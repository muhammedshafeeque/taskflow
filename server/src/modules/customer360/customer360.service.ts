/**
 * Customer 360: one portal customer (CustomerOrg) with its CRM accounts, deals,
 * contracts, projects, open issues, tickets and SLA, invoices, payments and
 * monitor status. Each section is filled only when the viewer may see that kind
 * of record (same rules as the record graph); otherwise it is null.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { CrmPipeline } from '../crm/models/crmPipeline.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { SlaPolicy } from '../service-desk/models/slaPolicy.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { JournalEntry } from '../ledger/ledger.models';
import { MonitorErrorGroup, MonitorProject, MonitorUptimeCheck, MonitorUptimeSample } from '../monitor/monitor.models';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { GraphAccess } from '../links/links.service';

const DAY = 86_400_000;
const OPEN_TICKET = ['open', 'pending', 'in_progress'];
/** A ticket whose resolution is due within this window is "at risk". */
const SLA_AT_RISK_MS = 4 * 60 * 60 * 1000;
const RENEWAL_WARN_DAYS = 30;
const MONITOR_READ = [TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR.PROJECT.READ, TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR.PROJECT.MANAGE];

const round = (n: number) => Math.round(n * 100) / 100;
const oid = (id: unknown) => new mongoose.Types.ObjectId(String(id));

export type SlaState = 'ok' | 'at_risk' | 'breached' | 'none';

/** SLA state of one open ticket at `now`: breached once either due time has passed unmet. */
export function ticketSlaState(
  t: { status: string; firstResponseDueAt?: Date | null; firstRespondedAt?: Date | null; resolutionDueAt?: Date | null },
  now = Date.now()
): SlaState {
  if (!OPEN_TICKET.includes(t.status)) return 'none';
  const responseDue = t.firstResponseDueAt ? new Date(t.firstResponseDueAt).getTime() : null;
  const resolutionDue = t.resolutionDueAt ? new Date(t.resolutionDueAt).getTime() : null;
  if (responseDue == null && resolutionDue == null) return 'none';
  if (responseDue != null && !t.firstRespondedAt && responseDue < now) return 'breached';
  if (resolutionDue != null && resolutionDue < now) return 'breached';
  if (resolutionDue != null && resolutionDue - now < SLA_AT_RISK_MS) return 'at_risk';
  if (responseDue != null && !t.firstRespondedAt && responseDue - now < SLA_AT_RISK_MS) return 'at_risk';
  return 'ok';
}

export type HealthFlag = { level: 'red' | 'amber'; area: string; text: string };

