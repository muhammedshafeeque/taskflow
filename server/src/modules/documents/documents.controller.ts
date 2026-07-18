import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as docs from './documents.service';

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
  res.json({ success: true, data: await docs.getDocumentsDashboard(ws(req)) });
}
export async function listDocuments(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await docs.listDocuments(ws(req), req.query as Record<string, string>) });
}
export async function createDocument(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await docs.createDocument(ws(req), req.body, uid(req)) });
}
export async function updateDocument(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await docs.updateDocument(req.params.id, ws(req), req.body) });
}
export async function cloneTemplate(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await docs.cloneTemplate(req.params.id, ws(req), req.body, uid(req)) });
}
export async function deleteDocument(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await docs.deleteDocument(req.params.id, ws(req)) });
}
