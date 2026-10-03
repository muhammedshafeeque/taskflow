import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export type AlertKindPref = 'delivery' | 'error' | 'uptime'

export type Prefs = {
  haptics: boolean
  biometricLock: boolean
  /** Re-lock after the app has been in background this many minutes (0 = every time). */
  relockMinutes: number
  notifications: boolean
  notifyKinds: AlertKindPref[]
  criticalOnly: boolean
  pollSeconds: number
  monitorProjectId: string
}

export const DEFAULT_PREFS: Prefs = {
  haptics: true,
  biometricLock: false,
  relockMinutes: 5,
  notifications: true,
  notifyKinds: ['delivery', 'error', 'uptime'],
  criticalOnly: false,
  pollSeconds: 60,
  monitorProjectId: '',
}

const KEY = 'pa_mobile_prefs_v1'

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  }
  return SecureStore.getItemAsync(key)
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      // ignore
    }
    return
  }
  await SecureStore.setItemAsync(key, value)
}

let cache: Prefs = { ...DEFAULT_PREFS }
const listeners = new Set<(p: Prefs) => void>()

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await read(KEY)
    cache = raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULT_PREFS }
  } catch {
    cache = { ...DEFAULT_PREFS }
  }
  listeners.forEach((l) => l(cache))
  return cache
}

export function getPrefs(): Prefs {
  return cache
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  cache = { ...cache, ...patch }
  listeners.forEach((l) => l(cache))
  await write(KEY, JSON.stringify(cache))
  return cache
}

export function subscribePrefs(fn: (p: Prefs) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Small JSON k/v for non-secret app state (seen alert ids etc). */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await read(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await write(key, JSON.stringify(value))
  } catch {
    // SecureStore has a ~2KB soft limit per value on some devices; callers keep payloads small.
  }
}
