import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import { User } from '../auth/user.model';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { DocPage, type IDocPage } from './models/docPage.model';
import { DocPageVersion } from './models/docPageVersion.model';
import { DocComment } from './models/docComment.model';
import { DocSpace, type DocSpaceRole } from './models/docSpace.model';
import { canEditRole, roleIn, type DocsActor } from './docs.access';
import { loadSpace, visibleSpaces } from './docSpaces.service';

export interface PageInput {
  spaceId?: string;
  parentId?: string | null;
  title?: string;
  emoji?: string;
  content?: string;
  status?: string;
  locked?: boolean;
  labels?: string[];
  issueIds?: string[];
  projectIds?: string[];
  /** Version the editor started from; a mismatch means someone else saved in between. */
  baseVersion?: number;
  message?: string;
}

const MAX_TITLE = 200;
const MAX_CONTENT = 2_000_000;
const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

type Person = { id: string; name?: string; email?: string };
type IssueRef = { id: string; key?: string; title?: string; status?: string; type?: string; projectId?: string; hidden?: boolean };

/** Plain text of stored rich text, for search and previews. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function excerpt(text: string, q?: string) {
  if (!q) return text.slice(0, 180);
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text.slice(0, 180);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 180)}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function oid(id: string) {
  return new mongoose.Types.ObjectId(id);
}

function idList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ApiError(400, `${field} must be a list`);
  const ids = [...new Set(v.map(String))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new ApiError(400, `${field} contains an invalid id`);
  return ids;
}

function cleanTitle(v: unknown) {
  const title = String(v ?? '').trim();
  if (!title) throw new ApiError(400, 'title is required');
  if (title.length > MAX_TITLE) throw new ApiError(400, `title cannot be longer than ${MAX_TITLE} characters`);
  return title;
}

function cleanContent(v: unknown) {
  const content = String(v ?? '');
  if (content.length > MAX_CONTENT) throw new ApiError(413, 'Page is too large');
  return content;
}

function cleanLabels(v: unknown) {
  if (!Array.isArray(v)) throw new ApiError(400, 'labels must be a list');
  return [...new Set(v.map((l) => String(l).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 30);
}

async function cleanIssueIds(actor: DocsActor, v: unknown) {
  const ids = idList(v, 'issueIds');
  if (!ids.length) return [];
  const projects = await actor.workspaceProjectIds();
  const found = await Issue.countDocuments({ _id: { $in: ids }, project: { $in: projects } });
  if (found !== ids.length) throw new ApiError(400, 'Every linked issue must belong to this workspace');
  return ids.map(oid);
}

async function cleanProjectIds(actor: DocsActor, v: unknown) {
  const ids = idList(v, 'projectIds');
  if (!ids.length) return [];
  const found = await Project.countDocuments({ _id: { $in: ids }, taskflowOrganizationId: actor.orgOid });
  if (found !== ids.length) throw new ApiError(400, 'Every linked project must belong to this workspace');
  return ids.map(oid);
}

/** Issues in this workspace whose keys appear in the text. */
async function mentionedIssues(actor: DocsActor, text: string) {
  const keys = [...new Set(text.match(ISSUE_KEY_RE) ?? [])].slice(0, 200);
  if (!keys.length) return [];
  const projects = await actor.workspaceProjectIds();
  const issues = await Issue.find({ key: { $in: keys }, project: { $in: projects } }).select('_id').lean();
  return issues.map((i) => i._id as mongoose.Types.ObjectId);
}

/** A page the user may see: its space is visible and it is published or their own draft. */
async function loadPage(actor: DocsActor, id: string, opts: { includeDeleted?: boolean } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Page not found');
  const page = await DocPage.findOne({ _id: id, taskflowOrganizationId: actor.orgOid });
  if (!page || (page.deletedAt && !opts.includeDeleted)) throw new ApiError(404, 'Page not found');
  if (page.status === 'draft' && String(page.createdBy) !== actor.id && !actor.isDocsAdmin) throw new ApiError(404, 'Page not found');
  const space = await DocSpace.findById(page.spaceId);
  if (!space) throw new ApiError(404, 'Page not found');
  const role = await roleIn(space, actor);
  if (!role) throw new ApiError(404, 'Page not found');
  return { page, space, role };
}

