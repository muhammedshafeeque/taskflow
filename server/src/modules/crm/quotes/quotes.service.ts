import { notifyUsers } from '../../notifications/domainNotify';
import mongoose from 'mongoose';
import {
  CrmQuote,
  type CrmQuoteBillingType,
  type CrmQuoteHistoryAction,
  type ICrmQuote,
  type ICrmQuoteLine,
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
    validUntil: input.validUntil ? new Date(String(input.validUntil)) : undefined,
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
    ${quote.validUntil ? `<p>Valid until: ${new Date(quote.validUntil).toLocaleDateString()}</p>` : ''}
    ${quote.notes ? `<p>${quote.notes}</p>` : ''}
    ${opts?.pdfBase64 ? '<p>A PDF copy of this quotation is attached.</p>' : ''}`,
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
    if (existing.status === 'accepted' || existing.status === 'rejected' || existing.status === 'expired') {
      throw new ApiError(400, 'This quotation is already closed');
    }
    const prev = existing.status;
    existing.status = nextStatus;
    pushHistory(
      existing,
      'status_changed',
      `Status changed from ${prev} to ${nextStatus}`,
      userId,
      { from: prev, to: nextStatus }
    );
    await existing.save();
    let converted: { contractId?: string; invoiceId?: string } | undefined;
    if (nextStatus === 'accepted') {
      converted = await convertAcceptedQuote(existing, orgId);
      const deal = existing.dealId ? await CrmDeal.findById(existing.dealId).select('ownerId').lean() : null;
      void notifyUsers([existing.createdBy, deal?.ownerId], 'crm_quote_accepted', { title: `Quote accepted: ${existing.title}`, body: `${existing.currency} ${existing.total}`, link: `/crm/quotes/${existing._id}` }, userId);
    }
    return { ...existing.toObject(), converted };
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
  };

  if (input.title !== undefined) existing.title = String(input.title).trim();
  if (input.notes !== undefined) existing.notes = input.notes as string;
  if (input.validUntil !== undefined) {
    existing.validUntil = input.validUntil ? new Date(String(input.validUntil)) : undefined;
  }
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

/**
 * When a quote is accepted, spin up a draft contract and a draft invoice from
 * its line items so sales hands off cleanly to delivery and finance. Best-effort:
 * a failure here never blocks the quote acceptance.
 */
async function convertAcceptedQuote(
  quote: {
    _id: unknown;
    title: string;
    accountId?: unknown;
    customerOrgId?: unknown;
    dealId?: unknown;
    leadId?: unknown;
    currency?: string;
    subtotal?: number;
    taxTotal?: number;
    total?: number;
    discountAmount?: number;
    lineItems?: {
      description: string;
      quantity?: number;
      unitPrice?: number;
      taxRate?: number;
      amount?: number;
      billingType?: string;
    }[];
    createdBy?: unknown;
  },
  orgId: string
  ): Promise<{ contractId?: string; invoiceId?: string; handoff?: unknown }> {
  const result: { contractId?: string; invoiceId?: string; handoff?: unknown } = {};
  const orgOid = toOrgOid(orgId);
  if (!quote.customerOrgId && !quote.accountId) return result;
  try {
    const { hourlyRateFromQuoteLines } = await import('../commercialHandoff.service');
    const hourlyRate = hourlyRateFromQuoteLines(quote.lineItems);
    const contractValue = quote.total ?? quote.subtotal ?? 0;
    const contract = await CrmContract.create({
      taskflowOrganizationId: orgOid,
      accountId: quote.accountId,
      customerOrgId: quote.customerOrgId,
      dealId: quote.dealId || undefined,
      title: quote.title,
      kind: 'other',
      value: contractValue,
      currency: quote.currency ?? 'USD',
      billingCycle: 'one_time',
      startDate: new Date(),
      status: 'draft',
      hourlyRate,
    });
    result.contractId = String(contract._id);

    const lines = (quote.lineItems ?? []).map((l) => {
      const quantity = l.quantity ?? 1;
      const unitPrice = l.unitPrice ?? 0;
      const taxRate = l.taxRate ?? 0;
      const discountPercent = (l as { discountPercent?: number }).discountPercent ?? 0;
      const billingType = (l as { billingType?: string }).billingType ?? 'fixed';
      const gross = quantity * unitPrice;
      const amount = round2(gross * (1 - Math.min(100, Math.max(0, discountPercent)) / 100));
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
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const taxTotal = quote.taxTotal ?? round2(lines.reduce((s, l) => s + l.amount * (l.taxRate / 100), 0));
    const total = quote.total ?? round2(subtotal + taxTotal);
    const count = await BillingInvoice.countDocuments({ taskflowOrganizationId: orgOid });
    if (quote.accountId) {
    const invoice = await BillingInvoice.create({
      taskflowOrganizationId: orgOid,
      accountId: quote.accountId,
      contractId: contract._id,
      number: `INV-${String(count + 1).padStart(5, '0')}`,
      status: 'draft',
      issueDate: new Date(),
      currency: quote.currency ?? 'USD',
      lines,
      subtotal,
      taxTotal,
      total,
      amountPaid: 0,
      notes: `Generated from accepted quote "${quote.title}"`,
    });
    result.invoiceId = String(invoice._id);
    }

    const { runCommercialHandoff } = await import('../commercialHandoff.service');
    result.handoff = await runCommercialHandoff({
      workspaceId: orgId,
      userId: String(quote.createdBy ?? ''),
      customerOrgId: quote.customerOrgId ? String(quote.customerOrgId) : undefined,
      dealId: quote.dealId ? String(quote.dealId) : undefined,
      leadId: quote.leadId ? String(quote.leadId) : undefined,
      quoteId: String(quote._id),
      contractId: result.contractId,
      projectTitle: quote.title,
      createPortalOrg: false,
    });
  } catch {
    /* best-effort conversion */
  }
  return result;
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
