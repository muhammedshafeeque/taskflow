import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as cal from './calendar.service';

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
  res.json({ success: true, data: await cal.getCalendarDashboard(ws(req)) });
}
export async function getFeed(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await cal.getUnifiedFeed(ws(req), req.query as Record<string, string>) });
}
export async function listEvents(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  res.json({ success: true, data: await cal.listEvents(ws(req), req.query as Record<string, string>) });
}
export async function createEvent(req: Request & { user?: AuthPayload }, res: Response) {
  res.status(201).json({ success: true, data: await cal.createEvent(ws(req), req.body, uid(req)) });
}
export async function updateEvent(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await cal.updateEvent(req.params.id, ws(req), req.body) });
}
export async function deleteEvent(req: Request & { user?: AuthPayload }, res: Response) {
  res.json({ success: true, data: await cal.deleteEvent(req.params.id, ws(req)) });
}