function assertCanEdit(role: DocSpaceRole, page?: Pick<IDocPage, 'locked'>) {
  if (!canEditRole(role)) throw new ApiError(403, 'You can view this space but not edit it');
  if (page?.locked && role !== 'admin') throw new ApiError(403, 'This page is locked; only space admins can edit it');
}

async function people(ids: Array<mongoose.Types.ObjectId | string | null | undefined>): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: unique } }).select('name email avatar').lean();
  return new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, email: u.email }]));
}

/** Issue summaries; issues in projects the user is not on show only their key. */
async function issueRefs(actor: DocsActor, ids: mongoose.Types.ObjectId[]): Promise<IssueRef[]> {
  if (!ids.length) return [];
  const projects = await actor.workspaceProjectIds();
  const mine = await actor.projectIds();
  const issues = await Issue.find({ _id: { $in: ids }, project: { $in: projects } }).select('key title status type project').lean();
  return issues.map((i) =>
    actor.isDocsAdmin || mine.has(String(i.project))
      ? { id: String(i._id), key: i.key, title: i.title, status: i.status, type: i.type, projectId: String(i.project) }
      : { id: String(i._id), key: i.key, projectId: String(i.project), hidden: true }
  );
}

async function ancestors(page: IDocPage) {
  const trail: Array<{ id: string; title: string; emoji?: string }> = [];
  let parentId = page.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(String(parentId)) && trail.length < 25) {
    seen.add(String(parentId));
    const parent = await DocPage.findById(parentId).select('title emoji parentId deletedAt').lean();
    if (!parent || parent.deletedAt) break;
    trail.unshift({ id: String(parent._id), title: parent.title, emoji: parent.emoji });
    parentId = parent.parentId;
  }
  return trail;
}

async function pageDetail(actor: DocsActor, page: IDocPage, role: DocSpaceRole) {
  const space = await DocSpace.findById(page.spaceId).select('key name icon color homePageId').lean();
  const linkedIds = page.issueIds;
  const mentionIds = page.mentionedIssueIds.filter((m) => !linkedIds.some((l) => String(l) === String(m)));
  const [byId, linkedIssues, mentioned, projects, trail, children, commentCount] = await Promise.all([
    people([page.createdBy, page.updatedBy]),
    issueRefs(actor, linkedIds),
    issueRefs(actor, mentionIds),
    Project.find({ _id: { $in: page.projectIds }, taskflowOrganizationId: actor.orgOid }).select('name key').lean(),
    ancestors(page),
    DocPage.find(visibleChildFilter(actor, page.spaceId, page._id as mongoose.Types.ObjectId))
      .sort({ position: 1, title: 1 })
      .select('title emoji updatedAt')
      .lean(),
    DocComment.countDocuments({ pageId: page._id }),
  ]);
  return {
    id: String(page._id),
    space: space ? { id: String(space._id), key: space.key, name: space.name, icon: space.icon, color: space.color } : null,
    isHome: space?.homePageId ? String(space.homePageId) === String(page._id) : false,
    parentId: page.parentId ? String(page.parentId) : null,
    breadcrumbs: trail,
    title: page.title,
    emoji: page.emoji,
    content: page.content,
    status: page.status,
    locked: page.locked,
    labels: page.labels,
    version: page.version,
    starred: page.starredBy.some((u) => String(u) === actor.id),
    issues: linkedIssues,
    mentionedIssues: mentioned,
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
    children: children.map((c) => ({ id: String(c._id), title: c.title, emoji: c.emoji, updatedAt: c.updatedAt })),
    commentCount,
    createdBy: byId.get(String(page.createdBy)) ?? { id: String(page.createdBy) },
    updatedBy: byId.get(String(page.updatedBy)) ?? { id: String(page.updatedBy) },
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deletedAt: page.deletedAt ?? null,
    myRole: role,
    canEdit: canEditRole(role) && (!page.locked || role === 'admin'),
  };
}

/** Published pages plus the user's own drafts. */
function draftFilter(actor: DocsActor) {
  return actor.isDocsAdmin ? {} : { $or: [{ status: 'published' }, { createdBy: oid(actor.id) }] };
}

function visibleChildFilter(actor: DocsActor, spaceId: mongoose.Types.ObjectId, parentId: mongoose.Types.ObjectId) {
  return { spaceId, parentId, deletedAt: null, ...draftFilter(actor) };
}

