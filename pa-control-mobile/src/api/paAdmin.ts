import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { readCache, saveCache, setOffline } from '../lib/offlineCache'

const SECRET_KEY = 'pa_admin_secret'
const BASE_KEY = 'pa_api_base'

const extra = Constants.expoConfig?.extra as
  | { paApiUrl?: string; atriumUrl?: string }
  | undefined

export function defaultApiUrl(): string {
  return (
    process.env.EXPO_PUBLIC_PA_API_URL?.trim() ||
    extra?.paApiUrl?.trim() ||
    ''
  ).replace(/\/$/, '')
}

export function defaultAtriumUrl(): string {
  return (
    process.env.EXPO_PUBLIC_ATRIUM_URL?.trim() ||
    extra?.atriumUrl?.trim() ||
    ''
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
  const isGet = !init.method || init.method.toUpperCase() === 'GET'
  if (!isGet) return requestOnline<T>(path, init)
  try {
    const data = await requestOnline<T>(path, init)
    saveCache(path, data)
    setOffline(false)
    return data
  } catch (err) {
    // Only fall back for network failures — real API errors (4xx/5xx) still surface.
    if (!(err instanceof NetworkError)) throw err
    const cached = await readCache<T>(path)
    if (!cached) throw err
    setOffline(true, cached.savedAt)
    return cached.data
  }
}

class NetworkError extends Error {}

async function requestOnline<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = getStoredSecret()
  if (!secret) throw new Error('Admin secret required')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  let res: Response
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // A personal Atrium token (atr_…) signs in as you; anything else is the shared admin secret.
        ...(secret.startsWith('atr_') ? { Authorization: `Bearer ${secret}` } : { 'x-pa-admin-secret': secret }),
        ...(init.headers || {}),
      },
    })
  } catch (err) {
    if (controller.signal.aborted) throw new NetworkError('Request timed out — is the PA server reachable?')
    throw new NetworkError(err instanceof Error ? err.message : 'Network request failed')
  } finally {
    clearTimeout(timeout)
  }

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

export type QuietHours = {
  enabled: boolean
  start: string
  end: string
  timezone: string
  awayMessage: string
}

export type BotSettings = {
  key: string
  botPaused: boolean
  voiceRepliesEnabled: boolean
  sttLanguage: 'ml' | 'en' | 'auto'
  quietHours?: QuietHours
  updatedAt?: string
}

export type MessageTemplate = { _id: string; name: string; body: string; usage: 'reply' | 'broadcast' | 'both' }

export type BroadcastAudience = { activeWithinDays?: number; lang?: 'ml' | 'en'; leadsOnly?: boolean; chatIds?: string[] }

