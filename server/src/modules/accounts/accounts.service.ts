import { autoPost, postExpense, postExpensePayment } from '../ledger/ledger.service';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import mongoose from 'mongoose';
import { AccountExpense } from './models/accountExpense.model';
import { AccountsSettings } from '../ledger/ledger.models';
import {
  EDITABLE_EXPENSE_STATUSES,
  EMPTY_EXPENSE_APPROVAL_SETTINGS,
  assertExpenseTransitionPermission,
  assertValidExpenseTransition,
  assertWithinMaxClaim,
  evaluateExpenseApproval,
  type ExpenseActor,
  type ExpenseApprovalSettings,
} from './expenseApproval';
import {
  cancelForRecord,
  decideForRecord,
  isApprovalChainEnabled,
  submitForApproval,
} from '../approvals/approvals.service';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function monthKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 7);
}

function lastMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return months;
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function listExpenses(
  workspaceId: string | null | undefined,
  query: { status?: string; category?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  return AccountExpense.find(filter).populate('vendorAccountId', 'name').populate('purchaseOrderId', 'poNumber').populate('projectId', 'name key').sort({ expenseDate: -1 }).lean();
}

function parseAmount(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Amount must be a non-negative number');
  return Math.round(n * 100) / 100;
}

export async function createExpense(workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.description || !String(input.description).trim()) throw new ApiError(400, 'Description is required');
  const status = input.status === undefined || input.status === '' ? 'submitted' : String(input.status);
  if (status !== 'draft' && status !== 'submitted') {
    throw new ApiError(400, 'New expenses can only start as draft or submitted');
  }
  const amount = parseAmount(input.amount);
  if (status === 'submitted') assertWithinMaxClaim(amount, await getExpenseApprovalSettings(orgId));
  const reference = input.reference
    ? String(input.reference).trim()
    : `EXP-${String((await AccountExpense.countDocuments({ taskflowOrganizationId: orgOid })) + 1).padStart(4, '0')}`;
  try {
    const doc = await AccountExpense.create({
      taskflowOrganizationId: orgOid,
      reference,
      description: String(input.description).trim(),
      category: input.category ?? 'other',
      status,
      vendorAccountId: input.vendorAccountId || undefined,
      purchaseOrderId: input.purchaseOrderId || undefined,
      projectId: input.projectId || undefined,
      amount,
      currency: input.currency ?? 'USD',
      expenseDate: asDate(input.expenseDate) ?? new Date(),
      submittedBy: userId,
      notes: input.notes,
      receiptUrls: Array.isArray(input.receiptUrls) ? input.receiptUrls.map(String).filter((u) => u.startsWith('/api/uploads/') || /^https:\/\//.test(u)).slice(0, 10) : [],
      reimbursable: Boolean(input.reimbursable),
    });
    if (status === 'submitted' && (await isApprovalChainEnabled(orgId, 'expense'))) {
      try {
        await submitForApproval(orgId, 'expense', String(doc._id), userId ?? '');
      } catch (err) {
        // Keep the claim, but as a draft, so it isn't left "submitted" with nobody to approve it.
        await AccountExpense.updateOne({ _id: doc._id }, { $set: { status: 'draft' } });
        throw err;
      }
    }
    return (await AccountExpense.findById(doc._id).lean())!;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Reference already exists');
    throw err;
  }
}

/** Edit a claim's details. Status changes go through transitionExpense so approval rules always apply. */
export async function updateExpense(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const exp = await AccountExpense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!exp) throw new ApiError(404, 'Expense not found');
  if ('status' in input && input.status !== exp.status) {
    throw new ApiError(400, 'Use the status endpoint (PATCH /accounts/expenses/:id/status) to change an expense status');
  }
  if (!EDITABLE_EXPENSE_STATUSES.includes(exp.status)) {
    throw new ApiError(400, `A ${exp.status} expense can no longer be edited`);
  }
  const fields = ['description', 'category', 'currency', 'notes', 'vendorAccountId', 'projectId', 'purchaseOrderId'] as const;
  for (const key of fields) if (key in input) (exp as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('amount' in input) {
    const amount = parseAmount(input.amount);
    if (amount !== exp.amount) {
      exp.amount = amount;
      if (exp.status === 'submitted') {
        assertWithinMaxClaim(amount, await getExpenseApprovalSettings(orgId));
        // The amount changed under review: any first approval no longer applies.
        exp.firstApprovedBy = undefined;
        exp.firstApprovedAt = undefined;
      }
    }
  }
  if ('expenseDate' in input) exp.expenseDate = asDate(input.expenseDate) ?? exp.expenseDate;
  await exp.save();
  return exp.toObject();
}

/**
 * Move a claim through draft → submitted → approved → paid (or rejected → draft).
 * Enforces valid moves, who may make them, no self-approval and the workspace amount limits.
 */
export async function transitionExpense(
  id: string,
  workspaceId: string | null | undefined,
  status: unknown,
  actor: ExpenseActor
): Promise<Record<string, unknown> & { awaitingSecondApproval: boolean }> {
  const orgId = requireWorkspaceId(workspaceId);
  const exp = await AccountExpense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!exp) throw new ApiError(404, 'Expense not found');

  const next = assertValidExpenseTransition(exp.status, status);
  const submittedBy = exp.submittedBy ? String(exp.submittedBy) : null;
  assertExpenseTransitionPermission(exp.status, next, actor, submittedBy);

  let awaitingSecondApproval = false;
  const clearApprovals = () => {
    exp.firstApprovedBy = undefined;
    exp.firstApprovedAt = undefined;
  };

  // With an approval chain turned on (Approvals → chains), the chain decides instead of the limits below.
  if (await isApprovalChainEnabled(orgId, 'expense')) {
    if (next === 'approved' || next === 'rejected') {
      const r = await decideForRecord(orgId, 'expense', id, actor, next === 'approved' ? 'approve' : 'reject');
      const fresh = (await AccountExpense.findById(exp._id).lean())!;
      return { ...fresh, awaitingSecondApproval: r.outcome === 'pending', approvalRequestId: String(r.request._id) };
    }
    if (next === 'submitted') {
      assertWithinMaxClaim(exp.amount, await getExpenseApprovalSettings(orgId));
      await submitForApproval(orgId, 'expense', id, actor.userId);
    }
    if (next === 'draft') await cancelForRecord(orgId, 'expense', id, actor.userId, 'Expense sent back to draft');
  }

  if (next === 'submitted') {
    assertWithinMaxClaim(exp.amount, await getExpenseApprovalSettings(orgId));
    clearApprovals();
    exp.status = 'submitted';
  } else if (next === 'approved') {
    const outcome = evaluateExpenseApproval({
      amount: exp.amount,
      submittedBy,
      firstApprovedBy: exp.firstApprovedBy ? String(exp.firstApprovedBy) : null,
      userId: actor.userId,
      roleId: actor.roleId,
      settings: await getExpenseApprovalSettings(orgId),
    });
    if (outcome === 'first_stage') {
      exp.firstApprovedBy = actor.userId as never;
      exp.firstApprovedAt = new Date();
      awaitingSecondApproval = true;
    } else {
      exp.status = 'approved';
      exp.approvedBy = actor.userId as never;
      exp.approvedAt = new Date();
    }
  } else if (next === 'rejected') {
    clearApprovals();
    exp.status = 'rejected';
    exp.rejectedBy = actor.userId as never;
    exp.rejectedAt = new Date();
  } else if (next === 'draft') {
    clearApprovals();
    exp.status = 'draft';
  } else if (next === 'paid') {
    exp.status = 'paid';
    if (!exp.paidDate) exp.paidDate = new Date();
  }

  await exp.save();
  if (exp.status === 'approved' || exp.status === 'paid') autoPost(() => postExpense(orgId, String(exp._id)), `expense ${exp.reference}`);
  if (exp.status === 'paid') autoPost(() => postExpensePayment(orgId, String(exp._id)), `expense payment ${exp.reference}`);
  return { ...exp.toObject(), awaitingSecondApproval };
}

