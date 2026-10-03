import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  monitorApi,
  type MonitorErrorGroup,
  type MonitorHttpRow,
  type MonitorLogRow,
  type MonitorOverview,
  type MonitorPresenceRow,
  type MonitorReleaseRow,
  type MonitorTransactionRow,
  type MonitorUptimeCheck,
} from '../../src/api/paAdmin'
import { compact, ms, pct, timeAgo } from '../../src/lib/format'
import { getPrefs, savePrefs } from '../../src/lib/prefs'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts, radius, spacing, toneColors, type Tone } from '../../src/theme'
import { bucketize, HeartbeatBar, MiniBars, Sparkline } from '../../src/ui/Charts'
import { useToast } from '../../src/ui/Toast'
import {
  Badge,
  Banner,
  Btn,
  Card,
  Chip,
  ChipScroll,
  EmptyState,
  Header,
  IconButton,
  Input,
  ListRow,
  Mono,
  Screen,
  ScreenScroll,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  SkeletonList,
  StatGrid,
  StatTile,
  StatusDot,
  Wrap,
} from '../../src/ui/Ui'

type Tab = 'errors' | 'uptime' | 'logs' | 'http' | 'perf' | 'live' | 'releases'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'errors', label: 'Errors' },
  { id: 'uptime', label: 'Uptime' },
  { id: 'logs', label: 'Logs' },
  { id: 'http', label: 'HTTP' },
  { id: 'perf', label: 'Perf' },
  { id: 'live', label: 'Live' },
  { id: 'releases', label: 'Releases' },
]

const VITALS: Array<{ id: string; label: string; good: number; poor: number; fmt: (v: number) => string }> = [
  { id: 'lcp', label: 'LCP', good: 2500, poor: 4000, fmt: (v) => ms(v) },
  { id: 'inp', label: 'INP', good: 200, poor: 500, fmt: (v) => ms(v) },
  { id: 'cls', label: 'CLS', good: 0.1, poor: 0.25, fmt: (v) => v.toFixed(3) },
  { id: 'ttfb', label: 'TTFB', good: 800, poor: 1800, fmt: (v) => ms(v) },
]

function levelTone(level: string): Tone {
  const l = level.toLowerCase()
  if (l === 'error' || l === 'fatal') return 'danger'
  if (l === 'warn' || l === 'warning') return 'warn'
  if (l === 'info') return 'info'
  return 'neutral'
}

function statusTone(status?: number): Tone {
  if (!status) return 'neutral'
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warn'
  if (status >= 300) return 'info'
  return 'ok'
}

