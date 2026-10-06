import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { atrium, type MyIssue, type MyWork } from '../src/api/atrium'
import { haptic } from '../src/lib/haptics'
import { colors, fonts, radius, spacing } from '../src/theme'
import { AtriumGate } from '../src/ui/AtriumGate'
import { useToast } from '../src/ui/Toast'
import { Badge, Btn, Card, Chip, EmptyState, Header, Screen, ScreenScroll, Section, StatGrid, StatTile, Wrap } from '../src/ui/Ui'

const QUICK_TIMES = [15, 30, 60, 120]

function dueLabel(due?: string): { text: string; overdue: boolean } | null {
  if (!due) return null
  const d = new Date(due)
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { text: `${-days}d overdue`, overdue: true }
  if (days === 0) return { text: 'due today', overdue: false }
  return { text: `due in ${days}d`, overdue: false }
}

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`
}

function MyWorkInner() {
  const toast = useToast()
  const [data, setData] = useState<MyWork | null>(null)
  const [active, setActive] = useState<MyIssue | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await atrium.myWork())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true)
    try {
      await fn()
      haptic.success()
      toast.success(msg)
      setActive(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const overdue = data?.issues.filter((i) => dueLabel(i.dueDate)?.overdue) ?? []
  const rest = data?.issues.filter((i) => !dueLabel(i.dueDate)?.overdue) ?? []

  const row = (i: MyIssue) => {
    const due = dueLabel(i.dueDate)
    return (
      <Card key={i._id} onPress={() => setActive(i)} style={{ gap: 4 }}>
        <View style={styles.rowHead}>
          <Text style={styles.key}>{i.key}</Text>
          <Badge label={i.status} tone="neutral" />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {i.title}
        </Text>
        <Text style={[styles.meta, due?.overdue && { color: colors.danger }]}>
          {i.projectName} · {i.priority}
          {due ? ` · ${due.text}` : ''}
        </Text>
      </Card>
    )
  }

  return (
    <>
      <ScreenScroll onRefresh={load}>
        <StatGrid>
          <StatTile label="Open" value={data?.counts.open ?? '—'} icon="list" tone="accent" />
          <StatTile label="Overdue" value={data?.counts.overdue ?? '—'} icon="alert-circle" tone={data?.counts.overdue ? 'danger' : 'ok'} />
          <StatTile label="Due this week" value={data?.counts.dueThisWeek ?? '—'} icon="calendar" tone="warn" />
          <StatTile label="Logged today" value={data ? fmtMinutes(data.loggedTodayMinutes) : '—'} icon="timer" tone="info" />
        </StatGrid>
        {data && !data.issues.length ? (
          <EmptyState icon="checkmark-done" title="Nothing assigned" message="You have no open issues. Nice." />
        ) : null}
        {overdue.length ? (
          <Section title="Overdue">
            <View style={{ gap: spacing.sm }}>{overdue.map(row)}</View>
          </Section>
        ) : null}
        {rest.length ? (
          <Section title="Assigned to me">
            <View style={{ gap: spacing.sm }}>{rest.map(row)}</View>
          </Section>
        ) : null}
      </ScreenScroll>

      <Modal visible={Boolean(active)} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <Pressable style={styles.backdrop} onPress={() => setActive(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            {active ? (
              <>
                <Text style={styles.key}>{active.key}</Text>
                <Text style={[styles.title, { fontSize: 17 }]}>{active.title}</Text>
                <Text style={styles.label}>Move to</Text>
                <Wrap>
                  {active.statuses.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      active={s === active.status}
                      disabled={busy || s === active.status}
                      onPress={() => void run(() => atrium.setStatus(active._id, s), `Moved to ${s}`)}
                    />
                  ))}
                </Wrap>
                <Text style={styles.label}>Log time</Text>
                <Wrap>
                  {QUICK_TIMES.map((m) => (
                    <Chip key={m} label={`+${fmtMinutes(m)}`} icon="timer-outline" disabled={busy} onPress={() => void run(() => atrium.logTime(active._id, m), `Logged ${fmtMinutes(m)}`)} />
                  ))}
                </Wrap>
                <Btn label="Close" variant="ghost" compact onPress={() => setActive(null)} />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

export default function MyWorkScreen() {
  return (
    <Screen>
      <Header title="My work" subtitle="Atrium issues assigned to you" back />
      <AtriumGate>
        <MyWorkInner />
      </AtriumGate>
    </Screen>
  )
}

const styles = StyleSheet.create({
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  key: { fontFamily: fonts.semiBold, color: colors.accent, fontSize: 12 },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  label: { fontFamily: fonts.medium, color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgElevated, padding: spacing.lg, gap: spacing.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
})