export async function getCustomer360(access: GraphAccess, customerId: string) {
  if (!mongoose.Types.ObjectId.isValid(customerId) || !(await access.canSeeType('customer'))) {
    throw new ApiError(404, 'Customer not found');
  }
  const customer = await CustomerOrg.findOne({ _id: customerId, taskflowOrganizationId: access.orgOid })
    .select('name status contactEmail contactPhone crmAccountId createdAt')
    .lean();
  if (!customer) throw new ApiError(404, 'Customer not found');
  const cid = oid(customerId);
  const now = Date.now();

  // ── Who the customer is in CRM, and which projects are theirs ────────────
  const accounts = await CrmAccount.find({
    taskflowOrganizationId: access.orgOid,
    $or: [{ customerOrgId: cid }, ...(customer.crmAccountId ? [{ _id: customer.crmAccountId }] : [])],
  })
    .select('name type projectIds')
    .lean();
  const accountIds = accounts.map((a) => a._id);
  const belongs = {
    taskflowOrganizationId: access.orgOid,
    $or: [{ customerOrgId: cid }, ...(accountIds.length ? [{ accountId: { $in: accountIds } }] : [])],
  };

  const [mapped, viaAccount] = await Promise.all([
    CustomerProjectMapping.find({ customerOrgId: cid, status: 'active' }).distinct('projectId'),
    accountIds.length ? Project.find({ crmAccountId: { $in: accountIds } }).distinct('_id') : Promise.resolve([]),
  ]);
  const projectIdSet = new Set([...mapped, ...viaAccount, ...accounts.flatMap((a) => a.projectIds ?? [])].map(String));
  const allProjects = await Project.find({ _id: { $in: [...projectIdSet].map(oid) }, taskflowOrganizationId: access.orgOid })
    .select('name key archived statuses')
    .lean();
  const projects = [];
  for (const p of allProjects) if (await access.canSeeProject(p._id)) projects.push(p);
  const projectIds = projects.map((p) => p._id);

  const [canDeals, canContracts, canTickets, canInvoices, canMonitor] = await Promise.all([
    access.canSeeType('deal'),
    access.canSeeType('contract'),
    access.canSeeType('ticket'),
    access.canSeeType('invoice'),
    access.can('monitor', MONITOR_READ),
  ]);

  const [deals, contracts, issues, tickets, invoices, monitor] = await Promise.all([
    canDeals ? loadDeals(belongs) : null,
    canContracts ? loadContracts(belongs, now) : null,
    loadIssues(projects, now),
    canTickets ? loadTickets(belongs, now) : null,
    canInvoices ? loadInvoices(access.orgOid, belongs, now) : null,
    canMonitor ? loadMonitor(access.orgOid, projectIds) : null,
  ]);

  const health: HealthFlag[] = [];
  if (tickets?.sla.breached) health.push({ level: 'red', area: 'tickets', text: `${tickets.sla.breached} ticket${tickets.sla.breached === 1 ? '' : 's'} past SLA` });
  if (tickets?.sla.atRisk) health.push({ level: 'amber', area: 'tickets', text: `${tickets.sla.atRisk} ticket${tickets.sla.atRisk === 1 ? '' : 's'} close to SLA` });
  if (invoices?.summary.overdueCount) {
    health.push({ level: 'red', area: 'invoices', text: `${invoices.summary.overdueCount} overdue invoice${invoices.summary.overdueCount === 1 ? '' : 's'} (${invoices.summary.overdue.toLocaleString('en')})` });
  }
  for (const m of monitor?.projects ?? []) {
    if (m.uptime === 'down') health.push({ level: 'red', area: 'monitor', text: `${m.name} is down` });
  }
  if (issues.summary.overdue) health.push({ level: 'amber', area: 'issues', text: `${issues.summary.overdue} overdue issue${issues.summary.overdue === 1 ? '' : 's'}` });
  for (const c of contracts?.items ?? []) {
    if (c.renewsInDays != null && c.renewsInDays >= 0 && c.renewsInDays <= RENEWAL_WARN_DAYS) {
      health.push({ level: 'amber', area: 'contracts', text: `${c.title} renews in ${c.renewsInDays} day${c.renewsInDays === 1 ? '' : 's'}` });
    }
  }

  return {
    customer: {
      id: String(customer._id),
      name: customer.name,
      status: customer.status,
      contactEmail: customer.contactEmail,
      contactPhone: customer.contactPhone,
      since: customer.createdAt,
      accounts: accounts.map((a) => ({ id: String(a._id), name: a.name, type: a.type })),
    },
    health,
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key, archived: Boolean((p as { archived?: boolean }).archived) })),
    hiddenProjects: allProjects.length - projects.length,
    deals,
    contracts,
    issues,
    tickets,
    invoices,
    monitor,
  };
}

type Belongs = Record<string, unknown>;

async function loadDeals(belongs: Belongs) {
  const rows = await CrmDeal.find(belongs)
    .select('title status value currency expectedCloseDate pipelineId stageId updatedAt')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  // Stages are embedded in their pipeline.
  const pipelines = await CrmPipeline.find({ _id: { $in: [...new Set(rows.map((d) => String(d.pipelineId)))] } })
    .select('stages._id stages.name')
    .lean();
  const stageName = new Map(pipelines.flatMap((p) => (p.stages ?? []).map((st) => [String(st._id), st.name] as const)));
  const open = rows.filter((d) => d.status === 'open');
  return {
    summary: {
      open: open.length,
      pipeline: round(open.reduce((s, d) => s + (d.value ?? 0), 0)),
      won: round(rows.filter((d) => d.status === 'won').reduce((s, d) => s + (d.value ?? 0), 0)),
    },
    items: rows.map((d) => ({
      id: String(d._id),
      title: d.title,
      status: d.status,
      value: d.value,
      currency: d.currency,
      stage: stageName.get(String(d.stageId)),
      expectedCloseDate: d.expectedCloseDate,
    })),
  };
}

