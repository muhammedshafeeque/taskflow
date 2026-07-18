import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { AccountExpense } from './models/accountExpense.model';

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
  return AccountExpense.find(filter).populate('vendorAccountId', 'name').sort({ expenseDate: -1 }).lean();
}

export async function createExpense(workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.description || !String(input.description).trim()) throw new ApiError(400, 'Description is required');
  const reference = input.reference
    ? String(input.reference).trim()
    : `EXP-${String((await AccountExpense.countDocuments({ taskflowOrganizationId: orgOid })) + 1).padStart(4, '0')}`;
  try {
    const doc = await AccountExpense.create({
      taskflowOrganizationId: orgOid,
      reference,
      description: String(input.description).trim(),
      category: input.category ?? 'other',
      status: input.status ?? 'submitted',
      vendorAccountId: input.vendorAccountId || undefined,
      purchaseOrderId: input.purchaseOrderId || undefined,
      projectId: input.projectId || undefined,
      amount: Number(input.amount ?? 0),
      currency: input.currency ?? 'USD',
      expenseDate: asDate(input.expenseDate) ?? new Date(),
      submittedBy: userId,
      notes: input.notes,
    });
    return doc.toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Reference already exists');
    throw err;
  }
}

export async function updateExpense(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const exp = await AccountExpense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!exp) throw new ApiError(404, 'Expense not found');
  const fields = ['description', 'category', 'currency', 'notes', 'vendorAccountId', 'projectId', 'purchaseOrderId'] as const;
  for (const key of fields) if (key in input) (exp as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('amount' in input) exp.amount = Number(input.amount);
  if ('expenseDate' in input) exp.expenseDate = asDate(input.expenseDate) ?? exp.expenseDate;
  if ('status' in input) {
    const prev = exp.status;
    exp.status = input.status as never;
    if (exp.status === 'approved' && prev !== 'approved') exp.approvedBy = userId as never;
    if (exp.status === 'paid' && !exp.paidDate) exp.paidDate = new Date();
  }
  await exp.save();
  return exp.toObject();
}

export async function deleteExpense(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await AccountExpense.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Expense not found');
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
