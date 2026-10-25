/**
 * Atrium/Taskflow tool layer for the PA assistant (mobile "Ask PA" + control-center voice).
 * Lets the LLM read any Atrium API resource through the JWT proxy (taskflowRequest),
 * and perform a small allowlist of write actions the owner explicitly asks for.
 *
 * Requires TASKFLOW_API_TOKEN or TASKFLOW_EMAIL + TASKFLOW_PASSWORD — the ingest secret
 * alone cannot read Atrium data. The Taskflow user's own permissions still apply.
 */
import type Groq from 'groq-sdk'
import { taskflowMonitorRequest, taskflowRequest } from './taskflowContext'

/** Monitor paths go through the PA service API (ingest secret); everything else via JWT. */
function atriumRequest(path: string, init?: { method?: string; body?: unknown }) {
  if (/^\/api\/monitor\/(projects|pm-suggestions)(\/|\?|$)/.test(path)) {
    return taskflowMonitorRequest(path.slice('/api/monitor'.length), init)
  }
  return taskflowRequest(path, init)
}

type ToolDef = Groq.Chat.Completions.ChatCompletionTool

const MAX_RESULT_CHARS = 9000
const MAX_STRING = 500
const MAX_ARRAY = 30
const MAX_DEPTH = 6

/** GET paths the assistant must never touch (secrets, binary, side-effectful). */
const READ_DENY = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/customer\/auth(\/|$)/,
  /^\/api\/uploads(\/|$)/,
  /^\/api\/webhooks(\/|$)/,
  /^\/api\/push(-subscriptions)?(\/|$)/,
  /\/ingest(\/|$)/,
  /\/export(\/|$)/,
]

/** Writes the assistant may perform (method + path pattern). */
const WRITE_ALLOW: Array<{ method: 'POST' | 'PATCH'; pattern: RegExp; label: string }> = [
  { method: 'POST', pattern: /^\/api\/issues$/, label: 'create issue' },
  { method: 'PATCH', pattern: /^\/api\/issues\/[\w-]+$/, label: 'update issue' },
  { method: 'POST', pattern: /^\/api\/issues\/[\w-]+\/comments$/, label: 'comment on issue' },
  { method: 'POST', pattern: /^\/api\/issues\/[\w-]+\/work-logs$/, label: 'log work' },
  { method: 'POST', pattern: /^\/api\/crm\/(leads|activities|contacts|deals)$/, label: 'create CRM record' },
  { method: 'PATCH', pattern: /^\/api\/crm\/(leads|activities|contacts|deals)\/[\w-]+$/, label: 'update CRM record' },
  { method: 'POST', pattern: /^\/api\/crm\/activities\/[\w-]+\/complete$/, label: 'complete CRM activity' },
  { method: 'POST', pattern: /^\/api\/service\/tickets$/, label: 'create service ticket' },
  { method: 'PATCH', pattern: /^\/api\/service\/tickets\/[\w-]+$/, label: 'update service ticket' },
  { method: 'POST', pattern: /^\/api\/service\/tickets\/[\w-]+\/comments$/, label: 'comment on ticket' },
  { method: 'POST', pattern: /^\/api\/calendar\/events$/, label: 'create calendar event' },
  { method: 'PATCH', pattern: /^\/api\/calendar\/events\/[\w-]+$/, label: 'update calendar event' },
  { method: 'PATCH', pattern: /^\/api\/monitor\/projects\/[\w-]+\/errors\/[\w-]+$/, label: 'update monitor error' },
  { method: 'PATCH', pattern: /^\/api\/hrms\/leave\/[\w-]+\/decision$/, label: 'decide leave request' },
  { method: 'POST', pattern: /^\/api\/links$/, label: 'link two records' },
]

