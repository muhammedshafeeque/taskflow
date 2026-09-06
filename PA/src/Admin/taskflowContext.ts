/**
 * Read-only Taskflow/Atrium API helpers.
 * Projects: prefer TASKFLOW_INGEST_SECRET (same as CRM lead ingest).
 * Full snapshot: TASKFLOW_API_TOKEN, or TASKFLOW_EMAIL + TASKFLOW_PASSWORD.
 */

export type TaskflowSnapshot = {
  available: boolean
  reason?: string
  projects: Array<{ id: string; name: string; key?: string; status?: string }>
  portfolio?: unknown
  dashboard?: unknown
  crmLeadsStats?: unknown
  crmDashboard?: unknown
}

let cachedAccessToken: string | null = null
let cachedTokenAt = 0
const TOKEN_TTL_MS = 50 * 60 * 1000

function apiBase(): string | null {
  const url = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '')
  return url || null
}

function ingestSecret(): string | null {
  return process.env.TASKFLOW_INGEST_SECRET?.trim() || null
}

async function loginForToken(): Promise<string | null> {
  const base = apiBase()
  const email = process.env.TASKFLOW_EMAIL?.trim()
  const password = process.env.TASKFLOW_PASSWORD?.trim()
  if (!base || !email || !password) return null
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      console.warn('Taskflow login failed', res.status)
      return null
    }
    const json = (await res.json()) as {
      data?: { tokens?: { accessToken?: string } }
    }
    return json.data?.tokens?.accessToken?.trim() || null
  } catch (err) {
    console.warn('Taskflow login error', err)
    return null
  }
}

async function resolveAccessToken(): Promise<{
  token: string | null
  reason?: string
}> {
  const staticToken = process.env.TASKFLOW_API_TOKEN?.trim()
  if (staticToken) return { token: staticToken }

  if (cachedAccessToken && Date.now() - cachedTokenAt < TOKEN_TTL_MS) {
    return { token: cachedAccessToken }
  }

  const minted = await loginForToken()
  if (minted) {
    cachedAccessToken = minted
    cachedTokenAt = Date.now()
    return { token: minted }
  }

  if (!process.env.TASKFLOW_EMAIL?.trim()) {
    return {
      token: null,
      reason:
        'Set TASKFLOW_API_TOKEN or TASKFLOW_EMAIL + TASKFLOW_PASSWORD in PA/.env to load Atrium projects',
    }
  }
  return {
    token: null,
    reason: 'Taskflow login failed — check TASKFLOW_EMAIL / TASKFLOW_PASSWORD and TASKFLOW_API_URL',
  }
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const { token } = await resolveAccessToken()
  if (!token) return null
  const orgId = process.env.TASKFLOW_ORG_ID?.trim()
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (orgId) h['x-organization-id'] = orgId
  return h
}

async function getJson(path: string): Promise<unknown | null> {
  const base = apiBase()
  const h = await authHeaders()
  if (!base || !h) return null
  try {
    const res = await fetch(`${base}${path}`, { headers: h })
    if (!res.ok) {
      console.warn('Taskflow GET failed', path, res.status)
      if (res.status === 401) {
        cachedAccessToken = null
        cachedTokenAt = 0
      }
      return null
    }
    return (await res.json()) as unknown
  } catch (err) {
    console.warn('Taskflow GET error', path, err)
    return null
  }
}

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    if (Array.isArray(o.data)) return o.data
    if (o.data && typeof o.data === 'object') {
      const inner = o.data as Record<string, unknown>
      if (Array.isArray(inner.items)) return inner.items
      if (Array.isArray(inner.projects)) return inner.projects
      if (Array.isArray(inner.results)) return inner.results
    }
    if (Array.isArray(o.items)) return o.items
    if (Array.isArray(o.projects)) return o.projects
  }
  return []
}

function mapProject(p: unknown): {
  id: string
  name: string
  key?: string
  status?: string
} | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const id = String(o._id || o.id || '')
  const name = String(o.name || o.title || o.key || '')
  if (!id && !name) return null
  return {
    id: id || name,
    name: name || id,
    key: o.key ? String(o.key) : undefined,
    status: o.status ? String(o.status) : undefined,
  }
}