async function loadContracts(belongs: Belongs, now: number) {
  const rows = await CrmContract.find(belongs)
    .select('title kind status value currency startDate endDate renewalDate slaPolicyId')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  const policyIds = [...new Set(rows.map((c) => c.slaPolicyId).filter(Boolean).map(String))];
  const policies = policyIds.length
    ? await SlaPolicy.find({ _id: { $in: policyIds } }).select('name targets').lean()
    : [];
  const policyById = new Map(policies.map((p) => [String(p._id), p]));
  return {
    summary: {
      active: rows.filter((c) => c.status === 'active').length,
      activeValue: round(rows.filter((c) => c.status === 'active').reduce((s, c) => s + (c.value ?? 0), 0)),
    },
    slaPolicies: policies.map((p) => ({
      id: String(p._id),
      name: p.name,
      targets: (p.targets ?? []).map((t) => ({
        priority: t.priority,
        firstResponseMinutes: t.firstResponseMinutes,
        resolutionMinutes: t.resolutionMinutes,
      })),
    })),
    items: rows.map((c) => {
      const renewal = c.renewalDate ?? c.endDate;
      return {
        id: String(c._id),
        title: c.title,
        kind: c.kind,
        status: c.status,
        value: c.value,
        currency: c.currency,
        startDate: c.startDate,
        endDate: c.endDate,
        renewalDate: c.renewalDate,
        renewsInDays: renewal && c.status === 'active' ? Math.ceil((new Date(renewal).getTime() - now) / DAY) : null,
        slaPolicy: c.slaPolicyId ? policyById.get(String(c.slaPolicyId))?.name : undefined,
      };
    }),
  };
}

type ProjectRow = { _id: unknown; key?: string; statuses?: Array<{ name?: string; isClosed?: boolean }> };

async function loadIssues(projects: ProjectRow[], now: number) {
  if (!projects.length) return { summary: { open: 0, overdue: 0 }, items: [] };
  const openFilter = {
    $or: projects.map((p) => ({ project: p._id, status: { $nin: getClosedStatusNamesFromStatuses(p.statuses) } })),
  };
  const overdueFilter = { ...openFilter, dueDate: { $lt: new Date(now) } };
  const [open, overdue, rows] = await Promise.all([
    Issue.countDocuments(openFilter),
    Issue.countDocuments(overdueFilter),
    // Overdue and soonest-due first, then recently touched.
    Issue.find(openFilter)
      .select('key title status priority type dueDate assignee project')
      .populate('assignee', 'name')
      .sort({ dueDate: 1, updatedAt: -1 })
      .limit(15)
      .lean(),
  ]);
  const withDue = rows.filter((i) => i.dueDate).concat(rows.filter((i) => !i.dueDate));
  return {
    summary: { open, overdue },
    items: withDue.map((i) => ({
      id: String(i._id),
      key: i.key,
      title: i.title,
      status: i.status,
      priority: i.priority,
      type: i.type,
      dueDate: i.dueDate,
      overdue: Boolean(i.dueDate && new Date(i.dueDate).getTime() < now),
      assignee: (i.assignee as { name?: string } | null)?.name,
      projectId: String(i.project),
    })),
  };
}

async function loadTickets(belongs: Belongs, now: number) {
  const [open, recent] = await Promise.all([
    ServiceTicket.find({ ...belongs, status: { $in: OPEN_TICKET } })
      .select('subject status priority queue firstResponseDueAt firstRespondedAt resolutionDueAt linkedIssueId createdAt')
      .populate('linkedIssueId', 'key')
      .sort({ resolutionDueAt: 1, updatedAt: -1 })
      .limit(50)
      .lean(),
    ServiceTicket.find({ ...belongs, csatScore: { $ne: null }, updatedAt: { $gte: new Date(now - 90 * DAY) } })
      .select('csatScore')
      .lean(),
  ]);
  const items = open.map((t) => ({
    id: String(t._id),
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    queue: t.queue,
    sla: ticketSlaState(t, now),
    resolutionDueAt: t.resolutionDueAt,
    linkedIssueKey: (t.linkedIssueId as { key?: string } | null)?.key,
    createdAt: t.createdAt,
  }));
  const csat = recent.map((t) => t.csatScore as number);
  return {
    summary: { open: items.length },
    sla: {
      breached: items.filter((t) => t.sla === 'breached').length,
      atRisk: items.filter((t) => t.sla === 'at_risk').length,
      onTrack: items.filter((t) => t.sla === 'ok').length,
    },
    csat: csat.length ? { average: round(csat.reduce((s, n) => s + n, 0) / csat.length), responses: csat.length } : null,
    items,
  };
}

