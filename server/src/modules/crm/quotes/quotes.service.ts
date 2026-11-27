import { notifyUsers } from '../../notifications/domainNotify';
import { assertApprovedOrSubmit, assertDiscountApprovedOrSubmit, isApprovalChainEnabled } from '../../approvals/approvals.service';
import { overDiscountLimit } from './discountLimits';
import { logAudit } from '../../auditLogs/logAudit';
import mongoose from 'mongoose';
import {
  CrmQuote,
  type CrmQuoteBillingType,
  type CrmQuoteHistoryAction,
  type ICrmQuote,
  type ICrmQuoteLine,
  QUOTE_HANDOFF_STEPS,
  type QuoteHandoffStep,
} from '../models/crmQuote.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmContract } from '../models/crmContract.model';
import { BillingInvoice } from '../../billing/models/billingInvoice.model';
import { sendCustomerEmail } from '../../../services/email.service';
import { tfEmailWrap } from '../../../services/email.service';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

function pushHistory(
  quote: ICrmQuote,
  action: CrmQuoteHistoryAction,
  message: string,
  userId?: string,
  meta?: Record<string, unknown>
) {
  if (!quote.history) quote.history = [];
  quote.history.push({
    at: new Date(),
    action,
    message,
    userId: userId && mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : undefined,
    meta,
  });
}

function parseDateInput(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim();
  // Calendar dates (YYYY-MM-DD from the date picker) are stored as that day at 00:00 UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid date');
  return d;
}

