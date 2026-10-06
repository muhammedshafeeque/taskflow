import { File, Paths } from 'expo-file-system'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

/**
 * Last-known-good copies of GET responses, so the app still shows something
 * useful with no signal. Files live in the documents directory (survives
 * restarts; the OS doesn't purge it like the cache directory).
 */
const PREFIX = 'pa-cache-'
const MAX_BYTES = 512 * 1024

function fileFor(key: string): File {
  const safe = key.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 120)
  return new File(Paths.document, `${PREFIX}${safe}.json`)
}

export function saveCache(key: string, data: unknown): void {
  if (Platform.OS === 'web') return
  try {
    const body = JSON.stringify({ savedAt: Date.now(), data })
    if (body.length > MAX_BYTES) return
    fileFor(key).write(body)
  } catch {
    // Caching is best-effort.
  }
}

export async function readCache<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  if (Platform.OS === 'web') return null
  try {
    const f = fileFor(key)
    if (!f.exists) return null
    return JSON.parse(await f.text()) as { data: T; savedAt: number }
  } catch {
    return null
  }
}

type OfflineState = { offline: boolean; since: number | null }
let state: OfflineState = { offline: false, since: null }
const listeners = new Set<(s: OfflineState) => void>()

export function setOffline(offline: boolean, dataFrom?: number): void {
  if (state.offline === offline && (!offline || state.since === (dataFrom ?? state.since))) return
  state = { offline, since: offline ? (dataFrom ?? state.since ?? Date.now()) : null }
  listeners.forEach((l) => l(state))
}

export function useOffline(): OfflineState {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}
