import mongoose from 'mongoose';
import {
  MonitorCustomEvent,
  MonitorErrorGroup,
  MonitorHttpCall,
  MonitorLog,
  MonitorPresence,
  MonitorRelease,
  MonitorTransaction,
  MonitorUptimeCheck,
  MonitorUptimeSample,
  MonitorVital,
} from './monitor.models';
import { assertProjectInWorkspace } from './setup.service';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { ApiError } from '../../utils/ApiError';
import { assertSafeOutboundUrl, escapeRegex } from '../../utils/safeUrl';

type FilterQ = {
  environmentId?: string;
  appId?: string;
  release?: string;
  q?: string;
  level?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function asOid(id?: string) {
  if (!id) return undefined;
  return mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;
}

function scope(orgId: string, projectId: string, q: FilterQ) {
  const filter: Record<string, unknown> = {
    taskflowOrganizationId: toOrgOid(orgId),
    projectId: asOid(projectId),
  };
  const environmentId = asOid(q.environmentId);
  const appId = asOid(q.appId);
  if (environmentId) filter.environmentId = environmentId;
  if (appId) filter.appId = appId;
  if (q.release) filter.release = q.release;
  if (q.from || q.to) {
    const ts: Record<string, Date> = {};
    if (q.from) ts.$gte = new Date(q.from);
    if (q.to) ts.$lte = new Date(q.to);
    filter.timestamp = ts;
  }
  return filter;
}

function cap(n?: number) {
  return Math.min(200, Math.max(1, n ?? 100));
}

export async function overview(workspaceId: string | null | undefined, projectId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const orgOid = toOrgOid(orgId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const base = { taskflowOrganizationId: orgOid, projectId: asOid(projectId) };
  const [logs, errors, live, tx, httpFails, vitals, upOk, upFail] = await Promise.all([
    MonitorLog.countDocuments({ ...base, timestamp: { $gte: since } }),
    MonitorErrorGroup.countDocuments({ ...base, status: 'open' }),
    MonitorPresence.countDocuments({ ...base, lastSeen: { $gte: new Date(Date.now() - 2 * 60 * 1000) } }),
    MonitorTransaction.aggregate([
      { $match: { ...base, timestamp: { $gte: since } } },
      { $group: { _id: null, p95: { $avg: '$durationMs' }, n: { $sum: 1 } } },
    ]),
    MonitorHttpCall.countDocuments({ ...base, timestamp: { $gte: since }, status: { $gte: 400 } }),
    MonitorVital.aggregate([
      { $match: { ...base, timestamp: { $gte: since } } },
      { $group: { _id: '$name', avg: { $avg: '$value' } } },
    ]),
    MonitorUptimeSample.countDocuments({ ...base, timestamp: { $gte: since }, ok: true }),
    MonitorUptimeSample.countDocuments({ ...base, timestamp: { $gte: since }, ok: false }),
  ]);
  const txRow = tx[0] as { p95?: number; n?: number } | undefined;
  return {
    last24hLogs: logs,
    openErrors: errors,
    liveUsers: live,
    transactionAvgMs: txRow?.p95 ?? 0,
    transactionCount: txRow?.n ?? 0,
    httpErrors: httpFails,
    vitals: Object.fromEntries((vitals as Array<{ _id: string; avg: number }>).map((v) => [v._id, v.avg])),
    uptimeOk: upOk,
    uptimeFail: upFail,
  };
}

export async function listLogs(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter = scope(orgId, projectId, q);
  if (q.level) filter.level = q.level;
  if (q.q) filter.message = { $regex: escapeRegex(q.q), $options: 'i' };
  return MonitorLog.find(filter).sort({ timestamp: -1 }).limit(cap(q.limit)).lean();
}

export async function listErrorGroups(workspaceId: string | null | undefined, projectId: string, q: FilterQ & { status?: string }) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), projectId: asOid(projectId) };
  if (q.environmentId) filter.environmentId = asOid(q.environmentId);
  if (q.appId) filter.appId = asOid(q.appId);
  if (q.status) filter.status = q.status;
  if (q.q) filter.message = { $regex: escapeRegex(q.q), $options: 'i' };
  return MonitorErrorGroup.find(filter).sort({ lastSeen: -1 }).limit(cap(q.limit)).lean();
}

export async function getErrorGroup(workspaceId: string | null | undefined, projectId: string, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const group = await MonitorErrorGroup.findOne({
    _id: id,
    projectId,
    taskflowOrganizationId: toOrgOid(orgId),
  }).lean();
  if (!group) throw new ApiError(404, 'Error group not found');
  return group;
}

export type ErrorGroupPatch = {
  status?: string;
  /** true = acknowledge (I'm on it), false = clear. */
  acknowledged?: boolean;
  /** User id, or '' / null to unassign. */
  assigneeId?: string | null;
  /** Mute alerts for N minutes; 0 clears the snooze. */
  snoozeMinutes?: number;
};

