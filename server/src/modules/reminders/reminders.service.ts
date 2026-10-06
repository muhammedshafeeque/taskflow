import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { Milestone } from '../milestones/milestone.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { AssetLicense } from '../assets/models/assetLicense.model';
import { BillingSubscription } from '../billing/models/billingSubscription.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { generateSubscriptionInvoice } from '../billing/billing.service';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { notifyUser, type NotifyUserParams } from '../notifications/notificationDispatch.service';
import { claimReminder } from './reminderLog.model';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BATCH = 500;

type Id = mongoose.Types.ObjectId | string | null | undefined;

function day(d: Date | string | undefined | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : 'none';
}

function fmtDate(d: Date | string | undefined | null): string {
  return d ? new Date(d).toDateString() : '';
}

/** Send to each distinct user once; failures are logged, never thrown. */
async function notifyMany(userIds: Id[], params: Omit<NotifyUserParams, 'userId'>): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  await Promise.all(
    unique.map((userId) =>
      notifyUser({ ...params, userId }).catch((err) => console.error('reminder notify failed', err))
    )
  );
}

const adminCache = new Map<string, { at: number; ids: string[] }>();

/** Workspace admins — the fallback audience for records without an owner. */
async function orgAdmins(orgId: Id): Promise<string[]> {
  if (!orgId) return [];
  const key = String(orgId);
  const hit = adminCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.ids;
  const rows = await OrganizationMember.find({ organization: orgId, role: 'org_admin', status: 'active' })
    .select('user')
    .lean();
  const ids = rows.map((r) => String(r.user));
  adminCache.set(key, { at: Date.now(), ids });
  return ids;
}

// ── Project management ────────────────────────────────────────────────────

async function closedStatusesByProject(projectIds: Id[]): Promise<Map<string, Set<string>>> {
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select('statuses')
    .lean();
  const map = new Map<string, Set<string>>();
  for (const p of projects) {
    map.set(String(p._id), new Set(getClosedStatusNamesFromStatuses(p.statuses)));
  }
  return map;
}

export async function remindIssueDueDates(now = new Date()): Promise<number> {
  const issues = await Issue.find({
    assignee: { $exists: true, $ne: null },
    dueDate: { $gte: new Date(now.getTime() - 30 * DAY), $lte: new Date(now.getTime() + DAY) },
  })
    .select('title key status assignee project dueDate')
    .limit(BATCH * 4)
    .lean();
  if (!issues.length) return 0;

  const closed = await closedStatusesByProject([...new Set(issues.map((i) => String(i.project)))]);
  let sent = 0;
  for (const issue of issues) {
    if (closed.get(String(issue.project))?.has(issue.status)) continue;
    const overdue = new Date(issue.dueDate as Date) < now;
    const kind = overdue ? 'task_overdue' : 'task_due_soon';
    if (!(await claimReminder(kind, `${issue._id}:${day(issue.dueDate)}`))) continue;
    const label = issue.key ? `${issue.key} ${issue.title}` : issue.title;
    await notifyMany([issue.assignee], {
      eventKey: kind,
      title: overdue ? `Overdue: ${label}` : `Due soon: ${label}`,
      body: `${overdue ? 'Was due' : 'Due'} ${fmtDate(issue.dueDate)} · status ${issue.status}`,
      link: `/projects/${issue.project}/issues/${issue.key ?? issue._id}`,
      metadata: { issueId: String(issue._id), projectId: String(issue.project) },
    });
    sent++;
  }
  return sent;
}

export async function remindMilestones(now = new Date()): Promise<number> {
  const milestones = await Milestone.find({
    status: { $nin: ['completed', 'closed', 'done'] },
    dueDate: { $gte: now, $lte: new Date(now.getTime() + 3 * DAY) },
  })
    .select('name project dueDate')
    .limit(BATCH)
    .lean();
  let sent = 0;
  for (const m of milestones) {
    if (!(await claimReminder('milestone_due_soon', `${m._id}:${day(m.dueDate)}`))) continue;
    const project = await Project.findById(m.project).select('lead name').lean();
    await notifyMany([project?.lead], {
      eventKey: 'milestone_due_soon',
      title: `Milestone due soon: ${m.name}`,
      body: `${project?.name ?? 'Project'} · due ${fmtDate(m.dueDate)}`,
      link: `/projects/${m.project}/roadmap`,
      metadata: { milestoneId: String(m._id), projectId: String(m.project) },
    });
    sent++;
  }
  return sent;
}

