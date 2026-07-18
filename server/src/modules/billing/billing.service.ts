import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { WorkLog } from '../workLogs/workLog.model';
import { BillingSubscription } from './models/billingSubscription.model';
import { BillingInvoice, type IBillingInvoiceLine } from './models/billingInvoice.model';
import { BillingTaxRule } from './models/billingTaxRule.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function calcLineAmount(line: { quantity?: number; unitPrice?: number; taxRate?: number }): {
  amount: number;
  tax: number;
} {
  const qty = Number(line.quantity ?? 1);
  const unit = Number(line.unitPrice ?? 0);
  const base = Math.round(qty * unit * 100) / 100;
  const tax = Math.round(base * (Number(line.taxRate ?? 0) / 100) * 100) / 100;
  return { amount: base, tax };
}

function normalizeLines(lines: unknown): IBillingInvoiceLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((raw) => {
    const l = raw as Record<string, unknown>;
    const { amount, tax } = calcLineAmount(l);
    return {
      description: String(l.description ?? 'Line').trim() || 'Line',
      quantity: Number(l.quantity ?? 1),
      unitPrice: Number(l.unitPrice ?? 0),
      taxRate: Number(l.taxRate ?? 0),
      amount,
      sourceType: (l.sourceType as IBillingInvoiceLine['sourceType']) ?? 'manual',
      sourceId: l.sourceId ? String(l.sourceId) : undefined,
      // tax stored via invoice taxTotal; amount is pre-tax line total
      ...(tax >= 0 ? {} : {}),
    };
  });
}

function totalsFromLines(lines: IBillingInvoiceLine[]) {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const taxTotal =
    Math.round(lines.reduce((s, l) => s + l.amount * ((l.taxRate ?? 0) / 100), 0) * 100) / 100;
  return { subtotal, taxTotal, total: Math.round((subtotal + taxTotal) * 100) / 100 };
}

function monthlyAmount(amount: number, cycle: string): number {
  if (cycle === 'annual') return amount / 12;
  if (cycle === 'quarterly') return amount / 3;
  return amount;
}

