import { useCallback, useEffect, useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { atrium, type AgendaEvent } from '../src/api/atrium'
import { colors, fonts, spacing } from '../src/theme'
import { AtriumGate } from '../src/ui/AtriumGate'
import { useToast } from '../src/ui/Toast'
import { Badge, Btn, Card, EmptyState, Header, Screen, ScreenScroll, Section } from '../src/ui/Ui'

function dayKey(iso: string) {
  return new Date(iso).toDateString()
}

function AgendaInner() {
  const toast = useToast()
  const [events, setEvents] = useState<AgendaEvent[] | null>(null)

  const load = useCallback(async () => {
    try {
      setEvents(await atrium.agenda(14))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load agenda')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const days = new Map<string, AgendaEvent[]>()
  for (const e of events ?? []) days.set(dayKey(e.start), [...(days.get(dayKey(e.start)) ?? []), e])

  return (
    <ScreenScroll onRefresh={load}>
      {events && !events.length ? <EmptyState icon="calendar-outline" title="Nothing scheduled" message="No meetings in the next two weeks." /> : null}
      {[...days.entries()].map(([day, list]) => (
        <Section key={day} title={day === new Date().toDateString() ? 'Today' : day}>
          <View style={{ gap: spacing.sm }}>
            {list.map((e) => (
              <Card key={e._id} style={{ gap: 4 }}>
                <View style={styles.row}>
                  <Text style={styles.time}>
                    {e.allDay
                      ? 'All day'
                      : `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                          e.end ? `–${new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
                        }`}
                  </Text>
                  <Badge label={e.kind} tone="info" />
                </View>
                <Text style={styles.title}>{e.title}</Text>
                {e.accountId?.name || e.location ? (
                  <Text style={styles.meta}>{[e.accountId?.name, e.location].filter(Boolean).join(' · ')}</Text>
                ) : null}
                {e.meetingUrl ? <Btn label="Join" icon="videocam" compact onPress={() => void Linking.openURL(e.meetingUrl!)} /> : null}
              </Card>
            ))}
          </View>
        </Section>
      ))}
    </ScreenScroll>
  )
}

export default function AgendaScreen() {
  return (
    <Screen>
      <Header title="Agenda" subtitle="Your meetings for the next 2 weeks" back />
      <AtriumGate>
        <AgendaInner />
      </AtriumGate>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: fonts.semiBold, color: colors.accent, fontSize: 13 },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
})
