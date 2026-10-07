import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { AccountExpense } from '../accounts/models/accountExpense.model';
import { VendorBill, BankAccount, JournalEntry } from '../ledger/ledger.models';
import { WorkLog } from '../workLogs/workLog.model';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsPayrollRun } from '../hrms/models/hrmsPayroll.model';
import { getHrSettings, hourlyCost, countWorkingDays } from '../hrms/policy.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Management numbers: revenue vs cost by project and client, utilisation and
 * cash. Labour cost = logged hours × each person's hourly cost (explicit rate
 * or CTC ÷ standard hours). Amounts are in each document's currency; mixed
 * currencies are summed as-is, so keep one base currency for accurate totals.
 */
export async function profitability(ws: string | null | undefined, from: Date, to: Date) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const [settings, employees, projects] = await Promise.all([
    getHrSettings(String(orgOid)),
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId: { $ne: null } }).select('userId annualCtc hourlyCostRate status').lean(),
    Project.find({ taskflowOrganizationId: orgOid }).select('name key crmAccountId').lean(),
  ]);
  const rateByUser = new Map(employees.map((e) => [String(e.userId), hourlyCost(e, settings)]));
  const projectIds = projects.map((p) => p._id);

  // Revenue (net of tax) per project
  const invoices = await BillingInvoice.find({
    taskflowOrganizationId: orgOid,
    status: { $in: ['sent', 'paid', 'overdue'] },
    issueDate: { $gte: from, $lte: to },
  })
    .select('projectId accountId total taxTotal amountCredited currency')
    .populate('accountId', 'name')
    .lean();

  // Labour per project
  const issueToProject = new Map<string, string>();
  const issues = await Issue.find({ project: { $in: projectIds } }).select('_id project').lean();
  for (const i of issues) issueToProject.set(String(i._id), String(i.project));
  const logs = await WorkLog.find({ issue: { $in: issues.map((i) => i._id) }, date: { $gte: from, $lte: to } })
    .select('issue author minutesSpent billable')
    .lean();

  // Other direct costs
  const [expenses, bills] = await Promise.all([
    AccountExpense.find({ taskflowOrganizationId: orgOid, projectId: { $ne: null }, status: { $in: ['approved', 'paid'] }, expenseDate: { $gte: from, $lte: to } }).select('projectId amount').lean(),
    VendorBill.find({ taskflowOrganizationId: orgOid, projectId: { $ne: null }, status: { $in: ['approved', 'paid'] }, billDate: { $gte: from, $lte: to } }).select('projectId subtotal').lean(),
  ]);

  type Row = { projectId: string; name: string; key?: string; revenue: number; labourCost: number; otherCost: number; hours: number; billableHours: number };
  const rows = new Map<string, Row>(
    projects.map((p) => [String(p._id), { projectId: String(p._id), name: p.name, key: p.key, revenue: 0, labourCost: 0, otherCost: 0, hours: 0, billableHours: 0 }])
  );
  const unassigned = { revenue: 0 };
  for (const inv of invoices) {
    const net = (inv.total ?? 0) - (inv.taxTotal ?? 0) - (inv.amountCredited ?? 0);
    const row = inv.projectId ? rows.get(String(inv.projectId)) : undefined;
    if (row) row.revenue += net;
    else unassigned.revenue += net;
  }
  let totalMinutes = 0;
  let billableMinutes = 0;
  let unratedMinutes = 0;
  for (const l of logs) {
    const row = rows.get(issueToProject.get(String(l.issue)) ?? '');
    const rate = rateByUser.get(String(l.author));
    totalMinutes += l.minutesSpent;
    if (l.billable !== false) billableMinutes += l.minutesSpent;
    if (rate === undefined) unratedMinutes += l.minutesSpent;
    if (!row) continue;
    row.hours += l.minutesSpent / 60;
    if (l.billable !== false) row.billableHours += l.minutesSpent / 60;
    row.labourCost += ((rate ?? 0) * l.minutesSpent) / 60;
  }
  for (const e of expenses) {
    const row = rows.get(String(e.projectId));
    if (row) row.otherCost += e.amount ?? 0;
  }
  for (const b of bills) {
    const row = rows.get(String(b.projectId));
    if (row) row.otherCost += b.subtotal ?? 0;
  }

  const projectRows = [...rows.values()]
    .map((r) => {
      const cost = r.labourCost + r.otherCost;
      return {
        ...r,
        revenue: round2(r.revenue),
        labourCost: round2(r.labourCost),
        otherCost: round2(r.otherCost),
        hours: round2(r.hours),
        billableHours: round2(r.billableHours),
        profit: round2(r.revenue - cost),
        marginPct: r.revenue ? Math.round(((r.revenue - cost) / r.revenue) * 1000) / 10 : null,
      };
    })
    .filter((r) => r.revenue || r.labourCost || r.otherCost)
    .sort((a, b) => b.revenue - a.revenue);

  // Per client (by invoice account)
  const clients = new Map<string, { name: string; revenue: number }>();
  for (const inv of invoices) {
    const acc = inv.accountId as unknown as { _id?: unknown; name?: string } | null;
    const key = acc?._id ? String(acc._id) : 'unknown';
    const c = clients.get(key) ?? { name: acc?.name ?? 'Unknown', revenue: 0 };
    c.revenue += (inv.total ?? 0) - (inv.taxTotal ?? 0) - (inv.amountCredited ?? 0);
    clients.set(key, c);
  }
  // Attribute project cost to the project's CRM account where set
  const clientCost = new Map<string, number>();
  for (const p of projects) {
    if (!p.crmAccountId) continue;
    const r = rows.get(String(p._id));
    if (r) clientCost.set(String(p.crmAccountId), (clientCost.get(String(p.crmAccountId)) ?? 0) + r.labourCost + r.otherCost);
  }
  const clientRows = [...clients.entries()]
    .map(([accountId, c]) => {
      const cost = clientCost.get(accountId) ?? 0;
      return { accountId, name: c.name, revenue: round2(c.revenue), cost: round2(cost), profit: round2(c.revenue - cost) };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Utilisation: logged & billable hours vs capacity of active people
  const working = countWorkingDays(from, to, settings.weekendDays ?? [0, 6], new Set());
  const active = employees.filter((e) => e.status !== 'terminated').length;
  const capacityHours = active * working * (settings.standardHoursPerDay ?? 8);
  const totals = projectRows.reduce(
    (s, r) => ({ revenue: s.revenue + r.revenue, labour: s.labour + r.labourCost, other: s.other + r.otherCost }),
    { revenue: unassigned.revenue, labour: 0, other: 0 }
  );

  return {
    from,
    to,
    totals: {
      revenue: round2(totals.revenue),
      labourCost: round2(totals.labour),
      otherCost: round2(totals.other),
      profit: round2(totals.revenue - totals.labour - totals.other),
      unassignedRevenue: round2(unassigned.revenue),
    },
    projects: projectRows,
    clients: clientRows,
    utilisation: {
      capacityHours: round2(capacityHours),
      loggedHours: round2(totalMinutes / 60),
      billableHours: round2(billableMinutes / 60),
      utilisationPct: capacityHours ? Math.round((totalMinutes / 60 / capacityHours) * 1000) / 10 : null,
      billablePct: capacityHours ? Math.round((billableMinutes / 60 / capacityHours) * 1000) / 10 : null,
      /** Hours by people without an employee record / cost rate (cost counted as 0). */
      unratedHours: round2(unratedMinutes / 60),
    },
  };
}

export async function cashPosition(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const [receivables, payables, banks, lastPayroll] = await Promise.all([
    BillingInvoice.find({ taskflowOrganizationId: orgOid, status: { $in: ['sent', 'overdue'] } }).select('total amountPaid amountCredited dueDate').lean(),
    VendorBill.find({ taskflowOrganizationId: orgOid, status: 'approved' }).select('total amountPaid dueDate').lean(),
    BankAccount.find({ taskflowOrganizationId: orgOid, active: true }).select('name ledgerAccountId currency').lean(),
    HrmsPayrollRun.findOne({ taskflowOrganizationId: orgOid, status: { $in: ['finalized', 'paid'] } }).sort({ period: -1 }).select('totals period').lean(),
  ]);
  const due = (x: { total?: number | null; amountPaid?: number | null; amountCredited?: number | null }) => (x.total ?? 0) - (x.amountPaid ?? 0) - (x.amountCredited ?? 0);
  const bankRows = await Promise.all(
    banks.map(async (b) => {
      const agg = await JournalEntry.aggregate<{ d: number; c: number }>([
        { $match: { taskflowOrganizationId: orgOid, status: 'posted' } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': b.ledgerAccountId } },
        { $group: { _id: null, d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } },
      ]);
      return { name: b.name, currency: b.currency, balance: round2((agg[0]?.d ?? 0) - (agg[0]?.c ?? 0)) };
    })
  );
  return {
    bankBalance: round2(bankRows.reduce((s, b) => s + b.balance, 0)),
    banks: bankRows,
    receivables: round2(receivables.reduce((s, i) => s + due(i), 0)),
    overdueReceivables: round2(receivables.filter((i) => i.dueDate && i.dueDate < now).reduce((s, i) => s + due(i), 0)),
    payables: round2(payables.reduce((s, b) => s + due(b), 0)),
    next30: {
      expectedIn: round2(receivables.filter((i) => !i.dueDate || i.dueDate <= in30).reduce((s, i) => s + due(i), 0)),
      expectedOut: round2(payables.filter((b) => !b.dueDate || b.dueDate <= in30).reduce((s, b) => s + due(b), 0) + (lastPayroll?.totals?.net ?? 0)),
      payrollEstimate: round2(lastPayroll?.totals?.net ?? 0),
    },
  };
}

export async function payrollTrend(ws: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const runs = await HrmsPayrollRun.find({ taskflowOrganizationId: orgOid, status: { $in: ['finalized', 'paid'] } }).select('period totals').sort({ period: -1 }).limit(12).lean();
  return runs.reverse().map((r) => ({ period: r.period, gross: r.totals?.gross ?? 0, net: r.totals?.net ?? 0, employees: r.totals?.employees ?? 0 }));
}

type R = Request & { activeOrganizationId?: string };
export const insightsRoutes = Router();
insightsRoutes.use(authMiddleware, requireTaskflowUser, requireAnyPermission([TASK_FLOW_PERMISSIONS.TASKFLOW.PLATFORM.PROFITABILITY.READ]));

function range(req: Request) {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 90 * 86_400_000);
  return { from, to };
}

insightsRoutes.get('/profitability', asyncHandler(async (req: R, res: Response) => {
  const { from, to } = range(req);
  res.json({ success: true, data: await profitability(req.activeOrganizationId, from, to) });
}));
insightsRoutes.get('/cash', asyncHandler(async (req: R, res: Response) => {
  res.json({ success: true, data: await cashPosition(req.activeOrganizationId) });
}));
insightsRoutes.get('/payroll-trend', asyncHandler(async (req: R, res: Response) => {
  res.json({ success: true, data: await payrollTrend(req.activeOrganizationId) });
}));