export async function updateErrorGroup(
  workspaceId: string | null | undefined,
  projectId: string,
  id: string,
  patch: ErrorGroupPatch,
  actorId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (patch.status !== undefined) {
    if (patch.status !== 'open' && patch.status !== 'resolved') throw new ApiError(400, 'Invalid status');
    $set.status = patch.status;
    if (patch.status === 'resolved') $set.resolvedAt = new Date();
  }
  if (patch.acknowledged !== undefined) {
    if (patch.acknowledged) {
      $set.acknowledgedAt = new Date();
      if (actorId && mongoose.Types.ObjectId.isValid(actorId)) $set.acknowledgedBy = new mongoose.Types.ObjectId(actorId);
    } else {
      $unset.acknowledgedAt = 1;
      $unset.acknowledgedBy = 1;
    }
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId && mongoose.Types.ObjectId.isValid(patch.assigneeId)) {
      $set.assigneeId = new mongoose.Types.ObjectId(patch.assigneeId);
    } else $unset.assigneeId = 1;
  }
  if (patch.snoozeMinutes !== undefined) {
    const mins = Number(patch.snoozeMinutes);
    if (!Number.isFinite(mins) || mins < 0 || mins > 60 * 24 * 30) throw new ApiError(400, 'snoozeMinutes must be 0–43200');
    if (mins === 0) $unset.snoozedUntil = 1;
    else $set.snoozedUntil = new Date(Date.now() + mins * 60_000);
  }
  if (!Object.keys($set).length && !Object.keys($unset).length) throw new ApiError(400, 'Nothing to update');
  const updated = await MonitorErrorGroup.findOneAndUpdate(
    { _id: id, projectId, taskflowOrganizationId: toOrgOid(orgId) },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Error group not found');
  return updated;
}

export async function listLiveUsers(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter = scope(orgId, projectId, q);
  delete filter.timestamp;
  filter.lastSeen = { $gte: new Date(Date.now() - 2 * 60 * 1000) };
  return MonitorPresence.find(filter).sort({ lastSeen: -1 }).limit(cap(q.limit)).lean();
}

export async function listTransactions(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  return MonitorTransaction.find(scope(orgId, projectId, q)).sort({ timestamp: -1 }).limit(cap(q.limit)).lean();
}

export async function listHttp(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter = scope(orgId, projectId, q);
  if (q.q) filter.url = { $regex: escapeRegex(q.q), $options: 'i' };
  return MonitorHttpCall.find(filter).sort({ timestamp: -1 }).limit(cap(q.limit)).lean();
}

export async function listVitals(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  return MonitorVital.find(scope(orgId, projectId, q)).sort({ timestamp: -1 }).limit(cap(q.limit)).lean();
}

export async function listEvents(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter = scope(orgId, projectId, q);
  if (q.q) filter.name = { $regex: escapeRegex(q.q), $options: 'i' };
  return MonitorCustomEvent.find(filter).sort({ timestamp: -1 }).limit(cap(q.limit)).lean();
}

export async function listReleases(workspaceId: string | null | undefined, projectId: string, q: FilterQ) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), projectId: asOid(projectId) };
  if (q.environmentId) filter.environmentId = asOid(q.environmentId);
  if (q.appId) filter.appId = asOid(q.appId);
  return MonitorRelease.find(filter).sort({ firstSeen: -1 }).limit(cap(q.limit)).lean();
}

export async function deviceBreakdown(workspaceId: string | null | undefined, projectId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const rows = await MonitorPresence.aggregate([
    { $match: { taskflowOrganizationId: toOrgOid(orgId), projectId: asOid(projectId) } },
    { $group: { _id: { $ifNull: ['$userAgent', 'unknown'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 30 },
  ]);
  return rows;
}

export async function listUptimeChecks(workspaceId: string | null | undefined, projectId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  return MonitorUptimeCheck.find({ taskflowOrganizationId: toOrgOid(orgId), projectId: asOid(projectId) }).sort({ name: 1 }).lean();
}

export async function createUptimeCheck(
  workspaceId: string | null | undefined,
  projectId: string,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  let url: string;
  try {
    url = assertSafeOutboundUrl(String(input.url ?? ''), 'Uptime URL');
  } catch (err) {
    throw new ApiError(400, err instanceof Error ? err.message : 'Invalid uptime URL');
  }
  const name = String(input.name ?? url).trim();
  if (!name) throw new ApiError(400, 'name and url are required');
  const doc = await MonitorUptimeCheck.create({
    taskflowOrganizationId: toOrgOid(orgId),
    projectId,
    environmentId: input.environmentId || undefined,
    appId: input.appId || undefined,
    name,
    url,
    method: String(input.method ?? 'GET'),
    expectedStatus: Number(input.expectedStatus ?? 200),
    intervalMinutes: Math.max(1, Number(input.intervalMinutes ?? 5)),
    enabled: input.enabled !== false,
    nextRunAt: new Date(),
  });
  return doc.toObject();
}

export async function deleteUptimeCheck(workspaceId: string | null | undefined, projectId: string, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await MonitorUptimeCheck.findOneAndDelete({
    _id: id,
    projectId,
    taskflowOrganizationId: toOrgOid(orgId),
  });
  if (!deleted) throw new ApiError(404, 'Check not found');
  return { ok: true };
}

export async function listUptimeSamples(
  workspaceId: string | null | undefined,
  projectId: string,
  checkId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  await assertProjectInWorkspace(projectId, orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), projectId: asOid(projectId) };
  if (checkId) filter.checkId = checkId;
  return MonitorUptimeSample.find(filter).sort({ timestamp: -1 }).limit(100).lean();
}