/** A stored calendar date as YYYY-MM-DD (the UTC day it was saved as), for emails and messages. */
function calendarDay(d?: Date | string | null): string {
  if (!d) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** The issue date is chosen by the user — it is never taken from when the quote was created. */
function requireIssueDate(value: unknown): Date {
  const d = parseDateInput(value);
  if (!d) throw new ApiError(400, 'Choose the quotation’s issue date');
  return d;
}

function assertValidAfterIssue(issueDate?: Date, validUntil?: Date) {
  if (issueDate && validUntil && calendarDay(validUntil) < calendarDay(issueDate)) {
    throw new ApiError(400, '“Valid until” cannot be before the issue date');
  }
}

function summarizeContentChange(
  before: {
    title: string;
    currency: string;
    total: number;
    subtotal: number;
    discountPercent: number;
    notes?: string;
    lineItems: ICrmQuoteLine[];
    validUntil?: Date;
    issueDate?: Date;
  },
  after: {
    title: string;
    currency: string;
    total: number;
    subtotal: number;
    discountPercent: number;
    notes?: string;
    lineItems: ICrmQuoteLine[];
    validUntil?: Date;
    issueDate?: Date;
  }
): { message: string; meta: Record<string, unknown> } {
  const parts: string[] = [];
  const meta: Record<string, unknown> = {};
  if (before.title !== after.title) {
    parts.push(`title → "${after.title}"`);
    meta.title = { from: before.title, to: after.title };
  }
  if (before.currency !== after.currency) {
    parts.push(`currency ${before.currency} → ${after.currency}`);
  }
  if (before.lineItems.length !== after.lineItems.length) {
    parts.push(`lines ${before.lineItems.length} → ${after.lineItems.length}`);
    meta.lineCount = { from: before.lineItems.length, to: after.lineItems.length };
  }
  if (round2(before.total) !== round2(after.total)) {
    parts.push(`total ${before.total} → ${after.total}`);
    meta.total = { from: before.total, to: after.total };
  } else if (round2(before.subtotal) !== round2(after.subtotal)) {
    parts.push(`subtotal ${before.subtotal} → ${after.subtotal}`);
  }
  if ((before.discountPercent ?? 0) !== (after.discountPercent ?? 0)) {
    parts.push(`discount ${before.discountPercent ?? 0}% → ${after.discountPercent ?? 0}%`);
  }
  if ((before.notes ?? '') !== (after.notes ?? '')) {
    parts.push('notes updated');
  }
  const beforeIssue = before.issueDate ? new Date(before.issueDate).toISOString().slice(0, 10) : '';
  const afterIssue = after.issueDate ? new Date(after.issueDate).toISOString().slice(0, 10) : '';
  if (beforeIssue !== afterIssue) {
    parts.push(`issue date ${afterIssue || 'cleared'}`);
  }
  const beforeValid = before.validUntil ? new Date(before.validUntil).toISOString().slice(0, 10) : '';
  const afterValid = after.validUntil ? new Date(after.validUntil).toISOString().slice(0, 10) : '';
  if (beforeValid !== afterValid) {
    parts.push(`valid until ${afterValid || 'cleared'}`);
  }
  // Detect line amount / rate changes even when count stays same
  if (before.lineItems.length === after.lineItems.length) {
    let lineEdits = 0;
    for (let i = 0; i < before.lineItems.length; i++) {
      const a = before.lineItems[i];
      const b = after.lineItems[i];
      if (
        a.description !== b.description ||
        a.quantity !== b.quantity ||
        a.unitPrice !== b.unitPrice ||
        a.billingType !== b.billingType ||
        a.amount !== b.amount
      ) {
        lineEdits += 1;
      }
    }
    if (lineEdits > 0 && !parts.some((p) => p.startsWith('total') || p.startsWith('lines'))) {
      parts.push(`${lineEdits} line item(s) changed`);
      meta.lineEdits = lineEdits;
    }
  }
  return {
    message: parts.length ? `Updated: ${parts.join('; ')}` : 'Updated quotation',
    meta,
  };
}

type LineInput = {
  description?: string;
  category?: string;
  quantity?: number;
  unitPrice?: number;
  billingType?: CrmQuoteBillingType;
  taxRate?: number;
  discountPercent?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeLines(raw: LineInput[]): ICrmQuoteLine[] {
  return raw
    .filter((l) => String(l.description ?? '').trim())
    .map((l) => {
      const billingType: CrmQuoteBillingType =
        l.billingType === 'hourly' || l.billingType === 'milestone' ? l.billingType : 'fixed';
      const quantity =
        billingType === 'milestone'
          ? 1
          : Math.max(0, Number(l.quantity) || (billingType === 'hourly' ? 0 : 1));
      const unitPrice = Math.max(0, Number(l.unitPrice) || 0);
      const discountPercent = Math.min(100, Math.max(0, Number(l.discountPercent) || 0));
      const taxRate = Math.max(0, Number(l.taxRate) || 0);
      const gross = quantity * unitPrice;
      const amount = round2(gross * (1 - discountPercent / 100));
      return {
        description: String(l.description).trim(),
        category: l.category ? String(l.category).trim() : undefined,
        quantity,
        unitPrice,
        billingType,
        taxRate,
        discountPercent,
        amount,
      };
    });
}

function calcTotals(
  lineItems: ICrmQuoteLine[],
  quoteDiscountPercent = 0
): { subtotal: number; discountAmount: number; taxTotal: number; total: number } {
  const subtotal = round2(lineItems.reduce((s, l) => s + (l.amount ?? 0), 0));
  const discountPercent = Math.min(100, Math.max(0, quoteDiscountPercent));
  const discountAmount = round2(subtotal * (discountPercent / 100));
  const afterDiscount = round2(subtotal - discountAmount);
  // Scale line tax proportionally after quote-level discount
  const scale = subtotal > 0 ? afterDiscount / subtotal : 1;
  const taxTotal = round2(
    lineItems.reduce((s, l) => s + (l.amount ?? 0) * scale * ((l.taxRate ?? 0) / 100), 0)
  );
  const total = round2(afterDiscount + taxTotal);
  return { subtotal, discountAmount, taxTotal, total };
}

function billingLabel(type: CrmQuoteBillingType): string {
  if (type === 'hourly') return 'Hourly';
  if (type === 'milestone') return 'Milestone';
  return 'Fixed';
}

export async function listQuotes(
  workspaceId: string | null | undefined,
  opts?: { dealId?: string; leadId?: string; accountId?: string; customerOrgId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts?.dealId) filter.dealId = opts.dealId;
  if (opts?.leadId) filter.leadId = opts.leadId;
  if (opts?.customerOrgId) filter.customerOrgId = opts.customerOrgId;
  else if (opts?.accountId) filter.accountId = opts.accountId;
  return CrmQuote.find(filter)
    .populate('customerOrgId', 'name')
    .populate('accountId', 'name type')
    .populate('dealId', 'title status')
    .populate('leadId', 'title companyName status')
    .sort({ createdAt: -1 })
    .lean();
}

export async function getQuote(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const quote = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) })
    .populate('dealId', 'title status value currency')
    .populate(
      'leadId',
      'title companyName status contactName contactEmail additionalContacts'
    )
    .populate('customerOrgId', 'name contactEmail')
    .populate('accountId', 'name type industry website')
    .populate('contactId', 'name email')
    .populate('createdBy', 'name email')
    .populate('history.userId', 'name email')
    .lean();
  if (!quote) throw new ApiError(404, 'Quote not found');
  return quote;
}

