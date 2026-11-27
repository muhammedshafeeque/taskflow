/**
 * Customers accept or reject quotations online (AUT-32): from the secure link in the quotation
 * email, or from the customer portal. Both end in respondToQuote, the same path staff use.
 */
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/ApiError';
import { asyncHandler } from '../../../utils/asyncHandler';
import { CrmQuote } from '../models/crmQuote.model';
import { Organization } from '../../organizations/organization.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { customerAuthMiddleware } from '../../customer-portal/middleware/customerAuth.middleware';
import { customerRequirePermission } from '../../customer-portal/middleware/customerRequirePermission';
import { CUSTOMER_PERMISSIONS } from '../../../shared/constants/permissions';
import { respondToQuote } from './quotes.service';

const PURPOSE = 'quote_response';

/** Signed link for one quotation; valid 90 days (the quotation's own validity still applies). */
export function quoteResponseToken(quoteId: string): string {
  return jwt.sign({ sub: quoteId, purpose: PURPOSE }, env.jwtSecret, { expiresIn: '90d' });
}

export function quoteResponseUrl(quoteId: string): string {
  return `${env.frontendUrl.replace(/\/$/, '')}/quote/${quoteResponseToken(quoteId)}`;
}

function quoteIdFromToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string; purpose?: string };
    if (payload.purpose !== PURPOSE || !payload.sub || !mongoose.isValidObjectId(payload.sub)) throw new Error('bad');
    return payload.sub;
  } catch {
    throw new ApiError(404, 'This link is invalid or has expired. Please ask us for a new one.');
  }
}

type QuoteDoc = InstanceType<typeof CrmQuote>;

/** What the customer sees: the quotation itself, never internal history or approval details. */
async function customerView(q: QuoteDoc | Record<string, any>) {
  const [company, customer] = await Promise.all([
    Organization.findById(q.taskflowOrganizationId).select('name').lean(),
    q.customerOrgId ? CustomerOrg.findById(q.customerOrgId).select('name').lean() : null,
  ]);
  const expired = q.status === 'expired' || (q.status === 'sent' && q.validUntil && new Date(q.validUntil).getTime() < new Date().setHours(0, 0, 0, 0));
  return {
    _id: String(q._id),
    title: q.title,
    status: expired ? 'expired' : q.status,
    company: (company as { name?: string } | null)?.name ?? '',
    customer: (customer as { name?: string } | null)?.name ?? '',
    issueDate: q.issueDate,
    validUntil: q.validUntil,
    currency: q.currency,
    lineItems: (q.lineItems ?? []).map((l: Record<string, unknown>) => ({
      description: l.description,
      billingType: l.billingType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRate: l.taxRate,
      amount: l.amount,
    })),
    subtotal: q.subtotal,
    discountAmount: q.discountAmount,
    taxTotal: q.taxTotal,
    total: q.total,
    notes: q.notes,
    canRespond: q.status === 'sent' && !expired,
    response: q.response ? { decision: q.response.decision, via: q.response.via, name: q.response.name, at: q.response.at, note: q.response.note } : null,
  };
}

function decisionOf(body: unknown): 'accepted' | 'rejected' {
  const d = String((body as { decision?: unknown } | undefined)?.decision ?? '');
  if (d === 'accept' || d === 'accepted') return 'accepted';
  if (d === 'reject' || d === 'rejected') return 'rejected';
  throw new ApiError(400, 'Choose accept or reject');
}

// ── Secure link (no sign-in) ────────────────────────────────────────────────

export const publicQuoteRoutes = Router();

publicQuoteRoutes.get(
  '/:token',
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await CrmQuote.findById(quoteIdFromToken(req.params.token));
    if (!quote || quote.status === 'draft') throw new ApiError(404, 'This link is invalid or has expired. Please ask us for a new one.');
    res.json({ success: true, data: await customerView(quote) });
  })
);

publicQuoteRoutes.post(
  '/:token/respond',
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await CrmQuote.findById(quoteIdFromToken(req.params.token));
    if (!quote || quote.status === 'draft') throw new ApiError(404, 'This link is invalid or has expired. Please ask us for a new one.');
    const body = (req.body ?? {}) as { name?: string; email?: string; note?: string };
    const name = String(body.name ?? '').trim();
    if (!name) throw new ApiError(400, 'Enter your name');
    const decision = decisionOf(req.body);
    if (decision === 'rejected' && !String(body.note ?? '').trim()) throw new ApiError(400, 'Tell us why, so we can do better');
    await respondToQuote(String(quote.taskflowOrganizationId), quote, decision, { via: 'link', name, email: body.email }, body.note);
    res.json({ success: true, data: await customerView(quote) });
  })
);

// ── Customer portal ─────────────────────────────────────────────────────────

const CQ = CUSTOMER_PERMISSIONS.QUOTE.QUOTE;
type CustomerReq = Request & { customerUser?: { id: string; orgId: string; name?: string; email?: string } };

export const customerQuoteRoutes = Router();
customerQuoteRoutes.use(customerAuthMiddleware);

/** Quotations sent to the signed-in customer's organisation. */
customerQuoteRoutes.get(
  '/',
  customerRequirePermission(CQ.LIST),
  asyncHandler(async (req: CustomerReq, res: Response) => {
    const rows = await CrmQuote.find({ customerOrgId: new mongoose.Types.ObjectId(req.customerUser!.orgId), status: { $ne: 'draft' } })
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json({ success: true, data: await Promise.all(rows.map(customerView)) });
  })
);

async function portalQuote(req: CustomerReq): Promise<QuoteDoc> {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Quotation not found');
  const quote = await CrmQuote.findOne({ _id: id, customerOrgId: new mongoose.Types.ObjectId(req.customerUser!.orgId), status: { $ne: 'draft' } });
  if (!quote) throw new ApiError(404, 'Quotation not found');
  return quote;
}

customerQuoteRoutes.get(
  '/:id',
  customerRequirePermission(CQ.LIST),
  asyncHandler(async (req: CustomerReq, res: Response) => {
    res.json({ success: true, data: await customerView(await portalQuote(req)) });
  })
);

customerQuoteRoutes.post(
  '/:id/respond',
  customerRequirePermission(CQ.RESPOND),
  asyncHandler(async (req: CustomerReq, res: Response) => {
    const quote = await portalQuote(req);
    const decision = decisionOf(req.body);
    const note = (req.body as { note?: string } | undefined)?.note;
    if (decision === 'rejected' && !String(note ?? '').trim()) throw new ApiError(400, 'Tell us why, so we can do better');
    const cu = req.customerUser!;
    await respondToQuote(String(quote.taskflowOrganizationId), quote, decision, { via: 'portal', name: cu.name, email: cu.email, customerUserId: cu.id }, note);
    res.json({ success: true, data: await customerView(quote) });
  })
);