/** Approval chain finished (called by the approval engine). */
export async function applyExpenseChainOutcome(orgId: string, id: string, outcome: 'approved' | 'rejected', userId: string) {
  const exp = await AccountExpense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId), status: 'submitted' });
  if (!exp) return;
  exp.firstApprovedBy = undefined;
  exp.firstApprovedAt = undefined;
  if (outcome === 'approved') {
    exp.status = 'approved';
    exp.approvedBy = userId as never;
    exp.approvedAt = new Date();
  } else {
    exp.status = 'rejected';
    exp.rejectedBy = userId as never;
    exp.rejectedAt = new Date();
  }
  await exp.save();
  if (outcome === 'approved') autoPost(() => postExpense(orgId, String(exp._id)), `expense ${exp.reference}`);
}

// ── Expense approval settings ────────────────────────────────────────────────

export async function getExpenseApprovalSettings(workspaceId: string | null | undefined): Promise<ExpenseApprovalSettings> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = (await AccountsSettings.findOne({ taskflowOrganizationId: orgOid }, { expenseApproval: 1 }).lean()) as {
    expenseApproval?: {
      singleApproverLimit?: number | null;
      maxClaimAmount?: number | null;
      secondApproverIds?: unknown[];
      approverLimits?: Array<{ userId?: unknown; roleId?: unknown; maxAmount: number }>;
    };
  } | null;
  const a = doc?.expenseApproval;
  if (!a) return { ...EMPTY_EXPENSE_APPROVAL_SETTINGS };
  return {
    singleApproverLimit: a.singleApproverLimit ?? null,
    maxClaimAmount: a.maxClaimAmount ?? null,
    secondApproverIds: (a.secondApproverIds ?? []).map(String),
    approverLimits: (a.approverLimits ?? []).map((r) => ({
      ...(r.userId ? { userId: String(r.userId) } : {}),
      ...(r.roleId ? { roleId: String(r.roleId) } : {}),
      maxAmount: r.maxAmount,
    })),
  };
}

