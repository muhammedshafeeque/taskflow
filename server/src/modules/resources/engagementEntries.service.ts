import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Project } from '../projects/project.model';
import { ResourceEngagementEntry } from './models/resourceEngagementEntry.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';

const MAX_SPAN_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

interface EntryInput {
  userId?: string;
  title?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  mode?: string;
  value?: number | string;
  projectId?: string | null;
  notes?: string;
}

/** Who is asking: managers may write anyone's entries, everyone else only their own. */
export interface EntryActor {
  id: string;
  canManageOthers: boolean;
}

function day(v: unknown, field: string): Date {
  const d = new Date(String(v ?? ''));
  if (!v || Number.isNaN(d.getTime())) throw new ApiError(400, `${field} is required`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function assertCanWrite(actor: EntryActor, userId: string) {
  if (!actor.canManageOthers && userId !== actor.id) {
    throw new ApiError(403, 'You can only manage your own engagement entries');
  }
}

async function assertMember(orgOid: mongoose.Types.ObjectId, userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) throw new ApiError(400, 'Invalid userId');
  const ok = await OrganizationMember.exists({ organization: orgOid, user: userId, status: 'active' });
  if (!ok) throw new ApiError(400, 'Person is not an active member of this workspace');
}

async function assertProject(orgId: string, projectId: string) {
  if (!mongoose.Types.ObjectId.isValid(projectId)) throw new ApiError(400, 'Invalid projectId');
  const ok = await Project.exists({ _id: projectId, taskflowOrganizationId: orgId });
  if (!ok) throw new ApiError(400, 'Project is not in this workspace');
}

/** Validates a full set of entry fields (create, or an update merged onto the stored entry). */
function validate(v: { title: string; startDate: Date; endDate: Date; mode: string; value: number }) {
  if (!v.title.trim()) throw new ApiError(400, 'title is required');
  if (v.endDate < v.startDate) throw new ApiError(400, 'endDate must be on or after startDate');
  if ((v.endDate.getTime() - v.startDate.getTime()) / DAY_MS + 1 > MAX_SPAN_DAYS) {
    throw new ApiError(400, `An entry cannot span more than ${MAX_SPAN_DAYS} days`);
  }
  if (v.mode !== 'hours' && v.mode !== 'percent') throw new ApiError(400, "mode must be 'hours' or 'percent'");
  if (!Number.isFinite(v.value) || v.value <= 0) throw new ApiError(400, 'value must be greater than 0');
  if (v.mode === 'hours' && v.value > 24) throw new ApiError(400, 'Hours per day cannot exceed 24');
  if (v.mode === 'percent' && v.value > 200) throw new ApiError(400, 'Percent cannot exceed 200');
}

function populate<T>(q: T): T {
  return (q as unknown as mongoose.Query<unknown, unknown>)
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .populate('createdBy', 'name') as unknown as T;
}

export async function listEntries(
  workspaceId: string | null | undefined,
  query: { userId?: string; from?: string; to?: string; projectId?: string }
) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.userId) filter.userId = query.userId;
  if (query.projectId) filter.projectId = query.projectId;
  if (query.to) filter.startDate = { $lte: day(query.to, 'to') };
  if (query.from) filter.endDate = { $gte: day(query.from, 'from') };
  return populate(ResourceEngagementEntry.find(filter).sort({ startDate: 1 })).lean();
}

export async function createEntry(workspaceId: string | null | undefined, actor: EntryActor, input: EntryInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const userId = input.userId || actor.id;
  assertCanWrite(actor, userId);
  await assertMember(orgOid, userId);
  if (input.projectId) await assertProject(orgId, input.projectId);
  const startDate = day(input.startDate, 'startDate');
  const fields = {
    title: String(input.title ?? ''),
    startDate,
    endDate: input.endDate ? day(input.endDate, 'endDate') : startDate,
    mode: String(input.mode ?? 'hours'),
    value: Number(input.value),
  };
  validate(fields);
  const doc = await ResourceEngagementEntry.create({
    taskflowOrganizationId: orgOid,
    userId,
    ...fields,
    title: fields.title.trim(),
    category: input.category?.trim() || undefined,
    projectId: input.projectId || null,
    notes: input.notes,
    createdBy: actor.id,
  });
  logAudit({ userId: actor.id, action: 'create', resourceType: 'resource_engagement_entry', resourceId: String(doc._id), meta: { userId } });
  return populate(ResourceEngagementEntry.findById(doc._id)).lean();
}

async function findOwned(orgOid: mongoose.Types.ObjectId, actor: EntryActor, id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Entry not found');
  const doc = await ResourceEngagementEntry.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!doc) throw new ApiError(404, 'Entry not found');
  assertCanWrite(actor, String(doc.userId));
  return doc;
}

export async function updateEntry(workspaceId: string | null | undefined, actor: EntryActor, id: string, input: EntryInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const doc = await findOwned(orgOid, actor, id);
  if (input.userId && input.userId !== String(doc.userId)) {
    assertCanWrite(actor, input.userId);
    await assertMember(orgOid, input.userId);
    doc.userId = new mongoose.Types.ObjectId(input.userId);
  }
  if (input.projectId !== undefined) {
    if (input.projectId) await assertProject(orgId, input.projectId);
    doc.projectId = input.projectId ? new mongoose.Types.ObjectId(input.projectId) : null;
  }
  if (input.title !== undefined) doc.title = String(input.title).trim();
  if (input.category !== undefined) doc.category = String(input.category ?? '').trim() || undefined;
  if (input.startDate !== undefined) doc.startDate = day(input.startDate, 'startDate');
  if (input.endDate !== undefined) doc.endDate = day(input.endDate, 'endDate');
  if (input.mode !== undefined) doc.mode = input.mode as 'hours' | 'percent';
  if (input.value !== undefined) doc.value = Number(input.value);
  if (input.notes !== undefined) doc.notes = input.notes;
  validate({ title: doc.title, startDate: doc.startDate, endDate: doc.endDate, mode: doc.mode, value: doc.value });
  await doc.save();
  logAudit({ userId: actor.id, action: 'update', resourceType: 'resource_engagement_entry', resourceId: id, meta: { fields: Object.keys(input) } });
  return populate(ResourceEngagementEntry.findById(doc._id)).lean();
}

export async function deleteEntry(workspaceId: string | null | undefined, actor: EntryActor, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await findOwned(orgOid, actor, id);
  await doc.deleteOne();
  logAudit({ userId: actor.id, action: 'delete', resourceType: 'resource_engagement_entry', resourceId: id, meta: { userId: String(doc.userId) } });
  return { deleted: true };
}