/** Endpoint catalog shown to the model so it knows where data lives. */
export const ATRIUM_ENDPOINT_CATALOG = `Atrium API (paths relative to /api; GET unless noted):
- Search everything: /search?q=TEXT
- Record graph (how records connect across modules — deal, quote, contract, project, issues, tickets, invoices, POs, assets, people):
  /links/:type/:id (type = lead|deal|quote|contract|account|customer|project|issue|invoice|ticket|employee|asset|purchase_order),
  /links/search?type=TYPE&q=TEXT to find a record id. Answer "what's linked to X" / "which invoices belong to project Y" from here first.
- Projects: /projects, /projects/:id, /projects/:id/members, /projects/:id/timeline, /projects/:id/timesheet, /projects/:id/sprints/:sprintId/report
- Issues: /issues?project=ID&status=..&assignee=USERID&priority=..&type=..&sprint=..&dueDate=overdue|today|this_week&unassigned=true&page=1&limit=50
  /issues/jql?jql=QUERY, /issues/search-global?q=TEXT, /issues/by-key?project=ID&key=KEY-12, /issues/:id, /issues/:id/history, /issues/:id/subtasks, /issues/:id/links, /issues/:id/comments, /issues/:id/work-logs, /issues/quick-filters/counts
- Sprints: /sprints?project=ID, /sprints/:id · Milestones: /milestones?project=ID · Boards: /boards
- Dashboard: /dashboard/stats, /dashboard/portfolio, /dashboard/portfolio/timeline, /dashboard/project-metrics, /dashboard/workload, /dashboard/defect-metrics, /dashboard/estimates, /dashboard/performance-report, /dashboard/cost-usage
- Reports: /reports · Analytics: /analytics · Inbox: /inbox, /inbox/mentions, /inbox/unread-count · Notifications: /notifications
- Users: /users, /users/:id
- CRM: /crm/dashboard, /crm/executive-metrics, /crm/leads, /crm/leads/stats, /crm/leads/:id, /crm/deals, /crm/deals/forecast, /crm/accounts, /crm/accounts/:id/360, /crm/contacts, /crm/activities, /crm/pipelines, /crm/quotes, /crm/campaigns, /crm/contracts
- Service desk: /service/dashboard, /service/tickets, /service/tickets/:id, /service/sla, /service/kb/search?q=TEXT, /customer/requests
- Calendar: /calendar/dashboard, /calendar/events?from=ISO&to=ISO
- Monitor: /monitor/projects, /monitor/projects/:projectId/overview, .../errors, .../errors/:groupId, .../alerts, .../uptime, .../vitals, .../releases, .../logs, .../http, .../live-users, /monitor/pm-suggestions
- HRMS: /hrms/dashboard, /hrms/employees, /hrms/attendance, /hrms/leave, /hrms/payroll
- Other modules: /contracts, /billing, /resources, /assets, /procurement, /accounts, /documents, /roadmaps, /audit-logs
Allowed writes (atrium_write): POST /issues {project,title,type?,priority?,assignee?,description?,dueDate?}; PATCH /issues/:id {status?,priority?,assignee?,dueDate?,title?,...}; POST /issues/:id/comments {body}; POST /issues/:id/work-logs; POST/PATCH /crm/leads|activities|contacts|deals; POST /crm/activities/:id/complete; POST/PATCH /service/tickets; POST /service/tickets/:id/comments {body}; POST/PATCH /calendar/events; PATCH /monitor/projects/:p/errors/:g {status}; PATCH /hrms/leave/:id/decision; POST /links {from:{type,id},to:{type,id},relation?,note?} to link two records.`