export async function createQuote(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const hasDeal = Boolean(input.dealId);
  const hasLead = Boolean(input.leadId);
  if (!hasDeal && !hasLead) {
    throw new ApiError(400, 'Link the quotation to a deal or a lead');
  }

  type DealLean = {
    _id: unknown;
    title: string;
    accountId?: unknown;
    customerOrgId?: unknown;
    contactId?: unknown;
    currency?: string;
  };
  type LeadLean = {
    _id: unknown;
    title: string;
    accountId?: unknown;
    customerOrgId?: unknown;
    currency?: string;
  };

  let deal: DealLean | null = null;
  if (hasDeal) {
    deal = (await CrmDeal.findOne({ _id: input.dealId, taskflowOrganizationId: orgOid })
      .select('title accountId customerOrgId contactId currency')
      .lean()) as DealLean | null;
    if (!deal) throw new ApiError(404, 'Deal not found');
  }

  let lead: LeadLean | null = null;
  if (hasLead) {
    lead = (await CrmLead.findOne({ _id: input.leadId, taskflowOrganizationId: orgOid })
      .select('title accountId customerOrgId currency')
      .lean()) as LeadLean | null;
    if (!lead) throw new ApiError(404, 'Lead not found');
  }

  const issueDate = requireIssueDate(input.issueDate);
  const validUntil = parseDateInput(input.validUntil);
  assertValidAfterIssue(issueDate, validUntil);

  const lineItems = normalizeLines((input.lineItems as LineInput[]) ?? []);
  const discountPercent = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  const totals = calcTotals(lineItems, discountPercent);
  const defaultTitle = deal
    ? `Quote for ${deal.title}`
    : lead
      ? `Quote for ${lead.title}`
      : 'Quotation';
  const doc = await CrmQuote.create({
    taskflowOrganizationId: orgOid,
    dealId: deal?._id,
    leadId: lead?._id,
    accountId: deal?.accountId || lead?.accountId || input.accountId || undefined,
    customerOrgId: deal?.customerOrgId || lead?.customerOrgId || input.customerOrgId || undefined,
    contactId: deal?.contactId || input.contactId || undefined,
    title: String(input.title ?? defaultTitle).trim(),
    status: 'draft',
    version: 1,
    issueDate,
    validUntil,
    lineItems,
    ...totals,
    discountPercent,
    currency: input.currency ?? deal?.currency ?? lead?.currency ?? 'USD',
    taxCode: input.taxCode ? String(input.taxCode) : undefined,
    notes: input.notes,
    createdBy: userId,
    history: [
      {
        at: new Date(),
        action: 'created',
        message: 'Quotation created',
        userId: mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : undefined,
        meta: {
          total: totals.total,
          currency: input.currency ?? deal?.currency ?? lead?.currency ?? 'USD',
          lineCount: lineItems.length,
        },
      },
    ],
  });
  return doc.toObject();
}

