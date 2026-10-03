import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { paAdmin } from '../../src/api/paAdmin'
import { useAuth } from '../../src/auth/AuthContext'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts, spacing } from '../../src/theme'
import { Avatar, Btn, Card, GradientCard, Header, NavRow, Screen, ScreenScroll, Section } from '../../src/ui/Ui'

export default function MoreScreen() {
  const { baseUrl, lock } = useAuth()
  const { feed } = useAlerts()
  const [counts, setCounts] = useState({ groups: 0, requests: 0, jobs: 0, leads: 0, devicesOnline: 0 })

  useFocusEffect(
    useCallback(() => {
      void Promise.allSettled([
        paAdmin.listGroups(),
        paAdmin.listServiceRequests({ pendingOnly: true, limit: 1 }),
        paAdmin.listAgentJobs({ status: 'needs_review' }),
        paAdmin.status(),
        paAdmin.listAgentDevices(),
      ]).then(([g, r, j, s, d]) =>
        setCounts({
          groups: g.status === 'fulfilled' ? g.value.filter((x) => x.autoReplyEnabled).length : 0,
          requests: r.status === 'fulfilled' ? r.value.total ?? 0 : 0,
          jobs: j.status === 'fulfilled' ? j.value.length : 0,
          leads: s.status === 'fulfilled' ? s.value.counts.leads : 0,
          devicesOnline: d.status === 'fulfilled' ? d.value.filter((x) => x.online).length : 0,
        })
      )
    }, [])
  )

  return (
    <Screen>
      <Header title="More" subtitle="Every PA & Atrium tool" />
      <ScreenScroll>
        <GradientCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Avatar name="Admin" icon="shield-checkmark" size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Administrator</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {baseUrl.replace(/^https?:\/\//, '')}
              </Text>
            </View>
            <Btn label="Lock" icon="lock-closed" compact variant="secondary" onPress={() => void lock().then(() => router.replace('/unlock'))} />
          </View>
        </GradientCard>

        <Section title="WhatsApp">
          <View style={styles.list}>
            <NavRow icon="people" title="Groups" subtitle="Auto-reply, projects, capabilities" badge={counts.groups ? `${counts.groups} active` : undefined} onPress={() => router.push('/(tabs)/groups')} />
            <NavRow icon="headset" tone="info" title="Support" subtitle="Cases and live agent feed" onPress={() => router.push('/(tabs)/support')} />
            <NavRow icon="person-add" tone="ok" title="Leads" subtitle="WhatsApp → CRM leads" badge={counts.leads || undefined} onPress={() => router.push('/(tabs)/leads')} />
          </View>
        </Section>

        <Section title="Atrium">
          <View style={styles.list}>
            <NavRow icon="document-text" tone="warn" title="Requests & tickets" subtitle="Approve portal requests, update tickets" badge={counts.requests || undefined} onPress={() => router.push('/(tabs)/requests')} />
            <NavRow
              icon="pulse"
              tone={feed?.totals.uptimeDown ? 'danger' : 'accent'}
              title="Monitor"
              subtitle="Errors, uptime, logs, performance"
              badge={feed?.totals.openErrors ? `${feed.totals.openErrors} errors` : undefined}
              onPress={() => router.push('/(tabs)/monitor')}
            />
            <NavRow icon="notifications" tone="danger" title="Alert rules" subtitle="Create and test monitor alerts" onPress={() => router.push({ pathname: '/(tabs)/alerts', params: { view: 'rules' } })} />
            <NavRow icon="globe" tone="neutral" title="Atrium web" subtitle="Full Taskflow in-app" onPress={() => router.push('/(tabs)/atrium')} />
          </View>
        </Section>

        <Section title="Automation">
          <View style={styles.list}>
            <NavRow icon="desktop" tone="info" title="Agent" subtitle={`${counts.devicesOnline} device(s) online · fix & deploy jobs`} badge={counts.jobs ? `${counts.jobs} review` : undefined} onPress={() => router.push('/(tabs)/agent')} />
            <NavRow icon="sparkles" title="Ask PA" subtitle="Voice & text ops assistant" onPress={() => router.push('/assistant')} />
          </View>
        </Section>

        <Section title="App">
          <View style={styles.list}>
            <NavRow icon="settings" tone="neutral" title="Settings" subtitle="Notifications, security, haptics" onPress={() => router.push('/(tabs)/settings')} />
          </View>
        </Section>

        <Card style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <Text style={styles.sub}>Ivorix PA Control · v2.0</Text>
        </Card>
      </ScreenScroll>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  name: { fontFamily: fonts.bold, color: colors.text, fontSize: 17 },
  sub: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
})
