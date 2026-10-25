/**
 * Published Docs pages visible to a WhatsApp client chat.
 * Scoped to the chat's projects (and issues in those projects) — never other clients.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';
import { DocPage } from '../docs/models/docPage.model';
import { DocSpace } from '../docs/models/docSpace.model';
import { Issue } from '../issues/issue.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { escapeRegex } from '../../utils/safeUrl';
import type { ClientScope } from './paScope';

export type PaDocHit = {
  id: string;
  title: string;
  emoji?: string;
  excerpt: string;
  spaceKey?: string;
  spaceName?: string;
  url?: string;
  linkType?: 'project' | 'issue' | 'space' | 'search';
  /** Page text (capped) — only when the caller asks for bodies. */
  body?: string;
};

const BODY_MAX = 3000;
const STOPWORDS = new Set(
  'the and for are but not you your our can how what when where which who why with this that from have has had was were will would should could does did doing please pls tell about into there their them they then than just also any all some get got want need help know make like using use'.split(
    ' '
  )
);

/** Significant words of a chat question, so "how do I reset my password?" finds "Reset password". */
export function searchTerms(q: string): string[] {
  const words = String(q || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 8);
}

function frontendBase(): string {
  return (env.frontendUrl || env.appUrl || '').replace(/\/$/, '');
}

function pageUrl(spaceKey: string | undefined, pageId: string): string | undefined {
  const base = frontendBase();
  if (!base || !spaceKey) return undefined;
  return `${base}/docs/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
}

function excerptOf(text: string, terms: string[]): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (at < 0) return clean.slice(0, 280);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + 280)}`;
}

async function issueIdsInProjects(projectIds: string[]): Promise<mongoose.Types.ObjectId[]> {
  if (!projectIds.length) return [];
  const ids = await Issue.find({ project: { $in: projectIds } }).distinct('_id');
  return ids as mongoose.Types.ObjectId[];
}