// ── Service desk SLA ──────────────────────────────────────────────────────

const SLA_WARN_MS = Number(process.env.SLA_WARN_MINUTES || 60) * 60 * 1000;

export async function remindSla(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + SLA_WARN_MS);
  const tickets = await ServiceTicket.find({
    status: { $nin: ['resolved', 'closed'] },
    $or: [
      { firstRespondedAt: null, firstResponseDueAt: { $lte: horizon } },
      { resolutionDueAt: { $lte: horizon } },
    ],
  })
    .select('subject taskflowOrganizationId assigneeId firstResponseDueAt firstRespondedAt resolutionDueAt priority')
    .limit(BATCH)
    .lean();

  let sent = 0;
  for (const t of tickets) {
    const checks: Array<{ what: 'response' | 'resolution'; due?: Date | null }> = [
      { what: 'response', due: t.firstRespondedAt ? null : t.firstResponseDueAt },
      { what: 'resolution', due: t.resolutionDueAt },
    ];
    for (const { what, due } of checks) {
      if (!due || new Date(due) > horizon) continue;
      const breached = new Date(due) <= now;
      const kind = breached ? 'sla_breached' : 'sla_breach_warning';
      if (!(await claimReminder(kind, `${t._id}:${what}:${new Date(due).toISOString()}`))) continue;
      const audience: Id[] = t.assigneeId ? [t.assigneeId] : await orgAdmins(t.taskflowOrganizationId);
      // Breaches also go to admins so an unattended queue gets noticed.
      if (breached && t.assigneeId) audience.push(...(await orgAdmins(t.taskflowOrganizationId)));
      await notifyMany(audience, {
        eventKey: kind,
        title: breached ? `SLA breached (${what}): ${t.subject}` : `SLA at risk (${what}): ${t.subject}`,
        body: `${t.priority} priority · ${what} due ${new Date(due).toLocaleString()}`,
        link: `/service/tickets?ticket=${t._id}`,
        metadata: { ticketId: String(t._id) },
      });
      sent++;
    }
  }
  return sent;
}

// ── CRM ───────────────────────────────────────────────────────────────────

export async function remindCrmFollowUps(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + HOUR);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const [leads, activities] = await Promise.all([
    CrmLead.find({
      status: { $nin: ['converted', 'unqualified'] },
      assigneeId: { $exists: true, $ne: null },
      nextFollowUpAt: { $gte: weekAgo, $lte: soon },
    })
      .select('title companyName assigneeId nextFollowUpAt')
      .limit(BATCH)
      .lean(),
    CrmActivity.find({
      completedAt: null,
      dueAt: { $gte: weekAgo, $lte: soon },
    })
      .select('subject type assigneeId createdBy dueAt relatedType relatedId')
      .limit(BATCH)
      .lean(),
  ]);

  let sent = 0;
  for (const lead of leads) {
    if (!(await claimReminder('crm_follow_up_due', `lead:${lead._id}:${new Date(lead.nextFollowUpAt as Date).toISOString()}`))) continue;
    await notifyMany([lead.assigneeId], {
      eventKey: 'crm_follow_up_due',
      title: `Follow up: ${lead.title}`,
      body: `${lead.companyName ? `${lead.companyName} · ` : ''}due ${new Date(lead.nextFollowUpAt as Date).toLocaleString()}`,
      link: `/crm/leads/${lead._id}`,
      metadata: { leadId: String(lead._id) },
    });
    sent++;
  }
  for (const a of activities) {
    if (!(await claimReminder('crm_follow_up_due', `activity:${a._id}:${new Date(a.dueAt as Date).toISOString()}`))) continue;
    await notifyMany([a.assigneeId ?? a.createdBy], {
      eventKey: 'crm_follow_up_due',
      title: `${a.type.replace('_', ' ')} due: ${a.subject}`,
      body: `Due ${new Date(a.dueAt as Date).toLocaleString()}`,
      link: a.relatedType === 'lead' ? `/crm/leads/${a.relatedId}` : '/crm/follow-ups',
      metadata: { activityId: String(a._id) },
    });
    sent++;
  }
  return sent;
}