export const ATRIUM_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'atrium_get',
      description:
        'Read any Atrium/Taskflow data via GET. Use the endpoint catalog in the system prompt. Returns JSON (trimmed). Call several times to drill down (list → detail).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'API path, e.g. /issues or /crm/leads/abc123 (the /api prefix is optional)' },
          query: {
            type: 'object',
            description: 'Query-string params, e.g. {"project":"<id>","status":"In Progress","limit":"50"}',
            additionalProperties: true,
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'atrium_write',
      description:
        'Create or update an Atrium record (allowlisted endpoints only). ONLY call when the owner explicitly asked for this change in their latest message. Look up real ids with atrium_get first.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['POST', 'PATCH'] },
          path: { type: 'string', description: 'e.g. /issues/<id> or /issues/<id>/comments' },
          body: { type: 'object', additionalProperties: true },
        },
        required: ['method', 'path', 'body'],
      },
    },
  },
]

function normalizePath(raw: unknown): string | null {
  let p = String(raw ?? '').trim()
  if (!p || p.includes('://') || p.includes('..') || /\s/.test(p)) return null
  const qIdx = p.indexOf('?')
  if (qIdx >= 0) p = p.slice(0, qIdx)
  if (!p.startsWith('/')) p = `/${p}`
  if (!p.startsWith('/api/')) p = `/api${p}`
  return p.replace(/\/+$/, '') || null
}

function inlineQuery(raw: unknown): URLSearchParams {
  const params = new URLSearchParams()
  const pathStr = String(raw ?? '')
  const qIdx = pathStr.indexOf('?')
  if (qIdx >= 0) new URLSearchParams(pathStr.slice(qIdx + 1)).forEach((v, k) => params.append(k, v))
  return params
}

function buildQuery(pathRaw: unknown, query: unknown): string {
  const params = inlineQuery(pathRaw)
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x)))
      else params.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

const DROP_KEYS = new Set(['__v', 'password', 'passwordHash', 'avatar', 'avatarUrl', 'token', 'tokens', 'secret', 'apiKey', 'refreshToken'])

/** Shrink API JSON so it fits the model context: drop noise, cap strings/arrays/depth. */
export function compactJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  if (typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[${value.length} items]` : '{…}'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => compactJson(v, depth + 1))
    if (value.length > MAX_ARRAY) items.push(`…${value.length - MAX_ARRAY} more`)
    return items
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.has(k) || v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = compactJson(v, depth + 1)
  }
  return out
}

function serialize(status: number, json: unknown): string {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const ok = status >= 200 && status < 300
  const out = ok
    ? { status, result: compactJson('data' in body ? body.data : json), ...(body.pagination ? { pagination: body.pagination } : {}) }
    : { status, error: body.error ?? body.message ?? 'Request failed' }
  let text = JSON.stringify(out)
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}… [truncated — narrow the query with filters, limit, or a detail endpoint]`
  }
  return text
}

export type AtriumToolCallLog = { tool: string; method: string; path: string; status: number }

export async function runAtriumTool(
  name: string,
  rawArgs: string,
  log: AtriumToolCallLog[]
): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    return JSON.stringify({ error: 'Arguments were not valid JSON' })
  }

  const path = normalizePath(args.path)
  if (!path) return JSON.stringify({ error: 'Invalid path' })

  if (name === 'atrium_get') {
    if (READ_DENY.some((re) => re.test(path))) {
      return JSON.stringify({ error: `Path ${path} is not available to the assistant` })
    }
    const full = `${path}${buildQuery(args.path, args.query)}`
    const { status, json } = await atriumRequest(full)
    log.push({ tool: name, method: 'GET', path: full, status })
    return serialize(status, json)
  }

  if (name === 'atrium_write') {
    const method = String(args.method ?? '').toUpperCase()
    const rule = WRITE_ALLOW.find((r) => r.method === method && r.pattern.test(path))
    if (!rule) {
      return JSON.stringify({ error: `${method} ${path} is not an allowed assistant write` })
    }
    const body = args.body && typeof args.body === 'object' ? args.body : {}
    const { status, json } = await atriumRequest(path, { method, body })
    log.push({ tool: name, method, path, status })
    return serialize(status, json)
  }

  return JSON.stringify({ error: `Unknown tool ${name}` })
}
