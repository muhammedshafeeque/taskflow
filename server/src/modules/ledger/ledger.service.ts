import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { AccountExpense } from '../accounts/models/accountExpense.model';
import {
  AccountsSettings,
  CreditNote,
  JournalEntry,
  LedgerAccount,
  POSTING_KEYS,
  VendorBill,
  type AccountType,
  type PostingKey,
} from './ledger.models';

const round2 = (n: number) => Math.round(n * 100) / 100;
const oid = (id: string) => new mongoose.Types.ObjectId(id);
type Ws = string | null | undefined;

// ── Settings ─────────────────────────────────────────────────────────────

export async function getAccountsSettings(ws: Ws) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const doc = await AccountsSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  const toObj = (m: unknown) => (m instanceof Map ? Object.fromEntries(m) : ((m as Record<string, unknown>) ?? {}));
  return {
    accountMap: Object.fromEntries(Object.entries(toObj(doc?.accountMap)).map(([k, v]) => [k, String(v)])) as Partial<Record<PostingKey, string>>,
    expenseCategoryAccounts: Object.fromEntries(Object.entries(toObj(doc?.expenseCategoryAccounts)).map(([k, v]) => [k, String(v)])) as Record<string, string>,
    expenseCategories: doc?.expenseCategories ?? ['payroll', 'software', 'hardware', 'infrastructure', 'travel', 'marketing', 'office', 'professional_services', 'other'],
    fiscalYearStartMonth: doc?.fiscalYearStartMonth ?? 4,
    autoPost: doc?.autoPost ?? true,
    billNumberPrefix: doc?.billNumberPrefix ?? 'BILL-',
    creditNotePrefix: doc?.creditNotePrefix ?? 'CN-',
    postingKeys: POSTING_KEYS,
  };
}

export async function updateAccountsSettings(ws: Ws, input: Record<string, unknown>) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const $set: Record<string, unknown> = {};
  const validAccountIds = new Set((await LedgerAccount.find({ taskflowOrganizationId: orgOid }).distinct('_id')).map(String));
  if (input.accountMap && typeof input.accountMap === 'object') {
    for (const [k, v] of Object.entries(input.accountMap as Record<string, unknown>)) {
      if (!(POSTING_KEYS as readonly string[]).includes(k)) continue;
      if (v && !validAccountIds.has(String(v))) throw new ApiError(400, `Unknown account for ${k}`);
      $set[`accountMap.${k}`] = v ? oid(String(v)) : undefined;
    }
  }
  if (input.expenseCategoryAccounts && typeof input.expenseCategoryAccounts === 'object') {
    for (const [k, v] of Object.entries(input.expenseCategoryAccounts as Record<string, unknown>)) {
      if (v && !validAccountIds.has(String(v))) throw new ApiError(400, `Unknown account for category ${k}`);
      $set[`expenseCategoryAccounts.${k.replace(/[.$]/g, '_')}`] = v ? oid(String(v)) : undefined;
    }
  }
  if (Array.isArray(input.expenseCategories)) {
    const cats = [...new Set(input.expenseCategories.map((c) => String(c).trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean))].slice(0, 50);
    if (!cats.length) throw new ApiError(400, 'Keep at least one expense category');
    $set.expenseCategories = cats;
  }
  if (input.fiscalYearStartMonth !== undefined) $set.fiscalYearStartMonth = Math.min(12, Math.max(1, Number(input.fiscalYearStartMonth) || 1));
  if (typeof input.autoPost === 'boolean') $set.autoPost = input.autoPost;
  for (const k of ['billNumberPrefix', 'creditNotePrefix'] as const) if (typeof input[k] === 'string') $set[k] = (input[k] as string).slice(0, 12);
  await AccountsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $set }, { upsert: true });
  return getAccountsSettings(String(orgOid));
}

// ── Chart of accounts ────────────────────────────────────────────────────

export async function listAccounts(ws: Ws) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return LedgerAccount.find({ taskflowOrganizationId: orgOid }).sort({ code: 1 }).lean();
}

export async function saveAccount(ws: Ws, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  for (const k of ['code', 'name', 'description'] as const) if (typeof input[k] === 'string') data[k] = (input[k] as string).trim().slice(0, k === 'description' ? 500 : 80);
  if (['asset', 'liability', 'equity', 'income', 'expense'].includes(String(input.type))) data.type = input.type;
  if (typeof input.active === 'boolean') data.active = input.active;
  if (input.parentId !== undefined) data.parentId = input.parentId ? oid(String(input.parentId)) : undefined;
  try {
    if (id) {
      const doc = await LedgerAccount.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
      if (!doc) throw new ApiError(404, 'Account not found');
      return doc;
    }
    if (!data.code || !data.name || !data.type) throw new ApiError(400, 'code, name and type are required');
    return (await LedgerAccount.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'An account with that code already exists');
    throw err;
  }
}

