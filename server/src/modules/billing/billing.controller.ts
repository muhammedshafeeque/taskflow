import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as billing from './billing.service';

function ws(req: Request & { user?: AuthPayload; activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await billing.getBillingDashboard(ws(req));
  res.json({ success: true, data });
}

export async function listSubscriptions(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; accountId?: string };
  const data = await billing.listSubscriptions(ws(req), q);
  res.json({ success: true, data });
}

export async function createSubscription(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.createSubscription(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function updateSubscription(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.updateSubscription(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function deleteSubscription(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.deleteSubscription(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function generateSubscriptionInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.generateSubscriptionInvoice(req.params.id, ws(req), uid(req));
  res.status(201).json({ success: true, data });
}

export async function listInvoices(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; accountId?: string };
  const data = await billing.listInvoices(ws(req), q);
  res.json({ success: true, data });
}

export async function createInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.createInvoice(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function updateInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.updateInvoice(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function recordPayment(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await billing.recordPayment(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function deleteInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.deleteInvoice(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listTax(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await billing.listTaxRules(ws(req));
  res.json({ success: true, data });
}

export async function createTax(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.createTaxRule(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateTax(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.updateTaxRule(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function deleteTax(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.deleteTaxRule(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function getTimeToInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await billing.getUnbilledTimeSummary(ws(req));
  res.json({ success: true, data });
}

export async function createFromTime(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await billing.createInvoiceFromTime(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}