export async function fetchTaskflowSnapshot(): Promise<TaskflowSnapshot> {
  const base = apiBase()
  if (!base) {
    return {
      available: false,
      reason: 'TASKFLOW_API_URL not configured',
      projects: [],
    }
  }

  const auth = await resolveAccessToken()
  if (!auth.token) {
    return {
      available: false,
      reason: auth.reason || 'Taskflow auth missing',
      projects: [],
    }
  }

  const [projectsRaw, portfolio, dashboard, crmLeadsStats, crmDashboard] =
    await Promise.all([
      getJson('/api/projects?limit=100'),
      getJson('/api/dashboard/portfolio'),
      getJson('/api/dashboard/stats'),
      getJson('/api/crm/leads/stats'),
      getJson('/api/crm/dashboard'),
    ])

  const projects = asArray(projectsRaw)
    .map(mapProject)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 100)

  return {
    available: true,
    projects,
    portfolio: unwrapData(portfolio),
    dashboard: unwrapData(dashboard),
    crmLeadsStats: unwrapData(crmLeadsStats),
    crmDashboard: unwrapData(crmDashboard),
  }
}

/** List projects via shared ingest secret (no JWT). */
async function listProjectsViaIngest(): Promise<{
  available: boolean
  reason?: string
  projects: Array<{ id: string; name: string; key?: string; status?: string }>
} | null> {
  const base = apiBase()
  const secret = ingestSecret()
  if (!base || !secret) return null

  const orgId = process.env.TASKFLOW_ORG_ID?.trim()
  try {
    const res = await fetch(`${base}/api/crm/ingest/projects`, {
      headers: {
        'x-pa-ingest-secret': secret,
        ...(orgId ? { 'x-organization-id': orgId } : {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      console.warn('Taskflow ingest projects failed', res.status, body.slice(0, 200))
      return {
        available: false,
        reason: `Taskflow ingest projects failed (${res.status})`,
        projects: [],
      }
    }
    const json = (await res.json()) as unknown
    const projects = asArray(json)
      .map(mapProject)
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 200)
    return { available: true, projects }
  } catch (err) {
    console.warn('Taskflow ingest projects error', err)
    return {
      available: false,
      reason: 'Taskflow ingest projects request failed',
      projects: [],
    }
  }
}

export async function listTaskflowProjects(): Promise<{
  available: boolean
  reason?: string
  projects: Array<{ id: string; name: string; key?: string; status?: string }>
}> {
  const viaIngest = await listProjectsViaIngest()
  if (viaIngest) return viaIngest

  const snap = await fetchTaskflowSnapshot()
  return {
    available: snap.available,
    reason:
      snap.reason ||
      'Set TASKFLOW_INGEST_SECRET (same as server PA_INGEST_SECRET) to load projects',
    projects: snap.projects,
  }
}

function unwrapData(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in (raw as object)) {
    return (raw as { data: unknown }).data
  }
  return raw
}

export function formatSnapshotForPrompt(
  snap: TaskflowSnapshot,
  local: {
    botPaused: boolean
    voiceRepliesEnabled: boolean
    sttLanguage: string
    chats: number
    pausedChats: number
    whatsappLeads: number
    recentChats: string[]
    recentLeadTitles: string[]
  }
): string {
  const lines: string[] = [
    '## WhatsApp PA (local)',
    `- Bot auto-replies: ${local.botPaused ? 'PAUSED' : 'running'}`,
    `- Voice replies to WhatsApp: ${local.voiceRepliesEnabled ? 'on' : 'off'}`,
    `- WhatsApp STT language setting: ${local.sttLanguage}`,
    `- Conversations: ${local.chats} (${local.pausedChats} paused)`,
    `- Local WhatsApp leads: ${local.whatsappLeads}`,
  ]
  if (local.recentChats.length) {
    lines.push(`- Recent chats: ${local.recentChats.join('; ')}`)
  }
  if (local.recentLeadTitles.length) {
    lines.push(`- Recent leads: ${local.recentLeadTitles.join('; ')}`)
  }

  lines.push('', '## Atrium / Taskflow')
  if (!snap.available) {
    lines.push(`- Live Atrium API: unavailable (${snap.reason})`)
  } else if (snap.projects.length) {
    lines.push(
      `- Projects (${snap.projects.length}): ${snap.projects
        .map((p) => `${p.name}${p.key ? ` [${p.key}]` : ''}`)
        .join('; ')}`
    )
  } else {
    lines.push('- Projects: none returned (check token permissions / org id)')
  }
  return lines.join('\n')
}