async function nextInvoiceNumber(orgOid: mongoose.Types.ObjectId): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await BillingInvoice.find({ taskflowOrganizationId: orgOid, number: new RegExp(`^${prefix}`) })
    .sort({ number: -1 })
    .limit(1)
    .lean();
  const lastNum = last[0]?.number?.split('-').pop();
  const next = (lastNum ? Number(lastNum) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function assertAccount(orgOid: mongoose.Types.ObjectId, accountId: unknown) {
  const account = await CrmAccount.findOne({ _id: accountId, taskflowOrganizationId: orgOid });
  if (!account) throw new ApiError(404, 'Account not found');
  return account;
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export async function getBillingDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();

  const [subscriptions, invoices, taxRules, unbilled] = await Promise.all([
    BillingSubscription.find({ taskflowOrganizationId: orgOid }).lean(),
    BillingInvoice.find({ taskflowOrganizationId: orgOid }).lean(),
    BillingTaxRule.find({ taskflowOrganizationId: orgOid }).lean(),
    getUnbilledTimeSummary(workspaceId),
  ]);

  const activeSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'trial');
  const mrr = Math.round(
    activeSubs.reduce((s, sub) => s + monthlyAmount(sub.amount ?? 0, sub.billingCycle), 0) * 100
  ) / 100;
  const arr = Math.round(mrr * 12 * 100) / 100;

  const openInvoices = invoices.filter((i) => i.status === 'draft' || i.status === 'sent' || i.status === 'overdue');
  const overdue = invoices.filter((i) => {
    if (i.status === 'overdue') return true;
    if (i.status === 'sent' && i.dueDate && new Date(i.dueDate) < now) return true;
    return false;
  });
  const paid = invoices.filter((i) => i.status === 'paid');
  const outstanding = openInvoices.reduce((s, i) => s + Math.max(0, (i.total ?? 0) - (i.amountPaid ?? 0)), 0);
  const collected = paid.reduce((s, i) => s + (i.total ?? 0), 0);

  const byStatus = ['draft', 'sent', 'paid', 'overdue', 'void'].map((status) => ({
    name: status,
    count: invoices.filter((i) => i.status === status).length,
    value: invoices.filter((i) => i.status === status).reduce((s, i) => s + (i.total ?? 0), 0),
  }));

  const byCycle = ['monthly', 'quarterly', 'annual'].map((cycle) => ({
    name: cycle,
    count: activeSubs.filter((s) => s.billingCycle === cycle).length,
    mrr: Math.round(
      activeSubs
        .filter((s) => s.billingCycle === cycle)
        .reduce((sum, sub) => sum + monthlyAmount(sub.amount ?? 0, sub.billingCycle), 0) * 100
    ) / 100,
  }));

  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const invoiceTrend = months.map((month) => {
    const inMonth = invoices.filter((inv) => {
      const d = inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 7) : '';
      return d === month;
    });
    return {
      month,
      invoiced: Math.round(inMonth.reduce((s, i) => s + (i.total ?? 0), 0) * 100) / 100,
      paid: Math.round(
        inMonth.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.total ?? 0), 0) * 100
      ) / 100,
      count: inMonth.length,
    };
  });

  const upcomingBilling = activeSubs
    .filter((s) => s.nextBillingDate)
    .map((s) => ({
      _id: String(s._id),
      name: s.name,
      amount: s.amount ?? 0,
      currency: s.currency ?? 'USD',
      nextBillingDate: s.nextBillingDate,
      daysUntil: Math.ceil((new Date(s.nextBillingDate!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      billingCycle: s.billingCycle,
      accountId: String(s.accountId),
    }))
    .filter((s) => s.daysUntil >= 0 && s.daysUntil <= 60)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 12);

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime())
    .slice(0, 8)
    .map((i) => ({
      _id: String(i._id),
      number: i.number,
      status: i.status,
      total: i.total ?? 0,
      currency: i.currency ?? 'USD',
      issueDate: i.issueDate,
      accountId: String(i.accountId),
    }));

  return {
    counts: {
      activeSubscriptions: activeSubs.length,
      drafts: invoices.filter((i) => i.status === 'draft').length,
      overdue: overdue.length,
      taxRules: taxRules.filter((t) => t.enabled).length,
      unbilledProjects: unbilled.projects.length,
    },
    mrr,
    arr,
    outstanding: Math.round(outstanding * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    unbilledHours: unbilled.totalHours,
    unbilledValue: unbilled.estimatedValue,
    byStatus,
    byCycle,
    invoiceTrend,
    upcomingBilling,
    recentInvoices,
  };
}

// ── Subscriptions ─────────────────────────────────────────────────────────

export async function listSubscriptions(
  workspaceId: string | null | undefined,
  query: { status?: string; accountId?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.accountId) filter.accountId = query.accountId;
  return BillingSubscription.find(filter)
    .populate('accountId', 'name type')
    .sort({ nextBillingDate: 1, createdAt: -1 })
    .lean();
}

export async function createSubscription(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  await assertAccount(orgOid, input.accountId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Name is required');
  if (!input.startDate) throw new ApiError(400, 'Start date is required');

  const seats = Math.max(1, Number(input.seats ?? 1));
  const unitPrice = Number(input.unitPrice ?? input.amount ?? 0);
  const amount = input.amount != null ? Number(input.amount) : seats * unitPrice;

  const doc = await BillingSubscription.create({
    taskflowOrganizationId: orgOid,
    accountId: input.accountId,
    contractId: input.contractId || undefined,
    name: String(input.name).trim(),
    planCode: input.planCode ? String(input.planCode).trim() : undefined,
    status: input.status ?? 'active',
    billingCycle: input.billingCycle ?? 'monthly',
    amount,
    currency: input.currency ?? 'USD',
    seats,
    unitPrice,
    startDate: asDate(input.startDate)!,
    nextBillingDate: asDate(input.nextBillingDate) ?? asDate(input.startDate),
    endDate: asDate(input.endDate),
    autoRenew: input.autoRenew !== false,
    notes: input.notes,
    createdBy: userId,
  });
  return BillingSubscription.findById(doc._id).populate('accountId', 'name type').lean();
}

export async function updateSubscription(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await BillingSubscription.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Subscription not found');

  const fields = [
    'name',
    'planCode',
    'status',
    'billingCycle',
    'amount',
    'currency',
    'seats',
    'unitPrice',
    'startDate',
    'nextBillingDate',
    'endDate',
    'autoRenew',
    'notes',
    'contractId',
    'accountId',
  ] as const;

  for (const key of fields) {
    if (!(key in input)) continue;
    const val = input[key];
    if (key === 'startDate' || key === 'nextBillingDate' || key === 'endDate') {
      (existing as unknown as Record<string, unknown>)[key] = val === null || val === '' ? undefined : asDate(val);
    } else if (key === 'autoRenew') {
      existing.autoRenew = Boolean(val);
    } else if (key === 'amount' || key === 'seats' || key === 'unitPrice') {
      (existing as unknown as Record<string, unknown>)[key] = Number(val);
    } else if (val !== undefined) {
      (existing as unknown as Record<string, unknown>)[key] = val === '' ? undefined : val;
    }
  }
  if (input.seats != null || input.unitPrice != null) {
    if (input.amount == null) {
      existing.amount = existing.seats * existing.unitPrice;
    }
  }
  await existing.save();
  return BillingSubscription.findById(existing._id).populate('accountId', 'name type').lean();
}

export async function deleteSubscription(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await BillingSubscription.findOneAndDelete({
    _id: id,
    taskflowOrganizationId: toOrgOid(orgId),
  });
  if (!deleted) throw new ApiError(404, 'Subscription not found');
  return { deleted: true };
}

export async function generateSubscriptionInvoice(
  id: string,
  workspaceId: string | null | undefined,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const sub = await BillingSubscription.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!sub) throw new ApiError(404, 'Subscription not found');

  const taxRules = await BillingTaxRule.find({ taskflowOrganizationId: orgOid, enabled: true }).lean();
  const defaultTax = taxRules[0];
  const taxRate = defaultTax?.rate ?? 0;

  const lines = normalizeLines([
    {
      description: `${sub.name} (${sub.billingCycle})` + (sub.seats > 1 ? ` × ${sub.seats} seats` : ''),
      quantity: 1,
      unitPrice: sub.amount,
      taxRate,
      sourceType: 'subscription',
      sourceId: String(sub._id),
    },
  ]);
  const { subtotal, taxTotal, total } = totalsFromLines(lines);
  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

  const invoice = await BillingInvoice.create({
    taskflowOrganizationId: orgOid,
    accountId: sub.accountId,
    subscriptionId: sub._id,
    contractId: sub.contractId,
    number: await nextInvoiceNumber(orgOid),
    status: 'draft',
    issueDate,
    dueDate,
    currency: sub.currency,
    subtotal,
    taxTotal,
    total,
    amountPaid: 0,
    lines,
    taxCode: defaultTax?.code,
    createdBy: userId,
  });

  // Advance next billing date
  const next = sub.nextBillingDate ? new Date(sub.nextBillingDate) : new Date();
  if (sub.billingCycle === 'annual') next.setFullYear(next.getFullYear() + 1);
  else if (sub.billingCycle === 'quarterly') next.setMonth(next.getMonth() + 3);
  else next.setMonth(next.getMonth() + 1);
  sub.nextBillingDate = next;
  await sub.save();

  return BillingInvoice.findById(invoice._id).populate('accountId', 'name type').lean();
}

// ── Invoices ──────────────────────────────────────────────────────────────

export async function listInvoices(
  workspaceId: string | null | undefined,
  query: { status?: string; accountId?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.accountId) filter.accountId = query.accountId;
  return BillingInvoice.find(filter)
    .populate('accountId', 'name type')
    .sort({ issueDate: -1 })
    .lean();
}

export async function createInvoice(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  await assertAccount(orgOid, input.accountId);
  const lines = normalizeLines(input.lines);
  if (lines.length === 0) throw new ApiError(400, 'At least one line item is required');
  const { subtotal, taxTotal, total } = totalsFromLines(lines);

  const doc = await BillingInvoice.create({
    taskflowOrganizationId: orgOid,
    accountId: input.accountId,
    subscriptionId: input.subscriptionId || undefined,
    contractId: input.contractId || undefined,
    projectId: input.projectId || undefined,
    number: input.number ? String(input.number) : await nextInvoiceNumber(orgOid),
    status: input.status ?? 'draft',
    issueDate: asDate(input.issueDate) ?? new Date(),
    dueDate: asDate(input.dueDate),
    currency: input.currency ?? 'USD',
    subtotal,
    taxTotal,
    total,
    amountPaid: Number(input.amountPaid ?? 0),
    lines,
    notes: input.notes,
    taxCode: input.taxCode,
    createdBy: userId,
  });
  return BillingInvoice.findById(doc._id).populate('accountId', 'name type').lean();
}

export async function updateInvoice(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await BillingInvoice.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Invoice not found');

  if (input.lines) {
    existing.lines = normalizeLines(input.lines);
    const t = totalsFromLines(existing.lines);
    existing.subtotal = t.subtotal;
    existing.taxTotal = t.taxTotal;
    existing.total = t.total;
  }
  if (input.status != null) existing.status = input.status as typeof existing.status;
  if (input.notes !== undefined) existing.notes = String(input.notes ?? '');
  if (input.taxCode !== undefined) existing.taxCode = String(input.taxCode ?? '');
  if (input.dueDate !== undefined) existing.dueDate = asDate(input.dueDate);
  if (input.issueDate !== undefined) existing.issueDate = asDate(input.issueDate) ?? existing.issueDate;
  if (input.amountPaid != null) existing.amountPaid = Number(input.amountPaid);
  if (input.postedToAccounts != null) existing.postedToAccounts = Boolean(input.postedToAccounts);
  if (input.currency) existing.currency = String(input.currency);

  // auto overdue
  if (
    existing.status === 'sent' &&
    existing.dueDate &&
    existing.dueDate < new Date() &&
    (existing.amountPaid ?? 0) < existing.total
  ) {
    existing.status = 'overdue';
  }

  await existing.save();
  return BillingInvoice.findById(existing._id).populate('accountId', 'name type').lean();
}

export async function recordPayment(
  id: string,
  workspaceId: string | null | undefined,
  input: { amount?: number; paidDate?: unknown; markPaid?: boolean }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const invoice = await BillingInvoice.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (invoice.status === 'void') throw new ApiError(400, 'Cannot record payment on a void invoice');

  const outstanding = Math.round((invoice.total - (invoice.amountPaid ?? 0)) * 100) / 100;
  const requested = input.markPaid ? outstanding : Number(input.amount ?? 0);
  if (!(requested > 0)) throw new ApiError(400, 'Payment amount must be greater than zero');
  const applied = Math.min(requested, outstanding);

  invoice.amountPaid = Math.round(((invoice.amountPaid ?? 0) + applied) * 100) / 100;
  if (invoice.amountPaid >= invoice.total - 0.01) {
    invoice.status = 'paid';
  } else if (invoice.status === 'draft') {
    invoice.status = 'sent';
  }
  await invoice.save();
  return BillingInvoice.findById(invoice._id).populate('accountId', 'name type').lean();
}

export async function deleteInvoice(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await BillingInvoice.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Invoice not found');
  if (existing.status === 'paid') throw new ApiError(400, 'Cannot delete a paid invoice');
  await existing.deleteOne();
  return { deleted: true };
}

// ── Tax ───────────────────────────────────────────────────────────────────

export async function listTaxRules(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return BillingTaxRule.find({ taskflowOrganizationId: toOrgOid(orgId) }).sort({ code: 1 }).lean();
}

export async function createTaxRule(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!input.name || !input.code) throw new ApiError(400, 'Name and code are required');
  try {
    const doc = await BillingTaxRule.create({
      taskflowOrganizationId: toOrgOid(orgId),
      name: String(input.name).trim(),
      code: String(input.code).trim().toUpperCase(),
      rate: Number(input.rate ?? 0),
      jurisdiction: input.jurisdiction,
      hsnSac: input.hsnSac,
      inclusive: Boolean(input.inclusive),
      enabled: input.enabled !== false,
      notes: input.notes,
    });
    return doc.toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Tax code already exists');
    throw err;
  }
}