export async function sendQuote(
  id: string,
  workspaceId: string | null | undefined,
  toEmail: string,
  opts?: { pdfBase64?: string; pdfFilename?: string; message?: string; userId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const quote = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) })
    .populate('customerOrgId', 'name')
    .populate('accountId', 'name')
    .lean();
  if (!quote) throw new ApiError(404, 'Quote not found');
  if (quote.status === 'accepted' || quote.status === 'rejected' || quote.status === 'expired') {
    throw new ApiError(400, 'Cannot email an accepted, rejected, or expired quotation');
  }
  if (!quote.issueDate) throw new ApiError(400, 'Set the quotation’s issue date before sending it');
  await gateQuote(orgId, quote, opts?.userId ?? String(quote.createdBy), 'send this quotation');
  const accountName =
    quote.customerOrgId && typeof quote.customerOrgId === 'object' && 'name' in quote.customerOrgId
      ? String((quote.customerOrgId as { name?: string }).name ?? '')
      : quote.accountId && typeof quote.accountId === 'object' && 'name' in quote.accountId
        ? String((quote.accountId as { name?: string }).name ?? '')
        : '';
  const lines = (quote.lineItems ?? [])
    .map((l) => {
      const qtyLabel = l.billingType === 'hourly' ? `${l.quantity} hrs` : String(l.quantity);
      const rateLabel =
        l.billingType === 'hourly' ? `${l.unitPrice}/hr` : String(l.unitPrice);
      return `<tr>
        <td>${l.category ? `<em>${l.category}</em> — ` : ''}${l.description}</td>
        <td>${billingLabel(l.billingType as CrmQuoteBillingType)}</td>
        <td>${qtyLabel}</td>
        <td>${rateLabel}</td>
        <td>${l.taxRate ?? 0}%</td>
        <td>${l.amount}</td>
      </tr>`;
    })
    .join('');
  const total = quote.total ?? quote.subtotal;
  const customMessage = opts?.message?.trim()
    ? `<p>${opts.message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
    : '';
  const { quoteResponseUrl } = await import('./customerQuotes');
  const respondUrl = quoteResponseUrl(id);
  const html = tfEmailWrap(
    `${customMessage}
    <p>Please find your quotation: <strong>${quote.title}</strong>${
      accountName ? ` for <strong>${accountName}</strong>` : ''
    }.</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><th>Feature</th><th>Type</th><th>Qty / Hours</th><th>Rate</th><th>Tax</th><th>Amount</th></tr>
      ${lines}
    </table>
    <p>Subtotal: ${quote.subtotal} ${quote.currency}</p>
    ${(quote.discountAmount ?? 0) > 0 ? `<p>Discount: −${quote.discountAmount} ${quote.currency}</p>` : ''}
    ${(quote.taxTotal ?? 0) > 0 ? `<p>Tax: ${quote.taxTotal} ${quote.currency}</p>` : ''}
    <p><strong>Total: ${total} ${quote.currency}</strong></p>
    <p>Issue date: ${calendarDay(quote.issueDate)}</p>
    ${quote.validUntil ? `<p>Valid until: ${calendarDay(quote.validUntil)}</p>` : ''}
    ${quote.notes ? `<p>${quote.notes}</p>` : ''}
    ${opts?.pdfBase64 ? '<p>A PDF copy of this quotation is attached.</p>' : ''}
    <p><a href="${respondUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Review and accept online</a></p>
    <p style="font-size:12px;color:#666">You can accept or decline this quotation from that page.</p>`,
    'indigo'
  );

  const attachments =
    opts?.pdfBase64 && opts.pdfBase64.trim()
      ? [
          {
            filename: opts.pdfFilename?.trim() || `quote-${quote.title.replace(/\s+/g, '-')}.pdf`,
            content: opts.pdfBase64.replace(/^data:application\/pdf;base64,/, ''),
            contentType: 'application/pdf',
            encoding: 'base64' as const,
          },
        ]
      : undefined;

  await sendCustomerEmail(toEmail, `Quote: ${quote.title}`, html, attachments);
  const doc = await CrmQuote.findById(id);
  if (!doc) throw new ApiError(404, 'Quote not found');
  const wasDraft = doc.status === 'draft';
  if (wasDraft) doc.status = 'sent';
  pushHistory(
    doc,
    wasDraft ? 'sent' : 'emailed',
    wasDraft ? `Quotation sent by email to ${toEmail}` : `Quotation re-sent by email to ${toEmail}`,
    opts?.userId,
    { toEmail, attachedPdf: Boolean(opts?.pdfBase64) }
  );
  await doc.save();
  {
    const deal = doc.dealId ? await CrmDeal.findById(doc.dealId).select('ownerId').lean() : null;
    void notifyUsers([doc.createdBy, deal?.ownerId], 'crm_quote_sent', { title: `Quote sent: ${quote.title}`, body: `To ${toEmail}`, link: `/crm/quotes/${id}` }, opts?.userId);
  }
  try {
    const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
    await dispatchWebhook(orgId, 'quote.sent', { quoteId: id, toEmail, title: quote.title });
  } catch {
    /* best-effort */
  }
  return { ok: true, status: doc.status };
}

/**
 * Before a quote goes to the customer (sent or accepted):
 * - the quote approval chain, when on, approves draft quotes (AUT-27), and also any quote above the
 *   sender's discount limit, even one already sent and edited since;
 * - with the chain off, a quote above the sender's discount limit needs approval from someone whose
 *   limit covers it (AUT-31). An approval stays valid while the total and discount stay the same.
 */
async function gateQuote(
  orgId: string,
  quote: { _id: unknown; status: string; lineItems?: Array<{ quantity?: number; unitPrice?: number }>; subtotal?: number; discountAmount?: number },
  actorUserId: string,
  action: string
) {
  const id = String(quote._id);
  const over = await overDiscountLimit(orgId, actorUserId, quote);
  if (await isApprovalChainEnabled(orgId, 'quote')) {
    if (quote.status === 'draft' || over) await assertApprovedOrSubmit(orgId, 'quote', id, actorUserId, action);
    return;
  }
  if (over) await assertDiscountApprovedOrSubmit(orgId, id, actorUserId, action, over);
}

export type QuoteResponder =
  | { via: 'staff'; userId?: string }
  | { via: 'link' | 'portal'; name?: string; email?: string; customerUserId?: string };

/**
 * Accept or reject a quotation (AUT-32). Staff, the customer's secure link and the customer portal
 * all come through here, so acceptance always runs the same steps: the discount/approval gate, the
 * draft contract and invoice, the deal moved to Won (with commission and alerts), and notifications.
 */
export async function respondToQuote(
  orgId: string,
  quote: InstanceType<typeof CrmQuote>,
  decision: 'accepted' | 'rejected',
  who: QuoteResponder,
  note?: string
) {
  if (quote.status === 'accepted' || quote.status === 'rejected' || quote.status === 'expired') {
    throw new ApiError(400, `This quotation is already ${quote.status}`);
  }
  const byCustomer = who.via !== 'staff';
  if (byCustomer) {
    if (quote.status !== 'sent') throw new ApiError(400, 'This quotation is not open for a response');
    if (quote.validUntil && new Date(quote.validUntil).getTime() < startOfToday().getTime()) {
      throw new ApiError(400, 'This quotation has expired. Please contact us for an updated one.');
    }
  }
  if (decision === 'accepted') {
    const actor = who.via === 'staff' ? who.userId ?? String(quote.createdBy) : String(quote.createdBy);
    try {
      await gateQuote(orgId, quote, actor, 'mark this quotation accepted');
    } catch (err) {
      // The customer never sees internal approval details.
      if (byCustomer && err instanceof ApiError && (err.statusCode === 409 || err.statusCode === 400)) {
        throw new ApiError(409, 'This quotation is being reviewed on our side. We will be in touch shortly.');
      }
      throw err;
    }
  }
  const cleanNote = note ? String(note).trim().slice(0, 2000) || undefined : undefined;
  const prev = quote.status;
  quote.status = decision;
  quote.response = {
    decision,
    via: who.via,
    at: new Date(),
    note: cleanNote,
    ...(who.via === 'staff'
      ? { userId: who.userId && mongoose.isValidObjectId(who.userId) ? new mongoose.Types.ObjectId(who.userId) : undefined }
      : {
          name: who.name ? String(who.name).trim().slice(0, 200) : undefined,
          email: who.email ? String(who.email).trim().toLowerCase().slice(0, 200) : undefined,
          customerUserId: who.customerUserId && mongoose.isValidObjectId(who.customerUserId) ? new mongoose.Types.ObjectId(who.customerUserId) : undefined,
        }),
  };
  const by = byCustomer ? ` by ${quote.response.name || quote.response.email || 'the customer'} (${who.via === 'link' ? 'online link' : 'customer portal'})` : '';
  pushHistory(quote, 'status_changed', `Status changed from ${prev} to ${decision}${by}`, who.via === 'staff' ? who.userId : undefined, {
    from: prev,
    to: decision,
    via: who.via,
    ...(cleanNote ? { note: cleanNote } : {}),
  });
  await quote.save();

  const orgIdStr = orgId;
  const deal = quote.dealId ? await CrmDeal.findById(quote.dealId).select('ownerId').lean() : null;
  const staffActor = who.via === 'staff' ? who.userId : undefined;
  let converted: QuoteHandoffSummary | undefined;
  if (decision === 'accepted') {
    // Contract, invoice, delivery links and the deal won. Failures are kept on the quote and shown,
    // never hidden (AUT-33); the acceptance itself stands.
    converted = await runQuoteHandoff(orgIdStr, quote, staffActor);
    void notifyUsers([quote.createdBy, deal?.ownerId], 'crm_quote_accepted', { title: `Quote accepted${by}: ${quote.title}`, body: `${quote.currency} ${quote.total}`, link: `/crm/quotes/${quote._id}` }, staffActor);
  } else if (byCustomer) {
    void notifyUsers([quote.createdBy, deal?.ownerId], 'crm_quote_rejected', { title: `Quote rejected${by}: ${quote.title}`, body: cleanNote ?? '', link: `/crm/quotes/${quote._id}` });
  }
  try {
    const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
    await dispatchWebhook(orgIdStr, decision === 'accepted' ? 'quote.accepted' : 'quote.rejected', { quoteId: String(quote._id), title: quote.title, via: who.via });
  } catch {
    /* best-effort */
  }
  return { ...quote.toObject(), converted };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function updateQuote(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Quote not found');

  const nextStatus = input.status as string | undefined;
  if (nextStatus === 'accepted' || nextStatus === 'rejected') {
    return respondToQuote(orgId, existing, nextStatus, { via: 'staff', userId }, input.responseNote ? String(input.responseNote) : undefined);
  }

  // Content edits allowed until accepted (draft or sent)
  if (existing.status !== 'draft' && existing.status !== 'sent') {
    throw new ApiError(400, 'Only draft or sent quotations can be edited');
  }

  const before = {
    title: existing.title,
    currency: existing.currency,
    total: existing.total,
    subtotal: existing.subtotal,
    discountPercent: existing.discountPercent ?? 0,
    notes: existing.notes,
    lineItems: existing.lineItems.map((l) => ({ ...l })),
    validUntil: existing.validUntil,
    issueDate: existing.issueDate,
  };

  if (input.title !== undefined) existing.title = String(input.title).trim();
  if (input.notes !== undefined) existing.notes = input.notes as string;
  if (input.validUntil !== undefined) {
    existing.validUntil = parseDateInput(input.validUntil);
  }
  if (input.issueDate !== undefined) {
    existing.issueDate = requireIssueDate(input.issueDate);
  }
  assertValidAfterIssue(existing.issueDate, existing.validUntil);
  if (input.currency !== undefined) existing.currency = String(input.currency);
  if (input.taxCode !== undefined) existing.taxCode = input.taxCode ? String(input.taxCode) : undefined;
  if (input.discountPercent !== undefined) {
    existing.discountPercent = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  }
  if (input.lineItems) {
    existing.lineItems = normalizeLines(input.lineItems as LineInput[]);
  }
  // Allow re-linking while still open
  if (input.dealId !== undefined) {
    existing.dealId = input.dealId
      ? new mongoose.Types.ObjectId(String(input.dealId))
      : undefined;
  }
  if (input.leadId !== undefined) {
    existing.leadId = input.leadId
      ? new mongoose.Types.ObjectId(String(input.leadId))
      : undefined;
  }

  const totals = calcTotals(existing.lineItems, existing.discountPercent ?? 0);
  existing.subtotal = totals.subtotal;
  existing.discountAmount = totals.discountAmount;
  existing.taxTotal = totals.taxTotal;
  existing.total = totals.total;

  const summary = summarizeContentChange(before, {
    title: existing.title,
    currency: existing.currency,
    total: existing.total,
    subtotal: existing.subtotal,
    discountPercent: existing.discountPercent ?? 0,
    notes: existing.notes,
    lineItems: existing.lineItems,
    validUntil: existing.validUntil,
    issueDate: existing.issueDate,
  });

  // Bump version when a sent quote is revised
  if (existing.status === 'sent') {
    existing.version = (existing.version ?? 1) + 1;
    summary.meta.version = existing.version;
    summary.message = `${summary.message} (v${existing.version})`;
  }

  pushHistory(existing, 'updated', summary.message, userId, summary.meta);
  await existing.save();
  return existing.toObject();
}

type HandoffQuote = InstanceType<typeof CrmQuote>;
type StepResult = { status: 'done' | 'skipped'; refId?: string };
export type QuoteHandoffSummary = {
  status: 'done' | 'failed';
  contractId?: string;
  invoiceId?: string;
  handoff?: unknown;
  failedStep?: QuoteHandoffStep;
  error?: string;
};

const STEP_LABEL: Record<QuoteHandoffStep, string> = {
  account: 'billing account',
  contract: 'draft contract',
  invoice: 'draft invoice',
  delivery: 'link to the customer and project',
  deal: 'deal marked won',
};

const isDuplicateKey = (err: unknown) => (err as { code?: number } | null)?.code === 11000;

/**
 * After a quotation is accepted, hand it off to billing and delivery (AUT-33):
 *   account  → the customer's CRM billing account
 *   contract → one draft contract for the quotation
 *   invoice  → one draft invoice for the quotation
 *   delivery → customer, deal, quote and contract linked to the deal's project (if it has one)
 *   deal     → the deal moved to Won (same steps as any other win, AUT-32)
 * Each step first looks for what an earlier attempt already made, so running it again never
 * duplicates anything. The result of every step is kept on the quotation; a failure stops the run,
 * is logged and audited, and the quote and deal owners are told. The quotation stays accepted (the
 * customer did accept it) and the failed step can be retried from the quote page.
 */
export async function runQuoteHandoff(orgId: string, quote: HandoffQuote, actorUserId?: string): Promise<QuoteHandoffSummary> {
  const orgOid = toOrgOid(orgId);
  const steps: NonNullable<HandoffQuote['handoff']>['steps'] = [];
  const summary: QuoteHandoffSummary = { status: 'done' };
  let contractId: mongoose.Types.ObjectId | undefined;
  const hasCustomer = Boolean(quote.customerOrgId || quote.accountId);

  const run: Record<QuoteHandoffStep, () => Promise<StepResult>> = {
    account: async () => {
      if (quote.accountId || !quote.customerOrgId) return { status: quote.accountId ? 'done' : 'skipped', refId: quote.accountId ? String(quote.accountId) : undefined };
      // Customers that came in through lead conversion have a portal organisation; billing needs its CRM account.
      const { syncCrmAccountFromCustomerOrg } = await import('../crmBridge.service');
      quote.accountId = new mongoose.Types.ObjectId(await syncCrmAccountFromCustomerOrg(String(quote.customerOrgId), orgId));
      await CrmQuote.updateOne({ _id: quote._id }, { $set: { accountId: quote.accountId } });
      return { status: 'done', refId: String(quote.accountId) };
    },
    contract: async () => {
      if (!hasCustomer) return { status: 'skipped' };
      let contract: { _id: unknown } | null = await CrmContract.findOne({ taskflowOrganizationId: orgOid, quoteId: quote._id }).select('_id').lean();
      if (!contract) {
        const { hourlyRateFromQuoteLines } = await import('../commercialHandoff.service');
        try {
          contract = (
            await CrmContract.create({
              taskflowOrganizationId: orgOid,
              quoteId: quote._id,
              accountId: quote.accountId,
              customerOrgId: quote.customerOrgId,
              dealId: quote.dealId || undefined,
              title: quote.title,
              kind: 'other',
              value: quote.total ?? quote.subtotal ?? 0,
              currency: quote.currency ?? 'USD',
              billingCycle: 'one_time',
              startDate: new Date(),
              status: 'draft',
              hourlyRate: hourlyRateFromQuoteLines(quote.lineItems),
            })
          ).toObject();
        } catch (err) {
          // Another attempt made it at the same moment: use that one.
          if (!isDuplicateKey(err)) throw err;
          contract = await CrmContract.findOne({ quoteId: quote._id }).select('_id').lean();
        }
      }
      contractId = contract!._id as mongoose.Types.ObjectId;
      summary.contractId = String(contractId);
      return { status: 'done', refId: summary.contractId };
    },
    invoice: async () => {
      if (!quote.accountId) return { status: 'skipped' };
      let invoice: { _id: unknown } | null = await BillingInvoice.findOne({ taskflowOrganizationId: orgOid, sourceQuoteId: quote._id }).select('_id').lean();
      if (!invoice) {
        const lines = (quote.lineItems ?? []).map((l) => {
          const quantity = l.quantity ?? 1;
          const unitPrice = l.unitPrice ?? 0;
          const taxRate = l.taxRate ?? 0;
          const discountPercent = (l as { discountPercent?: number }).discountPercent ?? 0;
          const billingType = (l as { billingType?: string }).billingType ?? 'fixed';
          const amount = round2(quantity * unitPrice * (1 - Math.min(100, Math.max(0, discountPercent)) / 100));
          return {
            description: l.description,
            quantity,
            unitPrice,
            taxRate,
            amount,
            billingType,
            category: (l as { category?: string }).category,
            discountPercent,
            sourceType: 'manual' as const,
          };
        });
        const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
        const taxTotal = quote.taxTotal ?? round2(lines.reduce((sum, l) => sum + l.amount * (l.taxRate / 100), 0));
        const total = quote.total ?? round2(subtotal + taxTotal);
        const { nextInvoiceNumber } = await import('../../billing/billing.service');
        try {
          invoice = (
            await BillingInvoice.create({
              taskflowOrganizationId: orgOid,
              sourceQuoteId: quote._id,
              accountId: quote.accountId,
              customerOrgId: quote.customerOrgId || undefined,
              contractId,
              number: await nextInvoiceNumber(orgOid),
              status: 'draft',
              issueDate: new Date(),
              currency: quote.currency ?? 'USD',
              lines,
              subtotal,
              taxTotal,
              total,
              amountPaid: 0,
              notes: `Generated from accepted quote "${quote.title}"`,
            })
          ).toObject();
        } catch (err) {
          if (!isDuplicateKey(err) || !(await BillingInvoice.exists({ sourceQuoteId: quote._id }))) throw err;
          invoice = await BillingInvoice.findOne({ sourceQuoteId: quote._id }).select('_id').lean();
        }
      }
      summary.invoiceId = String(invoice!._id);
      return { status: 'done', refId: summary.invoiceId };
    },
    delivery: async () => {
      if (!hasCustomer && !quote.dealId) return { status: 'skipped' };
      const { runCommercialHandoff } = await import('../commercialHandoff.service');
      summary.handoff = await runCommercialHandoff({
        workspaceId: orgId,
        userId: actorUserId || String(quote.createdBy ?? ''),
        customerOrgId: quote.customerOrgId ? String(quote.customerOrgId) : undefined,
        dealId: quote.dealId ? String(quote.dealId) : undefined,
        leadId: quote.leadId ? String(quote.leadId) : undefined,
        quoteId: String(quote._id),
        contractId: summary.contractId,
        projectTitle: quote.title,
        createPortalOrg: false,
      });
      const projectId = (summary.handoff as { projectId?: string } | undefined)?.projectId;
      return { status: 'done', refId: projectId };
    },
    deal: async () => {
      if (!quote.dealId) return { status: 'skipped' };
      const { winDeal } = await import('../deals/deals.service');
      const deal = await winDeal(orgId, quote.dealId, quote.response?.via && quote.response.via !== 'staff' ? 'Customer accepted the quotation' : 'Quotation accepted');
      return deal ? { status: 'done', refId: String(deal._id) } : { status: 'skipped' };
    },
  };

  for (const key of QUOTE_HANDOFF_STEPS) {
    try {
      const r = await run[key]();
      steps.push({ key, status: r.status, at: new Date(), refId: r.refId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ key, status: 'failed', at: new Date(), error: message.slice(0, 500) });
      summary.status = 'failed';
      summary.failedStep = key;
      summary.error = message.slice(0, 500);
      console.error(`[quote handoff] quote ${String(quote._id)} failed at ${key}:`, err);
      break;
    }
  }

  const attempts = (quote.handoff?.attempts ?? 0) + 1;
  quote.handoff = { status: summary.status, steps, failedStep: summary.failedStep, error: summary.error, attempts, lastAttemptAt: new Date() };
  await CrmQuote.updateOne({ _id: quote._id }, { $set: { handoff: quote.handoff } });
  logAudit({
    userId: actorUserId || String(quote.createdBy ?? ''),
    action: summary.status === 'done' ? 'crm.quote.handoff' : 'crm.quote.handoff_failed',
    resourceType: 'crm_quote',
    resourceId: String(quote._id),
    meta: { attempts, failedStep: summary.failedStep, error: summary.error, contractId: summary.contractId, invoiceId: summary.invoiceId },
  });
  if (summary.status === 'failed') {
    const deal = quote.dealId ? await CrmDeal.findById(quote.dealId).select('ownerId').lean() : null;
    void notifyUsers([quote.createdBy, deal?.ownerId], 'crm_quote_handoff_failed', {
      title: `Accepted quote needs attention: ${quote.title}`,
      body: `The ${STEP_LABEL[summary.failedStep!]} step failed: ${summary.error}. Open the quote to retry.`,
      link: `/crm/quotes/${quote._id}`,
    });
  }
  return summary;
}

/** Run the handoff of an accepted quotation again, from the start; finished steps are found, not redone. */
export async function retryQuoteHandoff(id: string, workspaceId: string | null | undefined, userId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const quote = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!quote) throw new ApiError(404, 'Quote not found');
  if (quote.status !== 'accepted') throw new ApiError(400, 'Only accepted quotations are handed off');
  if (quote.handoff?.status !== 'failed') throw new ApiError(409, 'Nothing to retry: the handoff of this quotation has not failed');
  const summary = await runQuoteHandoff(orgId, quote, userId);
  pushHistory(quote, 'updated', summary.status === 'done' ? 'Handoff retried and completed' : `Handoff retried; ${STEP_LABEL[summary.failedStep!]} failed again`, userId, {
    handoff: summary.status,
    failedStep: summary.failedStep,
  });
  await CrmQuote.updateOne({ _id: quote._id }, { $set: { history: quote.history } });
  return { quote: await CrmQuote.findById(quote._id).lean(), handoff: summary };
}

export async function deleteQuote(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmQuote.findOneAndDelete({
    _id: id,
    taskflowOrganizationId: toOrgOid(orgId),
    status: 'draft',
  });
  if (!deleted) throw new ApiError(404, 'Draft quote not found');
  return { ok: true };
}