export async function getPage(actor: DocsActor, id: string) {
  const { page, role } = await loadPage(actor, id);
  return pageDetail(actor, page, role);
}

/** Every page in a space as a flat list; the client builds the tree from parentId and position. */
export async function spaceTree(actor: DocsActor, keyOrId: string) {
  const { space } = await loadSpace(actor, keyOrId);
  const pages = await DocPage.find({ spaceId: space._id, deletedAt: null, ...draftFilter(actor) })
    .sort({ position: 1, title: 1 })
    .select('title emoji parentId position status locked updatedAt')
    .lean();
  return pages.map((p) => ({
    id: String(p._id),
    parentId: p.parentId ? String(p.parentId) : null,
    title: p.title,
    emoji: p.emoji,
    position: p.position,
    status: p.status,
    locked: p.locked,
    updatedAt: p.updatedAt,
  }));
}

async function nextPosition(spaceId: mongoose.Types.ObjectId, parentId: mongoose.Types.ObjectId | null) {
  const last = await DocPage.findOne({ spaceId, parentId, deletedAt: null }).sort({ position: -1 }).select('position').lean();
  return (last?.position ?? -1) + 1;
}

async function assertParent(spaceId: mongoose.Types.ObjectId, parentId: string | null | undefined) {
  if (!parentId) return null;
  if (!mongoose.Types.ObjectId.isValid(parentId)) throw new ApiError(400, 'Invalid parentId');
  const parent = await DocPage.findOne({ _id: parentId, spaceId, deletedAt: null }).select('_id');
  if (!parent) throw new ApiError(400, 'Parent page must be in the same space');
  return parent._id as mongoose.Types.ObjectId;
}

export async function createPage(actor: DocsActor, input: PageInput) {
  if (!input.spaceId) throw new ApiError(400, 'spaceId is required');
  const { space, role } = await loadSpace(actor, input.spaceId);
  assertCanEdit(role);
  if (space.archived) throw new ApiError(400, 'This space is archived');
  const parentId = await assertParent(space._id as mongoose.Types.ObjectId, input.parentId);
  const title = cleanTitle(input.title ?? 'Untitled');
  const content = cleanContent(input.content);
  const text = htmlToText(content);
  const [issueIds, projectIds, mentionedIssueIds] = await Promise.all([
    cleanIssueIds(actor, input.issueIds),
    cleanProjectIds(actor, input.projectIds),
    mentionedIssues(actor, `${title}\n${text}`),
  ]);
  const page = await DocPage.create({
    taskflowOrganizationId: actor.orgOid,
    spaceId: space._id,
    parentId,
    position: await nextPosition(space._id as mongoose.Types.ObjectId, parentId),
    title,
    emoji: input.emoji?.trim() || undefined,
    content,
    text,
    status: input.status === 'draft' ? 'draft' : 'published',
    labels: input.labels ? cleanLabels(input.labels) : [],
    issueIds,
    projectIds,
    mentionedIssueIds,
    createdBy: actor.id,
    updatedBy: actor.id,
  });
  await DocPageVersion.create({ pageId: page._id, version: 1, title, content, authorId: actor.id, message: input.message?.trim() || undefined });
  logAudit({ userId: actor.id, action: 'create', resourceType: 'doc_page', resourceId: String(page._id), meta: { title, space: space.key } });
  return pageDetail(actor, page, role);
}

