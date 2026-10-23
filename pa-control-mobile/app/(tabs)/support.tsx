import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import EventSource from 'react-native-sse'
import {
  type SupportCaseRow,
  type SupportEventRow,
  paAdmin,
  supportEventsUrl,
} from '../../src/api/paAdmin'
import { humanize, timeAgo } from '../../src/lib/format'
import { colors, fonts, spacing, type Tone } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Badge,
  Card,
  EmptyState,
  Header,
  IconTile,
  ListRow,
  Screen,
  ScreenScroll,
  Segmented,
  SkeletonList,
  StatGrid,
  StatTile,
  StatusDot,
  Wrap,
} from '../../src/ui/Ui'

function caseTone(status: string): Tone {
  if (/closed|resolved|done/i.test(status)) return 'ok'
  if (/escalat|fail|block/i.test(status)) return 'danger'
  if (/wait|pending|qa/i.test(status)) return 'warn'
  return 'accent'
}

function priorityTone(p?: string): Tone {
  if (!p) return 'neutral'
  if (/critical|urgent|p0|highest/i.test(p)) return 'danger'
  if (/high|p1/i.test(p)) return 'warn'
  return 'neutral'
}

export default function SupportScreen() {
  const toast = useToast()
  const [cases, setCases] = useState<SupportCaseRow[]>([])
  const [events, setEvents] = useState<SupportEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [tab, setTab] = useState<'feed' | 'open' | 'closed'>('feed')

  const load = useCallback(async () => {
    try {
      const data = await paAdmin.listSupportCases()
      setCases(data.cases || [])
      setEvents((prev) => (prev.length ? prev : data.events || []))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load support')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false
    void (async () => {
      try {
        const url = await supportEventsUrl()
        if (cancelled) return
        es = new EventSource(url) as EventSource
        es.addEventListener('open', () => setLive(true))
        const onSupport = (event: { data?: string | null }) => {
          if (!event.data) return
          try {
            const parsed = JSON.parse(String(event.data)) as SupportEventRow
            setEvents((prev) =>
              [parsed, ...prev.filter((e) => e.id !== parsed.id)].slice(0, 150)
            )
            setLive(true)
          } catch {
            // ignore bad payloads
          }
        }
        ;(
          es as unknown as {
            addEventListener: (t: string, cb: typeof onSupport) => void
          }
        ).addEventListener('support', onSupport)
        es.addEventListener('error', () => setLive(false))
      } catch {
        if (!cancelled) setLive(false)
      }
    })()
    return () => {
      cancelled = true
      es?.close()
      setLive(false)
    }
  }, [])

  const open = useMemo(() => cases.filter((c) => !/closed|resolved/i.test(c.status)), [cases])
  const closed = useMemo(() => cases.filter((c) => /closed|resolved/i.test(c.status)), [cases])
  const escalated = open.filter((c) => caseTone(c.status) === 'danger').length
  const tickets = cases.reduce((n, c) => n + (c.ticketIds?.length || 0), 0)

  return (
    <Screen>
      <Header
        title="Support"
        subtitle="AI support agents across WhatsApp groups"
        back
        right={
          <View style={styles.live}>
            <StatusDot tone={live ? 'ok' : 'neutral'} pulse={live} />
            <Text style={[styles.liveText, { color: live ? colors.ok : colors.muted }]}>{live ? 'LIVE' : 'OFFLINE'}</Text>
          </View>
        }
      />
      <ScreenScroll onRefresh={load}>
        <StatGrid>
          <StatTile label="Open cases" value={open.length} icon="folder-open" tone="accent" />
          <StatTile label="Escalated" value={escalated} icon="flame" tone={escalated ? 'danger' : 'neutral'} />
          <StatTile label="Tickets created" value={tickets} icon="ticket" tone="info" />
          <StatTile label="Resolved" value={closed.length} icon="checkmark-done" tone="ok" />
        </StatGrid>
        <Segmented
          style={{ marginHorizontal: 0, marginTop: spacing.md }}
          value={tab}
          onChange={setTab}
          options={[
            { id: 'feed', label: 'Live feed' },
            { id: 'open', label: 'Open', count: open.length },
            { id: 'closed', label: 'Closed' },
          ]}
        />
        {loading ? <SkeletonList count={5} /> : null}
        <View style={{ gap: spacing.sm }}>
          {tab === 'feed'
            ? events.map((e, i) => (
                <Card key={e.id || `${e.at}-${i}`} style={{ gap: 6 }}>
                  <View style={styles.evHead}>
                    <IconTile icon="pulse" tone="accent" size={30} />
                    <Text style={styles.evType} numberOfLines={1}>
                      {humanize(e.type)}
                    </Text>
                    <Text style={styles.evTime}>{timeAgo(e.at)}</Text>
                  </View>
                  {e.summary ? <Text style={styles.evBody}>{e.summary}</Text> : null}
                  <Wrap>
                    {e.groupName || e.groupId ? <Badge label={e.groupName || e.groupId || ''} tone="neutral" icon="people" /> : null}
                    {e.agent ? <Badge label={humanize(e.agent)} tone="accent" icon="sparkles" /> : null}
                    {e.ticketId ? <Badge label={e.ticketId} tone="info" icon="ticket" /> : null}
                    {e.priority ? <Badge label={e.priority} tone={priorityTone(e.priority)} /> : null}
                    {e.qaStatus ? <Badge label={`QA ${e.qaStatus}`} tone={/pass|ok/i.test(e.qaStatus) ? 'ok' : 'warn'} /> : null}
                  </Wrap>
                </Card>
              ))
            : (tab === 'open' ? open : closed).map((c) => (
                <ListRow
                  key={c.id}
                  leading={<IconTile icon="chatbox-ellipses" tone={caseTone(c.status)} size={38} />}
                  title={c.groupName || c.groupId}
                  subtitle={`${humanize(c.latestAgent || 'agent')} · ${humanize(c.latestAgentStatus || c.status)}`}
                  meta={`${c.ticketIds?.length || 0} tickets · QA ${c.lastQaStatus || '—'} · ${timeAgo(c.updatedAt)}`}
                  trailing={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Badge label={humanize(c.status)} tone={caseTone(c.status)} />
                      {c.lastPriority ? <Badge label={c.lastPriority} tone={priorityTone(c.lastPriority)} /> : null}
                    </View>
                  }
                />
              ))}
          {!loading && tab === 'feed' && !events.length ? <EmptyState icon="pulse-outline" message="No events yet. They stream in live." /> : null}
          {!loading && tab !== 'feed' && !(tab === 'open' ? open : closed).length ? (
            <EmptyState icon="folder-open-outline" message={`No ${tab} cases.`} />
          ) : null}
        </View>
      </ScreenScroll>
    </Screen>
  )
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  liveText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 },
  evHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  evType: { flex: 1, fontFamily: fonts.semiBold, color: colors.text, fontSize: 14 },
  evTime: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11 },
  evBody: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 14, lineHeight: 20 },
})
