import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { PurchaseOrder } from '../procurement/models/purchaseOrder.model';
import { BankAccount, BankTransaction, CreditNote, JournalEntry, LedgerAccount, VendorBill } from './ledger.models';
import { autoPost, getAccountsSettings, postBill, postBillPayment, postCreditNote } from './ledger.service';
import { emitWorkspaceEvent } from '../webhooks/workspaceEvents';

const round2 = (n: number) => Math.round(n * 100) / 100;
const oid = (id: string) => new mongoose.Types.ObjectId(id);
type Ws = string | null | undefined;

// ── Vendor bills ─────────────────────────────────────────────────────────

function normalizeBillLines(lines: unknown) {
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, 'Add at least one line');
  return lines.map((raw: Record<string, unknown>) => {
    const quantity = Number(raw.quantity ?? 1);
    const unitPrice = Number(raw.unitPrice ?? 0);
    const taxRate = Number(raw.taxRate ?? 0);
    const base = round2(quantity * unitPrice);
    return {
      description: String(raw.description ?? '').slice(0, 300) || 'Item',
      quantity,
      unitPrice,
      taxRate,
      amount: round2(base + (base * taxRate) / 100),
      accountId: raw.accountId && mongoose.Types.ObjectId.isValid(String(raw.accountId)) ? oid(String(raw.accountId)) : undefined,
    };
  });
}

function totals(lines: Array<{ quantity: number; unitPrice: number; taxRate: number; amount: number }>) {
  const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { subtotal, taxTotal: round2(total - subtotal), total };
}

export async function listBills(ws: Ws, query: { status?: string; vendorAccountId?: string }) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.status) filter.status = query.status;
  if (query.vendorAccountId) filter.vendorAccountId = query.vendorAccountId;
  return VendorBill.find(filter).populate('vendorAccountId', 'name').populate('purchaseOrderId', 'poNumber').sort({ billDate: -1 }).limit(300).lean();
}

export async function createBill(ws: Ws, input: Record<string, unknown>, userId: string) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  let lines: ReturnType<typeof normalizeBillLines>;
  let vendor = input.vendorAccountId ? String(input.vendorAccountId) : '';
  let currency = input.currency ? String(input.currency) : undefined;
  let po: InstanceType<typeof PurchaseOrder> | null = null;
  if (input.purchaseOrderId) {
    // Bill from a PO: copy its lines unless lines were given.
    po = await PurchaseOrder.findOne({ _id: input.purchaseOrderId, taskflowOrganizationId: orgOid });
    if (!po) throw new ApiError(404, 'Purchase order not found');
    vendor = vendor || String(po.vendorAccountId);
    currency = currency ?? po.currency;
  }
  if (Array.isArray(input.lines) && input.lines.length) lines = normalizeBillLines(input.lines);
  else if (po) lines = normalizeBillLines(po.lines.map((l: { description: string; quantity: number; unitPrice: number }) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })));
  else throw new ApiError(400, 'Add at least one line');
  if (!vendor) throw new ApiError(400, 'Vendor is required');
  const s = await getAccountsSettings(orgId);
  const count = await VendorBill.countDocuments({ taskflowOrganizationId: orgOid });
  const billDate = input.billDate ? new Date(String(input.billDate)) : new Date();
  const bill = await VendorBill.create({
    taskflowOrganizationId: orgOid,
    number: `${s.billNumberPrefix}${String(count + 1).padStart(5, '0')}`,
    vendorBillRef: input.vendorBillRef ? String(input.vendorBillRef).slice(0, 60) : undefined,
    vendorAccountId: oid(vendor),
    purchaseOrderId: po?._id,
    projectId: input.projectId && mongoose.Types.ObjectId.isValid(String(input.projectId)) ? oid(String(input.projectId)) : po?.projectId,
    billDate,
    dueDate: input.dueDate ? new Date(String(input.dueDate)) : new Date(billDate.getTime() + 30 * 86_400_000),
    currency: currency ?? 'USD',
    lines,
    ...totals(lines),
    attachmentUrls: Array.isArray(input.attachmentUrls) ? input.attachmentUrls.map(String).slice(0, 10) : [],
    notes: input.notes ? String(input.notes).slice(0, 2000) : undefined,
    createdBy: oid(userId),
  });
  return bill.toObject();
}

