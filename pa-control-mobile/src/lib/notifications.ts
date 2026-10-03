import * as BackgroundTask from 'expo-background-task'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { loadAuthFromStore, monitorApi, pushApi, type MonitorFeedAlert } from '../api/paAdmin'
import { alertPassesPrefs, diffNewAlerts, loadCursor, saveCursor } from './alertWatch'
import { getPrefs, loadPrefs } from './prefs'

export const ALERT_TASK = 'pa-monitor-alert-poll'
const ALERT_CHANNEL = 'alerts'

let configured = false

export function configureNotifications() {
  if (configured || Platform.OS === 'web') return
  configured = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  })
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
      name: 'Monitor alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#F87171',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }).catch(() => {})
  }
}

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  const cur = await Notifications.getPermissionsAsync()
  if (cur.granted) return true
  const next = await Notifications.requestPermissionsAsync()
  return next.granted
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  const id = extra?.eas?.projectId || Constants.easConfig?.projectId || ''
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export type PushRegistration = { ok: true; token: string } | { ok: false; reason: string }

/** Registers this device with PA for server-side Expo pushes (works when the app is closed). */
export async function registerRemotePush(): Promise<PushRegistration> {
  if (Platform.OS === 'web') return { ok: false, reason: 'Push is not available on web' }
  if (!Device.isDevice) return { ok: false, reason: 'Remote push needs a physical device' }
  if (!(await ensurePermission())) return { ok: false, reason: 'Notification permission denied' }
  const projectId = easProjectId()
  if (!projectId) {
    return {
      ok: false,
      reason: 'Set a real EAS projectId in app.json (extra.eas.projectId) to enable remote push. Local alert polling still works.',
    }
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    const prefs = getPrefs()
    await pushApi.register({
      token,
      platform: Platform.OS,
      deviceName: Device.deviceName || Device.modelName || 'Mobile',
      kinds: prefs.criticalOnly ? ['critical'] : prefs.notifyKinds,
    })
    return { ok: true, token }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Push registration failed' }
  }
}

export async function notifyLocal(a: MonitorFeedAlert) {
  if (Platform.OS === 'web') return
  const dot = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : '🔵'
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${dot} ${a.projectName} · ${a.title}`,
      body: a.body || a.title,
      data: { kind: a.kind, alertId: a.id, projectId: a.projectId, ref: a.ref ?? '' },
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL } : null,
  }).catch(() => {})
}

/** Poll feed once and raise local notifications for anything new. Shared by foreground + background. */
export async function pollAndNotify(opts: { notify: boolean }): Promise<MonitorFeedAlert[]> {
  const feed = await monitorApi.feed()
  if (!feed.available) return []
  const cursor = await loadCursor()
  const { fresh, next } = diffNewAlerts(feed, cursor)
  await saveCursor(next)
  const prefs = getPrefs()
  const wanted = fresh.filter((a) => alertPassesPrefs(a, prefs))
  if (opts.notify && prefs.notifications) {
    for (const a of wanted.slice(0, 5)) await notifyLocal(a)
  }
  return wanted
}

// Must be defined at module scope so the OS can wake the JS runtime for it.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(ALERT_TASK, async () => {
    try {
      const auth = await loadAuthFromStore()
      if (!auth.secret) return BackgroundTask.BackgroundTaskResult.Success
      await loadPrefs()
      if (!getPrefs().notifications) return BackgroundTask.BackgroundTaskResult.Success
      await pollAndNotify({ notify: true })
      return BackgroundTask.BackgroundTaskResult.Success
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed
    }
  })
}

export async function setBackgroundPolling(enabled: boolean) {
  if (Platform.OS === 'web') return
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(ALERT_TASK)
    if (enabled && !registered) {
      await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 15 })
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(ALERT_TASK)
    }
  } catch {
    // background tasks unavailable (Expo Go / web)
  }
}