/**
 * Optional starter chart (only when the chart is empty). Everything it creates
 * is ordinary data the company can rename, renumber or delete.
 */
export async function applyStarterChart(ws: Ws) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  if (await LedgerAccount.exists({ taskflowOrganizationId: orgOid })) throw new ApiError(409, 'Chart of accounts already has accounts');
  const starter: Array<[string, string, AccountType, PostingKey?]> = [
    ['1000', 'Bank', 'asset', 'bank'],
    ['1100', 'Accounts receivable', 'asset', 'receivable'],
    ['1200', 'Input tax recoverable', 'asset', 'inputTax'],
    ['2000', 'Accounts payable', 'liability', 'payable'],
    ['2100', 'Tax payable', 'liability', 'taxPayable'],
    ['2200', 'Employee reimbursements payable', 'liability', 'employeeReimbursements'],
    ['2300', 'Payroll deductions payable', 'liability', 'payrollDeductions'],
    ['3000', 'Owner equity', 'equity'],
    ['4000', 'Revenue', 'income', 'revenue'],
    ['5000', 'Salaries & wages', 'expense', 'salaryExpense'],
    ['5100', 'General expenses', 'expense', 'expenseDefault'],
  ];
  const map: Record<string, mongoose.Types.ObjectId> = {};
  for (const [code, name, type, key] of starter) {
    const a = await LedgerAccount.create({ taskflowOrganizationId: orgOid, code, name, type });
    if (key) map[`accountMap.${key}`] = a._id as mongoose.Types.ObjectId;
  }
  await AccountsSettings.updateOne({ taskflowOrganizationId: orgOid }, { $set: map }, { upsert: true });
  return listAccounts(String(orgOid));
}

// ── Journals ─────────────────────────────────────────────────────────────

type LineInput = { accountId: string | mongoose.Types.ObjectId; debit?: number; credit?: number; description?: string; projectId?: unknown };

async function nextJournalNumber(orgOid: mongoose.Types.ObjectId): Promise<string> {
  const count = await JournalEntry.countDocuments({ taskflowOrganizationId: orgOid });
  return `JE-${String(count + 1).padStart(5, '0')}`;
}

export function validateLines(lines: LineInput[]) {
  if (lines.length < 2) throw new ApiError(400, 'A journal entry needs at least two lines');
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = round2(Number(l.debit) || 0);
    const c = round2(Number(l.credit) || 0);
    if (d < 0 || c < 0 || (d > 0 && c > 0) || (d === 0 && c === 0)) throw new ApiError(400, 'Each line is either a debit or a credit');
    dr += d;
    cr += c;
  }
  if (round2(dr) !== round2(cr)) throw new ApiError(400, `Debits (${round2(dr)}) must equal credits (${round2(cr)})`);
}

export async function createJournal(
  ws: Ws,
  input: { date?: unknown; memo?: string; currency?: string; lines: LineInput[]; sourceType?: string; sourceId?: string },
  userId?: string
) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const lines = (input.lines ?? []).filter((l) => (Number(l.debit) || 0) !== 0 || (Number(l.credit) || 0) !== 0);
  validateLines(lines);
  const ids = [...new Set(lines.map((l) => String(l.accountId)))];
  const found = await LedgerAccount.countDocuments({ taskflowOrganizationId: orgOid, _id: { $in: ids } });
  if (found !== ids.length) throw new ApiError(400, 'Unknown account in journal lines');
  const date = input.date ? new Date(String(input.date)) : new Date();
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Invalid date');
  try {
    return (
      await JournalEntry.create({
        taskflowOrganizationId: orgOid,
        number: await nextJournalNumber(orgOid),
        date,
        memo: String(input.memo ?? '').slice(0, 300) || 'Journal entry',
        currency: input.currency ?? 'USD',
        lines: lines.map((l) => ({
          accountId: oid(String(l.accountId)),
          debit: round2(Number(l.debit) || 0),
          credit: round2(Number(l.credit) || 0),
          description: l.description,
          projectId: l.projectId && mongoose.Types.ObjectId.isValid(String(l.projectId)) ? oid(String(l.projectId)) : undefined,
        })),
        sourceType: input.sourceType ?? 'manual',
        sourceId: input.sourceId,
        createdBy: userId && mongoose.Types.ObjectId.isValid(userId) ? oid(userId) : undefined,
      })
    ).toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null; // already posted
    throw err;
  }
}