export async function updateTaxRule(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await BillingTaxRule.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    {
      $set: {
        ...(input.name != null ? { name: String(input.name).trim() } : {}),
        ...(input.code != null ? { code: String(input.code).trim().toUpperCase() } : {}),
        ...(input.rate != null ? { rate: Number(input.rate) } : {}),
        ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
        ...(input.hsnSac !== undefined ? { hsnSac: input.hsnSac } : {}),
        ...(input.inclusive != null ? { inclusive: Boolean(input.inclusive) } : {}),
        ...(input.enabled != null ? { enabled: Boolean(input.enabled) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Tax rule not found');
  return updated;
}

export async function deleteTaxRule(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await BillingTaxRule.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Tax rule not found');
  return { deleted: true };
}

// ── Time to invoice ───────────────────────────────────────────────────────

export async function getUnbilledTimeSummary(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const projects = await Project.find({ taskflowOrganizationId: orgOid })
    .select('name key crmAccountId')
    .lean();
  if (projects.length === 0) {
    return { from, to, totalHours: 0, estimatedValue: 0, projects: [] as Array<Record<string, unknown>> };
  }

  const projectIds = projects.map((p) => p._id);
  const issues = await Issue.find({ project: { $in: projectIds } }).select('_id project').lean();
  const issueToProject = new Map(issues.map((i) => [String(i._id), String(i.project)]));
  const issueIds = issues.map((i) => i._id);

  const logs =
    issueIds.length === 0
      ? []
      : await WorkLog.find({
          issue: { $in: issueIds },
          date: { $gte: from, $lte: to },
        })
          .select('issue minutesSpent')
          .lean();

  const minutesByProject = new Map<string, number>();
  for (const log of logs) {
    const pid = issueToProject.get(String(log.issue));
    if (!pid) continue;
    minutesByProject.set(pid, (minutesByProject.get(pid) ?? 0) + (log.minutesSpent ?? 0));
  }

  // Approximate hourly rate from linked subscription unitPrice or default 100
  const defaultRate = 100;
  const projectRows = projects
    .map((p) => {
      const minutes = minutesByProject.get(String(p._id)) ?? 0;
      const hours = Math.round((minutes / 60) * 10) / 10;
      return {
        projectId: String(p._id),
        projectName: p.name,
        projectKey: p.key,
        accountId: p.crmAccountId ? String(p.crmAccountId) : undefined,
        hours,
        estimatedValue: Math.round(hours * defaultRate * 100) / 100,
        rate: defaultRate,
      };
    })
    .filter((p) => p.hours > 0)
    .sort((a, b) => b.hours - a.hours);

  const totalHours = Math.round(projectRows.reduce((s, p) => s + p.hours, 0) * 10) / 10;
  const estimatedValue = Math.round(projectRows.reduce((s, p) => s + p.estimatedValue, 0) * 100) / 100;

  return { from, to, totalHours, estimatedValue, defaultRate, projects: projectRows };
}

export async function createInvoiceFromTime(
  workspaceId: string | null | undefined,
  input: {
    accountId: string;
    projectId: string;
    hours: number;
    rate?: number;
    taxRate?: number;
    description?: string;
  },
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  await assertAccount(orgOid, input.accountId);
  const project = await Project.findOne({ _id: input.projectId, taskflowOrganizationId: orgOid });
  if (!project) throw new ApiError(404, 'Project not found');

  const rate = Number(input.rate ?? 100);
  const hours = Number(input.hours);
  if (hours <= 0) throw new ApiError(400, 'Hours must be greater than zero');

  let taxRate = Number(input.taxRate ?? 0);
  if (!input.taxRate) {
    const tax = await BillingTaxRule.findOne({ taskflowOrganizationId: orgOid, enabled: true }).lean();
    if (tax) taxRate = tax.rate;
  }

  const lines = normalizeLines([
    {
      description:
        input.description ??
        `Professional services — ${project.key ?? project.name} (${hours}h @ ${rate})`,
      quantity: hours,
      unitPrice: rate,
      taxRate,
      sourceType: 'time',
      sourceId: String(project._id),
    },
  ]);
  const { subtotal, taxTotal, total } = totalsFromLines(lines);
  const issueDate = new Date();

  const doc = await BillingInvoice.create({
    taskflowOrganizationId: orgOid,
    accountId: input.accountId,
    projectId: project._id,
    number: await nextInvoiceNumber(orgOid),
    status: 'draft',
    issueDate,
    dueDate: new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    subtotal,
    taxTotal,
    total,
    amountPaid: 0,
    lines,
    createdBy: userId,
  });
  return BillingInvoice.findById(doc._id).populate('accountId', 'name type').lean();
}
