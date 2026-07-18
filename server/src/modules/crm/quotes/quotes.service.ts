import { CrmQuote } from '../models/crmQuote.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmContract } from '../models/crmContract.model';
import { BillingInvoice } from '../../billing/models/billingInvoice.model';
import { sendCustomerEmail } from '../../../services/email.service';
import { tfEmailWrap } from '../../../services/email.service';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
function calcSubtotal(lineItems: { quantity?: number; unitPrice?: number }[]): number {
  return lineItems.reduce((s, l) => s + (l.quantity ?? 1) * (l.unitPrice ?? 0), 0);
}

export async function listQuotes(
  workspaceId: string | null | undefined,
  opts?: { dealId?: string; accountId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts?.dealId) filter.dealId = opts.dealId;
  if (opts?.accountId) filter.accountId = opts.accountId;
  return CrmQuote.find(filter).sort({ createdAt: -1 }).lean();
}

export async function createQuote(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const deal = await CrmDeal.findOne({ _id: input.dealId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  const lineItems = (input.lineItems as { quantity?: number; unitPrice?: number }[]) ?? [];
  const doc = await CrmQuote.create({
    taskflowOrganizationId: toOrgOid(orgId),
    dealId: deal._id,
    accountId: deal.accountId,
    title: String(input.title ?? `Quote for ${deal.title}`).trim(),
    status: 'draft',
    version: 1,
    validUntil: input.validUntil ? new Date(String(input.validUntil)) : undefined,
    lineItems,
    subtotal: calcSubtotal(lineItems),
    currency: input.currency ?? deal.currency ?? 'USD',
    notes: input.notes,
    createdBy: userId,
  });
  return doc.toObject();
}

export async function sendQuote(
  id: string,
  workspaceId: string | null | undefined,
  toEmail: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const quote = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  if (!quote) throw new ApiError(404, 'Quote not found');
  const lines = (quote.lineItems ?? [])
    .map((l) => `<tr><td>${l.description}</td><td>${l.quantity}</td><td>${l.unitPrice}</td></tr>`)
    .join('');
  const html = tfEmailWrap(
    `<p>Please find your quote: <strong>${quote.title}</strong></p>
    <table border="1" cellpadding="8"><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${lines}</table>
    <p><strong>Total: ${quote.subtotal} ${quote.currency}</strong></p>
    ${quote.notes ? `<p>${quote.notes}</p>` : ''}`,
    'indigo'
  );
  await sendCustomerEmail(toEmail, `Quote: ${quote.title}`, html);
  await CrmQuote.findByIdAndUpdate(id, { $set: { status: 'sent' } });
  try {
    const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
    await dispatchWebhook(orgId, 'quote.sent', { quoteId: id, toEmail, title: quote.title });
  } catch {
    /* best-effort */
  }
  return { ok: true };
}

export async function updateQuote(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Quote not found');

  const nextStatus = input.status as string | undefined;
  if (nextStatus === 'accepted' || nextStatus === 'rejected') {
    const wasAccepted = existing.status === 'accepted';
    existing.status = nextStatus;
    await existing.save();
    let converted: { contractId?: string; invoiceId?: string } | undefined;
    if (nextStatus === 'accepted' && !wasAccepted) {
      converted = await convertAcceptedQuote(existing, orgId);
    }
    return { ...existing.toObject(), converted };
  }

  if (existing.status !== 'draft') {
    throw new ApiError(400, 'Only draft quotes can be edited');
  }
  if (input.title !== undefined) existing.title = String(input.title).trim();
  if (input.notes !== undefined) existing.notes = input.notes as string;
  if (input.validUntil !== undefined) {
    existing.validUntil = input.validUntil ? new Date(String(input.validUntil)) : undefined;
  }
  if (input.currency !== undefined) existing.currency = String(input.currency);
  if (input.lineItems) {
    const lineItems = input.lineItems as {
      description: string;
      quantity?: number;
      unitPrice?: number;
      billingType?: 'fixed' | 'hourly' | 'milestone';
    }[];
    existing.lineItems = lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? 0,
      billingType: l.billingType ?? 'fixed',
    }));
    existing.subtotal = calcSubtotal(existing.lineItems);
  }
  await existing.save();
  return existing.toObject();
}

/**
 * When a quote is accepted, spin up a draft contract and a draft invoice from
 * its line items so sales hands off cleanly to delivery and finance. Best-effort:
 * a failure here never blocks the quote acceptance.
 */
async function convertAcceptedQuote(
  quote: { _id: unknown; title: string; accountId?: unknown; dealId?: unknown; currency?: string; subtotal?: number; lineItems?: { description: string; quantity?: number; unitPrice?: number }[] },
  orgId: string
): Promise<{ contractId?: string; invoiceId?: string }> {
  const result: { contractId?: string; invoiceId?: string } = {};
  const orgOid = toOrgOid(orgId);
  if (!quote.accountId) return result;
  try {
    const contract = await CrmContract.create({
      taskflowOrganizationId: orgOid,
      accountId: quote.accountId,
      dealId: quote.dealId || undefined,
      title: quote.title,
      kind: 'other',
      value: quote.subtotal ?? 0,
      currency: quote.currency ?? 'USD',
      billingCycle: 'one_time',
      startDate: new Date(),
      status: 'draft',
    });
    result.contractId = String(contract._id);

    const lines = (quote.lineItems ?? []).map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? 0,
      taxRate: 0,
      amount: Math.round((l.quantity ?? 1) * (l.unitPrice ?? 0) * 100) / 100,
      sourceType: 'manual' as const,
    }));
    const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const count = await BillingInvoice.countDocuments({ taskflowOrganizationId: orgOid });
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
      taxTotal: 0,
      total: subtotal,
      amountPaid: 0,
      notes: `Generated from accepted quote "${quote.title}"`,
    });
    result.invoiceId = String(invoice._id);
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
