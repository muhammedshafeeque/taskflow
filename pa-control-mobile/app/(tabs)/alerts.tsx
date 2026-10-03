import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, StyleSheet, Switch, Text, View } from 'react-native'
import {
  ALERT_TRIGGERS,
  monitorApi,
  pushApi,
  type AlertTrigger,
  type MonitorAlertDelivery,
  type MonitorAlertRule,
  type MonitorFeedAlert,
} from '../../src/api/paAdmin'
import { humanize, timeAgo } from '../../src/lib/format'
import { haptic } from '../../src/lib/haptics'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts, spacing, type Tone } from '../../src/theme'
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
  IconTile,
  Input,
  ListRow,
  Screen,
  ScreenScroll,
  Segmented,
  Sheet,
  SkeletonList,
  Wrap,
  type IconName,
} from '../../src/ui/Ui'

type View_ = 'inbox' | 'rules' | 'history'
type SevFilter = 'all' | 'critical' | 'warning' | 'info'

const SEV_TONE: Record<MonitorFeedAlert['severity'], Tone> = { critical: 'danger', warning: 'warn', info: 'info' }
const KIND_ICON: Record<MonitorFeedAlert['kind'], IconName> = {
  uptime: 'cloud-offline',
  error: 'bug',
  delivery: 'notifications',
}

type Draft = {
  _id?: string
  name: string
  trigger: AlertTrigger
  recipients: string
  cooldownMinutes: string
  enabled: boolean
  messageContains: string
  minCount: string
  windowMinutes: string
  logLevels: string[]
  httpStatusMin: string
  httpStatusMax: string
  durationMs: string
  vitalName: string
  vitalGte: string
  eventName: string
  uptimeFailStreak: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  trigger: 'error_new',
  recipients: '',
  cooldownMinutes: '15',
  enabled: true,
  messageContains: '',
  minCount: '10',
  windowMinutes: '5',
  logLevels: ['error', 'fatal'],
  httpStatusMin: '500',
  httpStatusMax: '599',
  durationMs: '2000',
  vitalName: 'lcp',
  vitalGte: '2500',
  eventName: '',
  uptimeFailStreak: '2',
}

function draftFromRule(r: MonitorAlertRule): Draft {
  const c = r.conditions || {}
  return {
    _id: r._id,
    name: r.name,
    trigger: r.trigger,
    recipients: r.recipients.join(', '),
    cooldownMinutes: String(r.cooldownMinutes ?? 15),
    enabled: r.enabled,
    messageContains: c.messageContains ?? '',
    minCount: String(c.minCount ?? 10),
    windowMinutes: String(c.windowMinutes ?? 5),
    logLevels: c.logLevels ?? ['error', 'fatal'],
    httpStatusMin: String(c.httpStatusMin ?? 500),
    httpStatusMax: String(c.httpStatusMax ?? 599),
    durationMs: String(c.durationMs ?? 2000),
    vitalName: c.vitalName ?? 'lcp',
    vitalGte: String(c.vitalGte ?? 2500),
    eventName: c.eventName ?? '',
    uptimeFailStreak: String(c.uptimeFailStreak ?? 2),
  }
}

function bodyFromDraft(d: Draft): Partial<MonitorAlertRule> {
  const conditions: MonitorAlertRule['conditions'] = {}
  if (d.messageContains.trim()) conditions.messageContains = d.messageContains.trim()
  if (d.trigger === 'error_spike') {
    conditions.minCount = Number(d.minCount) || 10
    conditions.windowMinutes = Number(d.windowMinutes) || 5
  }
  if (d.trigger === 'log_level') conditions.logLevels = d.logLevels
  if (d.trigger === 'http_status') {
    conditions.httpStatusMin = Number(d.httpStatusMin) || 500
    conditions.httpStatusMax = Number(d.httpStatusMax) || 599
  }
  if (d.trigger === 'transaction_slow') conditions.durationMs = Number(d.durationMs) || 2000
  if (d.trigger === 'vital_threshold') {
    conditions.vitalName = d.vitalName
    conditions.vitalGte = Number(d.vitalGte) || 2500
  }
  if (d.trigger === 'event_name') conditions.eventName = d.eventName.trim()
  if (d.trigger === 'uptime_down') conditions.uptimeFailStreak = Number(d.uptimeFailStreak) || 1
  return {
    name: d.name.trim(),
    trigger: d.trigger,
    enabled: d.enabled,
    recipients: d.recipients
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    cooldownMinutes: Number(d.cooldownMinutes) || 15,
    conditions,
  }
}

