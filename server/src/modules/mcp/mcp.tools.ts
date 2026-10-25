import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { htmlToText } from '../docs/docPages.service';
import { AtriumApi, AtriumApiError } from './mcp.api';
import { catalogFor, isBlockedPath, matchEntry, type CatalogEntry } from './apiCatalog';

/** Who the MCP session acts as. Everything else is fetched through the API with their token. */
export interface McpContext {
  api: AtriumApi;
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  workspace: { id: string; name?: string } | null;
  readOnly: boolean;
}

type Paginated<T> = { data: T[]; total: number; page: number; limit: number; totalPages: number };
type Ref = { _id?: string; id?: string; name?: string; key?: string; email?: string; title?: string; status?: string } | string | null | undefined;
type RawIssue = {
  _id: string;
  key?: string;
  title: string;
  description?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: Ref;
  reporter?: Ref;
  project?: Ref;
  sprint?: Ref;
  parent?: Ref;
  milestone?: Ref;
  labels?: string[];
  dueDate?: string;
  startDate?: string;
  storyPoints?: number;
  timeEstimateMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISSUE_KEY = /^[A-Z][A-Z0-9]{0,9}-\d+$/i;
const MAX_TEXT = 12_000;

function refName(r: Ref) {
  if (!r || typeof r === 'string') return undefined;
  return r.name ?? r.title ?? r.key;
}

function refId(r: Ref) {
  if (!r) return undefined;
  return typeof r === 'string' ? r : (r._id ?? r.id);
}

function clip(text: string, max = MAX_TEXT) {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)` : text;
}

function issueSummary(i: RawIssue) {
  return {
    id: i._id,
    key: i.key,
    title: i.title,
    type: i.type,
    status: i.status,
    priority: i.priority,
    assignee: refName(i.assignee) ?? null,
    project: typeof i.project === 'object' && i.project ? { id: refId(i.project), key: i.project.key, name: i.project.name } : refId(i.project),
    sprint: refName(i.sprint) ?? null,
    labels: i.labels?.length ? i.labels : undefined,
    dueDate: i.dueDate ?? undefined,
    storyPoints: i.storyPoints ?? undefined,
    updatedAt: i.updatedAt,
  };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Runs a tool body and turns API refusals into a readable tool error instead of a protocol error. */
function run<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      if (err instanceof AtriumApiError) {
        const why = err.status === 403 ? 'You do not have permission for this in Atrium' : err.status === 404 ? 'Not found, or not visible to you' : 'Atrium refused the request';
        return fail(`${why} (${err.status}): ${err.message}`);
      }
      return fail(err instanceof Error ? err.message : 'Unexpected error');
    }
  };
}

/** Accepts a project id or key and returns the id, using only projects the user can see. */
async function resolveProject(api: AtriumApi, idOrKey: string) {
  if (OBJECT_ID.test(idOrKey)) return idOrKey;
  const page = await api.get<Paginated<{ _id: string; key: string; name: string }>>('/projects', { page: 1, limit: 200 });
  const hit = page.data.find((p) => p.key.toLowerCase() === idOrKey.toLowerCase() || p.name.toLowerCase() === idOrKey.toLowerCase());
  if (!hit) throw new Error(`No project "${idOrKey}" among the projects you can access. Use list_projects to see them.`);
  return hit._id;
}

/** Accepts an issue id or key (e.g. APP-12) and returns the issue id. */
async function resolveIssue(api: AtriumApi, idOrKey: string) {
  if (OBJECT_ID.test(idOrKey)) return idOrKey;
  if (!ISSUE_KEY.test(idOrKey)) throw new Error('Give an issue key like APP-12 or an issue id');
  const found = await api.get<Paginated<RawIssue>>('/issues/search-global', { q: idOrKey, page: 1, limit: 10 });
  const hit = found.data.find((i) => i.key?.toLowerCase() === idOrKey.toLowerCase());
  if (!hit) throw new Error(`Issue ${idOrKey.toUpperCase()} was not found among the issues you can access`);
  return hit._id;
}

const RECORD_TYPES = [
  'lead',
  'deal',
  'quote',
  'contract',
  'account',
  'customer',
  'project',
  'issue',
  'invoice',
  'ticket',
  'employee',
  'asset',
  'purchase_order',
] as const;
type RecordType = (typeof RECORD_TYPES)[number];
type RecordSummary = { type: RecordType; id: string; title: string; subtitle?: string; status?: string; link: string };
type GraphEdge = { linkId?: string; source: 'link' | 'field'; relation: string; direction: 'out' | 'in'; note?: string; record: RecordSummary };

const recordType = z.enum(RECORD_TYPES);
const recordRef = z
  .string()
  .describe('Record id, an issue key (APP-12), a project key, or a name / number to look up (e.g. an invoice number)');

/** Accepts an id, a project or issue key, or a name/number that matches exactly one record of that type. */
async function resolveRecord(api: AtriumApi, type: RecordType, ref: string): Promise<string> {
  if (OBJECT_ID.test(ref)) return ref;
  if (type === 'project') return resolveProject(api, ref);
  if (type === 'issue') return resolveIssue(api, ref);
  const { records } = await api.get<{ records: RecordSummary[] }>('/links/search', { type, q: ref });
  const exact = records.filter((r) => r.title.toLowerCase() === ref.toLowerCase() || r.title.toLowerCase().startsWith(`${ref.toLowerCase()} ·`));
  const pick = exact.length === 1 ? exact : records;
  if (pick.length === 1) return pick[0].id;
  if (!pick.length) throw new Error(`No ${type} matching "${ref}" that you can access. Use find_records to search.`);
  throw new Error(`"${ref}" matches several ${type} records: ${pick.slice(0, 5).map((r) => `${r.title} (${r.id})`).join('; ')}. Pass the id.`);
}

/** Some list endpoints return an array, others a page object. */
function asList<T>(v: T[] | { data?: T[] } | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  return v?.data ?? [];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
};

export function registerTools(server: McpServer, ctx: McpContext) {
  const { api } = ctx;
  // The SDK's generic registerTool signature makes the compiler infer every schema deeply (and run out of memory),
  // so tools are registered through this narrower view of the same method.
  const tool = <A>(name: string, config: ToolConfig, handler: (args: A) => Promise<CallToolResult>) =>
    (server as unknown as { registerTool: (n: string, c: ToolConfig, h: (args: A) => Promise<CallToolResult>) => void }).registerTool(name, config, handler);
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  // ── Context ────────────────────────────────────────────────────────────────

  tool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The Atrium user this connection acts as, their active workspace, and whether the token is read-only. Call this first if unsure what you can access.',
      inputSchema: {},
      annotations: read,
    },
    run(async () => ({
      user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
      workspace: ctx.workspace,
      readOnly: ctx.readOnly,
      permissionCount: ctx.user.permissions.length,
      note: 'Every tool sees only the projects, issues, docs and resources this user can see in Atrium.',
    }))
  );

  tool(
    'my_work',
    {
      title: 'My work',
      description: 'Work assigned to the current user across their projects: open issues, overdue and due-soon items.',
      inputSchema: {},
      annotations: read,
    },
    run(async () => api.get('/me/work'))
  );

  tool(
    'my_agenda',
    {
      title: 'My agenda',
      description: "The current user's calendar events for the next few days.",
      inputSchema: { days: z.number().int().min(1).max(31).optional().describe('How many days ahead (default 7)') },
      annotations: read,
    },
    run(async ({ days }: { days?: number }) => api.get('/me/agenda', { days }))
  );

  // ── Projects ───────────────────────────────────────────────────────────────

  tool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects the current user is a member of in the active workspace.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: read,
    },
    run(async ({ limit }: { limit?: number }) => {
      const page = await api.get<Paginated<{ _id: string; key: string; name: string; description?: string; status?: string; lead?: Ref }>>('/projects', { page: 1, limit: limit ?? 100 });
      return {
        total: page.total,
        projects: page.data.map((p) => ({ id: p._id, key: p.key, name: p.name, status: p.status, lead: refName(p.lead), description: p.description ? clip(p.description, 300) : undefined })),
      };
    })
  );

  tool(
    'get_project',
    {
      title: 'Get project',
      description: 'Details of one project, including its statuses, issue types and priorities.',
      inputSchema: { project: z.string().describe('Project id or key, e.g. APP') },
      annotations: read,
    },
    run(async ({ project }: { project: string }) => api.get(`/projects/${await resolveProject(api, project)}`))
  );

  tool(
    'list_project_members',
    {
      title: 'List project members',
      description: 'People on a project (useful to find an assignee id).',
      inputSchema: { project: z.string().describe('Project id or key') },
      annotations: read,
    },
    run(async ({ project }: { project: string }) => {
      const members = await api.get<Array<{ user?: Ref; designation?: Ref }>>(`/projects/${await resolveProject(api, project)}/members`);
      return members.map((m) => ({ userId: refId(m.user), name: refName(m.user), email: typeof m.user === 'object' ? m.user?.email : undefined, designation: refName(m.designation) }));
    })
  );

  tool(
    'list_sprints',
    {
      title: 'List sprints',
      description: "A project's sprints (planned, active and completed).",
      inputSchema: { project: z.string().describe('Project id or key') },
      annotations: read,
    },
    run(async ({ project }: { project: string }) => api.get('/sprints', { project: await resolveProject(api, project) }))
  );

  tool(
    'project_overview',
    {
      title: 'Project / portfolio overview',
      description: 'Delivery insights: health, completion, overdue work, workload. Omit project for all of your projects.',
      inputSchema: { project: z.string().optional().describe('Project id or key; omit for every project you are on') },
      annotations: read,
    },
    run(async ({ project }: { project?: string }) => api.get('/dashboard/overview', { projectId: project ? await resolveProject(api, project) : undefined }))
  );

  // ── Issues ─────────────────────────────────────────────────────────────────

  tool(
    'search_issues',
    {
      title: 'Search issues',
      description:
        'Find issues the user can see. Use `text` for a free-text search across all their projects, or the filters for structured queries. `assignee: "me"` means the current user.',
      inputSchema: {
        text: z.string().optional().describe('Free text or an issue key; searches all accessible projects'),
        project: z.string().optional().describe('Project id or key'),
        status: z.array(z.string()).optional().describe('Status names, e.g. ["In Progress"]'),
        excludeStatus: z.array(z.string()).optional(),
        assignee: z.string().optional().describe('"me", or a user id'),
        unassigned: z.boolean().optional(),
        type: z.array(z.string()).optional(),
        priority: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
        sprint: z.string().optional().describe('Sprint id'),
        due: z.enum(['overdue', 'today', 'this_week']).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: read,
    },
    run(
      async (a: {
        text?: string;
        project?: string;
        status?: string[];
        excludeStatus?: string[];
        assignee?: string;
        unassigned?: boolean;
        type?: string[];
        priority?: string[];
        labels?: string[];
        sprint?: string;
        due?: 'overdue' | 'today' | 'this_week';
        page?: number;
        limit?: number;
      }) => {
        const limit = a.limit ?? 25;
        const page = a.page ?? 1;
        if (a.text) {
          const res = await api.get<Paginated<RawIssue>>('/issues/search-global', { q: a.text, page, limit });
          return { total: res.total, page: res.page, issues: res.data.map(issueSummary) };
        }
        const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (a.project) qs.set('project', await resolveProject(api, a.project));
        const many = (k: string, v?: string[]) => v?.forEach((x) => qs.append(k, x));
        many('status', a.status);
        many('statusExclude', a.excludeStatus);
        many('type', a.type);
        many('priority', a.priority);
        many('labels', a.labels);
        if (a.assignee) qs.set('assignee', a.assignee === 'me' ? ctx.user.id : a.assignee);
        if (a.unassigned) qs.set('unassigned', 'true');
        if (a.sprint) qs.set('sprint', a.sprint);
        if (a.due) qs.set('dueDate', a.due);
        const res = await api.request<Paginated<RawIssue>>('GET', `/issues?${qs}`);
        return { total: res.total, page: res.page, totalPages: res.totalPages, issues: res.data.map(issueSummary) };
      }
    )
  );

  tool(
    'jql_search',
    {
      title: 'JQL search',
      description: 'Search issues with a JQL-style query, e.g. `project = APP AND status != Done ORDER BY updated DESC`.',
      inputSchema: { jql: z.string(), page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: read,
    },
    run(async ({ jql, page, limit }: { jql: string; page?: number; limit?: number }) => {
      const res = await api.get<Paginated<RawIssue>>('/issues/jql', { jql, page: page ?? 1, limit: limit ?? 25 });
      return { total: res.total, page: res.page, issues: res.data.map(issueSummary) };
    })
  );

  tool(
    'get_issue',
    {
      title: 'Get issue',
      description: 'Full details of an issue: description, people, dates, estimates, subtasks, links and recent comments.',
      inputSchema: {
        issue: z.string().describe('Issue key (APP-12) or id'),
        includeComments: z.boolean().optional().describe('Include the latest comments (default true)'),
      },
      annotations: read,
    },
    run(async ({ issue, includeComments }: { issue: string; includeComments?: boolean }) => {
      const id = await resolveIssue(api, issue);
      type Link = { linkType?: string; type?: string; direction?: string; issue?: RawIssue; target?: RawIssue; source?: RawIssue };
      type Comment = { body: string; author?: Ref; createdAt?: string };
      const [i, subtaskRes, linkRes, commentRes] = await Promise.all([
        api.get<RawIssue>(`/issues/${id}`),
        api.get<RawIssue[] | { data?: RawIssue[] }>(`/issues/${id}/subtasks`).catch(() => []),
        api.get<Link[] | { data?: Link[] }>(`/issues/${id}/links`).catch(() => []),
        includeComments === false ? Promise.resolve([]) : api.get<Comment[] | { data?: Comment[] }>(`/issues/${id}/comments`, { limit: 100 }).catch(() => []),
      ]);
      const subtasks = asList(subtaskRes);
      const links = asList(linkRes);
      const comments = asList(commentRes);
      return {
        ...issueSummary(i),
        description: i.description ? clip(htmlToText(i.description)) : '',
        reporter: refName(i.reporter),
        parent: typeof i.parent === 'object' && i.parent ? { id: refId(i.parent), key: i.parent.key, title: i.parent.title } : undefined,
        milestone: refName(i.milestone),
        startDate: i.startDate,
        timeEstimateMinutes: i.timeEstimateMinutes,
        createdAt: i.createdAt,
        subtasks: subtasks.map((s) => ({ key: s.key, title: s.title, status: s.status, assignee: refName(s.assignee) })),
        links: links.map((l) => {
          const other = l.issue ?? l.target ?? l.source;
          return { type: l.linkType ?? l.type, direction: l.direction, key: other?.key, title: other?.title, status: other?.status };
        }),
        // The API lists newest first; keep the latest 15 and show them in order.
        comments: comments.slice(0, 15).reverse().map((c) => ({ author: refName(c.author), at: c.createdAt, text: clip(htmlToText(c.body), 2000) })),
      };
    })
  );

  tool(
    'list_work_logs',
    {
      title: 'List work logs',
      description: 'Time logged on an issue.',
      inputSchema: { issue: z.string().describe('Issue key or id') },
      annotations: read,
    },
    run(async ({ issue }: { issue: string }) => api.get(`/issues/${await resolveIssue(api, issue)}/work-logs`))
  );

  // ── Docs ───────────────────────────────────────────────────────────────────

  tool(
    'docs_list_spaces',
    {
      title: 'List doc spaces',
      description: 'Knowledge spaces the user can open, with their role in each.',
      inputSchema: { project: z.string().optional().describe('Only spaces linked to this project (id or key)') },
      annotations: read,
    },
    run(async ({ project }: { project?: string }) => {
      const spaces = await api.get<Array<{ id: string; key: string; name: string; description?: string; myRole: string; pageCount: number; homePageId: string | null; projects: Array<{ key: string }> }>>(
        '/docs/spaces',
        { projectId: project ? await resolveProject(api, project) : undefined }
      );
      return spaces.map((s) => ({ id: s.id, key: s.key, name: s.name, description: s.description, myRole: s.myRole, pages: s.pageCount, homePageId: s.homePageId, projects: s.projects.map((p) => p.key) }));
    })
  );

  tool(
    'docs_search',
    {
      title: 'Search docs',
      description: 'Search pages by title, text, label or issue key across the spaces the user can open.',
      inputSchema: {
        query: z.string().optional(),
        space: z.string().optional().describe('Space key'),
        label: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: read,
    },
    run(async ({ query, space, label, limit }: { query?: string; space?: string; label?: string; limit?: number }) => {
      const res = await api.get<{ pages: Array<{ id: string; title: string; excerpt: string; status: string; space: { key: string } | null; updatedAt: string; labels?: string[] }> }>('/docs/search', {
        q: query,
        spaceKey: space,
        label,
        limit: limit ?? 20,
      });
      return res.pages.map((p) => ({ id: p.id, title: p.title, space: p.space?.key, status: p.status, labels: p.labels, excerpt: p.excerpt, updatedAt: p.updatedAt }));
    })
  );

  tool(
    'docs_get_page',
    {
      title: 'Read a doc page',
      description: 'Read a page as plain text, with its linked issues, projects and child pages.',
      inputSchema: { pageId: z.string() },
      annotations: read,
    },
    run(async ({ pageId }: { pageId: string }) => {
      const p = await api.get<{
        id: string;
        title: string;
        content: string;
        status: string;
        version: number;
        labels: string[];
        canEdit: boolean;
        space: { key: string; name: string } | null;
        breadcrumbs: Array<{ title: string }>;
        issues: Array<{ key?: string; title?: string; status?: string }>;
        mentionedIssues: Array<{ key?: string }>;
        projects: Array<{ key: string }>;
        children: Array<{ id: string; title: string }>;
        updatedBy: { name?: string };
        updatedAt: string;
      }>(`/docs/pages/${encodeURIComponent(pageId)}`);
      return {
        id: p.id,
        title: p.title,
        space: p.space?.key,
        path: p.breadcrumbs.map((b) => b.title),
        status: p.status,
        version: p.version,
        labels: p.labels,
        canEdit: p.canEdit,
        updatedBy: p.updatedBy.name,
        updatedAt: p.updatedAt,
        linkedIssues: p.issues.map((i) => ({ key: i.key, title: i.title, status: i.status })),
        mentionedIssues: p.mentionedIssues.map((i) => i.key),
        projects: p.projects.map((x) => x.key),
        childPages: p.children,
        text: clip(htmlToText(p.content), 40_000),
      };
    })
  );

  tool(
    'docs_for_issue',
    {
      title: 'Docs for an issue',
      description: 'Pages linked to an issue or mentioning its key (specs, notes, designs).',
      inputSchema: { issue: z.string().describe('Issue key or id') },
      annotations: read,
    },
    run(async ({ issue }: { issue: string }) => {
      const res = await api.get<{ pages: Array<{ id: string; title: string; linkType?: string; space: { key: string } | null; excerpt: string }> }>('/docs/links', { issueId: await resolveIssue(api, issue) });
      return res.pages.map((p) => ({ id: p.id, title: p.title, space: p.space?.key, linkType: p.linkType, excerpt: p.excerpt }));
    })
  );

  // ── Resources ──────────────────────────────────────────────────────────────

  tool(
    'my_allocations',
    {
      title: 'My resource allocations',
      description: "The current user's project allocations (needs resource-allocation read access in Atrium).",
      inputSchema: { status: z.enum(['current', 'upcoming', 'past', 'all']).optional() },
      annotations: read,
    },
    run(async ({ status }: { status?: string }) => api.get('/resources/allocations', { userId: ctx.user.id, status: status ?? 'current' }))
  );

  // ── Record graph ────────────────────────────────────────────────────────────

  tool(
    'find_records',
    {
      title: 'Find records',
      description: `Search one record type (${RECORD_TYPES.join(', ')}) by name, number or key. Returns ids for linked_records and link_records.`,
      inputSchema: { type: recordType, query: z.string().optional().describe('Text to match; omit for the most recent') },
      annotations: read,
    },
    run(async ({ type, query }: { type: RecordType; query?: string }) => api.get('/links/search', { type, q: query ?? '' }))
  );

  tool(
    'linked_records',
    {
      title: 'Linked records',
      description:
        'Everything connected to one record across modules: the deal, quote, contract, project, issues, tickets, invoices, POs, assets and people it links to, ' +
        'whether set on the record itself (source "field") or added as an explicit link (source "link"). Records you cannot access are only counted.',
      inputSchema: { type: recordType, record: recordRef },
      annotations: read,
    },
    run(async ({ type, record }: { type: RecordType; record: string }) => {
      const id = await resolveRecord(api, type, record);
      const graph = await api.get<{ record: RecordSummary; edges: GraphEdge[]; hidden: number }>(`/links/${type}/${id}`);
      return {
        record: graph.record,
        linked: graph.edges.map((e) => ({
          type: e.record.type,
          id: e.record.id,
          title: e.record.title,
          status: e.record.status,
          detail: e.record.subtitle,
          relation: e.relation,
          direction: e.direction,
          source: e.source,
          linkId: e.linkId,
          note: e.note,
        })),
        hiddenFromYou: graph.hidden,
      };
    })
  );

  tool(
    'customer_360',
    {
      title: 'Customer 360',
      description:
        'Everything about one portal customer: health flags (SLA breaches, overdue invoices, outages, overdue issues, renewals), deals, contracts and SLA, ' +
        'projects and open issues, open tickets with SLA state, invoices, payments and monitoring. Sections the user may not see are null.',
      inputSchema: { customer: z.string().describe('Customer id or name') },
      annotations: read,
    },
    run(async ({ customer }: { customer: string }) => api.get(`/customer-360/${await resolveRecord(api, 'customer', customer)}`))
  );

  tool(
    'employee_360',
    {
      title: 'Employee 360',
      description:
        'One person: assigned work, allocations and capacity, timesheet (last 4 weeks), leave, attendance, payslips and skills, with flags ' +
        '(over-allocated, overdue work, unsubmitted timesheet, leave clashing with due work). Use "me" for the current user. Sections the user may not see are null.',
      inputSchema: { person: z.string().describe('"me", an employee id, or a name / employee code') },
      annotations: read,
    },
    run(async ({ person }: { person: string }) =>
      api.get(`/employee-360/${person.trim().toLowerCase() === 'me' ? 'me' : await resolveRecord(api, 'employee', person)}`)
    )
  );

  // ── Whole API (every module), limited to what this user may call ────────────

  const catalog = () => catalogFor(ctx.user);
  const describe = (e: CatalogEntry) => ({
    method: e.method,
    path: e.path,
    module: e.module,
    needs: e.permissions.map((t) => (t.all?.length ? t.all.join(' + ') : `one of: ${(t.any ?? []).join(', ')}`)).join(' and ') || undefined,
  });

  tool(
    'api_areas',
    {
      title: 'Atrium API areas',
      description:
        'Every Atrium area this user can use (CRM, HR, billing, accounts, service desk, assets, procurement, contracts, calendar, monitor, resources, projects, docs…) with how many endpoints each has. Start here for anything the dedicated tools do not cover.',
      inputSchema: {},
      annotations: read,
    },
    run(async () => {
      const entries = await catalog();
      const areas = new Map<string, { area: string; module?: string; endpoints: number; reads: number; writes: number }>();
      for (const e of entries) {
        const a = areas.get(e.area) ?? { area: e.area, module: e.module, endpoints: 0, reads: 0, writes: 0 };
        a.endpoints++;
        if (e.method === 'GET') a.reads++;
        else a.writes++;
        areas.set(e.area, a);
      }
      return { readOnlyToken: ctx.readOnly, areas: [...areas.values()].sort((x, y) => x.area.localeCompare(y.area)) };
    })
  );

  tool(
    'api_endpoints',
    {
      title: 'Find Atrium API endpoints',
      description: 'List endpoints this user can call, by area (e.g. "crm", "hrms", "billing") and/or a word in the path (e.g. "invoice"). Use with api_request.',
      inputSchema: {
        area: z.string().optional().describe('First path segment, from api_areas'),
        search: z.string().optional().describe('Text that must appear in the path'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      },
      annotations: read,
    },
    run(async ({ area, search, method }: { area?: string; search?: string; method?: string }) => {
      const q = search?.toLowerCase();
      const list = (await catalog()).filter(
        (e) => (!area || e.area === area.replace(/^\//, '')) && (!q || e.path.toLowerCase().includes(q)) && (!method || e.method === method) && (!ctx.readOnly || e.method === 'GET')
      );
      return { count: list.length, endpoints: list.slice(0, 250).map(describe), truncated: list.length > 250 || undefined };
    })
  );

  tool(
    'api_request',
    {
      title: 'Call the Atrium API',
      description:
        'Call any Atrium endpoint as the current user (find it with api_endpoints). Their permissions and project access are enforced by Atrium on every call. Paths are relative to /api, e.g. GET /crm/deals or PATCH /hrms/employees/<id>. Confirm with the user before changing or deleting data.',
      inputSchema: {
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().describe('e.g. /crm/deals/66f…; ids from earlier results'),
        query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Query-string parameters'),
        body: z.record(z.unknown()).optional().describe('JSON body for POST / PUT / PATCH'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    run(async ({ method, path, query, body }: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; query?: Record<string, string | number | boolean>; body?: Record<string, unknown> }) => {
      let clean = path.trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/api(?=\/)/, '').split('?')[0];
      if (!clean.startsWith('/')) clean = `/${clean}`;
      if (clean.includes('..') || clean.includes('//') || /%2e|%2f/i.test(clean)) throw new Error('Invalid path');
      if (isBlockedPath(clean)) throw new Error('That area is not available to AI assistants (credentials, sign-in, internal and portal endpoints).');
      if (ctx.readOnly && method !== 'GET') throw new Error('This token is read-only, so only GET requests are allowed.');
      if (!matchEntry(await catalog(), method, clean)) {
        throw new Error(`${method} ${clean} is not an endpoint you can use. Check api_endpoints for what is available to you.`);
      }
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) qs.set(k, String(v));
      const full = qs.toString() ? `${clean}?${qs}` : clean;
      const data = await api.request(method, full, method === 'GET' || method === 'DELETE' ? undefined : (body ?? {}));
      const text = JSON.stringify(data ?? null, null, 1);
      return text.length > 60_000 ? `${text.slice(0, 60_000)}\n… (truncated; use paging or filters for the rest)` : data ?? { ok: true };
    })
  );

  if (ctx.readOnly) return;

  // ── Writes (hidden for read-only tokens; the API checks permissions again) ──

  tool(
    'bulk_update_issues',
    {
      title: 'Bulk update issues',
      description:
        'Change many issues at once: pick them by `issues` (keys or ids) and/or a `jql` query, then set any of assignee, sprint, status, priority, type, labels or due date. ' +
        'Status, priority and type are matched to each project’s own names; sprint is an id or a sprint name in each issue’s project. ' +
        'Returns per-issue errors and updates the rest. Use dryRun to preview. Ask the user before running it.',
      inputSchema: {
        issues: z.array(z.string()).max(500).optional().describe('Issue keys (APP-12) or ids'),
        jql: z.string().optional().describe('Also select every issue matching this JQL, e.g. `project = APP AND status = Backlog`'),
        max: z.number().int().min(1).max(500).optional().describe('Most issues a JQL selection may touch (default 200)'),
        assignee: z.string().nullable().optional().describe('"me", a user id, or null to unassign'),
        sprint: z.string().nullable().optional().describe('Sprint id or name (in each issue’s project), or null to move to the backlog'),
        status: z.string().optional(),
        priority: z.string().optional(),
        type: z.string().optional(),
        labels: z.array(z.string()).optional().describe('Replaces all labels on each issue'),
        dueDate: z.string().nullable().optional().describe('YYYY-MM-DD or null'),
        dryRun: z.boolean().optional().describe('Resolve and validate only; change nothing'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    run(async (a: BulkArgs) => bulkUpdateIssues(api, ctx, a))
  );

  tool(
    'create_sprint',
    {
      title: 'Create sprint',
      description:
        'Create a sprint in a project. Sprints live on a Scrum board: if the project has none, a Scrum board with the project’s status columns is created first.',
      inputSchema: {
        project: z.string().describe('Project id or key'),
        name: z.string().min(1).max(200),
        startDate: z.string().optional().describe('YYYY-MM-DD'),
        endDate: z.string().optional().describe('YYYY-MM-DD'),
        board: z.string().regex(OBJECT_ID).optional().describe('Board id; default is the project’s first Scrum board'),
      },
      annotations: write,
    },
    run(async (a: { project: string; name: string; startDate?: string; endDate?: string; board?: string }) => {
      const projectId = await resolveProject(api, a.project);
      const { board, created } = a.board ? { board: { _id: a.board, name: undefined as string | undefined }, created: false } : await scrumBoardFor(api, projectId);
      const sprint = await api.post<{ _id: string; name: string; status?: string }>('/sprints', {
        name: a.name,
        project: projectId,
        board: board._id,
        startDate: a.startDate,
        endDate: a.endDate,
      });
      return {
        sprint: { id: sprint._id, name: sprint.name, status: sprint.status },
        board: { id: board._id, name: board.name, created },
      };
    })
  );


  tool(
    'link_records',
    {
      title: 'Link two records',
      description:
        'Add an explicit link between two records of any type (e.g. an issue that delivers a deal, a PO billed to a project). ' +
        'You must be able to open both. Ask the user before linking.',
      inputSchema: {
        from_type: recordType,
        from: recordRef,
        to_type: recordType,
        to: recordRef,
        relation: z.string().max(40).optional().describe('Short label read from → to, e.g. "delivers", "blocks", "billed by" (default "related")'),
        note: z.string().max(500).optional(),
      },
      annotations: write,
    },
    run(async (a: { from_type: RecordType; from: string; to_type: RecordType; to: string; relation?: string; note?: string }) => {
      const [fromId, toId] = await Promise.all([resolveRecord(api, a.from_type, a.from), resolveRecord(api, a.to_type, a.to)]);
      return api.post('/links', { from: { type: a.from_type, id: fromId }, to: { type: a.to_type, id: toId }, relation: a.relation, note: a.note });
    })
  );

  tool(
    'unlink_records',
    {
      title: 'Remove a record link',
      description: 'Remove an explicit link (the linkId from linked_records). Links set on the record itself (source "field") are changed on that record instead. Ask the user first.',
      inputSchema: { link_id: z.string().regex(OBJECT_ID).describe('linkId from linked_records') },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    run(async ({ link_id }: { link_id: string }) => {
      await api.delete(`/links/${link_id}`);
      return { removed: link_id };
    })
  );

  tool(
    'create_issue',
    {
      title: 'Create issue',
      description: 'Create an issue in a project. Type, priority and status must be names that exist in that project (see get_project).',
      inputSchema: {
        project: z.string().describe('Project id or key'),
        title: z.string().min(1).max(300),
        description: z.string().optional().describe('Plain text or Markdown'),
        type: z.string().optional(),
        priority: z.string().optional(),
        status: z.string().optional(),
        assignee: z.string().optional().describe('"me" or a user id'),
        labels: z.array(z.string()).optional(),
        parent: z.string().optional().describe('Parent issue key or id'),
        sprint: z.string().optional().describe('Sprint id'),
        storyPoints: z.number().optional(),
      },
      annotations: write,
    },
    run(
      async (a: {
        project: string;
        title: string;
        description?: string;
        type?: string;
        priority?: string;
        status?: string;
        assignee?: string;
        labels?: string[];
        parent?: string;
        sprint?: string;
        storyPoints?: number;
      }) => {
        const created = await api.post<RawIssue>('/issues', {
          project: await resolveProject(api, a.project),
          title: a.title,
          description: a.description,
          type: a.type,
          priority: a.priority,
          status: a.status,
          assignee: a.assignee === 'me' ? ctx.user.id : a.assignee,
          labels: a.labels,
          parent: a.parent ? await resolveIssue(api, a.parent) : undefined,
          sprint: a.sprint,
          storyPoints: a.storyPoints,
        });
        return { created: issueSummary(created) };
      }
    )
  );

  tool(
    'update_issue',
    {
      title: 'Update issue',
      description: 'Change fields on an issue (status, assignee, priority, title, description, labels, dates, estimate). Only the fields you pass are changed.',
      inputSchema: {
        issue: z.string().describe('Issue key or id'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        type: z.string().optional(),
        assignee: z.string().nullable().optional().describe('"me", a user id, or null to unassign'),
        labels: z.array(z.string()).optional(),
        dueDate: z.string().nullable().optional().describe('YYYY-MM-DD or null'),
        startDate: z.string().nullable().optional(),
        storyPoints: z.number().nullable().optional(),
        timeEstimateMinutes: z.number().int().nullable().optional(),
        sprint: z.string().nullable().optional(),
      },
      annotations: write,
    },
    run(async ({ issue, assignee, ...rest }: { issue: string; assignee?: string | null } & Record<string, unknown>) => {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (assignee !== undefined) body.assignee = assignee === 'me' ? ctx.user.id : assignee;
      if (!Object.keys(body).length) throw new Error('Nothing to change');
      const updated = await api.patch<RawIssue>(`/issues/${await resolveIssue(api, issue)}`, body);
      return { updated: issueSummary(updated) };
    })
  );

  tool(
    'add_comment',
    {
      title: 'Comment on issue',
      description: 'Add a comment to an issue as the current user.',
      inputSchema: { issue: z.string().describe('Issue key or id'), body: z.string().min(1).max(20_000) },
      annotations: write,
    },
    run(async ({ issue, body }: { issue: string; body: string }) => {
      await api.post(`/issues/${await resolveIssue(api, issue)}/comments`, { body });
      return { ok: true };
    })
  );

  tool(
    'log_work',
    {
      title: 'Log work',
      description: 'Log time spent on an issue for the current user.',
      inputSchema: {
        issue: z.string().describe('Issue key or id'),
        minutes: z.number().int().positive().max(24 * 60),
        date: z.string().optional().describe('YYYY-MM-DD, default today'),
        description: z.string().max(2000).optional(),
      },
      annotations: write,
    },
    run(async ({ issue, minutes, date, description }: { issue: string; minutes: number; date?: string; description?: string }) => {
      await api.post(`/issues/${await resolveIssue(api, issue)}/work-logs`, { minutesSpent: minutes, date: date ?? today(), description });
      return { ok: true, minutes, date: date ?? today() };
    })
  );

  tool(
    'docs_create_page',
    {
      title: 'Create doc page',
      description: 'Create a page in a space the user can edit. Starts as a draft unless publish is true. Content may be Markdown or HTML.',
      inputSchema: {
        space: z.string().describe('Space key or id'),
        title: z.string().min(1).max(200),
        content: z.string().optional(),
        parentPageId: z.string().optional(),
        issues: z.array(z.string()).optional().describe('Issue keys or ids to link'),
        projects: z.array(z.string()).optional().describe('Project ids or keys to link'),
        labels: z.array(z.string()).optional(),
        publish: z.boolean().optional(),
      },
      annotations: write,
    },
    run(
      async (a: { space: string; title: string; content?: string; parentPageId?: string; issues?: string[]; projects?: string[]; labels?: string[]; publish?: boolean }) => {
        const space = await api.get<{ id: string }>(`/docs/spaces/${encodeURIComponent(a.space)}`);
        const page = await api.post<{ id: string; title: string; status: string; space: { key: string } | null }>('/docs/pages', {
          spaceId: space.id,
          parentId: a.parentPageId ?? null,
          title: a.title,
          content: toHtml(a.content ?? ''),
          issueIds: a.issues ? await Promise.all(a.issues.map((i) => resolveIssue(api, i))) : undefined,
          projectIds: a.projects ? await Promise.all(a.projects.map((p) => resolveProject(api, p))) : undefined,
          labels: a.labels,
          status: a.publish ? 'published' : 'draft',
        });
        return { created: { id: page.id, title: page.title, status: page.status, space: page.space?.key } };
      }
    )
  );

  tool(
    'docs_update_page',
    {
      title: 'Update doc page',
      description: 'Replace a page’s title and/or content (a new version is kept in history), or append to it.',
      inputSchema: {
        pageId: z.string(),
        title: z.string().optional(),
        content: z.string().optional().describe('New full content (Markdown or HTML)'),
        append: z.string().optional().describe('Content to add at the end instead of replacing'),
        changeNote: z.string().optional(),
        publish: z.boolean().optional(),
      },
      annotations: { ...write, destructiveHint: true },
    },
    run(async (a: { pageId: string; title?: string; content?: string; append?: string; changeNote?: string; publish?: boolean }) => {
      const current = await api.get<{ version: number; content: string }>(`/docs/pages/${encodeURIComponent(a.pageId)}`);
      const content = a.content !== undefined ? toHtml(a.content) : a.append !== undefined ? `${current.content}${toHtml(a.append)}` : undefined;
      const page = await api.patch<{ id: string; version: number; status: string }>(`/docs/pages/${encodeURIComponent(a.pageId)}`, {
        title: a.title,
        content,
        baseVersion: current.version,
        message: a.changeNote ?? 'Edited via AI assistant',
        status: a.publish ? 'published' : undefined,
      });
      return { updated: { id: page.id, version: page.version, status: page.status } };
    })
  );
}

/** Light Markdown → HTML for content written by an assistant; HTML is passed through. */
export function toHtml(input: string): string {
  const text = input.trim();
  if (!text) return '';
  if (/^<([a-z][a-z0-9]*)\b[^>]*>/i.test(text)) return text;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(`<li><p>${inline(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ''))}</p></li>`);
        i++;
      }
      i--;
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push('<hr>');
      continue;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
}

// ── Bulk update and sprint helpers ───────────────────────────────────────────

type BulkArgs = {
  issues?: string[];
  jql?: string;
  max?: number;
  assignee?: string | null;
  sprint?: string | null;
  status?: string;
  priority?: string;
  type?: string;
  labels?: string[];
  dueDate?: string | null;
  dryRun?: boolean;
};
type Named = { id?: string; _id?: string; name: string };
type ProjectConfig = { _id: string; key: string; statuses?: Named[]; priorities?: Named[]; issueTypes?: Named[] };
type SprintRow = { _id: string; name: string; status?: string; project?: Ref };
type Target = { id: string; key?: string; projectId: string };

const BULK_CHUNK = 100;

/** Every issue matching `jql`, up to `max`. */
async function issuesByJql(api: AtriumApi, jql: string, max: number): Promise<{ issues: RawIssue[]; total: number }> {
  const out: RawIssue[] = [];
  let total = 0;
  for (let page = 1; out.length < max; page += 1) {
    const res = await api.get<Paginated<RawIssue>>('/issues/jql', { jql, page, limit: 100 });
    total = res.total;
    out.push(...res.data);
    if (page >= res.totalPages || !res.data.length) break;
  }
  return { issues: out.slice(0, max), total };
}

/** Exact name match in a project's list, ignoring case; returns the project's own spelling. */
function canonical(list: Named[] | undefined, value: string): string | null {
  if (!list?.length) return value; // project uses defaults — let the API decide
  return list.find((x) => x.name.toLowerCase() === value.trim().toLowerCase())?.name ?? null;
}

export async function bulkUpdateIssues(api: AtriumApi, ctx: McpContext, a: BulkArgs) {
  const fields = ['assignee', 'sprint', 'status', 'priority', 'type', 'labels', 'dueDate'] as const;
  if (!fields.some((f) => a[f] !== undefined)) throw new Error(`Give at least one field to change: ${fields.join(', ')}`);
  if (!a.issues?.length && !a.jql) throw new Error('Select issues with `issues` (keys or ids) and/or `jql`');

  const failed: Array<{ issue: string; error: string }> = [];
  const targets = new Map<string, Target>();
  const add = (i: RawIssue) => {
    const projectId = refId(i.project);
    if (projectId) targets.set(i._id, { id: i._id, key: i.key, projectId });
  };

  // Keys resolve through JQL in batches; ids through a direct read.
  const refs = [...new Set((a.issues ?? []).map((r) => r.trim()).filter(Boolean))];
  const keys = refs.filter((r) => ISSUE_KEY.test(r)).map((r) => r.toUpperCase());
  const ids = refs.filter((r) => OBJECT_ID.test(r));
  for (const r of refs) if (!ISSUE_KEY.test(r) && !OBJECT_ID.test(r)) failed.push({ issue: r, error: 'Not an issue key or id' });
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const { issues } = await issuesByJql(api, `key in (${batch.join(', ')})`, batch.length);
    issues.forEach(add);
    const found = new Set(issues.map((x) => x.key?.toUpperCase()));
    for (const k of batch) if (!found.has(k)) failed.push({ issue: k, error: 'Not found, or not visible to you' });
  }
  await Promise.all(
    ids.map(async (id) => {
      try {
        add(await api.get<RawIssue>(`/issues/${id}`));
      } catch {
        failed.push({ issue: id, error: 'Not found, or not visible to you' });
      }
    })
  );
  let jqlTotal: number | undefined;
  if (a.jql) {
    const max = a.max ?? 200;
    const res = await issuesByJql(api, a.jql, max);
    res.issues.forEach(add);
    jqlTotal = res.total;
    if (res.total > max) {
      failed.push({ issue: `jql (${res.total - max} more)`, error: `Only the first ${max} matches were selected; raise max or narrow the query` });
    }
  }

  // Per-project names and sprints, so each issue gets values valid in its own project.
  const projectIds = [...new Set([...targets.values()].map((t) => t.projectId))];
  const [configs, sprints] = await Promise.all([
    Promise.all(projectIds.map((id) => api.get<ProjectConfig>(`/projects/${id}`))),
    a.sprint
      ? Promise.all(projectIds.map((id) => api.get<Paginated<SprintRow> | SprintRow[]>('/sprints', { project: id, limit: 100 }).then(asList)))
      : Promise.resolve(projectIds.map(() => [] as SprintRow[])),
  ]);
  const configOf = new Map(projectIds.map((id, i) => [id, configs[i]]));
  const sprintsOf = new Map(projectIds.map((id, i) => [id, sprints[i]]));

  const groups = new Map<string, { updates: Record<string, unknown>; targets: Target[] }>();
  for (const t of targets.values()) {
    const cfg = configOf.get(t.projectId)!;
    const updates: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const [field, list] of [
      ['status', cfg.statuses],
      ['priority', cfg.priorities],
      ['type', cfg.issueTypes],
    ] as const) {
      const value = a[field];
      if (value === undefined) continue;
      const name = canonical(list, value);
      if (name) updates[field] = name;
      else problems.push(`${field} "${value}" does not exist in ${cfg.key} (${(list ?? []).map((x) => x.name).join(', ')})`);
    }
    if (a.sprint !== undefined) {
      if (a.sprint === null) updates.sprint = null;
      else {
        const list = sprintsOf.get(t.projectId) ?? [];
        const hit = OBJECT_ID.test(a.sprint)
          ? list.find((sp) => sp._id === a.sprint)
          : list.find((sp) => sp.name.toLowerCase() === a.sprint!.trim().toLowerCase());
        if (hit) updates.sprint = hit._id;
        else problems.push(`sprint "${a.sprint}" is not a sprint of ${cfg.key}`);
      }
    }
    if (a.assignee !== undefined) updates.assignee = a.assignee === 'me' ? ctx.user.id : a.assignee;
    if (a.labels !== undefined) updates.labels = a.labels;
    if (a.dueDate !== undefined) updates.dueDate = a.dueDate;

    if (problems.length) {
      failed.push({ issue: t.key ?? t.id, error: problems.join('; ') });
      continue;
    }
    const sig = JSON.stringify(updates);
    const g = groups.get(sig) ?? { updates, targets: [] };
    g.targets.push(t);
    groups.set(sig, g);
  }

  const planned = [...groups.values()].reduce((n, g) => n + g.targets.length, 0);
  if (a.dryRun) {
    return {
      dryRun: true,
      selected: targets.size,
      wouldUpdate: planned,
      jqlMatches: jqlTotal,
      changes: [...groups.values()].map((g) => ({ updates: g.updates, issues: g.targets.map((t) => t.key ?? t.id) })),
      failed,
    };
  }

  let updated = 0;
  const done: string[] = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.targets.length; i += BULK_CHUNK) {
      const chunk = g.targets.slice(i, i + BULK_CHUNK);
      try {
        const res = await api.request<{ updated: number }>('PATCH', '/issues/bulk', { issueIds: chunk.map((t) => t.id), updates: g.updates });
        updated += res?.updated ?? chunk.length;
        done.push(...chunk.map((t) => t.key ?? t.id));
      } catch (err) {
        const why = err instanceof Error ? err.message : 'Update failed';
        for (const t of chunk) failed.push({ issue: t.key ?? t.id, error: why });
      }
    }
  }
  return { selected: targets.size, updated, issues: done, jqlMatches: jqlTotal, failed };
}

/** The project's first Scrum board, or a new one whose columns are the project's statuses. */
async function scrumBoardFor(api: AtriumApi, projectId: string): Promise<{ board: { _id: string; name?: string }; created: boolean }> {
  const boards = asList(await api.get<Paginated<{ _id: string; name: string; type: string }> | Array<{ _id: string; name: string; type: string }>>('/boards', { project: projectId, limit: 100 }));
  const scrum = boards.find((b) => b.type === 'Scrum');
  if (scrum) return { board: scrum, created: false };
  const project = await api.get<ProjectConfig & { name: string }>(`/projects/${projectId}`);
  const statuses = [...(project.statuses ?? [])].sort((x, y) => ((x as { order?: number }).order ?? 0) - ((y as { order?: number }).order ?? 0));
  const board = await api.post<{ _id: string; name: string }>('/boards', {
    name: `${project.key} Scrum`,
    type: 'Scrum',
    project: projectId,
    columns: statuses.map((st, order) => ({ name: st.name, statusId: st.name, order })),
  });
  return { board, created: true };
}