export async function updatePage(actor: DocsActor, id: string, input: PageInput) {
  const { page, role } = await loadPage(actor, id);
  const lockOnly = Object.keys(input).every((k) => k === 'locked');
  if (lockOnly) {
    if (role !== 'admin') throw new ApiError(403, 'Only space admins can lock pages');
  } else {
    assertCanEdit(role, page);
  }
  if (input.locked !== undefined) {
    if (role !== 'admin') throw new ApiError(403, 'Only space admins can lock pages');
    page.locked = Boolean(input.locked);
  }

  const nextTitle = input.title !== undefined ? cleanTitle(input.title) : page.title;
  const nextContent = input.content !== undefined ? cleanContent(input.content) : page.content;
  const bodyChanged = nextTitle !== page.title || nextContent !== page.content;
  if (bodyChanged && input.baseVersion !== undefined && Number(input.baseVersion) !== page.version) {
    const latest = await pageDetail(actor, page, role);
    throw new ApiError(409, 'Someone else saved this page while you were editing', latest);
  }
  if (bodyChanged) {
    page.title = nextTitle;
    page.content = nextContent;
    page.text = htmlToText(nextContent);
    page.mentionedIssueIds = await mentionedIssues(actor, `${nextTitle}\n${page.text}`);
    page.version += 1;
  }
  if (input.emoji !== undefined) page.emoji = String(input.emoji ?? '').trim() || undefined;
  if (input.status !== undefined) {
    if (input.status !== 'draft' && input.status !== 'published') throw new ApiError(400, 'status must be draft or published');
    // Drafts are private to their author, so only the author can turn a page back into one.
    if (input.status === 'draft' && page.status !== 'draft' && String(page.createdBy) !== actor.id) {
      throw new ApiError(403, 'Only the author can move a page back to draft');
    }
    page.status = input.status;
  }
  if (input.labels !== undefined) page.labels = cleanLabels(input.labels);
  if (input.issueIds !== undefined) page.issueIds = await cleanIssueIds(actor, input.issueIds);
  if (input.projectIds !== undefined) page.projectIds = await cleanProjectIds(actor, input.projectIds);
  page.updatedBy = oid(actor.id);
  await page.save();
  if (bodyChanged) {
    await DocPageVersion.create({
      pageId: page._id,
      version: page.version,
      title: page.title,
      content: page.content,
      authorId: actor.id,
      message: input.message?.trim() || undefined,
    });
  }
  return pageDetail(actor, page, role);
}

