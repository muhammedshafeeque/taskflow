import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as assets from './assets.service';

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
  res.json({ success: true, data: await assets.getAssetsDashboard(ws(req)) });
}

export async function listAssets(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await assets.listAssets(ws(req), req.query as Record<string, string>) });
}
export async function createAsset(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await assets.createAsset(ws(req), req.body) });
}
export async function updateAsset(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await assets.updateAsset(req.params.id, ws(req), req.body) });
}
export async function deleteAsset(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await assets.deleteAsset(req.params.id, ws(req)) });
}

export async function listLicenses(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await assets.listLicenses(ws(req), req.query as Record<string, string>) });
}
export async function createLicense(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await assets.createLicense(ws(req), req.body) });
}
export async function updateLicense(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await assets.updateLicense(req.params.id, ws(req), req.body) });
}
export async function deleteLicense(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await assets.deleteLicense(req.params.id, ws(req)) });
}