export async function remindStaleDeals(now = new Date()): Promise<number> {
  const deals = await CrmDeal.find({
    status: 'open',
    ownerId: { $exists: true, $ne: null },
    updatedAt: { $lt: new Date(now.getTime() - 14 * DAY) },
  })
    .select('title ownerId updatedAt value currency')
    .limit(BATCH)
    .lean();
  let sent = 0;
  for (const d of deals) {
    // Once per deal per period of inactivity; touching the deal resets the key.
    if (!(await claimReminder('crm_deal_stale', `${d._id}:${day(d.updatedAt)}`))) continue;
    await notifyMany([d.ownerId], {
      eventKey: 'crm_deal_stale',
      title: `Stale deal: ${d.title}`,
      body: `No activity since ${fmtDate(d.updatedAt)} · ${d.currency} ${d.value}`,
      link: '/crm/deals',
      metadata: { dealId: String(d._id) },
    });
    sent++;
  }
  return sent;
}

// ── Renewals ──────────────────────────────────────────────────────────────

const RENEWAL_WINDOW_DAYS = [30, 7, 1];

/** Which reminder bucket (30/7/1 days out) a date falls into, if any. */
function renewalBucket(date: Date, now: Date): number | null {
  const daysLeft = (date.getTime() - now.getTime()) / DAY;
  if (daysLeft < 0) return null;
  const buckets = RENEWAL_WINDOW_DAYS.filter((b) => daysLeft <= b);
  return buckets.length ? Math.min(...buckets) : null;
}

export async function remindRenewals(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 30 * DAY);
  const [contracts, licenses] = await Promise.all([
    CrmContract.find({
      status: 'active',
      $or: [{ renewalDate: { $gte: now, $lte: horizon } }, { endDate: { $gte: now, $lte: horizon } }],
    })
      .select('title taskflowOrganizationId dealId renewalDate endDate autoRenew value currency')
      .limit(BATCH)
      .lean(),
    AssetLicense.find({ status: 'active', renewalDate: { $gte: now, $lte: horizon } })
      .select('name vendor taskflowOrganizationId renewalDate seatsTotal seatCost currency')
      .limit(BATCH)
      .lean(),
  ]);

  let sent = 0;
  for (const c of contracts) {
    const date = new Date((c.renewalDate ?? c.endDate) as Date);
    const bucket = renewalBucket(date, now);
    if (bucket === null) continue;
    if (!(await claimReminder('contract_renewal_due', `${c._id}:${day(date)}:${bucket}`))) continue;
    const deal = c.dealId ? await CrmDeal.findById(c.dealId).select('ownerId').lean() : null;
    const audience = [deal?.ownerId, ...(await orgAdmins(c.taskflowOrganizationId))];
    await notifyMany(audience, {
      eventKey: 'contract_renewal_due',
      title: `${c.autoRenew ? 'Contract auto-renews' : 'Contract renewal due'}: ${c.title}`,
      body: `${fmtDate(date)} (${bucket} day${bucket > 1 ? 's' : ''}) · ${c.currency} ${c.value}`,
      link: `/contracts/${c._id}`,
      metadata: { contractId: String(c._id) },
    });
    sent++;
  }
  for (const l of licenses) {
    const date = new Date(l.renewalDate as Date);
    const bucket = renewalBucket(date, now);
    if (bucket === null) continue;
    if (!(await claimReminder('license_renewal_due', `${l._id}:${day(date)}:${bucket}`))) continue;
    await notifyMany(await orgAdmins(l.taskflowOrganizationId), {
      eventKey: 'license_renewal_due',
      title: `License renewal: ${l.name}`,
      body: `${l.vendor ? `${l.vendor} · ` : ''}renews ${fmtDate(date)} · ${l.seatsTotal} seats`,
      link: '/assets/licenses',
      metadata: { licenseId: String(l._id) },
    });
    sent++;
  }
  return sent;
}

