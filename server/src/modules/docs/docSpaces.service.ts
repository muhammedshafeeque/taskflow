import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { DocSpace, DOC_SPACE_AUDIENCES, DOC_SPACE_ROLES, type DocSpaceRole, type IDocSpace } from './models/docSpace.model';
import { DocPage } from './models/docPage.model';
import { DocPageVersion } from './models/docPageVersion.model';
import { DocComment } from './models/docComment.model';
import { roleIn, type DocsActor } from './docs.access';

export interface SpaceInput {
  key?: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  projectIds?: string[];
  audience?: string;
  audienceRole?: string;
  members?: Array<{ userId: string; role: string }>;
  archived?: boolean;
  homePageId?: string | null;
}

export interface SpaceRow {
  id: string;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  audience: IDocSpace['audience'];
  audienceRole: IDocSpace['audienceRole'];
  projects: Array<{ id: string; name: string; key: string }>;
  members: Array<{ id: string; name?: string; email?: string; role: DocSpaceRole }>;
  homePageId: string | null;
  archived: boolean;
  starred: boolean;
  pageCount: number;
  myRole: DocSpaceRole;
  createdBy: string;
  updatedAt: Date;
}

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const MAX_NAME = 80;

function idList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ApiError(400, `${field} must be a list`);
  const ids = [...new Set(v.map(String))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new ApiError(400, `${field} contains an invalid id`);
  return ids;
}

function cleanName(v: unknown): string {
  const name = String(v ?? '').trim();
  if (!name) throw new ApiError(400, 'name is required');
  if (name.length > MAX_NAME) throw new ApiError(400, `name cannot be longer than ${MAX_NAME} characters`);
  return name;
}