export async function voidJournal(ws: Ws, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const doc = await JournalEntry.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: { status: 'void' } }, { new: true }).lean();
  if (!doc) throw new ApiError(404, 'Journal entry not found');
  return doc;
}

export async function listJournals(ws: Ws, query: { from?: string; to?: string; accountId?: string; sourceType?: string; page?: number }) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.from || query.to) filter.date = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  if (query.accountId) filter['lines.accountId'] = oid(query.accountId);
  if (query.sourceType) filter.sourceType = query.sourceType;
  const page = Math.max(1, Number(query.page) || 1);
  const [data, total] = await Promise.all([
    JournalEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('lines.accountId', 'code name').lean(),
    JournalEntry.countDocuments(filter),
  ]);
  return { data, total, page };
}

// ── Automatic posting ────────────────────────────────────────────────────

async function postingContext(orgId: string) {
  const s = await getAccountsSettings(orgId);
  return { s, acct: (k: PostingKey) => s.accountMap[k] };
}

/** Invoice sent: DR receivable / CR revenue (+ CR tax payable). */
export async function postInvoice(orgId: string, invoiceId: string) {
  const { s, acct } = await postingContext(orgId);
  if (!s.autoPost || !acct('receivable') || !acct('revenue')) return null;
  const inv = await BillingInvoice.findById(invoiceId).lean();
  if (!inv || inv.status === 'draft' || inv.status === 'void') return null;
  const tax = round2(inv.taxTotal ?? 0);
  const net = round2((inv.total ?? 0) - tax);
  const lines: LineInput[] = [{ accountId: acct('receivable')!, debit: inv.total, description: `Invoice ${inv.number}` }];
  if (net) lines.push({ accountId: acct('revenue')!, credit: net, projectId: inv.projectId });
  if (tax && acct('taxPayable')) lines.push({ accountId: acct('taxPayable')!, credit: tax });
  else if (tax) lines[1] = { accountId: acct('revenue')!, credit: inv.total, projectId: inv.projectId };
  return createJournal(orgId, { date: inv.issueDate, memo: `Invoice ${inv.number}`, currency: inv.currency, lines, sourceType: 'invoice', sourceId: String(inv._id) });
}

/** Customer payment: DR bank / CR receivable. */
export async function postPayment(orgId: string, invoiceId: string, amount: number, ref: string) {
  const { s, acct } = await postingContext(orgId);
  if (!s.autoPost || !acct('bank') || !acct('receivable') || !(amount > 0)) return null;
  const inv = await BillingInvoice.findById(invoiceId).select('number currency').lean();
  return createJournal(orgId, {
    memo: `Payment for invoice ${inv?.number ?? ''}`,
    currency: inv?.currency,
    lines: [
      { accountId: acct('bank')!, debit: amount },
      { accountId: acct('receivable')!, credit: amount },
    ],
    sourceType: 'payment',
    sourceId: ref,
  });
}

/** Expense approved: DR expense account / CR payable (or employee reimbursements). */
export async function postExpense(orgId: string, expenseId: string) {
  const { s, acct } = await postingContext(orgId);
  const exp = await AccountExpense.findById(expenseId).lean();
  if (!s.autoPost || !exp) return null;
  const expenseAcct = s.expenseCategoryAccounts[exp.category] ?? acct('expenseDefault');
  const credit = exp.reimbursable ? acct('employeeReimbursements') : acct('payable');
  if (!expenseAcct || !credit) return null;
  return createJournal(orgId, {
    date: exp.expenseDate,
    memo: `Expense ${exp.reference} — ${exp.description}`,
    currency: exp.currency,
    lines: [
      { accountId: expenseAcct, debit: exp.amount, projectId: exp.projectId },
      { accountId: credit, credit: exp.amount },
    ],
    sourceType: 'expense',
    sourceId: String(exp._id),
  });
}

/** Expense paid out: DR payable/reimbursements / CR bank. */
export async function postExpensePayment(orgId: string, expenseId: string) {
  const { s, acct } = await postingContext(orgId);
  const exp = await AccountExpense.findById(expenseId).lean();
  if (!s.autoPost || !exp || !acct('bank')) return null;
  const debit = exp.reimbursable ? acct('employeeReimbursements') : acct('payable');
  if (!debit) return null;
  return createJournal(orgId, {
    date: exp.paidDate ?? new Date(),
    memo: `Paid expense ${exp.reference}`,
    currency: exp.currency,
    lines: [
      { accountId: debit, debit: exp.amount },
      { accountId: acct('bank')!, credit: exp.amount },
    ],
    sourceType: 'expense_payment',
    sourceId: String(exp._id),
  });
}