async function descendantIds(spaceId: mongoose.Types.ObjectId, rootId: mongoose.Types.ObjectId, filter: Record<string, unknown>) {
  const all = await DocPage.find({ spaceId, ...filter }).select('_id parentId').lean();
  const byParent = new Map<string, string[]>();
  for (const p of all) {
    const key = String(p.parentId ?? '');
    byParent.set(key, [...(byParent.get(key) ?? []), String(p._id)]);
  }
  const out: string[] = [];
  const stack = [String(rootId)];
  while (stack.length) {
    const next = stack.pop()!;
    for (const child of byParent.get(next) ?? []) {
      if (out.includes(child)) continue;
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/** Moves a page and everything under it to the space trash. */
export async function trashPage(actor: DocsActor, id: string) {
  const { page, space, role } = await loadPage(actor, id);
  assertCanEdit(role, page);
  if (space.homePageId && String(space.homePageId) === String(page._id)) {
    throw new ApiError(400, 'Choose another home page before deleting this one');
  }
  const ids = [String(page._id), ...(await descendantIds(page.spaceId, page._id as mongoose.Types.ObjectId, { deletedAt: null }))];
  const now = new Date();
  await DocPage.updateMany({ _id: { $in: ids } }, { deletedAt: now, deletedBy: actor.id });
  logAudit({ userId: actor.id, action: 'delete', resourceType: 'doc_page', resourceId: String(page._id), meta: { title: page.title, pages: ids.length } });
  return { trashed: ids.length };
}

export async function listTrash(actor: DocsActor, keyOrId: string) {
  const { space, role } = await loadSpace(actor, keyOrId);
  if (!canEditRole(role)) return [];
  const pages = await DocPage.find({ spaceId: space._id, deletedAt: { $ne: null } })
    .sort({ deletedAt: -1 })
    .select('title emoji parentId deletedAt deletedBy')
    .lean();
  // Show only the pages that were deleted directly, not the children that went with them.
  const trashed = new Map(pages.map((p) => [String(p._id), p]));
  const roots = pages.filter((p) => {
    const parent = p.parentId ? trashed.get(String(p.parentId)) : undefined;
    return !parent || String(parent.deletedAt) !== String(p.deletedAt);
  });
  const byId = await people(roots.map((p) => p.deletedBy));
  return roots.map((p) => ({
    id: String(p._id),
    title: p.title,
    emoji: p.emoji,
    deletedAt: p.deletedAt,
    deletedBy: p.deletedBy ? byId.get(String(p.deletedBy)) ?? { id: String(p.deletedBy) } : null,
    childCount: pages.filter((c) => String(c.deletedAt) === String(p.deletedAt) && String(c._id) !== String(p._id)).length,
  }));
}

export async function restorePage(actor: DocsActor, id: string) {
  const { page, role } = await loadPage(actor, id, { includeDeleted: true });
  assertCanEdit(role);
  if (!page.deletedAt) return pageDetail(actor, page, role);
  const ids = [
    String(page._id),
    ...(await descendantIds(page.spaceId, page._id as mongoose.Types.ObjectId, { deletedAt: page.deletedAt })),
  ];
  // If the old parent is gone, bring the page back at the top level.
  if (page.parentId && !(await DocPage.exists({ _id: page.parentId, deletedAt: null }))) {
    page.parentId = null;
    page.position = await nextPosition(page.spaceId, null);
  }
  page.deletedAt = null;
  page.deletedBy = null;
  await page.save();
  await DocPage.updateMany({ _id: { $in: ids } }, { deletedAt: null, deletedBy: null });
  logAudit({ userId: actor.id, action: 'restore', resourceType: 'doc_page', resourceId: String(page._id), meta: { title: page.title } });
  return pageDetail(actor, page, role);
}

/** Permanently removes a trashed page and the children deleted with it. */
export async function purgePage(actor: DocsActor, id: string) {
  const { page, role } = await loadPage(actor, id, { includeDeleted: true });
  if (role !== 'admin') throw new ApiError(403, 'Only space admins can empty the trash');
  if (!page.deletedAt) throw new ApiError(400, 'Move the page to the trash first');
  const ids = [String(page._id), ...(await descendantIds(page.spaceId, page._id as mongoose.Types.ObjectId, { deletedAt: page.deletedAt }))];
  await Promise.all([
    DocComment.deleteMany({ pageId: { $in: ids } }),
    DocPageVersion.deleteMany({ pageId: { $in: ids } }),
    DocPage.deleteMany({ _id: { $in: ids } }),
  ]);
  logAudit({ userId: actor.id, action: 'purge', resourceType: 'doc_page', resourceId: String(page._id), meta: { title: page.title, pages: ids.length } });
  return { deleted: ids.length };
}

/** Moves a page under a new parent (or to the top level) at `index` among its new siblings. */
export async function movePage(actor: DocsActor, id: string, input: { parentId?: string | null; spaceId?: string; index?: number }) {
  const { page, space, role } = await loadPage(actor, id);
  assertCanEdit(role, page);
  let targetSpaceId = page.spaceId;
  if (input.spaceId && input.spaceId !== String(page.spaceId)) {
    const target = await loadSpace(actor, input.spaceId);
    assertCanEdit(target.role);
    if (space.homePageId && String(space.homePageId) === String(page._id)) throw new ApiError(400, 'A space home page cannot leave its space');
    targetSpaceId = target.space._id as mongoose.Types.ObjectId;
  }
  const parentId = await assertParent(targetSpaceId, input.parentId ?? null);
  const subtree = await descendantIds(page.spaceId, page._id as mongoose.Types.ObjectId, { deletedAt: null });
  if (parentId && (String(parentId) === String(page._id) || subtree.includes(String(parentId)))) {
    throw new ApiError(400, 'A page cannot be moved under itself');
  }
  const siblings = await DocPage.find({ spaceId: targetSpaceId, parentId, deletedAt: null, _id: { $ne: page._id } })
    .sort({ position: 1, title: 1 })
    .select('_id');
  const index = Math.max(0, Math.min(siblings.length, Number.isFinite(input.index) ? Number(input.index) : siblings.length));
  const order = [...siblings.map((s) => String(s._id))];
  order.splice(index, 0, String(page._id));
  await DocPage.bulkWrite(
    order.map((pid, position) => ({
      updateOne: {
        filter: { _id: pid },
        update: pid === String(page._id) ? { $set: { position, parentId, spaceId: targetSpaceId } } : { $set: { position } },
      },
    }))
  );
  if (String(targetSpaceId) !== String(page.spaceId) && subtree.length) {
    await DocPage.updateMany({ _id: { $in: subtree } }, { spaceId: targetSpaceId });
  }
  return { moved: true };
}

export async function togglePageStar(actor: DocsActor, id: string, starred: boolean) {
  const { page } = await loadPage(actor, id);
  await DocPage.updateOne({ _id: page._id }, starred ? { $addToSet: { starredBy: actor.id } } : { $pull: { starredBy: actor.id } });
  return { starred };
}

export async function listVersions(actor: DocsActor, id: string) {
  const { page } = await loadPage(actor, id);
  const versions = await DocPageVersion.find({ pageId: page._id }).sort({ version: -1 }).select('version title authorId message createdAt').lean();
  const byId = await people(versions.map((v) => v.authorId));
  return versions.map((v) => ({
    version: v.version,
    title: v.title,
    message: v.message,
    author: byId.get(String(v.authorId)) ?? { id: String(v.authorId) },
    createdAt: v.createdAt,
  }));
}

export async function getVersion(actor: DocsActor, id: string, version: number) {
  const { page } = await loadPage(actor, id);
  const v = await DocPageVersion.findOne({ pageId: page._id, version }).lean();
  if (!v) throw new ApiError(404, 'Version not found');
  const byId = await people([v.authorId]);
  return {
    version: v.version,
    title: v.title,
    content: v.content,
    message: v.message,
    author: byId.get(String(v.authorId)) ?? { id: String(v.authorId) },
    createdAt: v.createdAt,
  };
}

export async function restoreVersion(actor: DocsActor, id: string, version: number) {
  const v = await getVersion(actor, id, version);
  const { page } = await loadPage(actor, id);
  return updatePage(actor, id, { title: v.title, content: v.content, baseVersion: page.version, message: `Restored version ${version}` });
}

/** Pages and spaces the user can see, matched on title, labels and text. */
export async function search(actor: DocsActor, query: { q?: string; spaceKey?: string; label?: string; limit?: number }) {
  const q = String(query.q ?? '').trim();
  const visible = await visibleSpaces(actor);
  const spaces = query.spaceKey ? visible.filter((v) => v.space.key === String(query.spaceKey).toUpperCase()) : visible;
  if (!spaces.length) return { pages: [], spaces: [] };
  const filter: Record<string, unknown> = {
    spaceId: { $in: spaces.map((s) => s.space._id) },
    deletedAt: null,
    ...draftFilter(actor),
  };
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$and = [{ $or: [{ title: re }, { labels: q.toLowerCase() }, { text: re }] }];
  }
  if (query.label) filter.labels = String(query.label).toLowerCase();
  const pages = await DocPage.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(Number(query.limit) || 30, 100))
    .select('title emoji spaceId labels text updatedAt updatedBy status')
    .lean();
  const spaceById = new Map(spaces.map((s) => [String(s.space._id), s.space]));
  const byId = await people(pages.map((p) => p.updatedBy));
  const ql = q.toLowerCase();
  // Title matches first, then the most recently edited.
  pages.sort((a, b) => Number(b.title.toLowerCase().includes(ql)) - Number(a.title.toLowerCase().includes(ql)));
  return {
    pages: pages.map((p) => {
      const s = spaceById.get(String(p.spaceId));
      return {
        id: String(p._id),
        title: p.title,
        emoji: p.emoji,
        status: p.status,
        labels: p.labels,
        excerpt: excerpt(p.text, q),
        space: s ? { id: String(s._id), key: s.key, name: s.name, icon: s.icon } : null,
        updatedAt: p.updatedAt,
        updatedBy: byId.get(String(p.updatedBy)) ?? null,
      };
    }),
    spaces: q
      ? spaces
          .filter((s) => s.space.name.toLowerCase().includes(ql) || s.space.key.toLowerCase().includes(ql))
          .slice(0, 8)
          .map((s) => ({ id: String(s.space._id), key: s.space.key, name: s.space.name, icon: s.space.icon }))
      : [],
  };
}

type PageCard = Awaited<ReturnType<typeof pageCards>>[number];

async function pageCards(actor: DocsActor, pages: Array<Pick<IDocPage, 'title' | 'emoji' | 'spaceId' | 'updatedAt' | 'updatedBy' | 'status' | 'text'> & { _id: unknown }>) {
  const spaceIds = [...new Set(pages.map((p) => String(p.spaceId)))];
  const [spaces, byId] = await Promise.all([
    DocSpace.find({ _id: { $in: spaceIds } }).select('key name icon color').lean(),
    people(pages.map((p) => p.updatedBy)),
  ]);
  const spaceById = new Map(spaces.map((s) => [String(s._id), s]));
  return pages.map((p) => {
    const s = spaceById.get(String(p.spaceId));
    return {
      id: String(p._id),
      title: p.title,
      emoji: p.emoji,
      status: p.status,
      excerpt: excerpt(p.text ?? ''),
      space: s ? { id: String(s._id), key: s.key, name: s.name, icon: s.icon, color: s.color } : null,
      updatedAt: p.updatedAt,
      updatedBy: byId.get(String(p.updatedBy)) ?? null,
    };
  });
}

const CARD_FIELDS = 'title emoji spaceId updatedAt updatedBy status text';

/** Docs home: recent, starred and draft pages across the spaces the user can open. */
export async function overview(actor: DocsActor) {
  const visible = await visibleSpaces(actor);
  const spaceIds = visible.map((v) => v.space._id);
  const base = { spaceId: { $in: spaceIds }, deletedAt: null };
  const [recent, starred, drafts, mine] = await Promise.all([
    DocPage.find({ ...base, status: 'published' }).sort({ updatedAt: -1 }).limit(12).select(CARD_FIELDS).lean(),
    DocPage.find({ ...base, starredBy: oid(actor.id), ...draftFilter(actor) }).sort({ updatedAt: -1 }).limit(12).select(CARD_FIELDS).lean(),
    DocPage.find({ ...base, status: 'draft', createdBy: oid(actor.id) }).sort({ updatedAt: -1 }).limit(12).select(CARD_FIELDS).lean(),
    DocPage.find({ ...base, status: 'published', updatedBy: oid(actor.id) }).sort({ updatedAt: -1 }).limit(8).select(CARD_FIELDS).lean(),
  ]);
  const [recentCards, starredCards, draftCards, mineCards] = await Promise.all([
    pageCards(actor, recent),
    pageCards(actor, starred),
    pageCards(actor, drafts),
    pageCards(actor, mine),
  ]);
  return { recent: recentCards, starred: starredCards, drafts: draftCards, editedByMe: mineCards };
}

/** Pages linked to an issue (by hand or by key) or to a project, plus spaces bound to the project. */
export async function links(actor: DocsActor, query: { issueId?: string; projectId?: string }) {
  const visible = await visibleSpaces(actor);
  const spaceIds = visible.map((v) => v.space._id);
  const base = { spaceId: { $in: spaceIds }, deletedAt: null, ...draftFilter(actor) };
  if (query.issueId) {
    if (!mongoose.Types.ObjectId.isValid(query.issueId)) throw new ApiError(400, 'Invalid issueId');
    const issueOid = oid(query.issueId);
    const pages = await DocPage.find({ ...base, $and: [{ $or: [{ issueIds: issueOid }, { mentionedIssueIds: issueOid }] }] })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select(`${CARD_FIELDS} issueIds`)
      .lean();
    const cards = await pageCards(actor, pages);
    return {
      pages: cards.map((c: PageCard, i) => ({ ...c, linkType: pages[i].issueIds.some((x) => String(x) === query.issueId) ? 'linked' : 'mentioned' })),
      spaces: [],
    };
  }
  if (query.projectId) {
    if (!mongoose.Types.ObjectId.isValid(query.projectId)) throw new ApiError(400, 'Invalid projectId');
    const projectOid = oid(query.projectId);
    const pages = await DocPage.find({ ...base, projectIds: projectOid }).sort({ updatedAt: -1 }).limit(50).select(CARD_FIELDS).lean();
    const spaces = visible.filter((v) => v.space.projectIds.some((p) => String(p) === query.projectId));
    return {
      pages: (await pageCards(actor, pages)).map((c) => ({ ...c, linkType: 'linked' as const })),
      spaces: spaces.map((v) => ({
        id: String(v.space._id),
        key: v.space.key,
        name: v.space.name,
        icon: v.space.icon,
        color: v.space.color,
        description: v.space.description,
        homePageId: v.space.homePageId ? String(v.space.homePageId) : null,
        myRole: v.role,
      })),
    };
  }
  throw new ApiError(400, 'issueId or projectId is required');
}

/** Issues the user can link: those in their projects (or any workspace project for docs admins). */
export async function lookupIssues(actor: DocsActor, query: { q?: string; projectId?: string }) {
  const projects = actor.isDocsAdmin ? (await actor.workspaceProjectIds()).map(String) : [...(await actor.projectIds())];
  const scope = query.projectId ? projects.filter((p) => p === query.projectId) : projects;
  if (!scope.length) return [];
  const q = String(query.q ?? '').trim();
  const filter: Record<string, unknown> = { project: { $in: scope.map(oid) } };
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ key: re }, { title: re }];
  }
  const issues = await Issue.find(filter).sort({ updatedAt: -1 }).limit(20).select('key title status type project').lean();
  return issues.map((i) => ({ id: String(i._id), key: i.key, title: i.title, status: i.status, type: i.type, projectId: String(i.project) }));
}

