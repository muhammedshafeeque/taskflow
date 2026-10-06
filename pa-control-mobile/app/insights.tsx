import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { type ChatAnalytics, paAdmin } from '../src/api/paAdmin'
import { compact } from '../src/lib/format'
import { colors, fonts, spacing } from '../src/theme'
import { MiniBars } from '../src/ui/Charts'
import { useToast } from '../src/ui/Toast'
import { Card, Header, Screen, ScreenScroll, Section, Segmented, Skeleton, StatGrid, StatTile } from '../src/ui/Ui'

type Range = '7' | '30' | '90'

function duration(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Breakdown({ data, labels }: { data: Record<string, number>; labels?: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  if (!rows.length) return <Text style={styles.muted}>No data yet.</Text>
  return (
    <View style={{ gap: 8 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ gap: 4 }}>
          <View style={styles.row}>
            <Text style={styles.label}>{labels?.[k] ?? k}</Text>
            <Text style={styles.muted}>
              {v} · {pct(total ? v / total : 0)}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${total ? (v / total) * 100 : 0}%` }]} />
          </View>
        </View>
      ))}
    </View>
  )
}

export default function InsightsScreen() {
  const toast = useToast()
  const [range, setRange] = useState<Range>('30')
  const [data, setData] = useState<ChatAnalytics | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await paAdmin.analytics(Number(range)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load insights')
    }
  }, [range, toast])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])

  const t = data?.totals
  return (
    <Screen>
      <Header title="Insights" subtitle="WhatsApp bot performance" back />
      <ScreenScroll onRefresh={load}>
        <Segmented
          options={[
            { id: '7', label: '7 days' },
            { id: '30', label: '30 days' },
            { id: '90', label: '90 days' },
          ]}
          value={range}
          onChange={setRange}
        />
        {!data || !t ? (
          <>
            <Skeleton height={160} style={{ marginTop: spacing.md }} />
            <Skeleton height={120} style={{ marginTop: spacing.md }} />
          </>
        ) : (
          <>
            <Section title="Overview">
              <StatGrid>
                <StatTile label="Active chats" value={compact(t.activeChats)} hint={`${t.pausedChats} paused now`} icon="chatbubbles" tone="accent" />
                <StatTile label="Messages in" value={compact(t.inbound)} hint={`${compact(t.botReplies)} bot · ${compact(t.humanReplies)} human`} icon="mail" tone="info" />
                <StatTile label="Median reply" value={duration(data.responseTimeSec.median)} hint={`p90 ${duration(data.responseTimeSec.p90)}`} icon="timer" tone="ok" />
                <StatTile label="Leads" value={t.leads} hint={`${t.leadsInCrm} in CRM · ${pct(data.leadConversionRate)} of chats`} icon="person-add" tone="warn" />
                <StatTile label="Human takeover" value={pct(data.humanTakeoverRate)} hint="Chats you replied to" icon="hand-left" tone="neutral" />
              </StatGrid>
            </Section>

            <Section title="Messages per day">
              <Card style={{ gap: spacing.sm }}>
                <MiniBars values={data.daily.map((d) => d.inbound)} height={70} />
                <View style={styles.row}>
                  <Text style={styles.muted}>{data.daily[0]?.date}</Text>
                  <Text style={styles.muted}>{data.daily[data.daily.length - 1]?.date}</Text>
                </View>
              </Card>
            </Section>

            <Section title="Leads per day">
              <Card>
                <MiniBars values={data.daily.map((d) => d.leads)} height={50} color={colors.warn} />
              </Card>
            </Section>

            <Section title="Languages">
              <Card>
                <Breakdown data={data.languages} labels={{ ml: 'Malayalam', en: 'English' }} />
              </Card>
            </Section>

            <Section title="What people ask about">
              <Card>
                <Breakdown
                  data={data.messageTypes}
                  labels={{ project_lead: 'New project', requirement: 'Requirements', support: 'Support', greeting: 'Greeting', random: 'Other' }}
                />
              </Card>
            </Section>
            <Text style={[styles.muted, { marginTop: spacing.md, textAlign: 'center' }]}>{data.note}</Text>
          </>
        )}
      </ScreenScroll>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: fonts.medium, color: colors.text, fontSize: 13 },
  muted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.panel2, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
})