async function spaceIdsForProjects(
  organizationId: string,
  projectIds: string[]
): Promise<mongoose.Types.ObjectId[]> {
  if (!projectIds.length) return [];
  const spaces = await DocSpace.find({
    taskflowOrganizationId: organizationId,
    archived: { $ne: true },
    projectIds: { $in: projectIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id')
    .lean();
  return spaces.map((s) => s._id as mongoose.Types.ObjectId);
}

/** Resolve ticket → linked issue / project, constrained to this chat's scope. */
async function resolveTicketScope(
  organizationId: string,
  scope: ClientScope,
  ticketId: string
): Promise<{ issueId?: string; projectId?: string }> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) throw new ApiError(400, 'Invalid ticketId');
  const ticket = await ServiceTicket.findOne({
    _id: ticketId,
    taskflowOrganizationId: organizationId,
  })
    .select('projectId linkedIssueId customerOrgId whatsappGroupId')
    .lean();
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  const inCustomer =
    scope.customerOrgId && ticket.customerOrgId && String(ticket.customerOrgId) === scope.customerOrgId;
  const inChat = ticket.whatsappGroupId && ticket.whatsappGroupId === scope.chatId;
  const projectId = ticket.projectId ? String(ticket.projectId) : undefined;
  const inProject = projectId && scope.projectIds.includes(projectId);
  if (!inCustomer && !inChat && !inProject) {
    throw new ApiError(404, 'Ticket not found');
  }
  return {
    issueId: ticket.linkedIssueId ? String(ticket.linkedIssueId) : undefined,
    projectId: inProject ? projectId : projectId && scope.projectIds.includes(projectId) ? projectId : undefined,
  };
}

export async function searchClientDocs(
  organizationId: string,
  scope: ClientScope,
  query: {
    q?: string;
    projectId?: string;
    issueId?: string;
    issueKey?: string;
    ticketId?: string;
    limit?: number;
    withBody?: boolean;
  }
): Promise<{ pages: PaDocHit[] }> {
  if (!scope.projectIds.length && !scope.customerOrgId) {
    throw new ApiError(403, 'This chat is not linked to a client in Atrium');
  }

  let projectIds = [...scope.projectIds];
  let issueOid: mongoose.Types.ObjectId | undefined;
  let linkType: PaDocHit['linkType'] = 'search';

  if (query.ticketId) {
    const resolved = await resolveTicketScope(organizationId, scope, query.ticketId);
    if (resolved.projectId) {
      projectIds = [resolved.projectId];
      linkType = 'project';
    }
    if (resolved.issueId && mongoose.Types.ObjectId.isValid(resolved.issueId)) {
      issueOid = new mongoose.Types.ObjectId(resolved.issueId);
      linkType = 'issue';
    }
  }

  if (query.projectId) {
    if (!scope.projectIds.includes(query.projectId)) {
      throw new ApiError(403, 'Project is not available to this chat');
    }
    projectIds = [query.projectId];
    linkType = 'project';
  }

  if (query.issueId || query.issueKey) {
    const issue = query.issueId
      ? await Issue.findOne({
          _id: query.issueId,
          project: { $in: scope.projectIds },
        })
          .select('_id project')
          .lean()
      : await Issue.findOne({
          key: String(query.issueKey).trim().toUpperCase(),
          project: { $in: scope.projectIds },
        })
          .select('_id project')
          .lean();
    if (!issue) throw new ApiError(404, 'Issue not found');
    issueOid = issue._id as mongoose.Types.ObjectId;
    projectIds = [String(issue.project)];
    linkType = 'issue';
  }

  const [projectIssueIds, projectSpaceIds] = await Promise.all([
    issueOid ? Promise.resolve([issueOid]) : issueIdsInProjects(projectIds),
    spaceIdsForProjects(organizationId, projectIds),
  ]);

  const orgOid = new mongoose.Types.ObjectId(organizationId);
  const projectOids = projectIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const orClauses: Record<string, unknown>[] = [];
  if (issueOid) {
    orClauses.push({ issueIds: issueOid }, { mentionedIssueIds: issueOid });
  } else if (projectIssueIds.length) {
    orClauses.push(
      { issueIds: { $in: projectIssueIds } },
      { mentionedIssueIds: { $in: projectIssueIds } }
    );
  }
  if (projectOids.length) {
    orClauses.push({ projectIds: { $in: projectOids } });
  }
  // Pages in a project-bound space, but never ones explicitly linked only to other projects.
  if (projectSpaceIds.length && projectOids.length) {
    orClauses.push({
      spaceId: { $in: projectSpaceIds },
      projectIds: { $not: { $elemMatch: { $nin: projectOids } } },
    });
  }

  if (!orClauses.length) {
    return { pages: [] };
  }

  const filter: Record<string, unknown> = {
    taskflowOrganizationId: orgOid,
    status: 'published',
    deletedAt: null,
    $or: orClauses,
  };

  const terms = searchTerms(String(query.q || ''));
  if (terms.length) {
    filter.$and = [
      {
        $or: terms.flatMap((t) => {
          const re = new RegExp(escapeRegex(t), 'i');
          return [{ title: re }, { text: re }, { labels: t }];
        }),
      },
    ];
  }

  const limit = Math.min(Math.max(Number(query.limit) || 5, 1), 15);
  const candidates = await DocPage.find(filter)
    .sort({ updatedAt: -1 })
    .limit(terms.length ? 50 : limit)
    .select('title emoji text labels spaceId')
    .lean();
  // Rank by how many question words each page covers; title matches count most.
  const score = (p: (typeof candidates)[number]) =>
    terms.reduce((sum, t) => {
      const title = String(p.title || '').toLowerCase();
      const text = String(p.text || '').toLowerCase();
      return sum + (title.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0) + ((p.labels || []).includes(t) ? 2 : 0);
    }, 0);
  const pages = terms.length
    ? candidates
        .map((p, i) => ({ p, s: score(p), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, limit)
        .map((x) => x.p)
    : candidates;

  const spaceIds = [...new Set(pages.map((p) => String(p.spaceId)))];
  const spaces = await DocSpace.find({ _id: { $in: spaceIds } }).select('key name').lean();
  const spaceById = new Map(spaces.map((s) => [String(s._id), s]));

  return {
    pages: pages.map((p) => {
      const space = spaceById.get(String(p.spaceId));
      const id = String(p._id);
      return {
        id,
        title: p.title,
        emoji: p.emoji || undefined,
        excerpt: excerptOf(p.text || '', terms),
        ...(query.withBody ? { body: String(p.text || '').slice(0, BODY_MAX) } : {}),
        spaceKey: space?.key,
        spaceName: space?.name,
        url: pageUrl(space?.key, id),
        linkType,
      };
    }),
  };
}

export async function getClientDoc(
  organizationId: string,
  scope: ClientScope,
  pageId: string
): Promise<PaDocHit & { body: string }> {
  if (!mongoose.Types.ObjectId.isValid(pageId)) throw new ApiError(400, 'Invalid page id');
  if (!scope.projectIds.length && !scope.customerOrgId) {
    throw new ApiError(403, 'This chat is not linked to a client in Atrium');
  }

  const page = await DocPage.findOne({
    _id: pageId,
    taskflowOrganizationId: organizationId,
    status: 'published',
    deletedAt: null,
  })
    .select('title emoji text spaceId projectIds issueIds mentionedIssueIds')
    .lean();
  if (!page) throw new ApiError(404, 'Page not found');

  const [projectIssueIds, projectSpaceIds] = await Promise.all([
    issueIdsInProjects(scope.projectIds),
    spaceIdsForProjects(organizationId, scope.projectIds),
  ]);
  const projectSet = new Set(scope.projectIds);
  const issueSet = new Set(projectIssueIds.map(String));
  const spaceSet = new Set(projectSpaceIds.map(String));

  const projectLinks = (page.projectIds || []).map(String);
  const hasForeignProject = projectLinks.some((id) => !projectSet.has(id));
  const allowed =
    projectLinks.some((id) => projectSet.has(id)) ||
    page.issueIds.some((id) => issueSet.has(String(id))) ||
    page.mentionedIssueIds.some((id) => issueSet.has(String(id))) ||
    (spaceSet.has(String(page.spaceId)) && !hasForeignProject);

  if (!allowed) throw new ApiError(404, 'Page not found');

  const space = await DocSpace.findById(page.spaceId).select('key name').lean();
  const id = String(page._id);
  const body = String(page.text || '').slice(0, BODY_MAX);
  return {
    id,
    title: page.title,
    emoji: page.emoji || undefined,
    excerpt: body.slice(0, 280),
    body,
    spaceKey: space?.key,
    spaceName: space?.name,
    url: pageUrl(space?.key, id),
  };
}
