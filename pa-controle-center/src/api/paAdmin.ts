const SECRET_KEY = 'pa_admin_secret'

export function getStoredSecret(): string {
  // Never bake credentials into the bundle — sign in with the admin secret or an Atrium token.
  return (sessionStorage.getItem(SECRET_KEY) || '').trim()
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
      // A personal Atrium token (atr_…) signs in as you; anything else is the shared admin secret.
      ...(secret.startsWith('atr_') ? { Authorization: `Bearer ${secret}` } : { 'x-pa-admin-secret': secret }),
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

export type BrandProfile = {
  companyName: string
  companyNameMl: string
  businessDescription: string
  servicesSummary: string
  greetingEn: string
  greetingMl: string
  leadThanksEn: string
  leadThanksMl: string
  mentionAliases: string[]
}

export type BotSettings = {
  key: string
  botPaused: boolean
  voiceRepliesEnabled: boolean
  sttLanguage: 'ml' | 'en' | 'auto'
  brand?: BrandProfile
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
  customerOrgId?: string
  customerOrgName?: string
  kbEnabled?: boolean
  portalRequestsEnabled?: boolean
  ticketStatusEnabled?: boolean
  issueStatusEnabled?: boolean
  billingEnabled?: boolean
  hrmsEnabled?: boolean
  assetsEnabled?: boolean
  procurementEnabled?: boolean
  participantEstimate?: number
  updatedAt?: string
}

export type CustomerOrgOption = {
  id: string
  name: string
  slug?: string
  crmAccountId?: string
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
    body: Partial<WhatsappGroupRow> & {
      atriumProjects?: Array<{ id: string; name: string; key?: string }> | null
      customerOrgId?: string | null
      customerOrgName?: string | null
    }
  ) =>
    request<WhatsappGroupRow>(
      `/api/admin/groups/${encodeURIComponent(chatId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),
  listCustomerOrgs: () =>
    request<{ orgs: CustomerOrgOption[]; reason?: string }>(
      '/api/admin/customer-orgs'
    ),
  listAtriumProjects: () =>
    request<AtriumProjectsResult>('/api/admin/atrium/projects'),
  listSupportCases: () =>
    request<{
      cases: SupportCaseRow[]
      events: SupportEventRow[]
    }>('/api/admin/support/cases'),
  listServiceRequests: (opts: {
    status?: string
    pendingOnly?: boolean
    page?: number
    limit?: number
  } = {}) => {
    const q = new URLSearchParams()
    if (opts.pendingOnly) q.set('pendingOnly', '1')
    if (opts.status) q.set('status', opts.status)
    if (opts.page) q.set('page', String(opts.page))
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return request<{
      requests: CustomerRequestRow[]
      total: number
      page: number
      limit: number
      totalPages: number
    }>(`/api/admin/service-requests${qs ? `?${qs}` : ''}`)
  },
  getServiceRequest: (id: string) =>
    request<{ request: CustomerRequestRow }>(
      `/api/admin/service-requests/${encodeURIComponent(id)}`
    ),
  approveServiceRequest: (
    id: string,
    body: { workClassification: 'billable_change' | 'fix'; note?: string }
  ) =>
    request<{ request: unknown }>(
      `/api/admin/service-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  rejectServiceRequest: (
    id: string,
    body: { reason?: string; note?: string }
  ) =>
    request<{ request: unknown }>(
      `/api/admin/service-requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  listServiceTickets: (opts: { status?: string; queue?: string } = {}) => {
    const q = new URLSearchParams()
    if (opts.status) q.set('status', opts.status)
    if (opts.queue) q.set('queue', opts.queue)
    const qs = q.toString()
    return request<{ tickets: ServiceTicketRow[] }>(
      `/api/admin/service-tickets${qs ? `?${qs}` : ''}`
    )
  },
  patchServiceTicket: (
    id: string,
    body: {
      status?: string
      priority?: string
      queue?: string
      comment?: string
    }
  ) =>
    request<{ ticket: unknown }>(
      `/api/admin/service-tickets/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),
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

export type CustomerRequestRow = {
  _id: string
  title: string
  description?: string
  type?: string
  priority?: string
  status: string
  workClassification?: string
  linkedIssueKey?: string
  linkedServiceTicketId?: string
  createdAt?: string
  updatedAt?: string
  customerOrgId?: { name?: string; slug?: string } | string
  projectId?: { name?: string; key?: string } | string
  createdBy?: { name?: string; email?: string } | string
}

export type ServiceTicketRow = {
  _id: string
  subject: string
  description?: string
  status: string
  priority: string
  queue?: string
  source?: string
  linkedIssueId?: { key?: string; title?: string } | string
  projectId?: { name?: string; key?: string } | string
  updatedAt?: string
}

/** Short-lived SSE ticket (never put PA_ADMIN_SECRET in the query). */
async function fetchAdminSseTicket(): Promise<string> {
  const secret = getStoredSecret()
  if (!secret) throw new Error('Admin secret required')
  const res = await fetch(`${baseUrl()}/api/admin/events-ticket`, {
    method: 'POST',
    headers: { 'x-pa-admin-secret': secret },
  })
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    data?: { ticket?: string }
    error?: string
  }
  if (!res.ok || !json.data?.ticket) {
    throw new Error(json.error || 'Failed to issue SSE ticket')
  }
  return json.data.ticket
}

/** SSE URL for live support events (ticket via query — EventSource cannot set headers). */
export async function supportEventsUrl(): Promise<string> {
  const ticket = encodeURIComponent(await fetchAdminSseTicket())
  return `${baseUrl()}/api/admin/support/events?ticket=${ticket}`
}