/** Vendor bill approved: DR expense lines (+ input tax) / CR payable. */
export async function postBill(orgId: string, billId: string) {
  const { s, acct } = await postingContext(orgId);
  const bill = await VendorBill.findById(billId).lean();
  if (!s.autoPost || !bill || !acct('payable')) return null;
  const lines: LineInput[] = [];
  for (const l of bill.lines) {
    const a = l.accountId ? String(l.accountId) : acct('expenseDefault');
    if (!a) return null;
    lines.push({ accountId: a, debit: round2(l.amount - (l.amount * (l.taxRate ?? 0)) / (100 + (l.taxRate ?? 0))), projectId: bill.projectId, description: l.description });
  }
  const netSum = round2(lines.reduce((x, l) => x + (Number(l.debit) || 0), 0));
  const tax = round2(bill.total - netSum);
  if (tax > 0) {
    if (acct('inputTax')) lines.push({ accountId: acct('inputTax')!, debit: tax });
    else lines[0] = { ...lines[0], debit: round2((Number(lines[0].debit) || 0) + tax) };
  }
  lines.push({ accountId: acct('payable')!, credit: bill.total });
  return createJournal(orgId, { date: bill.billDate, memo: `Bill ${bill.number}`, currency: bill.currency, lines, sourceType: 'bill', sourceId: String(bill._id) });
}

export async function postBillPayment(orgId: string, billId: string, amount: number, ref: string) {
  const { s, acct } = await postingContext(orgId);
  if (!s.autoPost || !acct('bank') || !acct('payable') || !(amount > 0)) return null;
  const bill = await VendorBill.findById(billId).select('number currency').lean();
  return createJournal(orgId, {
    memo: `Payment of bill ${bill?.number ?? ''}`,
    currency: bill?.currency,
    lines: [
      { accountId: acct('payable')!, debit: amount },
      { accountId: acct('bank')!, credit: amount },
    ],
    sourceType: 'bill_payment',
    sourceId: ref,
  });
}

/** Payroll paid: DR salaries (gross) / CR bank (net) / CR deductions payable. */
export async function postPayroll(orgId: string, run: { _id: unknown; period: string; totals: { gross: number; deductions: number; net: number } }, currency: string) {
  const { s, acct } = await postingContext(orgId);
  if (!s.autoPost || !acct('salaryExpense') || !acct('bank')) return null;
  const lines: LineInput[] = [
    { accountId: acct('salaryExpense')!, debit: run.totals.gross },
    { accountId: acct('bank')!, credit: run.totals.net },
  ];
  if (run.totals.deductions > 0) {
    if (!acct('payrollDeductions')) return null;
    lines.push({ accountId: acct('payrollDeductions')!, credit: run.totals.deductions });
  }
  return createJournal(orgId, { memo: `Payroll ${run.period}`, currency, lines, sourceType: 'payroll', sourceId: String(run._id) });
}

export async function postCreditNote(orgId: string, cnId: string) {
  const { s, acct } = await postingContext(orgId);
  const cn = await CreditNote.findById(cnId).lean();
  if (!s.autoPost || !cn || !acct('receivable') || !acct('revenue')) return null;
  const tax = round2(cn.taxAmount ?? 0);
  const lines: LineInput[] = [{ accountId: acct('revenue')!, debit: round2(cn.amount - (acct('taxPayable') ? tax : 0)) }];
  if (tax && acct('taxPayable')) lines.push({ accountId: acct('taxPayable')!, debit: tax });
  lines.push({ accountId: acct('receivable')!, credit: cn.amount });
  return createJournal(orgId, { date: cn.date, memo: `Credit note ${cn.number}`, currency: cn.currency, lines, sourceType: 'credit_note', sourceId: String(cn._id) });
}

/** Fire-and-forget wrapper: posting must never break the business action. */
export function autoPost(fn: () => Promise<unknown>, label: string): void {
  fn().catch((err) => console.error(`[ledger] auto-post ${label} failed:`, err));
}

// ── Reports ──────────────────────────────────────────────────────────────

