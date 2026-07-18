import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as accounts from './accounts.service';

function ws(req: Request & { activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}
function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await accounts.getAccountsDashboard(ws(req)) });
}
export async function getLedger(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await accounts.getLedger(ws(req)) });
}

export async function listInvoices(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await accounts.listAccountInvoices(ws(req), req.query as Record<string, string>) });
}
export async function postInvoice(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await accounts.postInvoiceToLedger(req.params.id, ws(req)) });
}

export async function listExpenses(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await accounts.listExpenses(ws(req), req.query as Record<string, string>) });
}
export async function createExpense(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await accounts.createExpense(ws(req), req.body, uid(req)) });
}
export async function updateExpense(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await accounts.updateExpense(req.params.id, ws(req), req.body, uid(req)) });
}
export async function deleteExpense(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await accounts.deleteExpense(req.params.id, ws(req)) });
}