export async function updateBill(ws: Ws, id: string, input: Record<string, unknown>, userId: string) {
  const orgId = requireWorkspaceId(ws);
  const bill = await VendorBill.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!bill) throw new ApiError(404, 'Bill not found');
  if (input.status === 'approved' && bill.status === 'draft') {
    bill.status = 'approved';
    bill.approvedBy = oid(userId);
    await bill.save();
    autoPost(() => postBill(orgId, id), `bill ${bill.number}`);
    return bill.toObject();
  }
  if (input.status === 'void') {
    if (bill.amountPaid > 0) throw new ApiError(400, 'Cannot void a bill with payments');
    bill.status = 'void';
    await bill.save();
    await JournalEntry.updateMany({ taskflowOrganizationId: bill.taskflowOrganizationId, sourceType: 'bill', sourceId: id }, { $set: { status: 'void' } });
    return bill.toObject();
  }
  if (bill.status !== 'draft') throw new ApiError(400, 'Only draft bills can be edited');
  if (Array.isArray(input.lines)) {
    const lines = normalizeBillLines(input.lines);
    bill.set('lines', lines);
    Object.assign(bill, totals(lines));
  }
  for (const k of ['vendorBillRef', 'notes', 'currency'] as const) if (typeof input[k] === 'string') bill.set(k, input[k]);
  for (const k of ['billDate', 'dueDate'] as const) if (input[k]) bill.set(k, new Date(String(input[k])));
  await bill.save();
  return bill.toObject();
}

export async function payBill(ws: Ws, id: string, input: { amount?: number }) {
  const orgId = requireWorkspaceId(ws);
  const bill = await VendorBill.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!bill) throw new ApiError(404, 'Bill not found');
  if (bill.status !== 'approved') throw new ApiError(400, 'Approve the bill before paying it');
  const outstanding = round2(bill.total - bill.amountPaid);
  const amount = round2(Math.min(Number(input.amount ?? outstanding), outstanding));
  if (!(amount > 0)) throw new ApiError(400, 'Nothing to pay');
  bill.amountPaid = round2(bill.amountPaid + amount);
  if (bill.amountPaid >= bill.total - 0.01) bill.status = 'paid';
  await bill.save();
  const ref = `${id}:${crypto.randomBytes(4).toString('hex')}`;
  autoPost(() => postBillPayment(orgId, id, amount, ref), `bill payment ${bill.number}`);
  return bill.toObject();
}

// ── Credit notes ─────────────────────────────────────────────────────────

export async function listCreditNotes(ws: Ws, invoiceId?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  return CreditNote.find({ taskflowOrganizationId: orgOid, ...(invoiceId ? { invoiceId } : {}) }).populate('invoiceId', 'number').sort({ date: -1 }).lean();
}

export async function createCreditNote(ws: Ws, input: { invoiceId?: string; amount?: number; reason?: string; date?: string }, userId: string) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const inv = await BillingInvoice.findOne({ _id: input.invoiceId, taskflowOrganizationId: orgOid });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  if (inv.status === 'draft' || inv.status === 'void') throw new ApiError(400, 'Credit notes apply to sent invoices only');
  const credited = round2((inv as unknown as { amountCredited?: number }).amountCredited ?? 0);
  const maxCredit = round2(inv.total - credited);
  const amount = round2(Number(input.amount));
  if (!(amount > 0) || amount > maxCredit) throw new ApiError(400, `Amount must be between 0 and ${maxCredit}`);
  // Tax share in proportion to the invoice's tax ratio.
  const taxAmount = inv.total ? round2((amount * (inv.taxTotal ?? 0)) / inv.total) : 0;
  const s = await getAccountsSettings(orgId);
  const count = await CreditNote.countDocuments({ taskflowOrganizationId: orgOid });
  const cn = await CreditNote.create({
    taskflowOrganizationId: orgOid,
    number: `${s.creditNotePrefix}${String(count + 1).padStart(5, '0')}`,
    invoiceId: inv._id,
    date: input.date ? new Date(input.date) : new Date(),
    amount,
    taxAmount,
    currency: inv.currency,
    reason: input.reason ? String(input.reason).slice(0, 500) : undefined,
    createdBy: oid(userId),
  });
  inv.set('amountCredited', round2(credited + amount));
  if ((inv.amountPaid ?? 0) + credited + amount >= inv.total - 0.01) inv.status = 'paid';
  await inv.save();
  autoPost(() => postCreditNote(orgId, String(cn._id)), `credit note ${cn.number}`);
  emitWorkspaceEvent(orgId, 'invoice.payment_recorded', { invoiceId: String(inv._id), number: inv.number, creditNote: cn.number, amount });
  return cn.toObject();
}

