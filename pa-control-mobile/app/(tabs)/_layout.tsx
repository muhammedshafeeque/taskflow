import { Ionicons } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import type { ColorValue } from 'react-native'
import { useAuth } from '../../src/auth/AuthContext'
import { colors, fonts } from '../../src/theme'
import { Loading } from '../../src/ui/Ui'

type IconName = React.ComponentProps<typeof Ionicons>['name']

function tabIcon(name: IconName, focusedName: IconName) {
  return ({
    color,
    size,
    focused,
  }: {
    color: ColorValue
    size: number
    focused: boolean
  }) => (
    <Ionicons
      name={focused ? focusedName : name}
      size={size}
      color={typeof color === 'string' ? color : colors.muted}
    />
  )
}

export default function TabsLayout() {
  const { ready, unlocked } = useAuth()
  if (!ready) return <Loading />
  if (!unlocked) return <Redirect href="/unlock" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.border,
          height: 62,
          paddingTop: 4,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontFamily: fonts.semiBold,
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('grid-outline', 'grid'),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: tabIcon('chatbubbles-outline', 'chatbubbles'),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: tabIcon('people-outline', 'people'),
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: 'Support',
          tabBarIcon: tabIcon('headset-outline', 'headset'),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: tabIcon('document-text-outline', 'document-text'),
        }}
      />
      <Tabs.Screen
        name="agent"
        options={{
          title: 'Agent',
          tabBarIcon: tabIcon('desktop-outline', 'desktop'),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'Leads',
          tabBarIcon: tabIcon('person-add-outline', 'person-add'),
        }}
      />
      <Tabs.Screen
        name="atrium"
        options={{
          title: 'Atrium',
          tabBarIcon: tabIcon('globe-outline', 'globe'),
        }}
      />
    </Tabs>
  )
}
