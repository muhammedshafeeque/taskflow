import type { MonitorFeed, MonitorFeedAlert } from '../api/paAdmin'
import type { Prefs } from './prefs'
import { readJson, writeJson } from './prefs'

/** Compact cursor (fits in SecureStore): newest alert time notified + currently-down uptime ids. */
export type WatchCursor = { notifiedAt: string; readAt: string; down: string[] }

const KEY = 'pa_alert_cursor_v1'

export async function loadCursor(): Promise<WatchCursor> {
  return readJson<WatchCursor>(KEY, { notifiedAt: '', readAt: '', down: [] })
}

export async function saveCursor(c: WatchCursor): Promise<void> {
  await writeJson(KEY, { ...c, down: c.down.slice(0, 40) })
}

export function alertPassesPrefs(a: MonitorFeedAlert, prefs: Prefs): boolean {
  if (prefs.criticalOnly && a.severity !== 'critical') return false
  if (prefs.notifyKinds.length && !prefs.notifyKinds.includes(a.kind)) return false
  return true
}

/**
 * Returns alerts that are new since the cursor and the next cursor.
 * First run (empty cursor) establishes a baseline and returns nothing.
 */
export function diffNewAlerts(
  feed: MonitorFeed,
  cursor: WatchCursor
): { fresh: MonitorFeedAlert[]; next: WatchCursor } {
  const nowDown = feed.alerts.filter((a) => a.kind === 'uptime' && a.ref).map((a) => a.ref as string)
  const newest = feed.alerts.reduce((m, a) => (a.at && a.at > m ? a.at : m), cursor.notifiedAt || '')
  if (!cursor.notifiedAt) {
    return { fresh: [], next: { ...cursor, notifiedAt: newest || new Date().toISOString(), down: nowDown } }
  }
  const prevDown = new Set(cursor.down)
  const fresh = feed.alerts.filter((a) =>
    a.kind === 'uptime' ? Boolean(a.ref && !prevDown.has(a.ref)) : Boolean(a.at && a.at > cursor.notifiedAt)
  )
  return { fresh, next: { ...cursor, notifiedAt: newest, down: nowDown } }
}

export function unreadCount(feed: MonitorFeed | null, readAt: string): number {
  if (!feed) return 0
  return feed.alerts.filter((a) => a.kind === 'uptime' || !readAt || (a.at && a.at > readAt)).length
}
