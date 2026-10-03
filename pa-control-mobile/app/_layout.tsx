import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans'
import * as Notifications from 'expo-notifications'
import { router, Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { AuthProvider, useAuth } from '../src/auth/AuthContext'
import {
  configureNotifications,
  registerRemotePush,
  setBackgroundPolling,
} from '../src/lib/notifications'
import { getPrefs } from '../src/lib/prefs'
import { AlertsProvider } from '../src/state/AlertsContext'
import { colors } from '../src/theme'
import { BiometricGate } from '../src/ui/BiometricGate'
import { ToastProvider } from '../src/ui/Toast'
import { Loading } from '../src/ui/Ui'

SplashScreen.preventAutoHideAsync().catch(() => {})
configureNotifications()

function NotificationBridge() {
  const { unlocked } = useAuth()

  useEffect(() => {
    if (!unlocked || Platform.OS === 'web') return
    const prefs = getPrefs()
    void setBackgroundPolling(prefs.notifications)
    if (prefs.notifications) void registerRemotePush()
  }, [unlocked])

  useEffect(() => {
    if (Platform.OS === 'web') return
    const open = (data: Record<string, unknown> | undefined) => {
      const kind = String(data?.kind || '')
      const projectId = String(data?.projectId || '')
      const ref = String(data?.ref || '')
      if (kind === 'error' && projectId && ref) {
        router.push({ pathname: '/monitor/error', params: { projectId, groupId: ref } })
      } else {
        router.push('/(tabs)/alerts')
      }
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data as Record<string, unknown>)
    )
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) open(r.notification.request.content.data as Record<string, unknown>)
    })
    return () => sub.remove()
  }, [])

  return null
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {})
  }, [fontsLoaded])

  if (!fontsLoaded) return <Loading />

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <ToastProvider>
          <AlertsProvider>
            <StatusBar style="light" />
            <NotificationBridge />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="unlock" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[chatId]" />
              <Stack.Screen name="monitor/error" />
              <Stack.Screen name="assistant" options={{ animation: 'slide_from_bottom' }} />
            </Stack>
            <BiometricGate />
          </AlertsProvider>
        </ToastProvider>
      </AuthProvider>
    </View>
  )
}