// ── Banking ──────────────────────────────────────────────────────────────

export async function listBankAccounts(ws: Ws) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const accounts = await BankAccount.find({ taskflowOrganizationId: orgOid }).populate('ledgerAccountId', 'code name').lean();
  const unreconciled = await BankTransaction.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    { $match: { taskflowOrganizationId: orgOid, matchedEntryId: null } },
    { $group: { _id: '$bankAccountId', n: { $sum: 1 } } },
  ]);
  return accounts.map((a) => ({ ...a, unreconciled: unreconciled.find((u) => String(u._id) === String(a._id))?.n ?? 0 }));
}

export async function saveBankAccount(ws: Ws, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const data: Record<string, unknown> = {};
  if (typeof input.name === 'string') data.name = input.name.trim().slice(0, 80);
  if (typeof input.currency === 'string') data.currency = input.currency.toUpperCase().slice(0, 3);
  if (typeof input.accountNumberLast4 === 'string') data.accountNumberLast4 = input.accountNumberLast4.replace(/\D/g, '').slice(-4);
  if (typeof input.active === 'boolean') data.active = input.active;
  if (input.ledgerAccountId) {
    const la = await LedgerAccount.findOne({ _id: input.ledgerAccountId, taskflowOrganizationId: orgOid, type: 'asset' }).lean();
    if (!la) throw new ApiError(400, 'Link the bank to an asset account in the chart of accounts');
    data.ledgerAccountId = la._id;
  }
  if (id) {
    const doc = await BankAccount.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
    if (!doc) throw new ApiError(404, 'Bank account not found');
    return doc;
  }
  if (!data.name || !data.ledgerAccountId) throw new ApiError(400, 'name and ledgerAccountId are required');
  return (await BankAccount.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
}

/** Parse a simple statement CSV: date, description, amount (or debit/credit columns). */
export function parseStatementCsv(csv: string): Array<{ date: Date; description: string; amount: number; reference?: string }> {
  const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col('date');
  const iDesc = col('description', 'narration', 'details', 'particular');
  const iAmt = col('amount');
  const iDebit = col('debit', 'withdrawal');
  const iCredit = col('credit', 'deposit');
  const iRef = col('reference', 'ref', 'cheque');
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) {
    throw new ApiError(400, 'CSV needs date, description and amount (or debit/credit) columns');
  }
  const num = (v?: string) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
  return lines.slice(1).flatMap((l) => {
    const c = split(l);
    const date = new Date(c[iDate]);
    if (Number.isNaN(date.getTime())) return [];
    const amount = iAmt >= 0 ? num(c[iAmt]) : num(c[iCredit]) - num(c[iDebit]);
    if (!amount) return [];
    return [{ date, description: c[iDesc] || '—', amount: round2(amount), reference: iRef >= 0 ? c[iRef] : undefined }];
  });
}