function parseLimit(raw: unknown, field: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${field} must be a non-negative number`);
  return Math.round(n * 100) / 100;
}

function parseOid(raw: unknown, field: string): mongoose.Types.ObjectId {
  const s = String(raw ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(s)) throw new ApiError(400, `Invalid ${field}`);
  return new mongoose.Types.ObjectId(s);
}

export async function updateExpenseApprovalSettings(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
): Promise<ExpenseApprovalSettings> {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const current = await getExpenseApprovalSettings(workspaceId);
  const $set: Record<string, unknown> = {};

  const single = parseLimit(input.singleApproverLimit, 'singleApproverLimit');
  if (single !== undefined) $set['expenseApproval.singleApproverLimit'] = single;
  const max = parseLimit(input.maxClaimAmount, 'maxClaimAmount');
  if (max !== undefined) $set['expenseApproval.maxClaimAmount'] = max;

  if (input.secondApproverIds !== undefined) {
    if (!Array.isArray(input.secondApproverIds)) throw new ApiError(400, 'secondApproverIds must be an array');
    const unique = [...new Set(input.secondApproverIds.map((v) => String(parseOid(v, 'secondApproverId'))))];
    $set['expenseApproval.secondApproverIds'] = unique.map((v) => new mongoose.Types.ObjectId(v));
  }

  if (input.approverLimits !== undefined) {
    if (!Array.isArray(input.approverLimits)) throw new ApiError(400, 'approverLimits must be an array');
    $set['expenseApproval.approverLimits'] = input.approverLimits.map((raw) => {
      const rule = (raw ?? {}) as Record<string, unknown>;
      const maxAmount = parseLimit(rule.maxAmount, 'approverLimits.maxAmount');
      if (maxAmount == null) throw new ApiError(400, 'Each approver limit needs a non-negative maxAmount');
      if (!rule.userId && !rule.roleId) throw new ApiError(400, 'Each approver limit needs a userId or roleId');
      return {
        ...(rule.userId ? { userId: parseOid(rule.userId, 'approverLimits.userId') } : {}),
        ...(rule.roleId ? { roleId: parseOid(rule.roleId, 'approverLimits.roleId') } : {}),
        maxAmount,
      };
    });
  }

  const nextSingle = single !== undefined ? single : current.singleApproverLimit;
  const nextMax = max !== undefined ? max : current.maxClaimAmount;
  if (nextSingle != null && nextMax != null && nextSingle > nextMax) {
    throw new ApiError(400, 'The two-approval threshold cannot be above the maximum claim amount');
  }

  if (Object.keys($set).length > 0) {
    await AccountsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $set }, { upsert: true });
  }
  return getExpenseApprovalSettings(workspaceId);
}

export async function deleteExpense(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await AccountExpense.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Expense not found');
  await cancelForRecord(orgId, 'expense', id, undefined, 'Expense deleted');
  return { deleted: true };
}

// ── Invoices (finance view of billing invoices) ──────────────────────────────

export async function listAccountInvoices(workspaceId: string | null | undefined, query: { status?: string } = {}) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  return BillingInvoice.find(filter).populate('accountId', 'name').sort({ issueDate: -1 }).lean();
}

export async function postInvoiceToLedger(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const inv = await BillingInvoice.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  inv.postedToAccounts = !inv.postedToAccounts;
  await inv.save();
  return { _id: String(inv._id), postedToAccounts: inv.postedToAccounts };
}

// ── Ledger (derived GL) ──────────────────────────────────────────────────────

export async function getLedger(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const [invoices, expenses] = await Promise.all([
    BillingInvoice.find({ taskflowOrganizationId: orgOid, status: { $ne: 'void' } }).populate('accountId', 'name').sort({ issueDate: -1 }).lean(),
    AccountExpense.find({ taskflowOrganizationId: orgOid, status: { $ne: 'rejected' } }).populate('vendorAccountId', 'name').sort({ expenseDate: -1 }).lean(),
  ]);

  const entries = [
    ...invoices.map((i) => ({
      _id: `inv-${i._id}`,
      date: i.issueDate,
      account: 'Accounts Receivable / Revenue',
      memo: `Invoice ${i.number} — ${(i.accountId as unknown as { name?: string })?.name ?? 'Customer'}`,
      type: 'revenue' as const,
      debit: 0,
      credit: Math.round((i.total ?? 0) * 100) / 100,
      currency: i.currency,
      posted: i.postedToAccounts,
    })),
    ...expenses.map((e) => ({
      _id: `exp-${e._id}`,
      date: e.expenseDate,
      account: `Expense — ${e.category.replace('_', ' ')}`,
      memo: `${e.reference} — ${e.description}`,
      type: 'expense' as const,
      debit: Math.round((e.amount ?? 0) * 100) / 100,
      credit: 0,
      currency: e.currency,
      posted: e.status === 'paid' || e.status === 'approved',
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalDebit = Math.round(entries.reduce((s, e) => s + e.debit, 0) * 100) / 100;
  const totalCredit = Math.round(entries.reduce((s, e) => s + e.credit, 0) * 100) / 100;
  return { entries: entries.slice(0, 200), totalDebit, totalCredit };
}

// ── Dashboard + reports ──────────────────────────────────────────────────────

export async function getAccountsDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const [invoices, expenses] = await Promise.all([
    BillingInvoice.find({ taskflowOrganizationId: orgOid, status: { $ne: 'void' } }).lean(),
    AccountExpense.find({ taskflowOrganizationId: orgOid, status: { $ne: 'rejected' } }).lean(),
  ]);

  const revenue = Math.round(invoices.reduce((s, i) => s + (i.total ?? 0), 0) * 100) / 100;
  const collected = Math.round(invoices.reduce((s, i) => s + (i.amountPaid ?? 0), 0) * 100) / 100;
  const outstanding = Math.round((revenue - collected) * 100) / 100;
  const totalExpense = Math.round(expenses.reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100;
  const netProfit = Math.round((revenue - totalExpense) * 100) / 100;

  const months = lastMonths(6);
  const cashflow = months.map((month) => {
    const income = invoices
      .filter((i) => i.issueDate && monthKey(i.issueDate) === month)
      .reduce((s, i) => s + (i.total ?? 0), 0);
    const spend = expenses
      .filter((e) => e.expenseDate && monthKey(e.expenseDate) === month)
      .reduce((s, e) => s + (e.amount ?? 0), 0);
    return {
      month,
      income: Math.round(income * 100) / 100,
      expense: Math.round(spend * 100) / 100,
      net: Math.round((income - spend) * 100) / 100,
    };
  });

  const expenseCategories = [
    'payroll', 'software', 'hardware', 'infrastructure', 'travel', 'marketing', 'office', 'professional_services', 'other',
  ]
    .map((c) => ({
      name: c.replace('_', ' '),
      value: Math.round(expenses.filter((e) => e.category === c).reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const receivablesAging = [
    { name: 'Not due', value: 0 },
    { name: '1–30d', value: 0 },
    { name: '31–60d', value: 0 },
    { name: '60d+', value: 0 },
  ];
  const now = Date.now();
  for (const i of invoices) {
    const due = (i.total ?? 0) - (i.amountPaid ?? 0);
    if (due <= 0 || i.status === 'paid') continue;
    const dueDate = i.dueDate ? new Date(i.dueDate).getTime() : new Date(i.issueDate).getTime();
    const overdueDays = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));
    const bucket = overdueDays <= 0 ? 0 : overdueDays <= 30 ? 1 : overdueDays <= 60 ? 2 : 3;
    receivablesAging[bucket].value = Math.round((receivablesAging[bucket].value + due) * 100) / 100;
  }

  return {
    counts: {
      invoices: invoices.length,
      expenses: expenses.length,
      unpaidInvoices: invoices.filter((i) => i.status !== 'paid').length,
      postedToLedger: invoices.filter((i) => i.postedToAccounts).length,
    },
    revenue,
    collected,
    outstanding,
    totalExpense,
    netProfit,
    profitMargin: revenue ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
    cashflow,
    expenseCategories,
    receivablesAging,
  };
}
