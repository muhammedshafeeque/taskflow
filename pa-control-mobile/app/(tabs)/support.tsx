import { useCallback, useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import EventSource from 'react-native-sse'
import {
  type SupportCaseRow,
  type SupportEventRow,
  paAdmin,
  supportEventsUrl,
} from '../../src/api/paAdmin'
import { colors, fonts, spacing } from '../../src/theme'
import {
  Badge,
  Btn,
  EmptyState,
  ErrorText,
  ListRow,
  Loading,
  PageHeader,
  Panel,
  Screen,
  SectionLabel,
} from '../../src/ui/Ui'

export default function SupportScreen() {
  const [cases, setCases] = useState<SupportCaseRow[]>([])
  const [events, setEvents] = useState<SupportEventRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await paAdmin.listSupportCases()
      setCases(data.cases || [])
      setEvents(data.events || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource(supportEventsUrl()) as EventSource
      setLive(true)
      const onSupport = (event: { data?: string | null }) => {
        if (!event.data) return
        try {
          const parsed = JSON.parse(String(event.data)) as SupportEventRow
          setEvents((prev) => [parsed, ...prev].slice(0, 100))
          void load()
        } catch {
          // ignore bad payloads
        }
      }
      ;(es as unknown as { addEventListener: (t: string, cb: typeof onSupport) => void }).addEventListener(
        'support',
        onSupport
      )
      es.addEventListener('error', () => setLive(false))
    } catch {
      setLive(false)
    }
    return () => {
      es?.close()
      setLive(false)
    }
  }, [load])

  if (loading) return <Loading />

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <PageHeader
        title="Support"
        subtitle={`Cases and live agent events · ${live ? 'live' : 'offline'}`}
        right={
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Badge label={live ? 'Live' : 'Offline'} tone={live ? 'ok' : 'warn'} />
            <Btn label="Refresh" variant="ghost" compact onPress={() => void load()} />
          </View>
        }
      />
      <ErrorText>{error}</ErrorText>

      <FlatList
        data={events}
        keyExtractor={(item, i) => item.id || `${item.at}-${i}`}
        contentContainerStyle={{ paddingBottom: 40, gap: spacing.sm }}
        ListHeaderComponent={
          <View>
            <SectionLabel>Cases</SectionLabel>
            {cases.length === 0 ? (
              <EmptyState message="No open support cases" />
            ) : (
              cases.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.groupName || item.groupId}
                  meta={`${item.status} · ${item.lastQaStatus || '—'} · tickets ${item.ticketIds?.length || 0}`}
                />
              ))
            )}
            <SectionLabel>Live events</SectionLabel>
          </View>
        }
        ListEmptyComponent={<EmptyState message="No events yet" />}
        renderItem={({ item }) => (
          <Panel>
            <Badge label={item.type} tone="accent" />
            <Text style={styles.meta}>
              {item.groupName || item.groupId || '—'}
              {item.agent ? ` · ${item.agent}` : ''}
              {item.at ? ` · ${item.at}` : ''}
            </Text>
            {item.summary ? <Text style={styles.body}>{item.summary}</Text> : null}
          </Panel>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  meta: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 12,
  },
  body: {
    fontFamily: fonts.regular,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
})