async function balances(orgOid: mongoose.Types.ObjectId, to?: Date, from?: Date) {
  const match: Record<string, unknown> = { taskflowOrganizationId: orgOid, status: 'posted' };
  if (to || from) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await JournalEntry.aggregate<{ _id: mongoose.Types.ObjectId; debit: number; credit: number }>([
    { $match: match },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.accountId', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const accounts = await LedgerAccount.find({ taskflowOrganizationId: orgOid }).lean();
  return accounts.map((a) => {
    const r = rows.find((x) => String(x._id) === String(a._id));
    const debit = round2(r?.debit ?? 0);
    const credit = round2(r?.credit ?? 0);
    const natural = a.type === 'asset' || a.type === 'expense' ? debit - credit : credit - debit;
    return { accountId: String(a._id), code: a.code, name: a.name, type: a.type as AccountType, debit, credit, balance: round2(natural) };
  });
}

export async function trialBalance(ws: Ws, to?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const rows = (await balances(orgOid, to ? new Date(to) : undefined)).filter((r) => r.debit || r.credit);
  return {
    rows,
    totalDebit: round2(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredit: round2(rows.reduce((s, r) => s + r.credit, 0)),
  };
}

export async function profitAndLoss(ws: Ws, from?: string, to?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const rows = await balances(orgOid, to ? new Date(to) : undefined, from ? new Date(from) : undefined);
  const income = rows.filter((r) => r.type === 'income' && r.balance);
  const expense = rows.filter((r) => r.type === 'expense' && r.balance);
  const totalIncome = round2(income.reduce((s, r) => s + r.balance, 0));
  const totalExpense = round2(expense.reduce((s, r) => s + r.balance, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) };
}

export async function balanceSheet(ws: Ws, to?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const rows = await balances(orgOid, to ? new Date(to) : undefined);
  const pick = (t: AccountType) => rows.filter((r) => r.type === t && r.balance);
  const sum = (xs: Array<{ balance: number }>) => round2(xs.reduce((s, r) => s + r.balance, 0));
  const retained = round2(sum(rows.filter((r) => r.type === 'income')) - sum(rows.filter((r) => r.type === 'expense')));
  const assets = pick('asset');
  const liabilities = pick('liability');
  const equity = pick('equity');
  return {
    assets,
    liabilities,
    equity,
    retainedEarnings: retained,
    totalAssets: sum(assets),
    totalLiabilities: sum(liabilities),
    totalEquity: round2(sum(equity) + retained),
    balanced: round2(sum(assets)) === round2(sum(liabilities) + sum(equity) + retained),
  };
}

/** Output tax (sales) vs input tax (purchases) for a period, grouped by rate. */
export async function taxSummary(ws: Ws, from: string, to: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const range = { $gte: new Date(from), $lte: new Date(to) };
  const [invoices, bills, credits] = await Promise.all([
    BillingInvoice.find({ taskflowOrganizationId: orgOid, status: { $in: ['sent', 'paid', 'overdue'] }, issueDate: range }).select('lines taxCode').lean(),
    VendorBill.find({ taskflowOrganizationId: orgOid, status: { $in: ['approved', 'paid'] }, billDate: range }).select('lines').lean(),
    CreditNote.find({ taskflowOrganizationId: orgOid, date: range }).select('amount taxAmount').lean(),
  ]);
  const byRate = new Map<number, { rate: number; taxableSales: number; outputTax: number; taxablePurchases: number; inputTax: number }>();
  const bucket = (rate: number) => {
    if (!byRate.has(rate)) byRate.set(rate, { rate, taxableSales: 0, outputTax: 0, taxablePurchases: 0, inputTax: 0 });
    return byRate.get(rate)!;
  };
  for (const inv of invoices) {
    for (const l of inv.lines ?? []) {
      const rate = Number(l.taxRate) || 0;
      const base = round2((l.quantity ?? 1) * (l.unitPrice ?? 0) * (1 - (l.discountPercent ?? 0) / 100));
      const b = bucket(rate);
      b.taxableSales = round2(b.taxableSales + base);
      b.outputTax = round2(b.outputTax + (base * rate) / 100);
    }
  }
  for (const bill of bills) {
    for (const l of bill.lines ?? []) {
      const rate = Number(l.taxRate) || 0;
      const base = round2((l.quantity ?? 1) * (l.unitPrice ?? 0));
      const b = bucket(rate);
      b.taxablePurchases = round2(b.taxablePurchases + base);
      b.inputTax = round2(b.inputTax + (base * rate) / 100);
    }
  }
  const rows = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const creditTax = round2(credits.reduce((s, c) => s + (c.taxAmount ?? 0), 0));
  const outputTax = round2(rows.reduce((s, r) => s + r.outputTax, 0) - creditTax);
  const inputTax = round2(rows.reduce((s, r) => s + r.inputTax, 0));
  return { from, to, rows, creditNoteTax: creditTax, outputTax, inputTax, netPayable: round2(outputTax - inputTax) };
}
