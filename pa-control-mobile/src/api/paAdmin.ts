import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const SECRET_KEY = 'pa_admin_secret'
const BASE_KEY = 'pa_api_base'

const extra = Constants.expoConfig?.extra as
  | { paApiUrl?: string; atriumUrl?: string }
  | undefined

export function defaultApiUrl(): string {
  return (
    process.env.EXPO_PUBLIC_PA_API_URL?.trim() ||
    extra?.paApiUrl?.trim() ||
    'https://pa.repod.online'
  ).replace(/\/$/, '')
}

export function defaultAtriumUrl(): string {
  return (
    process.env.EXPO_PUBLIC_ATRIUM_URL?.trim() ||
    extra?.atriumUrl?.trim() ||
    'https://taskflow.repod.online'
  ).replace(/\/$/, '')
}

let memorySecret = ''
let memoryBase = defaultApiUrl()

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(key)
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      // ignore quota / private mode
    }
    return
  }
  await SecureStore.setItemAsync(key, value)
}

async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      // ignore
    }
    return
  }
  await SecureStore.deleteItemAsync(key)
}

export async function loadAuthFromStore(): Promise<{
  secret: string
  baseUrl: string
}> {
  const [secret, base] = await Promise.all([
    storageGet(SECRET_KEY),
    storageGet(BASE_KEY),
  ])
  memorySecret = (secret || '').trim()
  memoryBase = (base || defaultApiUrl()).replace(/\/$/, '')
  return { secret: memorySecret, baseUrl: memoryBase }
}

export function getStoredSecret(): string {
  return memorySecret
}

export function getBaseUrl(): string {
  return memoryBase
}

export async function setAuth(secret: string, baseUrl: string): Promise<void> {
  memorySecret = secret.trim()
  memoryBase = baseUrl.trim().replace(/\/$/, '') || defaultApiUrl()
  await storageSet(SECRET_KEY, memorySecret)
  await storageSet(BASE_KEY, memoryBase)
}

export async function clearAuth(): Promise<void> {
  memorySecret = ''
  memoryBase = defaultApiUrl()
  await storageDelete(SECRET_KEY)
  await storageDelete(BASE_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = getStoredSecret()
  if (!secret) throw new Error('Admin secret required')

  const res = await fetch(`${getBaseUrl()}${path}`, {
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
    message?: string
    data?: T
  }

  if (!res.ok || json.success === false) {
    throw new Error(
      json.error || json.message || `Request failed (${res.status})`
    )
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
  listAgentDevices: () => request<AgentDeviceRow[]>('/api/admin/agent/devices'),
  createAgentPairing: (body: { name?: string; userLabel?: string } = {}) =>
    request<{
      device: AgentDeviceRow
      pairingCode: string
      expiresAt?: string
    }>('/api/admin/agent/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeAgentDevice: (deviceId: string) =>
    request<AgentDeviceRow>(
      `/api/admin/agent/devices/${encodeURIComponent(deviceId)}/revoke`,
      { method: 'POST' }
    ),
  listAgentJobs: (opts: { deviceId?: string; status?: string } = {}) => {
    const q = new URLSearchParams()
    if (opts.deviceId) q.set('deviceId', opts.deviceId)
    if (opts.status) q.set('status', opts.status)
    const qs = q.toString()
    return request<AgentJobRow[]>(
      `/api/admin/agent/jobs${qs ? `?${qs}` : ''}`
    )
  },
  getAgentJob: (id: string) =>
    request<AgentJobRow>(`/api/admin/agent/jobs/${encodeURIComponent(id)}`),
  createAgentJob: (body: {
    type: 'fix_issue' | 'follow_up' | 'run_command' | 'deploy'
    deviceId: string
    issueKey?: string
    projectId?: string
    projectKey?: string
    instruction?: string
    command?: string
    parentJobId?: string
  }) =>
    request<AgentJobRow>('/api/admin/agent/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelAgentJob: (id: string) =>
    request<AgentJobRow>(
      `/api/admin/agent/jobs/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    ),
  approveAgentDeploy: (id: string, command?: string) =>
    request<{ parent: AgentJobRow; deployJob: AgentJobRow }>(
      `/api/admin/agent/jobs/${encodeURIComponent(id)}/approve-deploy`,
      { method: 'POST', body: JSON.stringify({ command }) }
    ),
  rejectAgentJob: (id: string) =>
    request<AgentJobRow>(
      `/api/admin/agent/jobs/${encodeURIComponent(id)}/reject`,
      { method: 'POST' }
    ),
}

export type CustomerRequestRow = {
  _id: string
  title: string
  description?: string
  type?: string
  priority?: string
  status: string
  customerOrgId?: { name?: string; slug?: string } | string
  projectId?: { name?: string; key?: string } | string
}

export type ServiceTicketRow = {
  _id: string
  subject: string
  status: string
  priority: string
  linkedIssueId?: { key?: string; title?: string } | string
  projectId?: { name?: string; key?: string } | string
}

export function supportEventsUrl(): string {
  const secret = encodeURIComponent(getStoredSecret())
  return `${getBaseUrl()}/api/admin/support/events?secret=${secret}`
}

export type AgentDeviceRow = {
  deviceId: string
  name: string
  userLabel?: string
  lastSeenAt?: string
  online?: boolean
  workspaces?: Array<{
    projectKey: string
    projectId?: string
    localPath: string
  }>
  allowCommands?: string[]
  aiProviders?: string[]
}

export type AgentJobRow = {
  id: string
  type: string
  status: string
  deviceId: string
  issueKey?: string
  projectId?: string
  projectKey?: string
  instruction?: string
  command?: string
  logs?: Array<{ at?: string; line: string }>
  summary?: string
  diffStat?: string
  error?: string
  createdAt?: string
  updatedAt?: string
}

export function agentJobEventsUrl(jobId: string): string {
  const secret = encodeURIComponent(getStoredSecret())
  return `${getBaseUrl()}/api/admin/agent/jobs/${encodeURIComponent(
    jobId
  )}/events?secret=${secret}`
}