/** People and projects for the space and page pickers. */
export async function options(actor: DocsActor) {
  const memberIds = await OrganizationMember.find({ organization: actor.orgOid, status: 'active' }).distinct('user');
  const projectFilter = actor.isDocsAdmin
    ? { taskflowOrganizationId: actor.orgOid }
    : { _id: { $in: [...(await actor.projectIds())].map(oid) } };
  const [users, projects] = await Promise.all([
    User.find({ _id: { $in: memberIds } }).select('name email').sort({ name: 1 }).lean(),
    Project.find(projectFilter).select('name key').sort({ name: 1 }).lean(),
  ]);
  return {
    people: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
  };
}

// ── Comments ────────────────────────────────────────────────────────────────

export async function listComments(actor: DocsActor, pageId: string) {
  const { page } = await loadPage(actor, pageId);
  const comments = await DocComment.find({ pageId: page._id }).sort({ createdAt: 1 }).lean();
  const byId = await people(comments.map((c) => c.authorId));
  return comments.map((c) => ({
    id: String(c._id),
    parentId: c.parentId ? String(c.parentId) : null,
    body: c.body,
    resolved: c.resolved,
    author: byId.get(String(c.authorId)) ?? { id: String(c.authorId) },
    mine: String(c.authorId) === actor.id,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

export async function addComment(actor: DocsActor, pageId: string, input: { body?: string; parentId?: string | null }) {
  const { page } = await loadPage(actor, pageId);
  const body = String(input.body ?? '').trim();
  if (!htmlToText(body) && !/<img\b/i.test(body)) throw new ApiError(400, 'Comment cannot be empty');
  if (body.length > 100_000) throw new ApiError(413, 'Comment is too long');
  let parentId: mongoose.Types.ObjectId | null = null;
  if (input.parentId) {
    const parent = await DocComment.findOne({ _id: input.parentId, pageId: page._id }).select('_id parentId');
    if (!parent) throw new ApiError(400, 'Reply target not found');
    parentId = (parent.parentId ?? parent._id) as mongoose.Types.ObjectId;
  }
  await DocComment.create({ pageId: page._id, parentId, authorId: actor.id, body });
  return listComments(actor, pageId);
}

export async function updateComment(actor: DocsActor, pageId: string, commentId: string, input: { body?: string; resolved?: boolean }) {
  const { page, role } = await loadPage(actor, pageId);
  if (!mongoose.Types.ObjectId.isValid(commentId)) throw new ApiError(404, 'Comment not found');
  const comment = await DocComment.findOne({ _id: commentId, pageId: page._id });
  if (!comment) throw new ApiError(404, 'Comment not found');
  const mine = String(comment.authorId) === actor.id;
  if (input.body !== undefined) {
    if (!mine) throw new ApiError(403, 'You can only edit your own comments');
    const body = String(input.body).trim();
    if (!htmlToText(body) && !/<img\b/i.test(body)) throw new ApiError(400, 'Comment cannot be empty');
    comment.body = body;
  }
  if (input.resolved !== undefined) {
    if (!mine && !canEditRole(role)) throw new ApiError(403, 'You cannot resolve this comment');
    comment.resolved = Boolean(input.resolved);
  }
  await comment.save();
  return listComments(actor, pageId);
}

export async function deleteComment(actor: DocsActor, pageId: string, commentId: string) {
  const { page, role } = await loadPage(actor, pageId);
  if (!mongoose.Types.ObjectId.isValid(commentId)) throw new ApiError(404, 'Comment not found');
  const comment = await DocComment.findOne({ _id: commentId, pageId: page._id });
  if (!comment) throw new ApiError(404, 'Comment not found');
  if (String(comment.authorId) !== actor.id && role !== 'admin') throw new ApiError(403, 'You can only delete your own comments');
  await DocComment.deleteMany({ $or: [{ _id: comment._id }, { parentId: comment._id }] });
  return listComments(actor, pageId);
}
