const SECRET_KEY = 'pa_admin_secret'

export function getStoredSecret(): string {
  return (
    sessionStorage.getItem(SECRET_KEY) ||
    import.meta.env.VITE_PA_ADMIN_SECRET ||
    ''
  ).trim()
}

export function setStoredSecret(secret: string): void {
  sessionStorage.setItem(SECRET_KEY, secret.trim())
}

export function clearStoredSecret(): void {
  sessionStorage.removeItem(SECRET_KEY)
}

function baseUrl(): string {
  const raw = (import.meta.env.VITE_PA_API_URL as string | undefined)?.trim()
  return raw ? raw.replace(/\/$/, '') : ''
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const secret = getStoredSecret()
  if (!secret) throw new Error('Admin secret required')

  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-pa-admin-secret': secret,
      ...(init.headers || {}),
    },
  })

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    error?: string
    data?: T
  }

  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Request failed (${res.status})`)
  }

  return json.data as T
}

export type BotSettings = {
  key: string
  botPaused: boolean
  voiceRepliesEnabled: boolean
  sttLanguage: 'ml' | 'en' | 'auto'
  updatedAt?: string
}

export type AdminStatus = {
  whatsapp: {
    ready: boolean
    authenticated: boolean
    lastDisconnectReason: string | null
  }
  settings: BotSettings
  counts: {
    conversations: number
    paused: number
    leads: number
  }
}

export type ConversationListItem = {
  chatId: string
  lastLang?: string
  lastType?: string
  autoReplyPaused: boolean
  crmLeadId?: string
  localLeadId?: string
  contactName?: string
  contactPhone?: string
  messageCount: number
  leadCreatedAt?: string
  updatedAt?: string
  preview: string
}

export type ConversationDetail = {
  chatId: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; at?: string }>
  lead?: { summary?: string }
  lastType?: string
  lastLang?: string
  autoReplyPaused?: boolean
  contactName?: string
  contactPhone?: string
  crmLeadId?: string
  localLeadId?: string
  updatedAt?: string
}

export type WhatsappLead = {
  _id: string
  chatId: string
  title: string
  summary: string
  contactPhone?: string
  contactName?: string
  crmLeadId?: string
  createdAt?: string
}

export type WhatsappGroupRow = {
  chatId: string
  name: string
  autoReplyEnabled: boolean
  mentionOnly: boolean
  atriumProjects: Array<{ id: string; name: string; key?: string }>
  participantEstimate?: number
  updatedAt?: string
}

export type AtriumProject = {
  id: string
  name: string
  key?: string
  status?: string
}

export type AtriumProjectsResult = {
  available: boolean
  reason?: string
  projects: AtriumProject[]
}

export const paAdmin = {
  status: () => request<AdminStatus>('/api/admin/status'),
  getSettings: () => request<BotSettings>('/api/admin/settings'),
  patchSettings: (body: Partial<BotSettings>) =>
    request<BotSettings>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listConversations: (q = '') =>
    request<ConversationListItem[]>(
      `/api/admin/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),
  getConversation: (chatId: string) =>
    request<ConversationDetail>(
      `/api/admin/conversations/${encodeURIComponent(chatId)}`
    ),
  pause: (chatId: string) =>
    request<ConversationDetail>(
      `/api/admin/conversations/${encodeURIComponent(chatId)}/pause`,
      { method: 'POST' }
    ),
  resume: (chatId: string) =>
    request<ConversationDetail>(
      `/api/admin/conversations/${encodeURIComponent(chatId)}/resume`,
      { method: 'POST' }
    ),
  reset: (chatId: string) =>
    request<ConversationDetail>(
      `/api/admin/conversations/${encodeURIComponent(chatId)}/reset`,
      { method: 'POST' }
    ),
  listLeads: () => request<WhatsappLead[]>('/api/admin/leads'),
  listGroups: () => request<WhatsappGroupRow[]>('/api/admin/groups'),
  patchGroup: (
    chatId: string,
    body: {
      name?: string
      autoReplyEnabled?: boolean
      mentionOnly?: boolean
      atriumProjects?: Array<{ id: string; name: string; key?: string }> | null
    }
  ) =>
    request<WhatsappGroupRow>(
      `/api/admin/groups/${encodeURIComponent(chatId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),
  listAtriumProjects: () =>
    request<AtriumProjectsResult>('/api/admin/atrium/projects'),
  listSupportCases: () =>
    request<{
      cases: SupportCaseRow[]
      events: SupportEventRow[]
    }>('/api/admin/support/cases'),
}

export type SupportCaseRow = {
  id: string
  groupId: string
  groupName?: string
  projectIds: string[]
  status: string
  ticketIds: string[]
  lastQaStatus?: string
  lastPriority?: string
  updatedAt?: string
  latestAgent?: string
  latestAgentStatus?: string
}

export type SupportEventRow = {
  id: string
  type: string
  at: string
  groupId?: string
  groupName?: string
  projectId?: string
  projectName?: string
  ticketId?: string
  priority?: string
  summary?: string
  qaStatus?: string
  agent?: string
}

/** SSE URL for live support events (secret via query — EventSource cannot set headers). */
export function supportEventsUrl(): string {
  const secret = encodeURIComponent(getStoredSecret())
  const base = baseUrl()
  return `${base}/api/admin/support/events?secret=${secret}`
}