function cleanKey(v: unknown): string {
  const key = String(v ?? '').trim().toUpperCase();
  if (!KEY_RE.test(key)) throw new ApiError(400, 'key must be 2–10 letters or digits and start with a letter');
  return key;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new ApiError(400, `${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}

async function cleanProjects(actor: DocsActor, v: unknown) {
  const ids = idList(v, 'projectIds');
  if (ids.length === 0) return [];
  const found = await Project.countDocuments({ _id: { $in: ids }, taskflowOrganizationId: actor.orgOid });
  if (found !== ids.length) throw new ApiError(400, 'Every project must belong to this workspace');
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

async function cleanMembers(actor: DocsActor, v: unknown) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ApiError(400, 'members must be a list');
  const byUser = new Map<string, DocSpaceRole>();
  for (const m of v as Array<{ userId?: unknown; role?: unknown }>) {
    const userId = String(m?.userId ?? '');
    if (!mongoose.Types.ObjectId.isValid(userId)) throw new ApiError(400, 'members contains an invalid user');
    byUser.set(userId, oneOf(m.role, DOC_SPACE_ROLES, 'member role'));
  }
  const ids = [...byUser.keys()];
  if (ids.length) {
    const active = await OrganizationMember.countDocuments({ organization: actor.orgOid, user: { $in: ids }, status: 'active' });
    if (active !== ids.length) throw new ApiError(400, 'Every space member must be an active member of this workspace');
  }
  return ids.map((id) => ({ user: new mongoose.Types.ObjectId(id), role: byUser.get(id)! }));
}

async function toRows(spaces: IDocSpace[], actor: DocsActor, roles: DocSpaceRole[]): Promise<SpaceRow[]> {
  const userIds = [...new Set(spaces.flatMap((s) => s.members.map((m) => String(m.user))))];
  const projectIds = [...new Set(spaces.flatMap((s) => s.projectIds.map(String)))];
  const [users, projects, counts] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name email').lean(),
    Project.find({ _id: { $in: projectIds }, taskflowOrganizationId: actor.orgOid }).select('name key').lean(),
    DocPage.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
      { $match: { spaceId: { $in: spaces.map((s) => s._id) }, deletedAt: null, status: 'published' } },
      { $group: { _id: '$spaceId', n: { $sum: 1 } } },
    ]),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const countBySpace = new Map(counts.map((c) => [String(c._id), c.n]));
  return spaces.map((s, i) => ({
    id: String(s._id),
    key: s.key,
    name: s.name,
    description: s.description,
    icon: s.icon,
    color: s.color,
    audience: s.audience,
    audienceRole: s.audienceRole,
    projects: s.projectIds
      .map((id) => projectById.get(String(id)))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
    members: s.members.map((m) => {
      const u = userById.get(String(m.user));
      return { id: String(m.user), name: u?.name, email: u?.email, role: m.role };
    }),
    homePageId: s.homePageId ? String(s.homePageId) : null,
    archived: s.archived,
    starred: s.starredBy.some((u) => String(u) === actor.id),
    pageCount: countBySpace.get(String(s._id)) ?? 0,
    myRole: roles[i],
    createdBy: String(s.createdBy),
    updatedAt: s.updatedAt,
  }));
}

/** Spaces the user can open, each with their role in it. */
export async function visibleSpaces(actor: DocsActor, opts: { includeArchived?: boolean; projectId?: string } = {}) {
  const filter: Record<string, unknown> = { taskflowOrganizationId: actor.orgOid };
  if (!opts.includeArchived) filter.archived = false;
  if (opts.projectId) {
    if (!mongoose.Types.ObjectId.isValid(opts.projectId)) return [];
    filter.projectIds = new mongoose.Types.ObjectId(opts.projectId);
  }
  const spaces = await DocSpace.find(filter).sort({ name: 1 });
  const roles = await Promise.all(spaces.map((s) => roleIn(s, actor)));
  return spaces.map((space, i) => ({ space, role: roles[i] })).filter((x): x is { space: typeof x.space; role: DocSpaceRole } => x.role !== null);
}

export async function listSpaces(actor: DocsActor, opts: { includeArchived?: boolean; projectId?: string } = {}) {
  const visible = await visibleSpaces(actor, opts);
  return toRows(
    visible.map((v) => v.space),
    actor,
    visible.map((v) => v.role)
  );
}

/** Loads a space by key or id and checks the user can open it. */
export async function loadSpace(actor: DocsActor, keyOrId: string) {
  const byId = mongoose.Types.ObjectId.isValid(keyOrId) && keyOrId.length === 24;
  const space = await DocSpace.findOne({
    taskflowOrganizationId: actor.orgOid,
    ...(byId ? { _id: keyOrId } : { key: String(keyOrId).toUpperCase() }),
  });
  if (!space) throw new ApiError(404, 'Space not found');
  const role = await roleIn(space, actor);
  if (!role) throw new ApiError(404, 'Space not found');
  return { space, role };
}

export async function getSpace(actor: DocsActor, keyOrId: string) {
  const { space, role } = await loadSpace(actor, keyOrId);
  const [row] = await toRows([space], actor, [role]);
  return row;
}

export async function createSpace(actor: DocsActor, input: SpaceInput) {
  if (!actor.canCreateSpace) throw new ApiError(403, 'You cannot create spaces');
  const key = cleanKey(input.key);
  const name = cleanName(input.name);
  if (await DocSpace.exists({ taskflowOrganizationId: actor.orgOid, key })) {
    throw new ApiError(409, `A space with key ${key} already exists`);
  }
  const [projectIds, members] = await Promise.all([cleanProjects(actor, input.projectIds), cleanMembers(actor, input.members)]);
  const audience = input.audience === undefined ? (projectIds.length ? 'project' : 'workspace') : oneOf(input.audience, DOC_SPACE_AUDIENCES, 'audience');
  if (audience === 'project' && projectIds.length === 0) throw new ApiError(400, 'Link at least one project to share the space with project members');
  const space = await DocSpace.create({
    taskflowOrganizationId: actor.orgOid,
    key,
    name,
    description: input.description?.trim() || undefined,
    icon: input.icon?.trim() || undefined,
    color: input.color?.trim() || undefined,
    projectIds,
    audience,
    audienceRole: input.audienceRole === undefined ? 'editor' : oneOf(input.audienceRole, ['editor', 'viewer'] as const, 'audienceRole'),
    // The creator always administers the space they make.
    members: [...members.filter((m) => String(m.user) !== actor.id), { user: new mongoose.Types.ObjectId(actor.id), role: 'admin' }],
    createdBy: actor.id,
  });
  const home = await DocPage.create({
    taskflowOrganizationId: actor.orgOid,
    spaceId: space._id,
    title: `${name} home`,
    content: input.description?.trim() ? `<p>${escapeHtml(input.description.trim())}</p>` : '',
    text: input.description?.trim() ?? '',
    createdBy: actor.id,
    updatedBy: actor.id,
  });
  await DocPageVersion.create({ pageId: home._id, version: 1, title: home.title, content: home.content, authorId: actor.id });
  space.homePageId = home._id as mongoose.Types.ObjectId;
  await space.save();
  logAudit({ userId: actor.id, action: 'create', resourceType: 'doc_space', resourceId: String(space._id), meta: { key, name } });
  return getSpace(actor, String(space._id));
}

export async function updateSpace(actor: DocsActor, keyOrId: string, input: SpaceInput) {
  const { space, role } = await loadSpace(actor, keyOrId);
  if (role !== 'admin') throw new ApiError(403, 'Only space admins can change space settings');
  if (input.key !== undefined) {
    const key = cleanKey(input.key);
    if (key !== space.key && (await DocSpace.exists({ taskflowOrganizationId: actor.orgOid, key }))) {
      throw new ApiError(409, `A space with key ${key} already exists`);
    }
    space.key = key;
  }
  if (input.name !== undefined) space.name = cleanName(input.name);
  if (input.description !== undefined) space.description = String(input.description ?? '').trim() || undefined;
  if (input.icon !== undefined) space.icon = String(input.icon ?? '').trim() || undefined;
  if (input.color !== undefined) space.color = String(input.color ?? '').trim() || undefined;
  if (input.projectIds !== undefined) space.projectIds = await cleanProjects(actor, input.projectIds);
  if (input.audience !== undefined) space.audience = oneOf(input.audience, DOC_SPACE_AUDIENCES, 'audience');
  if (input.audienceRole !== undefined) space.audienceRole = oneOf(input.audienceRole, ['editor', 'viewer'] as const, 'audienceRole');
  // The creator keeps admin rights through roleIn, so a member list can never lock a space.
  if (input.members !== undefined) space.members = await cleanMembers(actor, input.members);
  if (space.audience === 'project' && space.projectIds.length === 0) {
    throw new ApiError(400, 'Link at least one project to share the space with project members');
  }
  if (input.archived !== undefined) space.archived = Boolean(input.archived);
  if (input.homePageId !== undefined) {
    if (input.homePageId === null) space.homePageId = null;
    else {
      const page = await DocPage.findOne({ _id: input.homePageId, spaceId: space._id, deletedAt: null }).select('_id');
      if (!page) throw new ApiError(400, 'Home page must be a page in this space');
      space.homePageId = page._id as mongoose.Types.ObjectId;
    }
  }
  await space.save();
  logAudit({ userId: actor.id, action: 'update', resourceType: 'doc_space', resourceId: String(space._id), meta: { fields: Object.keys(input) } });
  return getSpace(actor, String(space._id));
}

export async function deleteSpace(actor: DocsActor, keyOrId: string) {
  const { space, role } = await loadSpace(actor, keyOrId);
  if (role !== 'admin') throw new ApiError(403, 'Only space admins can delete a space');
  const pageIds = await DocPage.find({ spaceId: space._id }).distinct('_id');
  await Promise.all([
    DocComment.deleteMany({ pageId: { $in: pageIds } }),
    DocPageVersion.deleteMany({ pageId: { $in: pageIds } }),
    DocPage.deleteMany({ spaceId: space._id }),
  ]);
  await space.deleteOne();
  logAudit({ userId: actor.id, action: 'delete', resourceType: 'doc_space', resourceId: String(space._id), meta: { key: space.key, pages: pageIds.length } });
  return { deleted: true };
}

export async function toggleSpaceStar(actor: DocsActor, keyOrId: string, starred: boolean) {
  const { space } = await loadSpace(actor, keyOrId);
  await DocSpace.updateOne({ _id: space._id }, starred ? { $addToSet: { starredBy: actor.id } } : { $pull: { starredBy: actor.id } });
  return { starred };
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
