import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ResourceTeam } from './models/resourceTeam.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';

interface TeamInput {
  name?: string;
  description?: string;
  color?: string;
  leadId?: string | null;
  memberIds?: string[];
  projectIds?: string[];
}

export interface TeamRow {
  id: string;
  name: string;
  description?: string;
  color?: string;
  lead: { id: string; name?: string } | null;
  members: Array<{ id: string; name?: string; email?: string }>;
  projects: Array<{ id: string; name?: string; key?: string }>;
  updatedAt?: Date;
}

const MAX_NAME = 80;

function idList(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ApiError(400, `${field} must be a list`);
  const ids = [...new Set(v.map(String))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new ApiError(400, `${field} contains an invalid id`);
  return ids;
}

async function assertMembers(orgOid: mongoose.Types.ObjectId, userIds: string[]) {
  if (userIds.length === 0) return;
  const active = await OrganizationMember.find({ organization: orgOid, user: { $in: userIds }, status: 'active' }).distinct('user');
  if (active.length !== userIds.length) throw new ApiError(400, 'Every team member must be an active member of this workspace');
}

async function assertProjects(orgId: string, projectIds: string[]) {
  if (projectIds.length === 0) return;
  const found = await Project.countDocuments({ _id: { $in: projectIds }, taskflowOrganizationId: orgId });
  if (found !== projectIds.length) throw new ApiError(400, 'Every project must belong to this workspace');
}

function cleanName(v: unknown): string {
  const name = String(v ?? '').trim();
  if (!name) throw new ApiError(400, 'name is required');
  if (name.length > MAX_NAME) throw new ApiError(400, `name cannot be longer than ${MAX_NAME} characters`);
  return name;
}

async function assertUniqueName(orgOid: mongoose.Types.ObjectId, name: string, exceptId?: string) {
  const clash = await ResourceTeam.findOne({ taskflowOrganizationId: orgOid, name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
    .collation({ locale: 'en', strength: 2 })
    .select('_id')
    .lean();
  if (clash) throw new ApiError(409, `A team named “${name}” already exists`);
}

/** Teams with member and project names resolved. Ids that no longer resolve are dropped. */
export async function listTeams(workspaceId: string | null | undefined, query: { projectId?: string; userId?: string } = {}): Promise<TeamRow[]> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.projectId) filter.projectIds = query.projectId;
  if (query.userId) filter.memberIds = query.userId;
  const teams = await ResourceTeam.find(filter).collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean();
  const userIds = [...new Set(teams.flatMap((t) => [...t.memberIds, ...(t.leadId ? [t.leadId] : [])]).map(String))];
  const projectIds = [...new Set(teams.flatMap((t) => t.projectIds).map(String))];
  const [users, projects] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name email').lean(),
    Project.find({ _id: { $in: projectIds }, taskflowOrganizationId: orgId }).select('name key').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  return teams.map((t) => {
    const lead = t.leadId ? userById.get(String(t.leadId)) : undefined;
    return {
      id: String(t._id),
      name: t.name,
      description: t.description,
      color: t.color,
      lead: lead ? { id: String(lead._id), name: lead.name } : null,
      members: t.memberIds
        .map((id) => userById.get(String(id)))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
      projects: t.projectIds
        .map((id) => projectById.get(String(id)))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
      updatedAt: t.updatedAt,
    };
  });
}

async function rowOf(workspaceId: string, id: string): Promise<TeamRow> {
  const rows = await listTeams(workspaceId);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new ApiError(404, 'Team not found');
  return row;
}

export async function createTeam(workspaceId: string | null | undefined, actorId: string, input: TeamInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const name = cleanName(input.name);
  const memberIds = idList(input.memberIds, 'memberIds');
  const projectIds = idList(input.projectIds, 'projectIds');
  const leadId = input.leadId ? String(input.leadId) : null;
  // The lead is always part of the team.
  if (leadId && !memberIds.includes(leadId)) memberIds.push(leadId);
  await Promise.all([assertUniqueName(orgOid, name), assertMembers(orgOid, memberIds), assertProjects(orgId, projectIds)]);
  const doc = await ResourceTeam.create({
    taskflowOrganizationId: orgOid,
    name,
    description: input.description?.trim() || undefined,
    color: input.color?.trim() || undefined,
    leadId,
    memberIds,
    projectIds,
    createdBy: actorId,
  });
  logAudit({ userId: actorId, action: 'create', resourceType: 'resource_team', resourceId: String(doc._id), meta: { name } });
  return rowOf(orgId, String(doc._id));
}

async function findTeam(orgOid: mongoose.Types.ObjectId, id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Team not found');
  const doc = await ResourceTeam.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!doc) throw new ApiError(404, 'Team not found');
  return doc;
}

export async function updateTeam(workspaceId: string | null | undefined, actorId: string, id: string, input: TeamInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const doc = await findTeam(orgOid, id);
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    await assertUniqueName(orgOid, name, id);
    doc.name = name;
  }
  if (input.description !== undefined) doc.description = String(input.description ?? '').trim() || undefined;
  if (input.color !== undefined) doc.color = String(input.color ?? '').trim() || undefined;
  if (input.memberIds !== undefined) {
    const memberIds = idList(input.memberIds, 'memberIds');
    await assertMembers(orgOid, memberIds);
    doc.memberIds = memberIds.map((m) => new mongoose.Types.ObjectId(m));
  }
  if (input.projectIds !== undefined) {
    const projectIds = idList(input.projectIds, 'projectIds');
    await assertProjects(orgId, projectIds);
    doc.projectIds = projectIds.map((p) => new mongoose.Types.ObjectId(p));
  }
  if (input.leadId !== undefined) {
    if (input.leadId && !mongoose.Types.ObjectId.isValid(String(input.leadId))) throw new ApiError(400, 'Invalid leadId');
    doc.leadId = input.leadId ? new mongoose.Types.ObjectId(String(input.leadId)) : null;
  }
  if (doc.leadId && !doc.memberIds.some((m) => String(m) === String(doc.leadId))) {
    await assertMembers(orgOid, [String(doc.leadId)]);
    doc.memberIds.push(doc.leadId);
  }
  await doc.save();
  logAudit({ userId: actorId, action: 'update', resourceType: 'resource_team', resourceId: id, meta: { fields: Object.keys(input) } });
  return rowOf(orgId, id);
}

export async function deleteTeam(workspaceId: string | null | undefined, actorId: string, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await findTeam(orgOid, id);
  await doc.deleteOne();
  logAudit({ userId: actorId, action: 'delete', resourceType: 'resource_team', resourceId: id, meta: { name: doc.name } });
  return { deleted: true };
}
