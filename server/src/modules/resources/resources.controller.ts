import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as resourcesService from './resources.service';

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
  const data = await resourcesService.getDashboard(ws(req));
  res.json({ success: true, data });
}

export async function listAllocations(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { userId?: string; projectId?: string; activeOnly?: string; includeSoft?: string };
  const data = await resourcesService.listAllocations(ws(req), {
    userId: q.userId,
    projectId: q.projectId,
    activeOnly: q.activeOnly === 'true',
    includeSoft: q.includeSoft === 'false' ? false : undefined,
  });
  res.json({ success: true, data });
}

export async function createAllocation(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.createAllocation(ws(req), uid(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateAllocation(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.updateAllocation(ws(req), req.params.id, req.body);
  res.json({ success: true, data });
}

export async function deleteAllocation(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.deleteAllocation(ws(req), req.params.id);
  res.json({ success: true, data });
}

export async function getConflicts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await resourcesService.getConflicts(ws(req));
  res.json({ success: true, data });
}

export async function getUtilization(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { from?: string; to?: string };
  const data = await resourcesService.getUtilization(ws(req), q);
  res.json({ success: true, data });
}

export async function getBench(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const threshold = req.query.threshold ? Number(req.query.threshold) : undefined;
  const data = await resourcesService.getBench(ws(req), { threshold });
  res.json({ success: true, data });
}

export async function getForecast(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await resourcesService.getForecast(ws(req));
  res.json({ success: true, data });
}

export async function listDemands(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const status = req.query.status as string | undefined;
  const data = await resourcesService.listDemands(ws(req), { status });
  res.json({ success: true, data });
}

export async function createDemand(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.createDemand(ws(req), uid(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateDemand(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.updateDemand(ws(req), req.params.id, req.body);
  res.json({ success: true, data });
}

export async function deleteDemand(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await resourcesService.deleteDemand(ws(req), req.params.id);
  res.json({ success: true, data });
}

export async function listProfiles(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await resourcesService.listProfiles(ws(req));
  res.json({ success: true, data });
}

export async function upsertProfile(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await resourcesService.upsertProfile(ws(req), req.body);
  res.json({ success: true, data });
}

export async function listOptions(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await resourcesService.listTeamOptions(ws(req));
  res.json({ success: true, data });
}
