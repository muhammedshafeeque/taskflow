import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as proc from './procurement.service';

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
  res.json({ success: true, data: await proc.getProcurementDashboard(ws(req)) });
}

export async function listVendors(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await proc.listVendors(ws(req)) });
}
export async function createVendor(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await proc.createVendor(ws(req), req.body) });
}

export async function listPurchaseOrders(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await proc.listPurchaseOrders(ws(req), req.query as Record<string, string>) });
}
export async function createPurchaseOrder(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await proc.createPurchaseOrder(ws(req), req.body, uid(req)) });
}
export async function updatePurchaseOrder(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await proc.updatePurchaseOrder(req.params.id, ws(req), req.body) });
}
export async function transitionPurchaseOrder(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await proc.transitionPurchaseOrder(req.params.id, ws(req), req.body?.status, uid(req)) });
}
export async function deletePurchaseOrder(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await proc.deletePurchaseOrder(req.params.id, ws(req)) });
}