// ── Billing ───────────────────────────────────────────────────────────────

/**
 * Creates DRAFT invoices for subscriptions whose billing date has arrived.
 * Subscriptions more than one cycle behind are skipped (and reported once) so a
 * stale record doesn't mint a pile of back-dated invoices.
 */
export async function generateDueSubscriptionInvoices(now = new Date()): Promise<number> {
  // Opt-in: creating invoices automatically is a business decision.
  if (process.env.BILLING_AUTO_INVOICE !== 'true') return 0;
  const subs = await BillingSubscription.find({
    status: 'active',
    autoRenew: true,
    nextBillingDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  })
    .select('name taskflowOrganizationId nextBillingDate billingCycle createdBy')
    .limit(100)
    .lean();

  let made = 0;
  for (const sub of subs) {
    const next = new Date(sub.nextBillingDate as Date);
    const maxLagDays = sub.billingCycle === 'annual' ? 366 : sub.billingCycle === 'quarterly' ? 92 : 31;
    const admins = await orgAdmins(sub.taskflowOrganizationId);
    if (now.getTime() - next.getTime() > maxLagDays * DAY) {
      if (await claimReminder('invoice_generated', `stale:${sub._id}:${day(next)}`)) {
        await notifyMany(admins, {
          eventKey: 'invoice_generated',
          title: `Subscription needs review: ${sub.name}`,
          body: `Next billing date ${fmtDate(next)} is over a cycle behind — no invoice was auto-generated.`,
          link: '/billing/subscriptions',
        });
      }
      continue;
    }
    // Claim first so two instances never both generate.
    if (!(await claimReminder('subscription_invoice', `${sub._id}:${day(next)}`))) continue;
    try {
      const invoice = await generateSubscriptionInvoice(String(sub._id), String(sub.taskflowOrganizationId));
      made++;
      await notifyMany([sub.createdBy, ...admins], {
        eventKey: 'invoice_generated',
        title: `Draft invoice ${invoice?.number ?? ''} generated`,
        body: `${sub.name} · ${invoice?.currency ?? ''} ${invoice?.total ?? ''} — review and send.`,
        link: invoice ? `/billing/invoices/${invoice._id}` : '/billing/invoices',
        metadata: { subscriptionId: String(sub._id), invoiceId: invoice ? String(invoice._id) : undefined },
      });
    } catch (err) {
      console.error('auto subscription invoice failed', sub._id, err);
    }
  }
  return made;
}

export async function markOverdueInvoices(now = new Date()): Promise<number> {
  const invoices = await BillingInvoice.find({ status: 'sent', dueDate: { $lt: now } })
    .select('number taskflowOrganizationId createdBy dueDate total amountPaid currency')
    .limit(BATCH)
    .lean();
  let sent = 0;
  for (const inv of invoices) {
    if ((inv.amountPaid ?? 0) >= (inv.total ?? 0) && (inv.total ?? 0) > 0) continue;
    await BillingInvoice.updateOne({ _id: inv._id, status: 'sent' }, { $set: { status: 'overdue' } });
    if (!(await claimReminder('invoice_overdue', `${inv._id}:${day(inv.dueDate)}`))) continue;
    await notifyMany([inv.createdBy, ...(await orgAdmins(inv.taskflowOrganizationId))], {
      eventKey: 'invoice_overdue',
      title: `Invoice ${inv.number} is overdue`,
      body: `Due ${fmtDate(inv.dueDate)} · ${inv.currency} ${(inv.total ?? 0) - (inv.amountPaid ?? 0)} outstanding`,
      link: `/billing/invoices/${inv._id}`,
      metadata: { invoiceId: String(inv._id) },
    });
    sent++;
  }
  return sent;
}

export const REMINDER_JOBS = {
  issueDueDates: remindIssueDueDates,
  milestones: remindMilestones,
  sla: remindSla,
  crmFollowUps: remindCrmFollowUps,
  staleDeals: remindStaleDeals,
  renewals: remindRenewals,
  subscriptionInvoices: generateDueSubscriptionInvoices,
  overdueInvoices: markOverdueInvoices,
} as const;

export type ReminderJobName = keyof typeof REMINDER_JOBS;
