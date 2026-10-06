import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { defaultAtriumUrl } from './paAdmin'

/**
 * Direct Atrium access as *you* (not the shared PA admin secret), using a
 * personal API token from Atrium → Profile → API tokens.
 */
const TOKEN_KEY = 'atrium_api_token'
const URL_KEY = 'atrium_api_url'

let token = ''
let baseUrl = defaultAtriumUrl()

async function get(key: string) {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(key)
}

async function set(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key)
      else globalThis.localStorage?.setItem(key, value)
    } catch {
      // ignore
    }
    return
  }
  if (value === null) await SecureStore.deleteItemAsync(key)
  else await SecureStore.setItemAsync(key, value)
}

export async function loadAtriumAuth(): Promise<{ connected: boolean; baseUrl: string }> {
  const [t, u] = await Promise.all([get(TOKEN_KEY), get(URL_KEY)])
  token = (t || '').trim()
  baseUrl = (u || defaultAtriumUrl()).replace(/\/$/, '')
  return { connected: Boolean(token), baseUrl }
}

export function atriumConnected(): boolean {
  return Boolean(token)
}

export function atriumBaseUrl(): string {
  return baseUrl
}

async function request<T>(path: string, init: RequestInit = {}, override?: { token: string; baseUrl: string }): Promise<T> {
  const t = override?.token ?? token
  const b = override?.baseUrl ?? baseUrl
  if (!t) throw new Error('Connect your Atrium account in Settings first')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(`${b}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(init.headers || {}) },
    })
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string; data?: T }
    if (!res.ok || json.success === false) throw new Error(json.message || json.error || `Request failed (${res.status})`)
    return json.data as T
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Atrium did not respond — check the URL')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function connectAtrium(newToken: string, newBaseUrl: string): Promise<{ name: string; email: string }> {
  const t = newToken.trim()
  const b = (newBaseUrl.trim() || defaultAtriumUrl()).replace(/\/$/, '')
  if (!t.startsWith('atr_')) throw new Error('Paste a personal API token (starts with atr_)')
  const me = await request<{ user?: { name: string; email: string }; name?: string; email?: string }>('/auth/me', {}, { token: t, baseUrl: b })
  token = t
  baseUrl = b
  await Promise.all([set(TOKEN_KEY, t), set(URL_KEY, b)])
  const u = me.user ?? (me as { name: string; email: string })
  return { name: u.name, email: u.email }
}

export async function disconnectAtrium(): Promise<void> {
  token = ''
  await Promise.all([set(TOKEN_KEY, null), set(URL_KEY, null)])
}

export type MyIssue = {
  _id: string
  key?: string
  title: string
  status: string
  priority: string
  type: string
  dueDate?: string
  projectId: string
  projectName?: string
  projectKey?: string
  statuses: string[]
}

export type MyWork = {
  loggedTodayMinutes: number
  counts: { open: number; overdue: number; dueThisWeek: number }
  issues: MyIssue[]
}

export type AgendaEvent = {
  _id: string
  title: string
  kind: string
  start: string
  end?: string
  allDay?: boolean
  location?: string
  meetingUrl?: string
  accountId?: { name: string } | null
}

export type Pipeline = {
  _id: string
  name: string
  isDefault: boolean
  stages: Array<{ _id: string; name: string; order: number; probability: number; isWon: boolean; isLost: boolean }>
}

export type Deal = {
  _id: string
  title: string
  value: number
  currency: string
  status: 'open' | 'won' | 'lost'
  stageId: string
  pipelineId: string
  expectedCloseDate?: string
  customerOrgId?: { name: string } | null
}

export const atrium = {
  myWork: () => request<MyWork>('/me/work'),
  setStatus: (issueId: string, status: string) =>
    request(`/me/work/${issueId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  logTime: (issueId: string, minutes: number, note?: string) =>
    request(`/me/work/${issueId}/time`, { method: 'POST', body: JSON.stringify({ minutes, note }) }),
  agenda: (days = 7) => request<AgendaEvent[]>(`/me/agenda?days=${days}`),
  pipelines: () => request<Pipeline[]>('/crm/pipelines'),
  deals: () => request<Deal[]>('/crm/deals?status=open'),
  moveDeal: (id: string, stageId: string) => request<Deal>(`/crm/deals/${id}`, { method: 'PATCH', body: JSON.stringify({ stageId }) }),
}
