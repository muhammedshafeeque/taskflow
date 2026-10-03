import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { Platform, StyleSheet, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../../src/auth/AuthContext'
import { haptic } from '../../src/lib/haptics'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts } from '../../src/theme'
import { Loading, type IconName } from '../../src/ui/Ui'

function tabIcon(name: IconName, focusedName: IconName) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons
      name={focused ? focusedName : name}
      size={size - 1}
      color={typeof color === 'string' ? color : colors.muted}
    />
  )
}

/** Screens reachable from "More" — routed inside tabs so the tab bar stays visible. */
const HIDDEN = ['groups', 'support', 'requests', 'agent', 'leads', 'atrium', 'settings'] as const

export default function TabsLayout() {
  const { ready, unlocked } = useAuth()
  const { unread, feed } = useAlerts()
  const insets = useSafeAreaInsets()
  if (!ready) return <Loading />
  if (!unlocked) return <Redirect href="/unlock" />

  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 62 + (Platform.OS === 'ios' ? insets.bottom : Math.max(insets.bottom, 6)),
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? insets.bottom : Math.max(insets.bottom, 6),
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semiBold, fontSize: 11 },
        tabBarBadgeStyle: {
          backgroundColor: colors.danger,
          fontFamily: fonts.bold,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen
        name="chats"
        options={{ title: 'Inbox', tabBarIcon: tabIcon('chatbubbles-outline', 'chatbubbles') }}
      />
      <Tabs.Screen
        name="monitor"
        options={{
          title: 'Monitor',
          tabBarIcon: tabIcon('pulse-outline', 'pulse'),
          tabBarBadge: feed?.totals.uptimeDown ? '!' : undefined,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarIcon: tabIcon('notifications-outline', 'notifications'),
          tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('apps-outline', 'apps') }}
      />
      {HIDDEN.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  )
}