function ruleToBody(r: MonitorAlertRule, patch: Partial<MonitorAlertRule> = {}): Partial<MonitorAlertRule> {
  return {
    name: r.name,
    trigger: r.trigger,
    enabled: r.enabled,
    recipients: r.recipients,
    cooldownMinutes: r.cooldownMinutes,
    environmentId: r.environmentId ?? undefined,
    appId: r.appId ?? undefined,
    subjectTemplate: r.subjectTemplate,
    bodyTemplate: r.bodyTemplate,
    conditions: r.conditions,
    ...patch,
  }
}

export default function AlertsScreen() {
  const params = useLocalSearchParams<{ view?: string }>()
  const toast = useToast()
  const { feed, error, readAt, refresh, markAllRead } = useAlerts()
  const [view, setView] = useState<View_>('inbox')
  const [sev, setSev] = useState<SevFilter>('all')
  const [kind, setKind] = useState<'all' | MonitorFeedAlert['kind']>('all')
  const projects = feed?.projects ?? []
  const [projectId, setProjectId] = useState('')
  const [rules, setRules] = useState<MonitorAlertRule[]>([])
  const [deliveries, setDeliveries] = useState<MonitorAlertDelivery[]>([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const seenReadAt = useRef('')

  useEffect(() => {
    if (params.view === 'rules' || params.view === 'history') setView(params.view)
  }, [params.view])

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projects, projectId])

  // Snapshot "read" boundary on focus so unread dots survive this visit; mark read when leaving.
  useFocusEffect(
    useCallback(() => {
      seenReadAt.current = readAt
      return () => {
        void markAllRead()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markAllRead])
  )

  const loadRules = useCallback(async () => {
    if (!projectId) return
    setLoadingRules(true)
    try {
      const [r, d] = await Promise.all([monitorApi.alertRules(projectId), monitorApi.deliveries(projectId)])
      setRules(r)
      setDeliveries(d)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setLoadingRules(false)
    }
  }, [projectId, toast])

  useEffect(() => {
    if (view !== 'inbox') void loadRules()
  }, [view, loadRules])

  const alerts = useMemo(
    () =>
      (feed?.alerts ?? []).filter(
        (a) => (sev === 'all' || a.severity === sev) && (kind === 'all' || a.kind === kind)
      ),
    [feed, sev, kind]
  )
  const counts = useMemo(() => {
    const all = feed?.alerts ?? []
    return {
      critical: all.filter((a) => a.severity === 'critical').length,
      warning: all.filter((a) => a.severity === 'warning').length,
      info: all.filter((a) => a.severity === 'info').length,
    }
  }, [feed])

  async function toggleRule(r: MonitorAlertRule, enabled: boolean) {
    setRules((rs) => rs.map((x) => (x._id === r._id ? { ...x, enabled } : x)))
    try {
      await monitorApi.updateAlertRule(projectId, r._id, ruleToBody(r, { enabled }))
      toast.success(`${r.name} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      setRules((rs) => rs.map((x) => (x._id === r._id ? { ...x, enabled: !enabled } : x)))
      toast.error(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function testRule(r: MonitorAlertRule) {
    try {
      await monitorApi.testAlertRule(projectId, r._id)
      toast.success(`Test sent to ${r.recipients.length} recipient(s)`)
      void loadRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed')
    }
  }

  function deleteRule(r: MonitorAlertRule) {
    Alert.alert('Delete rule', `Delete “${r.name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await monitorApi.deleteAlertRule(projectId, r._id)
            toast.success('Rule deleted')
            void loadRules()
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed')
          }
        },
      },
    ])
  }

  async function saveDraft() {
    if (!draft) return
    const body = bodyFromDraft(draft)
    if (!body.name) return toast.error('Name is required')
    if (!body.recipients?.length) return toast.error('Add at least one recipient email')
    setSaving(true)
    try {
      if (draft._id) await monitorApi.updateAlertRule(projectId, draft._id, body)
      else await monitorApi.createAlertRule(projectId, body)
      toast.success(draft._id ? 'Rule updated' : 'Rule created')
      setDraft(null)
      void loadRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function openAlert(a: MonitorFeedAlert) {
    if (a.kind === 'error' && a.ref) {
      router.push({ pathname: '/monitor/error', params: { projectId: a.projectId, groupId: a.ref } })
    } else {
      router.push('/(tabs)/monitor')
    }
  }

  const ruleName = (id: string) => rules.find((r) => r._id === id)?.name

  return (
    <Screen>
      <Header
        title="Alerts"
        subtitle={feed ? `Updated ${timeAgo(feed.generatedAt)}` : 'Atrium monitor alerts'}
        right={
          <>
            <IconButton icon="settings-outline" onPress={() => router.push('/(tabs)/settings')} />
            {view === 'rules' ? (
              <IconButton icon="add" tone="accent" onPress={() => setDraft({ ...EMPTY_DRAFT })} />
            ) : null}
          </>
        }
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { id: 'inbox', label: 'Inbox', count: feed?.alerts.length },
          { id: 'rules', label: 'Rules', count: rules.length || undefined },
          { id: 'history', label: 'History' },
        ]}
      />

      {view === 'inbox' ? (
        <ScreenScroll onRefresh={refresh} contentStyle={{ paddingHorizontal: 0 }}>
          {error ? <Banner tone="warn" icon="cloud-offline">{error}</Banner> : null}
          <View style={{ paddingLeft: spacing.md }}>
            <ChipScroll>
              <Chip label="All" active={sev === 'all'} onPress={() => setSev('all')} />
              <Chip label="Critical" tone="danger" icon="flame" count={counts.critical} active={sev === 'critical'} onPress={() => setSev('critical')} />
              <Chip label="Warning" tone="warn" icon="warning" count={counts.warning} active={sev === 'warning'} onPress={() => setSev('warning')} />
              <Chip label="Info" tone="info" icon="information-circle" count={counts.info} active={sev === 'info'} onPress={() => setSev('info')} />
            </ChipScroll>
            <ChipScroll>
              {(['all', 'uptime', 'error', 'delivery'] as const).map((k) => (
                <Chip
                  key={k}
                  label={k === 'all' ? 'Any source' : k === 'delivery' ? 'Rule fired' : humanize(k)}
                  icon={k === 'all' ? 'layers-outline' : KIND_ICON[k]}
                  active={kind === k}
                  onPress={() => setKind(k)}
                />
              ))}
            </ChipScroll>
          </View>
          <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
            {!feed ? <SkeletonList count={5} /> : null}
            {alerts.map((a) => {
              const unread = a.kind === 'uptime' || !seenReadAt.current || a.at > seenReadAt.current
              return (
                <ListRow
                  key={a.id}
                  leading={<IconTile icon={KIND_ICON[a.kind]} tone={SEV_TONE[a.severity]} size={42} />}
                  title={a.title}
                  subtitle={a.body}
                  meta={`${a.projectName} · ${timeAgo(a.at)}`}
                  onPress={() => openAlert(a)}
                  trailing={unread ? <View style={styles.unreadDot} /> : undefined}
                  style={a.severity === 'critical' ? { borderColor: colors.dangerBorder } : undefined}
                />
              )
            })}
            {feed && !alerts.length ? (
              <EmptyState icon="notifications-off-outline" title="All quiet" message="No alerts match these filters." />
            ) : null}
          </View>
        </ScreenScroll>
      ) : (
        <ScreenScroll onRefresh={loadRules} contentStyle={{ paddingHorizontal: 0 }}>
          {projects.length > 1 ? (
            <View style={{ paddingLeft: spacing.md }}>
              <ChipScroll>
                {projects.map((p) => (
                  <Chip key={p.id} label={p.name} icon="cube-outline" active={p.id === projectId} onPress={() => setProjectId(p.id)} />
                ))}
              </ChipScroll>
            </View>
          ) : null}
          <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
            {loadingRules && !rules.length ? <SkeletonList count={4} /> : null}
            {!projects.length ? (
              <EmptyState icon="pulse" message="No monitor projects available from Atrium." />
            ) : null}

            {view === 'rules' ? (
              <>
                {rules.map((r) => {
                  const t = ALERT_TRIGGERS.find((x) => x.id === r.trigger)
                  return (
                    <Card key={r._id} onPress={() => setDraft(draftFromRule(r))}>
                      <View style={styles.ruleHead}>
                        <IconTile icon={(t?.icon || 'notifications') as IconName} tone={r.enabled ? 'accent' : 'neutral'} size={38} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ruleName} numberOfLines={1}>
                            {r.name}
                          </Text>
                          <Text style={styles.ruleSub}>
                            {t?.label || r.trigger} · cooldown {r.cooldownMinutes}m
                          </Text>
                        </View>
                        <Switch
                          value={r.enabled}
                          onValueChange={(v) => {
                            haptic.tap()
                            void toggleRule(r, v)
                          }}
                          trackColor={{ false: colors.panel3, true: colors.accent }}
                          thumbColor="#fff"
                        />
                      </View>
                      <Wrap>
                        <Badge label={`Fired ${r.fireCount}×`} tone={r.fireCount ? 'warn' : 'neutral'} />
                        <Badge label={r.lastFiredAt ? `Last ${timeAgo(r.lastFiredAt)}` : 'Never fired'} tone="neutral" />
                        <Badge label={`${r.recipients.length} recipient${r.recipients.length === 1 ? '' : 's'}`} tone="neutral" icon="mail" />
                      </Wrap>
                      {r.lastError ? <Text style={styles.ruleErr}>Last error: {r.lastError}</Text> : null}
                      <View style={styles.ruleActions}>
                        <Btn label="Test" icon="paper-plane" compact variant="secondary" onPress={() => void testRule(r)} />
                        <Btn label="Edit" icon="create" compact variant="secondary" onPress={() => setDraft(draftFromRule(r))} />
                        <Btn label="Delete" icon="trash" compact variant="ghost" onPress={() => deleteRule(r)} />
                      </View>
                    </Card>
                  )
                })}
                {!loadingRules && projects.length && !rules.length ? (
                  <EmptyState
                    icon="notifications-outline"
                    title="No alert rules"
                    message="Create a rule to email your team when errors, outages or slow requests happen."
                    action="Create rule"
                    onAction={() => setDraft({ ...EMPTY_DRAFT })}
                  />
                ) : null}
                <Card style={{ marginTop: spacing.sm }}>
                  <Text style={styles.ruleName}>Mobile push</Text>
                  <Text style={styles.ruleSub}>
                    Rules email recipients; PA also pushes new deliveries, errors and outages to this phone.
                  </Text>
                  <Btn
                    label="Send test push"
                    icon="phone-portrait"
                    compact
                    variant="secondary"
                    onPress={() =>
                      void pushApi
                        .test()
                        .then((r) => toast.success(r.sent ? `Delivered to ${r.sent} device(s)` : 'No registered devices'))
                        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Push failed'))
                    }
                  />
                </Card>
              </>
            ) : (
              <>
                {deliveries.map((d) => (
                  <ListRow
                    key={d._id}
                    leading={<IconTile icon={d.ok ? 'mail' : 'mail-unread'} tone={d.ok ? 'ok' : 'danger'} size={38} />}
                    title={d.subject || humanize(d.trigger)}
                    subtitle={d.ok ? d.summary || d.recipients.join(', ') : `Failed: ${d.error || 'unknown'}`}
                    meta={`${ruleName(d.ruleId) || humanize(d.trigger)} · ${timeAgo(d.timestamp)}`}
                  />
                ))}
                {!loadingRules && projects.length && !deliveries.length ? (
                  <EmptyState icon="time-outline" message="No alert deliveries in the last 30 days." />
                ) : null}
              </>
            )}
          </View>
        </ScreenScroll>
      )}

      <Sheet
        visible={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?._id ? 'Edit alert rule' : 'New alert rule'}
        subtitle={projects.find((p) => p.id === projectId)?.name}
        footer={
          <>
            <Btn label="Cancel" variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Btn label="Save rule" icon="checkmark" loading={saving} onPress={() => void saveDraft()} style={{ flex: 1 }} />
          </>
        }
      >
        {draft ? <RuleEditor draft={draft} onChange={setDraft} /> : null}
      </Sheet>
    </Screen>
  )
}

