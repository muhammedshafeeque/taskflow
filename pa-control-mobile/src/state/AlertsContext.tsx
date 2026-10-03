import { router } from 'expo-router'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState } from 'react-native'
import { monitorApi, type MonitorFeed } from '../api/paAdmin'
import { useAuth } from '../auth/AuthContext'
import { alertPassesPrefs, diffNewAlerts, loadCursor, saveCursor, unreadCount } from '../lib/alertWatch'
import { getPrefs, subscribePrefs } from '../lib/prefs'
import { useToast } from '../ui/Toast'

type AlertsState = {
  feed: MonitorFeed | null
  error: string
  loading: boolean
  unread: number
  readAt: string
  refresh: () => Promise<void>
  markAllRead: () => Promise<void>
}

const AlertsContext = createContext<AlertsState | null>(null)

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { unlocked } = useAuth()
  const toast = useToast()
  const [feed, setFeed] = useState<MonitorFeed | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [readAt, setReadAt] = useState('')
  const [pollSeconds, setPollSeconds] = useState(getPrefs().pollSeconds)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => subscribePrefs((p) => setPollSeconds(p.pollSeconds)), [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await monitorApi.feed()
      setFeed(next)
      setError(next.available ? '' : next.reason || 'Monitor unavailable')
      if (next.available) {
        const cursor = await loadCursor()
        setReadAt(cursor.readAt)
        const { fresh, next: nextCursor } = diffNewAlerts(next, cursor)
        await saveCursor(nextCursor)
        const wanted = fresh.filter((a) => alertPassesPrefs(a, getPrefs()))
        const top = wanted.find((a) => a.severity === 'critical') || wanted[0]
        if (top) {
          toast.show({
            title: `${top.projectName} · ${top.title}`,
            message: wanted.length > 1 ? `${top.body}\n+${wanted.length - 1} more alerts` : top.body,
            tone: top.severity === 'critical' ? 'danger' : top.severity === 'warning' ? 'warn' : 'info',
            onPress: () => router.push('/(tabs)/alerts'),
          })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitor feed')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const markAllRead = useCallback(async () => {
    const cursor = await loadCursor()
    const now = new Date().toISOString()
    await saveCursor({ ...cursor, readAt: now })
    setReadAt(now)
  }, [])

  useEffect(() => {
    if (!unlocked) {
      setFeed(null)
      return
    }
    void refresh()
    const start = () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = setInterval(() => void refresh(), Math.max(20, pollSeconds) * 1000)
    }
    start()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refresh()
        start()
      } else if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    })
    return () => {
      sub.remove()
      if (timer.current) clearInterval(timer.current)
    }
  }, [unlocked, pollSeconds, refresh])

  const value = useMemo(
    () => ({ feed, error, loading, unread: unreadCount(feed, readAt), readAt, refresh, markAllRead }),
    [feed, error, loading, readAt, refresh, markAllRead]
  )
  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
}

export function useAlerts(): AlertsState {
  const ctx = useContext(AlertsContext)
  if (!ctx) throw new Error('useAlerts outside AlertsProvider')
  return ctx
}