export default function MonitorScreen() {
  const toast = useToast()
  const { feed, error: feedError, refresh: refreshFeed } = useAlerts()
  const projects = feed?.projects ?? []
  const [projectId, setProjectId] = useState(getPrefs().monitorProjectId)
  const [tab, setTab] = useState<Tab>('errors')
  const [overview, setOverview] = useState<MonitorOverview | null>(null)
  const [loading, setLoading] = useState(false)

  const [errors, setErrors] = useState<MonitorErrorGroup[]>([])
  const [errorStatus, setErrorStatus] = useState<'open' | 'resolved'>('open')
  const [logs, setLogs] = useState<MonitorLogRow[]>([])
  const [logLevel, setLogLevel] = useState('')
  const [http, setHttp] = useState<MonitorHttpRow[]>([])
  const [httpClass, setHttpClass] = useState<'all' | '4xx' | '5xx'>('all')
  const [tx, setTx] = useState<MonitorTransactionRow[]>([])
  const [live, setLive] = useState<MonitorPresenceRow[]>([])
  const [releases, setReleases] = useState<MonitorReleaseRow[]>([])
  const [checks, setChecks] = useState<MonitorUptimeCheck[]>([])
  const [q, setQ] = useState('')
  const [expandedLog, setExpandedLog] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [newCheck, setNewCheck] = useState({ name: '', url: 'https://', interval: '5', expected: '200' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!projects.length) return
    if (!projectId || !projects.some((p) => p.id === projectId)) {
      setProjectId(projects[0].id)
    }
  }, [projects, projectId])

  const project = projects.find((p) => p.id === projectId)

  const loadTab = useCallback(
    async (which: Tab = tab) => {
      if (!projectId) return
      setLoading(true)
      try {
        const [ov] = await Promise.all([
          monitorApi.overview(projectId).catch(() => null),
          (async () => {
            if (which === 'errors') setErrors(await monitorApi.errors(projectId, { status: errorStatus, q, limit: 100 }))
            if (which === 'logs') setLogs(await monitorApi.logs(projectId, { level: logLevel, q, limit: 150 }))
            if (which === 'http') setHttp(await monitorApi.http(projectId, { q, limit: 150 }))
            if (which === 'perf') setTx(await monitorApi.transactions(projectId, { q, limit: 200 }))
            if (which === 'live') setLive(await monitorApi.liveUsers(projectId))
            if (which === 'releases') setReleases(await monitorApi.releases(projectId))
            if (which === 'uptime') setChecks(await monitorApi.uptime(projectId))
          })(),
        ])
        if (ov) setOverview(ov)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load monitor data')
      } finally {
        setLoading(false)
      }
    },
    [projectId, tab, errorStatus, logLevel, q, toast]
  )

  useEffect(() => {
    void loadTab(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tab, errorStatus, logLevel])

  function pickProject(id: string) {
    setProjectId(id)
    setOverview(null)
    void savePrefs({ monitorProjectId: id })
  }

  async function addCheck() {
    if (!projectId) return
    setBusy(true)
    try {
      await monitorApi.createUptime(projectId, {
        name: newCheck.name.trim() || newCheck.url.trim(),
        url: newCheck.url.trim(),
        intervalMinutes: Number(newCheck.interval) || 5,
        expectedStatus: Number(newCheck.expected) || 200,
      })
      toast.success('Uptime check created')
      setAddOpen(false)
      setNewCheck({ name: '', url: 'https://', interval: '5', expected: '200' })
      await Promise.all([loadTab('uptime'), refreshFeed()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  function confirmDeleteCheck(c: MonitorUptimeCheck) {
    Alert.alert('Delete check', `Stop monitoring ${c.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await monitorApi.deleteUptime(projectId, c._id)
            toast.success('Check deleted')
            await Promise.all([loadTab('uptime'), refreshFeed()])
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed')
          }
        },
      },
    ])
  }

  const httpFiltered = useMemo(
    () =>
      http.filter((h) =>
        httpClass === 'all' ? true : httpClass === '5xx' ? (h.status ?? 0) >= 500 : (h.status ?? 0) >= 400 && (h.status ?? 0) < 500
      ),
    [http, httpClass]
  )

  const txGroups = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const t of tx) map.set(t.name, [...(map.get(t.name) ?? []), t.durationMs])
    return [...map.entries()]
      .map(([name, ds]) => {
        const sorted = [...ds].sort((a, b) => a - b)
        return {
          name,
          count: ds.length,
          avg: ds.reduce((a, b) => a + b, 0) / ds.length,
          p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
        }
      })
      .sort((a, b) => b.p95 - a.p95)
  }, [tx])

  const uptimeSummary = project?.uptime ?? []
  const uptimeRate =
    overview && overview.uptimeOk + overview.uptimeFail > 0
      ? overview.uptimeOk / (overview.uptimeOk + overview.uptimeFail)
      : null

  if (!feed && !feedError) {
    return (
      <Screen>
        <Header title="Monitor" subtitle="Atrium observability" />
        <SkeletonList count={6} />
      </Screen>
    )
  }

  if (!feed?.available || !projects.length) {
    return (
      <Screen>
        <Header title="Monitor" subtitle="Atrium observability" />
        <ScreenScroll onRefresh={refreshFeed}>
          {feedError ? <Banner tone="warn" icon="cloud-offline">{feedError}</Banner> : null}
          <EmptyState
            icon="pulse"
            title="No monitor projects"
            message="Create a Monitor project in Atrium and install the SDK in your apps. PA needs TASKFLOW_API_TOKEN with monitor read permission."
            action="Retry"
            onAction={() => void refreshFeed()}
          />
        </ScreenScroll>
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        title="Monitor"
        subtitle={project ? `${project.name} · ${project.key}` : 'Atrium observability'}
        right={<IconButton icon="refresh" onPress={() => void Promise.all([loadTab(), refreshFeed()])} />}
      />
      <ScreenScroll
        onRefresh={async () => {
          await Promise.all([loadTab(), refreshFeed()])
        }}
        contentStyle={{ paddingHorizontal: 0 }}
      >
        {projects.length > 1 ? (
          <View style={{ paddingLeft: spacing.md }}>
            <ChipScroll>
              {projects.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  icon={p.uptime.some((u) => u.up === false) ? 'alert-circle' : 'cube-outline'}
                  tone={p.uptime.some((u) => u.up === false) ? 'danger' : 'accent'}
                  active={p.id === projectId}
                  onPress={() => pickProject(p.id)}
                />
              ))}
            </ChipScroll>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: spacing.md }}>
          <StatGrid>
            <StatTile
              label="Open errors"
              value={compact(overview?.openErrors)}
              icon="bug"
              tone={overview?.openErrors ? 'danger' : 'ok'}
              hint={overview?.openErrors ? 'Needs triage' : 'Clean'}
              onPress={() => setTab('errors')}
            />
            <StatTile
              label="Live users"
              value={compact(overview?.liveUsers)}
              icon="people"
              tone="info"
              hint="Last 2 minutes"
              onPress={() => setTab('live')}
            />
            <StatTile
              label="Avg response"
              value={ms(overview?.transactionAvgMs)}
              icon="speedometer"
              tone={(overview?.transactionAvgMs ?? 0) > 1500 ? 'warn' : 'accent'}
              hint={`${compact(overview?.transactionCount)} transactions`}
              onPress={() => setTab('perf')}
            />
            <StatTile
              label="Uptime · 24h"
              value={pct(uptimeRate)}
              icon="cloud-done"
              tone={uptimeRate !== null && uptimeRate < 0.99 ? 'danger' : 'ok'}
              hint={`${overview?.uptimeFail ?? 0} failed probes`}
              onPress={() => setTab('uptime')}
            />
            <StatTile
              label="HTTP errors"
              value={compact(overview?.httpErrors)}
              icon="swap-horizontal"
              tone={overview?.httpErrors ? 'warn' : 'neutral'}
              hint="4xx/5xx · 24h"
              onPress={() => setTab('http')}
            />
            <StatTile
              label="Logs"
              value={compact(overview?.last24hLogs)}
              icon="document-text"
              tone="neutral"
              hint="Last 24h"
              onPress={() => setTab('logs')}
            />
          </StatGrid>

          {overview && Object.keys(overview.vitals || {}).length ? (
            <Card style={{ marginTop: spacing.sm }}>
              <Text style={styles.cardTitle}>Web vitals · 24h avg</Text>
              <View style={styles.vitals}>
                {VITALS.map((v) => {
                  const val = overview.vitals[v.id]
                  const tone: Tone =
                    val === undefined ? 'neutral' : val <= v.good ? 'ok' : val <= v.poor ? 'warn' : 'danger'
                  return (
                    <View key={v.id} style={[styles.vital, { borderColor: toneColors[tone].border }]}>
                      <Text style={styles.vitalLabel}>{v.label}</Text>
                      <Text style={[styles.vitalValue, { color: toneColors[tone].fg }]}>
                        {val === undefined ? '—' : v.fmt(val)}
                      </Text>
                    </View>
                  )
                })}
              </View>
            </Card>
          ) : null}
        </View>

        <View style={{ marginTop: spacing.md, paddingLeft: spacing.md }}>
          <ChipScroll>
            {TABS.map((t) => (
              <Chip key={t.id} label={t.label} active={tab === t.id} onPress={() => setTab(t.id)} />
            ))}
          </ChipScroll>
        </View>

        {['errors', 'logs', 'http', 'perf'].includes(tab) ? (
          <SearchBar
            value={q}
            onChangeText={setQ}
            onSubmit={() => void loadTab()}
            placeholder={tab === 'http' ? 'Filter URL' : tab === 'perf' ? 'Filter transaction' : 'Search message'}
          />
        ) : null}

        <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
          {loading && <Text style={styles.loadingText}>Loading…</Text>}

          {tab === 'errors' ? (
            <>
              <Segmented
                style={{ marginHorizontal: 0, marginBottom: 0 }}
                value={errorStatus}
                onChange={setErrorStatus}
                options={[
                  { id: 'open', label: 'Open' },
                  { id: 'resolved', label: 'Resolved' },
                ]}
              />
              {errors.length ? (
                <Card style={{ gap: 6 }}>
                  <Text style={styles.cardTitle}>Last seen · 24h</Text>
                  <MiniBars values={bucketize(errors.map((e) => e.lastSeen))} color={colors.danger} height={40} />
                </Card>
              ) : null}
              {errors.map((e) => (
                <ListRow
                  key={e._id}
                  leading={
                    <View style={[styles.countPill, { borderColor: toneColors[e.count >= 10 ? 'danger' : 'warn'].border }]}>
                      <Text style={[styles.countText, { color: toneColors[e.count >= 10 ? 'danger' : 'warn'].fg }]}>
                        {compact(e.count)}
                      </Text>
                    </View>
                  }
                  title={e.type || 'Error'}
                  subtitle={e.message}
                  meta={`${e.kind || 'unhandled'} · last ${timeAgo(e.lastSeen)} · first ${timeAgo(e.firstSeen)}`}
                  onPress={() =>
                    router.push({ pathname: '/monitor/error', params: { projectId, groupId: e._id } })
                  }
                />
              ))}
              {!loading && !errors.length ? (
                <EmptyState icon="checkmark-done" title="No errors" message={`No ${errorStatus} error groups.`} />
              ) : null}
            </>
          ) : null}

          {tab === 'uptime' ? (
            <>
              <Btn label="Add uptime check" icon="add" variant="secondary" block onPress={() => setAddOpen(true)} />
              {checks.map((c) => {
                const s = uptimeSummary.find((u) => u.id === c._id)
                const tone: Tone = s?.up === false ? 'danger' : s?.up ? 'ok' : 'neutral'
                return (
                  <Card key={c._id} tone={s?.up === false ? 'danger' : undefined} onPress={() => confirmDeleteCheck(c)}>
                    <View style={styles.checkHead}>
                      <StatusDot tone={tone} pulse={s?.up === false} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={styles.sub} numberOfLines={1}>
                          {c.method || 'GET'} {c.url}
                        </Text>
                      </View>
                      <Badge
                        label={s?.up === false ? 'Down' : s?.up ? 'Up' : 'Pending'}
                        tone={tone}
                      />
                    </View>
                    <HeartbeatBar samples={s?.samples ?? []} />
                    {s && s.samples.some((x) => x.latencyMs) ? (
                      <Sparkline values={s.samples.map((x) => x.latencyMs ?? 0)} color={colors.info} height={36} />
                    ) : null}
                    <Wrap>
                      <Badge label={`${pct(s?.okRate)} success`} tone="neutral" />
                      <Badge label={`${ms(s?.latencyMs)} latency`} tone="neutral" />
                      <Badge label={`every ${c.intervalMinutes ?? 5}m`} tone="neutral" />
                      <Badge label={`expect ${c.expectedStatus ?? 200}`} tone="neutral" />
                    </Wrap>
                    <Text style={styles.hint}>Tap to manage</Text>
                  </Card>
                )
              })}
              {!loading && !checks.length ? (
                <EmptyState icon="cloud-outline" title="No uptime checks" message="Add a URL and Atrium will probe it on a schedule." />
              ) : null}
            </>
          ) : null}

          {tab === 'logs' ? (
            <>
              <Wrap>
                {['', 'error', 'warn', 'info', 'debug'].map((l) => (
                  <Chip
                    key={l || 'all'}
                    label={l ? l.toUpperCase() : 'ALL'}
                    tone={l ? levelTone(l) : 'accent'}
                    active={logLevel === l}
                    onPress={() => setLogLevel(l)}
                  />
                ))}
              </Wrap>
              {logs.map((l) => (
                <Pressable key={l._id} onPress={() => setExpandedLog(expandedLog === l._id ? '' : l._id)}>
                  <View style={styles.logRow}>
                    <View style={[styles.logBar, { backgroundColor: toneColors[levelTone(l.level)].fg }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.logHead}>
                        <Text style={[styles.logLevel, { color: toneColors[levelTone(l.level)].fg }]}>
                          {l.level.toUpperCase()}
                        </Text>
                        <Text style={styles.logTime}>{timeAgo(l.timestamp)}</Text>
                      </View>
                      <Mono style={{ color: colors.text }}>
                        {expandedLog === l._id ? l.message : l.message.slice(0, 160)}
                      </Mono>
                      {expandedLog === l._id && l.meta ? (
                        <Mono style={{ marginTop: 4 }}>{JSON.stringify(l.meta, null, 2).slice(0, 2000)}</Mono>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              ))}
              {!loading && !logs.length ? <EmptyState icon="document-text-outline" message="No logs match." /> : null}
            </>
          ) : null}

          {tab === 'http' ? (
            <>
              <Wrap>
                {(['all', '4xx', '5xx'] as const).map((c) => (
                  <Chip
                    key={c}
                    label={c.toUpperCase()}
                    tone={c === '5xx' ? 'danger' : c === '4xx' ? 'warn' : 'accent'}
                    active={httpClass === c}
                    onPress={() => setHttpClass(c)}
                  />
                ))}
              </Wrap>
              {httpFiltered.map((h) => (
                <View key={h._id} style={styles.httpRow}>
                  <Badge label={h.method} tone="neutral" />
                  <View style={{ flex: 1 }}>
                    <Mono style={{ color: colors.text }}>{h.url.slice(0, 120)}</Mono>
                    <Text style={styles.logTime}>
                      {h.direction === 'in' ? 'inbound' : 'outbound'} · {timeAgo(h.timestamp)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge label={String(h.status ?? '—')} tone={statusTone(h.status)} />
                    <Text style={styles.logTime}>{ms(h.durationMs)}</Text>
                  </View>
                </View>
              ))}
              {!loading && !httpFiltered.length ? <EmptyState icon="swap-horizontal" message="No HTTP calls." /> : null}
            </>
          ) : null}

          {tab === 'perf' ? (
            <>
              {tx.length > 1 ? (
                <Card>
                  <Text style={styles.cardTitle}>Response time · latest {tx.length}</Text>
                  <Sparkline values={[...tx].reverse().map((t) => t.durationMs)} color={colors.accent} height={64} />
                </Card>
              ) : null}
              {txGroups.map((g) => (
                <Card key={g.name} style={{ gap: 6 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Wrap>
                    <Badge label={`p95 ${ms(g.p95)}`} tone={g.p95 > 2000 ? 'danger' : g.p95 > 800 ? 'warn' : 'ok'} />
                    <Badge label={`avg ${ms(g.avg)}`} tone="neutral" />
                    <Badge label={`${g.count} calls`} tone="neutral" />
                  </Wrap>
                </Card>
              ))}
              {!loading && !tx.length ? <EmptyState icon="speedometer-outline" message="No transactions recorded." /> : null}
            </>
          ) : null}

          {tab === 'live' ? (
            <>
              {live.map((p) => (
                <ListRow
                  key={p._id}
                  leading={<StatusDot tone="ok" pulse />}
                  title={p.userId || `Session ${p.sessionId.slice(0, 8)}`}
                  subtitle={p.page || '—'}
                  meta={`${(p.userAgent || '').slice(0, 60)} · ${timeAgo(p.lastSeen)}`}
                />
              ))}
              {!loading && !live.length ? <EmptyState icon="people-outline" message="Nobody online right now." /> : null}
            </>
          ) : null}

          {tab === 'releases' ? (
            <>
              {releases.map((r) => (
                <ListRow
                  key={r._id}
                  leading={<Ionicons name="rocket" size={20} color={colors.accent2} />}
                  title={r.version}
                  meta={`First seen ${timeAgo(r.firstSeen)}`}
                />
              ))}
              {!loading && !releases.length ? <EmptyState icon="rocket-outline" message="No releases reported." /> : null}
            </>
          ) : null}
        </View>

        <Section title="Shortcuts" style={{ paddingHorizontal: spacing.md }}>
          <Btn
            label="Manage alert rules"
            icon="notifications"
            variant="secondary"
            block
            onPress={() => router.push({ pathname: '/(tabs)/alerts', params: { view: 'rules' } })}
          />
        </Section>
      </ScreenScroll>

      <Sheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title="New uptime check"
        subtitle={project?.name}
        footer={
          <>
            <Btn label="Cancel" variant="ghost" onPress={() => setAddOpen(false)} style={{ flex: 1 }} />
            <Btn label="Create" icon="add" loading={busy} onPress={() => void addCheck()} style={{ flex: 1 }} />
          </>
        }
      >
        <Input label="Name" value={newCheck.name} onChangeText={(v) => setNewCheck((c) => ({ ...c, name: v }))} placeholder="API health" />
        <Input
          label="URL"
          value={newCheck.url}
          onChangeText={(v) => setNewCheck((c) => ({ ...c, url: v }))}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://api.example.com/health"
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Interval (min)"
              value={newCheck.interval}
              keyboardType="number-pad"
              onChangeText={(v) => setNewCheck((c) => ({ ...c, interval: v }))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Expected status"
              value={newCheck.expected}
              keyboardType="number-pad"
              onChangeText={(v) => setNewCheck((c) => ({ ...c, expected: v }))}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  cardTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 14,
  },
  sub: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 12,
  },
  hint: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 11,
  },
  loadingText: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 12,
  },
  vitals: { flexDirection: 'row', gap: 8 },
  vital: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.panel2,
  },
  vitalLabel: {
    fontFamily: fonts.semiBold,
    color: colors.muted,
    fontSize: 11,
  },
  vitalValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    marginTop: 2,
  },
  countPill: {
    minWidth: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel2,
  },
  countText: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    overflow: 'hidden',
  },
  logBar: { width: 3, borderRadius: 2 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between' },
  logLevel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5 },
  logTime: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11 },
  httpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
  },
})