export type BroadcastRow = {
  _id: string
  name: string
  message: string
  audience: BroadcastAudience
  status: 'draft' | 'sending' | 'paused' | 'done' | 'cancelled'
  total: number
  sent: number
  failed: number
  skippedOptOut: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export type ChatAnalytics = {
  days: number
  totals: {
    activeChats: number
    inbound: number
    botReplies: number
    humanReplies: number
    leads: number
    leadsInCrm: number
    pausedChats: number
  }
  daily: Array<{ date: string; inbound: number; botReplies: number; humanReplies: number; leads: number }>
  responseTimeSec: { median: number | null; p90: number | null; samples: number }
  languages: Record<string, number>
  messageTypes: Record<string, number>
  humanTakeoverRate: number
  leadConversionRate: number
  note: string
}

export type WhatsAppStatus = {
  ready: boolean
  authenticated: boolean
  qrPending?: boolean
  reconnecting?: boolean
  reconnectAttempts?: number
  lastDisconnectReason: string | null
  lastReconnectAt?: string | null
}

export type AdminStatus = {
  whatsapp: WhatsAppStatus
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
  messages: Array<{ role: 'user' | 'assistant'; content: string; at?: string; by?: 'bot' | 'human' }>
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
  whatsappStatus: () => request<WhatsAppStatus>('/api/admin/whatsapp/status'),
  reconnectWhatsApp: () =>
    request<WhatsAppStatus>('/api/admin/whatsapp/reconnect', { method: 'POST' }),
  getSettings: () => request<BotSettings>('/api/admin/settings'),
  templates: () => request<MessageTemplate[]>('/api/admin/templates'),
  createTemplate: (body: { name: string; body: string; usage?: MessageTemplate['usage'] }) =>
    request<MessageTemplate>('/api/admin/templates', { method: 'POST', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => request<{ ok: true }>(`/api/admin/templates/${id}`, { method: 'DELETE' }),
  broadcasts: () => request<BroadcastRow[]>('/api/admin/broadcasts'),
  previewAudience: (audience: BroadcastAudience) =>
    request<{ count: number; matched: number; optedOut: number; cap: number }>('/api/admin/broadcasts/preview', {
      method: 'POST',
      body: JSON.stringify({ audience }),
    }),
  createBroadcast: (body: { name: string; message: string; audience: BroadcastAudience }) =>
    request<BroadcastRow>('/api/admin/broadcasts', { method: 'POST', body: JSON.stringify(body) }),
  broadcastAction: (id: string, action: 'send' | 'pause' | 'cancel') =>
    request<{ status: BroadcastRow['status'] }>(`/api/admin/broadcasts/${id}/${action}`, { method: 'POST' }),
  analytics: (days = 30) => request<ChatAnalytics>(`/api/admin/analytics?days=${days}`),
  patchSettings: (body: Partial<Omit<BotSettings, 'quietHours'>> & { quietHours?: Partial<QuietHours> }) =>
    request<BotSettings>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listConversations: (q = '') =>
    request<ConversationListItem[]>(
      `/api/admin/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),
  sendMessage: (chatId: string, text: string, pauseBot = true) =>
    request<ConversationDetail>(
      `/api/admin/conversations/${encodeURIComponent(chatId)}/send`,
      { method: 'POST', body: JSON.stringify({ text, pauseBot }) }
    ),
  whatsappQr: () =>
    request<{ qr: string | null; status: WhatsAppStatus }>('/api/admin/whatsapp/qr'),
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
    body: Partial<Omit<WhatsappGroupRow, 'atriumProjects' | 'customerOrgId' | 'customerOrgName'>> & {
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

/* ------------------------------ Atrium Monitor ----------------------------- */

export type MonitorSeverity = 'critical' | 'warning' | 'info'

export type MonitorFeedAlert = {
  id: string
  kind: 'delivery' | 'error' | 'uptime'
  severity: MonitorSeverity
  title: string
  body: string
  projectId: string
  projectName: string
  at: string
  ref?: string
}

export type MonitorOverview = {
  last24hLogs: number
  openErrors: number
  liveUsers: number
  transactionAvgMs: number
  transactionCount: number
  httpErrors: number
  vitals: Record<string, number>
  uptimeOk: number
  uptimeFail: number
}

export type MonitorUptimeSummary = {
  id: string
  name: string
  url: string
  up: boolean | null
  latencyMs?: number
  okRate: number | null
  samples: Array<{ ok: boolean; latencyMs?: number; at: string }>
}

export type MonitorFeed = {
  available: boolean
  reason?: string
  generatedAt: string
  projects: Array<{
    id: string
    name: string
    key: string
    overview: MonitorOverview | null
    uptime: MonitorUptimeSummary[]
  }>
  alerts: MonitorFeedAlert[]
  totals: {
    openErrors: number
    liveUsers: number
    httpErrors: number
    uptimeDown: number
    alerts24h: number
  }
}

export type MonitorErrorGroup = {
  _id: string
  type?: string
  message: string
  sampleStack?: string
  kind?: string
  count: number
  status: 'open' | 'resolved'
  firstSeen?: string
  lastSeen?: string
  appId?: string
  environmentId?: string
  acknowledgedAt?: string | null
  snoozedUntil?: string | null
  regressedAt?: string | null
  linkedIssueKey?: string
  linkedProjectId?: string
}

export type MonitorLogRow = {
  _id: string
  level: string
  message: string
  release?: string
  meta?: unknown
  timestamp: string
}

export type MonitorHttpRow = {
  _id: string
  method: string
  url: string
  status?: number
  durationMs?: number
  direction?: 'in' | 'out'
  timestamp: string
}

export type MonitorTransactionRow = {
  _id: string
  name: string
  durationMs: number
  status?: string
  timestamp: string
}

export type MonitorPresenceRow = {
  _id: string
  sessionId: string
  userId?: string
  page?: string
  userAgent?: string
  lastSeen: string
}

export type MonitorReleaseRow = {
  _id: string
  version: string
  firstSeen?: string
  appId?: string
}

export type MonitorUptimeCheck = {
  _id: string
  name: string
  url: string
  method?: string
  expectedStatus?: number
  intervalMinutes?: number
  enabled?: boolean
}

export const ALERT_TRIGGERS = [
  { id: 'error_new', label: 'New error', icon: 'bug' },
  { id: 'error_spike', label: 'Error spike', icon: 'trending-up' },
  { id: 'log_level', label: 'Log level', icon: 'document-text' },
  { id: 'http_status', label: 'HTTP status', icon: 'swap-horizontal' },
  { id: 'transaction_slow', label: 'Slow transaction', icon: 'speedometer' },
  { id: 'vital_threshold', label: 'Web vital', icon: 'pulse' },
  { id: 'uptime_down', label: 'Uptime down', icon: 'cloud-offline' },
  { id: 'event_name', label: 'Custom event', icon: 'flash' },
  { id: 'new_release', label: 'New release', icon: 'rocket' },
] as const

export type AlertTrigger = (typeof ALERT_TRIGGERS)[number]['id']

export type MonitorAlertRule = {
  _id: string
  name: string
  enabled: boolean
  trigger: AlertTrigger
  environmentId?: string | null
  appId?: string | null
  recipients: string[]
  cooldownMinutes: number
  lastFiredAt?: string
  lastError?: string
  fireCount: number
  subjectTemplate?: string
  bodyTemplate?: string
  conditions: {
    logLevels?: string[]
    messageContains?: string
    minCount?: number
    windowMinutes?: number
    httpStatusMin?: number
    httpStatusMax?: number
    durationMs?: number
    vitalName?: string
    vitalGte?: number
    eventName?: string
    uptimeFailStreak?: number
  }
}

export type MonitorAlertDelivery = {
  _id: string
  ruleId: string
  trigger?: string
  subject?: string
  recipients: string[]
  summary?: string
  ok: boolean
  error?: string
  timestamp: string
}

type MonitorQuery = {
  q?: string
  level?: string
  status?: string
  limit?: number
  environmentId?: string
  appId?: string
}

function qs(o: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const mp = (projectId: string, rest = '') =>
  `/api/admin/monitor/projects/${encodeURIComponent(projectId)}${rest}`

export const monitorApi = {
  feed: () => request<MonitorFeed>('/api/admin/monitor/feed'),
  overview: (pid: string) => request<MonitorOverview>(mp(pid, '/overview')),
  errors: (pid: string, o: MonitorQuery = {}) =>
    request<MonitorErrorGroup[]>(mp(pid, `/errors${qs(o)}`)),
  errorGroup: (pid: string, id: string) =>
    request<MonitorErrorGroup>(mp(pid, `/errors/${encodeURIComponent(id)}`)),
  createIssueFromError: (pid: string, id: string, pmProjectId: string) =>
    request<{ issueId: string; issueKey?: string; projectId: string }>(mp(pid, `/errors/${encodeURIComponent(id)}/issue`), {
      method: 'POST',
      body: JSON.stringify({ pmProjectId }),
    }),
  patchErrorGroup: (pid: string, id: string, body: { acknowledged?: boolean; snoozeMinutes?: number }) =>
    request<MonitorErrorGroup>(mp(pid, `/errors/${encodeURIComponent(id)}`), { method: 'PATCH', body: JSON.stringify(body) }),
  setErrorStatus: (pid: string, id: string, status: 'open' | 'resolved') =>
    request<MonitorErrorGroup>(mp(pid, `/errors/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  logs: (pid: string, o: MonitorQuery = {}) => request<MonitorLogRow[]>(mp(pid, `/logs${qs(o)}`)),
  http: (pid: string, o: MonitorQuery = {}) => request<MonitorHttpRow[]>(mp(pid, `/http${qs(o)}`)),
  transactions: (pid: string, o: MonitorQuery = {}) =>
    request<MonitorTransactionRow[]>(mp(pid, `/transactions${qs(o)}`)),
  liveUsers: (pid: string) => request<MonitorPresenceRow[]>(mp(pid, '/live-users')),
  releases: (pid: string) => request<MonitorReleaseRow[]>(mp(pid, '/releases')),
  uptime: (pid: string) => request<MonitorUptimeCheck[]>(mp(pid, '/uptime')),
  createUptime: (
    pid: string,
    body: { name: string; url: string; method?: string; expectedStatus?: number; intervalMinutes?: number }
  ) => request<MonitorUptimeCheck>(mp(pid, '/uptime'), { method: 'POST', body: JSON.stringify(body) }),
  deleteUptime: (pid: string, id: string) =>
    request<{ ok: boolean }>(mp(pid, `/uptime/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  alertRules: (pid: string) => request<MonitorAlertRule[]>(mp(pid, '/alerts')),
  createAlertRule: (pid: string, body: Partial<MonitorAlertRule>) =>
    request<MonitorAlertRule>(mp(pid, '/alerts'), { method: 'POST', body: JSON.stringify(body) }),
  updateAlertRule: (pid: string, id: string, body: Partial<MonitorAlertRule>) =>
    request<MonitorAlertRule>(mp(pid, `/alerts/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAlertRule: (pid: string, id: string) =>
    request<{ ok: boolean }>(mp(pid, `/alerts/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  testAlertRule: (pid: string, id: string) =>
    request<{ ok: boolean }>(mp(pid, `/alerts/${encodeURIComponent(id)}/test`), { method: 'POST' }),
  deliveries: (pid: string, ruleId?: string) =>
    request<MonitorAlertDelivery[]>(mp(pid, `/alert-deliveries${qs({ ruleId })}`)),
}

/* ---------------------------------- push ---------------------------------- */

export const pushApi = {
  register: (body: { token: string; platform: string; deviceName?: string; kinds?: string[] }) =>
    request<unknown>('/api/admin/push/register', { method: 'POST', body: JSON.stringify(body) }),
  unregister: (token: string) =>
    request<unknown>('/api/admin/push/unregister', { method: 'POST', body: JSON.stringify({ token }) }),
  test: (token?: string) =>
    request<{ sent: number }>('/api/admin/push/test', { method: 'POST', body: JSON.stringify({ token }) }),
}

/* -------------------------------- assistant -------------------------------- */

export type AssistantResult = { action: string; reply: string; data?: Record<string, unknown> }

export const assistantApi = {
  /** mode 'chat' = longer text answers; the assistant reads/updates Atrium via server-side tools. */
  command: (text: string, mode: 'chat' | 'voice' = 'chat') =>
    request<AssistantResult>('/api/admin/voice/command', { method: 'POST', body: JSON.stringify({ text, mode }) }),
  transcribe: (audioBase64: string, mimetype: string, language?: 'en' | 'ml' | 'auto') =>
    request<{ text: string; language?: string }>('/api/admin/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimetype, language }),
    }),
  speak: (text: string, lang: 'en' | 'ml' = 'en') =>
    request<{ mimetype: string; filename: string; audioBase64: string }>('/api/admin/voice/speak', {
      method: 'POST',
      body: JSON.stringify({ text, lang }),
    }),
}