export async function importStatement(ws: Ws, bankAccountId: string, csv: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const bank = await BankAccount.findOne({ _id: bankAccountId, taskflowOrganizationId: orgOid }).lean();
  if (!bank) throw new ApiError(404, 'Bank account not found');
  const rows = parseStatementCsv(String(csv ?? '').slice(0, 2_000_000));
  let imported = 0;
  for (const r of rows) {
    const importHash = crypto.createHash('sha1').update(`${r.date.toISOString().slice(0, 10)}|${r.description}|${r.amount}|${r.reference ?? ''}`).digest('hex');
    try {
      await BankTransaction.create({ taskflowOrganizationId: orgOid, bankAccountId: bank._id, ...r, importHash });
      imported++;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return { parsed: rows.length, imported, duplicates: rows.length - imported };
}

/** Unreconciled statement lines with likely journal matches (same amount on the bank account, ±7 days). */
export async function reconciliation(ws: Ws, bankAccountId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const bank = await BankAccount.findOne({ _id: bankAccountId, taskflowOrganizationId: orgOid }).lean();
  if (!bank) throw new ApiError(404, 'Bank account not found');
  const txns = await BankTransaction.find({ bankAccountId: bank._id, matchedEntryId: null }).sort({ date: 1 }).limit(300).lean();
  const matchedIds = await BankTransaction.find({ bankAccountId: bank._id, matchedEntryId: { $ne: null } }).distinct('matchedEntryId');
  const out = [];
  for (const t of txns) {
    const window = { $gte: new Date(t.date.getTime() - 7 * 86_400_000), $lte: new Date(t.date.getTime() + 7 * 86_400_000) };
    const side = t.amount > 0 ? 'debit' : 'credit';
    const candidates = await JournalEntry.find({
      taskflowOrganizationId: orgOid,
      status: 'posted',
      date: window,
      _id: { $nin: matchedIds },
      lines: { $elemMatch: { accountId: bank.ledgerAccountId, [side]: Math.abs(t.amount) } },
    })
      .select('number date memo')
      .limit(5)
      .lean();
    out.push({ ...t, candidates });
  }
  return out;
}

export async function matchTransaction(ws: Ws, txnId: string, entryId: string | null, userId: string) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const txn = await BankTransaction.findOne({ _id: txnId, taskflowOrganizationId: orgOid });
  if (!txn) throw new ApiError(404, 'Transaction not found');
  if (entryId) {
    const entry = await JournalEntry.findOne({ _id: entryId, taskflowOrganizationId: orgOid, status: 'posted' }).lean();
    if (!entry) throw new ApiError(404, 'Journal entry not found');
    txn.matchedEntryId = entry._id;
    txn.reconciledAt = new Date();
    txn.reconciledBy = oid(userId);
  } else {
    txn.matchedEntryId = undefined;
    txn.reconciledAt = undefined;
    txn.reconciledBy = undefined;
  }
  await txn.save();
  return txn.toObject();
}

/** Bank line with no matching entry (fees, interest): book it against an account and match it. */
export async function bookTransaction(ws: Ws, txnId: string, counterAccountId: string, userId: string) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const txn = await BankTransaction.findOne({ _id: txnId, taskflowOrganizationId: orgOid });
  if (!txn) throw new ApiError(404, 'Transaction not found');
  if (txn.matchedEntryId) throw new ApiError(400, 'Already reconciled');
  const bank = await BankAccount.findById(txn.bankAccountId).lean();
  if (!bank) throw new ApiError(404, 'Bank account not found');
  const { createJournal } = await import('./ledger.service');
  const amt = Math.abs(txn.amount);
  const entry = await createJournal(
    orgId,
    {
      date: txn.date,
      memo: `Bank: ${txn.description}`,
      currency: bank.currency,
      lines:
        txn.amount > 0
          ? [
              { accountId: bank.ledgerAccountId, debit: amt },
              { accountId: counterAccountId, credit: amt },
            ]
          : [
              { accountId: counterAccountId, debit: amt },
              { accountId: bank.ledgerAccountId, credit: amt },
            ],
      sourceType: 'bank',
      sourceId: String(txn._id),
    },
    userId
  );
  if (!entry) throw new ApiError(409, 'Already booked');
  return matchTransaction(orgId, txnId, String(entry._id), userId);
}
