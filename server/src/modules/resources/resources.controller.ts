import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import * as resourcesService from './resources.service';
import * as engagementService from './engagement.service';
import * as settingsService from './resourceSettings.service';
import * as entriesService from './engagementEntries.service';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

type Req = Request & { user?: AuthPayload; activeOrganizationId?: string };

function ws(req: Req) {
  return req.activeOrganizationId;
}

function uid(req: Req) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function getDashboard(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getDashboard(ws(req));
  res.json({ success: true, data });
}

export async function listAllocations(req: Req, res: Response) {
  uid(req);
  const q = req.query as Record<string, string | undefined>;
  const data = await resourcesService.listAllocations(ws(req), {
    userId: q.userId,
    projectId: q.projectId,
    demandId: q.demandId,
    status: q.status as 'active' | 'upcoming' | 'past' | 'current' | 'all' | undefined,
    activeOnly: q.activeOnly === 'true',
    includeSoft: q.includeSoft === 'false' ? false : undefined,
    from: q.from,
    to: q.to,
  });
  res.json({ success: true, data });
}

export async function checkAllocation(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.checkAllocation(ws(req), req.query as Record<string, string | undefined>);
  res.json({ success: true, data });
}

export async function createAllocation(req: Req, res: Response) {
  const data = await resourcesService.createAllocation(ws(req), uid(req), req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function updateAllocation(req: Req, res: Response) {
  const data = await resourcesService.updateAllocation(ws(req), uid(req), req.params.id, req.body ?? {});
  res.json({ success: true, data });
}

export async function deleteAllocation(req: Req, res: Response) {
  const data = await resourcesService.deleteAllocation(ws(req), uid(req), req.params.id);
  res.json({ success: true, data });
}

export async function getConflicts(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getConflicts(ws(req));
  res.json({ success: true, data });
}

export async function getUtilization(req: Req, res: Response) {
  uid(req);
  const q = req.query as { from?: string; to?: string; department?: string };
  const data = await resourcesService.getUtilization(ws(req), q);
  res.json({ success: true, data });
}

export async function getBench(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getBench(ws(req), { threshold: num(req.query.threshold), days: num(req.query.days) });
  res.json({ success: true, data });
}

export async function getSchedule(req: Req, res: Response) {
  uid(req);
  const q = req.query as Record<string, string | undefined>;
  const data = await resourcesService.getSchedule(ws(req), {
    from: q.from,
    weeks: num(q.weeks),
    projectId: q.projectId,
    department: q.department,
  });
  res.json({ success: true, data });
}

export async function getSkills(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getSkills(ws(req));
  res.json({ success: true, data });
}

export async function getForecast(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getForecast(ws(req));
  res.json({ success: true, data });
}

export async function listDemands(req: Req, res: Response) {
  uid(req);
  const status = req.query.status as string | undefined;
  const data = await resourcesService.listDemands(ws(req), { status });
  res.json({ success: true, data });
}

export async function createDemand(req: Req, res: Response) {
  const data = await resourcesService.createDemand(ws(req), uid(req), req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function updateDemand(req: Req, res: Response) {
  const data = await resourcesService.updateDemand(ws(req), uid(req), req.params.id, req.body ?? {});
  res.json({ success: true, data });
}

export async function deleteDemand(req: Req, res: Response) {
  const data = await resourcesService.deleteDemand(ws(req), uid(req), req.params.id);
  res.json({ success: true, data });
}

export async function getDemandCandidates(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.getDemandCandidates(ws(req), req.params.id);
  res.json({ success: true, data });
}

export async function fulfilDemand(req: Req, res: Response) {
  const data = await resourcesService.fulfilDemand(ws(req), uid(req), req.params.id, req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function listProfiles(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.listProfiles(ws(req));
  res.json({ success: true, data });
}

export async function upsertProfile(req: Req, res: Response) {
  const data = await resourcesService.upsertProfile(ws(req), uid(req), req.body ?? {});
  res.json({ success: true, data });
}

export async function bulkUpdateProfiles(req: Req, res: Response) {
  const data = await resourcesService.bulkUpdateProfiles(ws(req), uid(req), req.body ?? {});
  res.json({ success: true, data });
}

export async function listOptions(req: Req, res: Response) {
  uid(req);
  const data = await resourcesService.listTeamOptions(ws(req));
  res.json({ success: true, data });
}

export async function getEngagement(req: Req, res: Response) {
  uid(req);
  const q = req.query as { from?: string; to?: string; userId?: string; projectId?: string; threshold?: string };
  const data = await engagementService.getEngagement(ws(req), {
    from: q.from,
    to: q.to,
    userId: q.userId,
    projectId: q.projectId,
    threshold: num(q.threshold),
  });
  res.json({ success: true, data });
}

export async function getSettings(req: Req, res: Response) {
  uid(req);
  const data = await settingsService.getResourceSettings(ws(req));
  res.json({ success: true, data });
}

export async function updateSettings(req: Req, res: Response) {
  const actor = uid(req);
  const data = await settingsService.updateResourceSettings(ws(req), req.body ?? {});
  logAudit({ userId: actor, action: 'update', resourceType: 'resource_settings', meta: { fields: Object.keys(req.body ?? {}) } });
  res.json({ success: true, data });
}

function entryActor(req: Req): entriesService.EntryActor {
  const perms = req.user?.permissions ?? [];
  const R = TASK_FLOW_PERMISSIONS.TASKFLOW.RESOURCES;
  return {
    id: uid(req),
    canManageOthers: [R.ENGAGEMENT.MANAGE, R.ALLOCATION.MANAGE].some((p) => userHasPermission(perms, p)),
  };
}

export async function listEngagementEntries(req: Req, res: Response) {
  uid(req);
  const q = req.query as Record<string, string | undefined>;
  const data = await entriesService.listEntries(ws(req), { userId: q.userId, from: q.from, to: q.to, projectId: q.projectId });
  res.json({ success: true, data });
}

export async function createEngagementEntry(req: Req, res: Response) {
  const data = await entriesService.createEntry(ws(req), entryActor(req), req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function updateEngagementEntry(req: Req, res: Response) {
  const data = await entriesService.updateEntry(ws(req), entryActor(req), req.params.id, req.body ?? {});
  res.json({ success: true, data });
}

export async function deleteEngagementEntry(req: Req, res: Response) {
  const data = await entriesService.deleteEntry(ws(req), entryActor(req), req.params.id);
  res.json({ success: true, data });
}