function RuleEditor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  return (
    <View>
      <Input label="Rule name" value={draft.name} onChangeText={(v) => set({ name: v })} placeholder="Checkout errors" />
      <Text style={styles.fieldLabel}>Trigger</Text>
      <Wrap style={{ marginBottom: spacing.md }}>
        {ALERT_TRIGGERS.map((t) => (
          <Chip
            key={t.id}
            label={t.label}
            icon={t.icon as IconName}
            active={draft.trigger === t.id}
            onPress={() => set({ trigger: t.id })}
          />
        ))}
      </Wrap>

      {draft.trigger === 'error_spike' ? (
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input label="Min errors" keyboardType="number-pad" value={draft.minCount} onChangeText={(v) => set({ minCount: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Window (min)" keyboardType="number-pad" value={draft.windowMinutes} onChangeText={(v) => set({ windowMinutes: v })} />
          </View>
        </View>
      ) : null}
      {draft.trigger === 'log_level' ? (
        <>
          <Text style={styles.fieldLabel}>Levels</Text>
          <Wrap style={{ marginBottom: spacing.md }}>
            {['fatal', 'error', 'warn', 'info'].map((l) => (
              <Chip
                key={l}
                label={l.toUpperCase()}
                active={draft.logLevels.includes(l)}
                onPress={() =>
                  set({
                    logLevels: draft.logLevels.includes(l)
                      ? draft.logLevels.filter((x) => x !== l)
                      : [...draft.logLevels, l],
                  })
                }
              />
            ))}
          </Wrap>
        </>
      ) : null}
      {draft.trigger === 'http_status' ? (
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Input label="Status from" keyboardType="number-pad" value={draft.httpStatusMin} onChangeText={(v) => set({ httpStatusMin: v })} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Status to" keyboardType="number-pad" value={draft.httpStatusMax} onChangeText={(v) => set({ httpStatusMax: v })} />
          </View>
        </View>
      ) : null}
      {draft.trigger === 'transaction_slow' ? (
        <Input label="Slower than (ms)" keyboardType="number-pad" value={draft.durationMs} onChangeText={(v) => set({ durationMs: v })} />
      ) : null}
      {draft.trigger === 'vital_threshold' ? (
        <>
          <Text style={styles.fieldLabel}>Vital</Text>
          <Wrap style={{ marginBottom: spacing.md }}>
            {['lcp', 'inp', 'cls', 'ttfb'].map((v) => (
              <Chip key={v} label={v.toUpperCase()} active={draft.vitalName === v} onPress={() => set({ vitalName: v })} />
            ))}
          </Wrap>
          <Input label="Fire when ≥" keyboardType="decimal-pad" value={draft.vitalGte} onChangeText={(v) => set({ vitalGte: v })} />
        </>
      ) : null}
      {draft.trigger === 'event_name' ? (
        <Input label="Event name" value={draft.eventName} onChangeText={(v) => set({ eventName: v })} placeholder="checkout_failed" autoCapitalize="none" />
      ) : null}
      {draft.trigger === 'uptime_down' ? (
        <Input label="Consecutive failures" keyboardType="number-pad" value={draft.uptimeFailStreak} onChangeText={(v) => set({ uptimeFailStreak: v })} />
      ) : null}

      <Input
        label="Message contains (optional)"
        value={draft.messageContains}
        onChangeText={(v) => set({ messageContains: v })}
        placeholder="payment"
        autoCapitalize="none"
      />
      <Input
        label="Recipients (workspace member emails)"
        value={draft.recipients}
        onChangeText={(v) => set({ recipients: v })}
        placeholder="ops@company.com, dev@company.com"
        autoCapitalize="none"
        keyboardType="email-address"
        multiline
      />
      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Input label="Cooldown (min)" keyboardType="number-pad" value={draft.cooldownMinutes} onChangeText={(v) => set({ cooldownMinutes: v })} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.fieldLabel}>Enabled</Text>
          <Switch
            value={draft.enabled}
            onValueChange={(v) => set({ enabled: v })}
            trackColor={{ false: colors.panel3, true: colors.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ruleName: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  ruleSub: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 },
  ruleErr: { fontFamily: fonts.medium, color: colors.danger, fontSize: 12 },
  ruleActions: { flexDirection: 'row', gap: 8 },
  fieldLabel: {
    fontFamily: fonts.semiBold,
    color: colors.textDim,
    fontSize: 12,
    marginBottom: 6,
  },
  twoCol: { flexDirection: 'row', gap: spacing.sm },
})
