import { Ionicons } from '@expo/vector-icons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { type AdminStatus, type BotSettings, paAdmin } from '../../src/api/paAdmin'
import { compact, ms, pct, timeAgo } from '../../src/lib/format'
import { haptic } from '../../src/lib/haptics'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts, radius, spacing, toneColors, type Tone } from '../../src/theme'
import { HeartbeatBar } from '../../src/ui/Charts'
import { QuietHoursCard } from '../../src/ui/QuietHoursCard'
import { useToast } from '../../src/ui/Toast'
import {
  BrandMark,
  Btn,
  Card,
  Chip,
  GradientCard,
  IconButton,
  IconTile,
  ListRow,
  Screen,
  ScreenScroll,
  Section,
  Skeleton,
  StatGrid,
  StatTile,
  StatusDot,
  ToggleRow,
  Wrap,
  type IconName,
} from '../../src/ui/Ui'

const STT: Array<{ id: BotSettings['sttLanguage']; label: string }> = [
  { id: 'ml', label: 'Malayalam' },
  { id: 'en', label: 'English' },
  { id: 'auto', label: 'Auto' },
]

type Extras = { pendingRequests: number; jobsToReview: number; openCases: number }

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeScreen() {
  const toast = useToast()
  const { feed, unread, refresh: refreshFeed } = useAlerts()
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [extras, setExtras] = useState<Extras>({ pendingRequests: 0, jobsToReview: 0, openCases: 0 })
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])
  const [qr, setQr] = useState<string | null>(null)
  const qrPending = Boolean(status?.whatsapp.qrPending)

  // WhatsApp rotates the pairing code every ~20s; keep it fresh while a scan is needed.
  useEffect(() => {
    if (!qrPending) {
      setQr(null)
      return
    }
    let alive = true
    const pull = async () => {
      const res = await paAdmin.whatsappQr().catch(() => null)
      if (!alive || !res) return
      setQr(res.qr)
      setStatus((st) => (st ? { ...st, whatsapp: res.status } : st))
    }
    void pull()
    const t = setInterval(() => void pull(), 15_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [qrPending])

  const load = useCallback(async () => {
    const [st, reqs, jobs, support] = await Promise.allSettled([
      paAdmin.status(),
      paAdmin.listServiceRequests({ pendingOnly: true, limit: 1 }),
      paAdmin.listAgentJobs({ status: 'needs_review' }),
      paAdmin.listSupportCases(),
    ])
    if (st.status === 'fulfilled') setStatus(st.value)
    else toast.error(st.reason instanceof Error ? st.reason.message : 'Failed to load status')
    setExtras({
      pendingRequests: reqs.status === 'fulfilled' ? reqs.value.total ?? reqs.value.requests.length : 0,
      jobsToReview: jobs.status === 'fulfilled' ? jobs.value.length : 0,
      openCases:
        support.status === 'fulfilled'
          ? support.value.cases.filter((c) => !/closed|resolved/i.test(c.status)).length
          : 0,
    })
  }, [toast])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function patch(partial: Parameters<typeof paAdmin.patchSettings>[0], msg: string) {
    setSaving(true)
    try {
      const settings = await paAdmin.patchSettings(partial)
      setStatus((s) => (s ? { ...s, settings } : s))
      toast.success(msg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function reconnectWhatsApp() {
    setReconnecting(true)
    try {
      const wa = await paAdmin.reconnectWhatsApp()
      setStatus((st) => (st ? { ...st, whatsapp: wa } : st))
      toast.success('Reconnecting WhatsApp…')
      // Restart boots Chromium + WhatsApp Web; poll until it settles (max ~2 min).
      const deadline = Date.now() + 120_000
      while (mounted.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000))
        if (!mounted.current) return
        const next = await paAdmin.whatsappStatus().catch(() => null)
        if (!next) continue
        setStatus((st) => (st ? { ...st, whatsapp: next } : st))
        if (next.ready) {
          haptic.success()
          toast.success('WhatsApp connected')
          return
        }
        if (next.qrPending) {
          toast.error('Session expired — scan the QR code on the home screen')
          return
        }
      }
      if (mounted.current) toast.error('Still not ready — check server logs')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconnect failed')
    } finally {
      if (mounted.current) setReconnecting(false)
    }
  }

  function confirmReconnect() {
    Alert.alert(
      'Reconnect WhatsApp',
      'Restart the WhatsApp session on the server? Replies pause for up to a minute.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reconnect', style: 'destructive', onPress: () => void reconnectWhatsApp() },
      ]
    )
  }

  const s = status?.settings
  const totals = feed?.totals
  const wa = status?.whatsapp

  let health: { tone: Tone; title: string; detail: string } = {
    tone: 'ok',
    title: 'All systems operational',
    detail: 'WhatsApp connected · monitors healthy',
  }
  if (status && !wa?.ready) {
    health = {
      tone: 'danger',
      title: 'WhatsApp disconnected',
      detail: wa?.qrPending
        ? 'QR scan needed — scan the code below'
        : reconnecting || wa?.reconnecting
          ? 'Reconnecting…'
          : wa?.lastDisconnectReason || (wa?.authenticated ? 'Authenticated, waiting for ready' : 'Waiting for session'),
    }
  } else if (totals?.uptimeDown) {
    health = { tone: 'danger', title: `${totals.uptimeDown} service${totals.uptimeDown > 1 ? 's' : ''} down`, detail: 'Uptime checks failing' }
  } else if (s?.botPaused) {
    health = { tone: 'warn', title: 'Auto-replies paused', detail: 'The bot is not answering any chat' }
  } else if (totals?.openErrors) {
    health = { tone: 'warn', title: 'Operational with errors', detail: `${totals.openErrors} open error groups in Monitor` }
  }

  const actions: Array<{ icon: IconName; label: string; tone: Tone; onPress: () => void }> = [
    {
      icon: s?.botPaused ? 'play' : 'pause',
      label: s?.botPaused ? 'Resume bot' : 'Pause bot',
      tone: s?.botPaused ? 'ok' : 'warn',
      onPress: () =>
        void patch({ botPaused: !s?.botPaused }, s?.botPaused ? 'Auto-replies resumed' : 'Auto-replies paused'),
    },
    {
      icon: 'refresh',
      label: 'Reconnect WA',
      tone: wa?.ready ? 'info' : 'danger',
      onPress: confirmReconnect,
    },
    { icon: 'sparkles', label: 'Ask PA', tone: 'accent', onPress: () => router.push('/assistant') },
    { icon: 'construct', label: 'Fix job', tone: 'info', onPress: () => router.push('/(tabs)/agent') },
    { icon: 'document-text', label: 'Approvals', tone: 'warn', onPress: () => router.push('/(tabs)/requests') },
    { icon: 'globe', label: 'Atrium', tone: 'neutral', onPress: () => router.push('/(tabs)/atrium') },
  ]

  return (
    <Screen>
      <ScreenScroll
        onRefresh={async () => {
          await Promise.all([load(), refreshFeed()])
        }}
      >
        <View style={styles.topBar}>
          <BrandMark subtitle={greeting()} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <IconButton icon="sparkles" onPress={() => router.push('/assistant')} tone="accent" />
            <IconButton icon="notifications-outline" badge={unread} onPress={() => router.push('/(tabs)/alerts')} />
          </View>
        </View>

        {!status ? (
          <Skeleton height={150} />
        ) : (
          <GradientCard
            colorsPair={
              health.tone === 'danger'
                ? ['#3A1622', '#121722']
                : health.tone === 'warn'
                  ? ['#3A2A12', '#121722']
                  : ['#13284A', '#121722']
            }
          >
            <View style={styles.heroTop}>
              <StatusDot tone={health.tone} pulse size={9} />
              <Text style={[styles.heroEyebrow, { color: toneColors[health.tone].fg }]}>System status</Text>
            </View>
            <Text style={styles.heroTitle}>{health.title}</Text>
            <Text style={styles.heroDetail}>{health.detail}</Text>
            <View style={styles.heroFacts}>
              <HeroFact label="WhatsApp" value={wa?.ready ? 'Ready' : 'Offline'} tone={wa?.ready ? 'ok' : 'danger'} />
              <HeroFact label="Bot" value={s?.botPaused ? 'Paused' : 'Live'} tone={s?.botPaused ? 'warn' : 'ok'} />
              <HeroFact
                label="Monitors"
                value={totals ? (totals.uptimeDown ? `${totals.uptimeDown} down` : 'Healthy') : '—'}
                tone={totals?.uptimeDown ? 'danger' : 'ok'}
              />
            </View>
          </GradientCard>
        )}

        {qrPending ? (
          <Card style={styles.qrCard}>
            <Text style={styles.svcName}>Link WhatsApp</Text>
            <Text style={styles.qrHint}>
              On the business phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code. Open this screen on
              another device (e.g. the web control center) if you're using the same phone.
            </Text>
            {qr ? (
              <View style={styles.qrFrame}>
                <Image source={{ uri: qr }} style={styles.qrImage} resizeMode="contain" accessibilityLabel="WhatsApp pairing QR code" />
              </View>
            ) : (
              <Skeleton height={240} />
            )}
            <Text style={styles.qrHint}>The code refreshes automatically.</Text>
          </Card>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              disabled={saving}
              onPress={() => {
                haptic.tap()
                a.onPress()
              }}
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            >
              <IconTile icon={a.icon} tone={a.tone} size={46} />
              <Text style={styles.actionLabel} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Section title="Pulse">
          <StatGrid>
            <StatTile
              label="Conversations"
              value={compact(status?.counts.conversations)}
              hint={`${status?.counts.paused ?? 0} paused`}
              icon="chatbubbles"
              tone="accent"
              onPress={() => router.push('/(tabs)/chats')}
            />
            <StatTile
              label="Open errors"
              value={compact(totals?.openErrors)}
              hint={totals ? `${compact(totals.httpErrors)} HTTP failures 24h` : 'Monitor'}
              icon="bug"
              tone={totals?.openErrors ? 'danger' : 'ok'}
              onPress={() => router.push('/(tabs)/monitor')}
            />
            <StatTile
              label="Live users"
              value={compact(totals?.liveUsers)}
              hint="Across monitored apps"
              icon="people"
              tone="info"
              onPress={() => router.push('/(tabs)/monitor')}
            />
            <StatTile
              label="Alerts · 24h"
              value={compact(totals?.alerts24h)}
              hint={unread ? `${unread} unread` : 'All caught up'}
              icon="notifications"
              tone={unread ? 'warn' : 'neutral'}
              onPress={() => router.push('/(tabs)/alerts')}
            />
            <StatTile
              label="Approvals"
              value={extras.pendingRequests}
              hint="Pending portal requests"
              icon="document-text"
              tone={extras.pendingRequests ? 'warn' : 'neutral'}
              onPress={() => router.push('/(tabs)/requests')}
            />
            <StatTile
              label="Agent review"
              value={extras.jobsToReview}
              hint={`${extras.openCases} open support cases`}
              icon="desktop"
              tone={extras.jobsToReview ? 'accent' : 'neutral'}
              onPress={() => router.push('/(tabs)/agent')}
            />
          </StatGrid>
        </Section>

        {feed?.projects.length ? (
          <Section title="Services" action="Monitor" onAction={() => router.push('/(tabs)/monitor')}>
            <View style={{ gap: spacing.sm }}>
              {feed.projects.flatMap((p) =>
                p.uptime.slice(0, 3).map((u) => (
                  <Card key={u.id} style={{ gap: 8 }} onPress={() => router.push('/(tabs)/monitor')}>
                    <View style={styles.svcHead}>
                      <StatusDot tone={u.up === false ? 'danger' : u.up ? 'ok' : 'neutral'} pulse={u.up === false} />
                      <Text style={styles.svcName} numberOfLines={1}>
                        {u.name}
                      </Text>
                      <Text style={styles.svcMeta}>
                        {pct(u.okRate)} · {ms(u.latencyMs)}
                      </Text>
                    </View>
                    <HeartbeatBar samples={u.samples} height={16} />
                  </Card>
                ))
              )}
            </View>
          </Section>
        ) : null}

        {feed?.alerts.length ? (
          <Section title="Latest alerts" action="View all" onAction={() => router.push('/(tabs)/alerts')}>
            <View style={{ gap: spacing.sm }}>
              {feed.alerts.slice(0, 4).map((a) => (
                <ListRow
                  key={a.id}
                  leading={
                    <IconTile
                      icon={a.kind === 'uptime' ? 'cloud-offline' : a.kind === 'error' ? 'bug' : 'notifications'}
                      tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info'}
                      size={38}
                    />
                  }
                  title={a.title}
                  subtitle={a.body}
                  meta={`${a.projectName} · ${timeAgo(a.at)}`}
                  onPress={() =>
                    a.kind === 'error' && a.ref
                      ? router.push({ pathname: '/monitor/error', params: { projectId: a.projectId, groupId: a.ref } })
                      : router.push('/(tabs)/alerts')
                  }
                />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Bot controls">
          <Card>
            <View style={styles.waRow}>
              <IconTile icon="logo-whatsapp" tone={wa?.ready ? 'ok' : 'danger'} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.svcName}>WhatsApp session</Text>
                <Text style={styles.svcMeta} numberOfLines={1}>
                  {wa?.ready
                    ? 'Connected'
                    : wa?.qrPending
                      ? 'QR scan needed'
                      : reconnecting || wa?.reconnecting
                        ? 'Reconnecting…'
                        : wa?.authenticated
                          ? 'Authenticated, not ready'
                          : 'Offline'}
                  {wa?.lastReconnectAt ? ` · restarted ${timeAgo(wa.lastReconnectAt)}` : ''}
                </Text>
              </View>
              <Btn
                label="Reconnect"
                icon="refresh"
                compact
                variant={wa?.ready ? 'secondary' : 'danger'}
                loading={reconnecting}
                disabled={reconnecting || !status}
                onPress={confirmReconnect}
              />
            </View>
            <ToggleRow
              icon="flash"
              tone={s?.botPaused ? 'warn' : 'ok'}
              title="Auto-replies"
              subtitle={s?.botPaused ? 'Paused for every chat' : 'Bot is answering chats'}
              value={!s?.botPaused}
              disabled={saving || !s}
              onChange={(v) => void patch({ botPaused: !v }, v ? 'Auto-replies resumed' : 'Auto-replies paused')}
            />
            <ToggleRow
              icon="mic"
              tone="info"
              title="Voice replies"
              subtitle="Answer voice notes with spoken replies"
              value={Boolean(s?.voiceRepliesEnabled)}
              disabled={saving || !s}
              onChange={(v) => void patch({ voiceRepliesEnabled: v }, `Voice replies ${v ? 'on' : 'off'}`)}
            />
            <Text style={styles.fieldLabel}>Speech-to-text language</Text>
            <Wrap>
              {STT.map((l) => (
                <Chip
                  key={l.id}
                  label={l.label}
                  active={s?.sttLanguage === l.id}
                  disabled={saving || !s}
                  onPress={() => void patch({ sttLanguage: l.id }, `STT set to ${l.label}`)}
                />
              ))}
            </Wrap>
          </Card>
          <View style={{ marginTop: spacing.sm }}>
            <QuietHoursCard
              value={s?.quietHours}
              disabled={!s}
              onSave={async (quietHours) => {
                const settings = await paAdmin.patchSettings({ quietHours })
                setStatus((st) => (st ? { ...st, settings } : st))
                toast.success('Quiet hours saved')
              }}
            />
          </View>
        </Section>

        <Pressable onPress={() => router.push('/assistant')} style={{ marginTop: spacing.lg }}>
          <GradientCard colorsPair={['#22195A', '#121722']}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <IconTile icon="sparkles" tone="accent" />
              <View style={{ flex: 1 }}>
                <Text style={styles.svcName}>Ask PA anything</Text>
                <Text style={styles.svcMeta}>“Pause the bot”, “How many leads today?”, voice or text</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={colors.accent} />
            </View>
          </GradientCard>
        </Pressable>
      </ScreenScroll>
    </Screen>
  )
}

function HeroFact({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <View style={styles.heroFact}>
      <Text style={styles.heroFactLabel}>{label}</Text>
      <Text style={[styles.heroFactValue, { color: toneColors[tone].fg }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  qrCard: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  qrHint: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  qrFrame: { backgroundColor: '#fff', padding: 12, borderRadius: radius.md },
  qrImage: { width: 240, height: 240 },
  waRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontFamily: fonts.bold,
    color: colors.text,
    fontSize: 24,
    letterSpacing: -0.3,
  },
  heroDetail: {
    fontFamily: fonts.regular,
    color: colors.textDim,
    fontSize: 13,
    marginTop: -4,
  },
  heroFacts: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  heroFact: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  heroFactLabel: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 11,
  },
  heroFactValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    marginTop: 2,
  },
  actions: {
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
  },
  action: {
    alignItems: 'center',
    width: 68,
    gap: 6,
  },
  actionLabel: {
    fontFamily: fonts.medium,
    color: colors.textDim,
    fontSize: 11,
  },
  svcHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  svcName: {
    flex: 1,
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 14,
  },
  svcMeta: {
    fontFamily: fonts.medium,
    color: colors.muted,
    fontSize: 12,
  },
  fieldLabel: {
    fontFamily: fonts.semiBold,
    color: colors.textDim,
    fontSize: 13,
    marginTop: spacing.xs,
  },
})