async function loadInvoices(orgOid: mongoose.Types.ObjectId, belongs: Belongs, now: number) {
  const rows = await BillingInvoice.find({ ...belongs, status: { $ne: 'void' } })
    .select('number status total amountPaid amountCredited currency issueDate dueDate')
    .sort({ issueDate: -1 })
    .limit(100)
    .lean();
  const balance = (i: (typeof rows)[number]) => round((i.total ?? 0) - (i.amountPaid ?? 0) - (i.amountCredited ?? 0));
  const isOverdue = (i: (typeof rows)[number]) =>
    balance(i) > 0 && (i.status === 'overdue' || (i.status === 'sent' && Boolean(i.dueDate) && new Date(i.dueDate!).getTime() < now));
  const overdue = rows.filter(isOverdue);

  // Payments live in the ledger: one posted journal per payment, sourceId "<invoiceId>:<time>".
  const byId = new Map(rows.map((i) => [String(i._id), i]));
  const journals = rows.length
    ? await JournalEntry.find({
        taskflowOrganizationId: orgOid,
        sourceType: 'payment',
        status: 'posted',
        sourceId: { $regex: `^(${rows.map((i) => String(i._id)).join('|')}):` },
      })
        .select('date sourceId lines')
        .sort({ date: -1 })
        .limit(25)
        .lean()
    : [];
  const payments = journals.map((j) => {
    const inv = byId.get(String(j.sourceId).split(':')[0]);
    const lines = (j.lines ?? []) as Array<{ debit?: number }>;
    return {
      date: j.date,
      invoiceId: inv ? String(inv._id) : undefined,
      invoiceNumber: inv?.number,
      currency: inv?.currency,
      amount: round(lines.reduce((s, l) => s + (l.debit ?? 0), 0)),
    };
  });

  return {
    summary: {
      invoiced: round(rows.reduce((s, i) => s + (i.total ?? 0), 0)),
      collected: round(rows.reduce((s, i) => s + (i.amountPaid ?? 0), 0)),
      outstanding: round(rows.reduce((s, i) => s + Math.max(0, balance(i)), 0)),
      overdue: round(overdue.reduce((s, i) => s + balance(i), 0)),
      overdueCount: overdue.length,
      currency: rows[0]?.currency,
    },
    items: rows.slice(0, 25).map((i) => ({
      id: String(i._id),
      number: i.number,
      status: isOverdue(i) ? 'overdue' : i.status,
      total: i.total,
      balance: balance(i),
      currency: i.currency,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
    })),
    payments,
  };
}

async function loadMonitor(orgOid: mongoose.Types.ObjectId, projectIds: unknown[]) {
  if (!projectIds.length) return { projects: [] };
  const monitored = await MonitorProject.find({ taskflowOrganizationId: orgOid, sourceProjectId: { $in: projectIds } })
    .select('name key sourceProjectId')
    .lean();
  const projects = await Promise.all(
    monitored.map(async (m) => {
      const [openErrors, checks] = await Promise.all([
        MonitorErrorGroup.countDocuments({ projectId: m._id, status: 'open' }),
        MonitorUptimeCheck.find({ projectId: m._id, enabled: true }).select('name').lean(),
      ]);
      const latest = await Promise.all(
        checks.map((c) =>
          MonitorUptimeSample.findOne({ checkId: c._id }).sort({ timestamp: -1 }).select('ok timestamp').lean()
        )
      );
      const sampled = latest.filter(Boolean) as Array<{ ok: boolean; timestamp: Date }>;
      const down = checks.filter((_, i) => latest[i] && !latest[i]!.ok).map((c) => String(c.name));
      return {
        id: String(m._id),
        name: m.name,
        key: m.key,
        projectId: String(m.sourceProjectId),
        openErrors,
        checks: checks.length,
        uptime: (!sampled.length ? 'unknown' : down.length ? 'down' : 'up') as 'unknown' | 'down' | 'up',
        downChecks: down,
        lastCheckedAt: sampled.length ? new Date(Math.max(...sampled.map((s) => new Date(s.timestamp).getTime()))) : null,
      };
    })
  );
  return { projects };
}
