import { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  type BroadcastAudience,
  type BroadcastRow,
  type MessageTemplate,
  paAdmin,
} from '../src/api/paAdmin'
import { timeAgo } from '../src/lib/format'
import { colors, fonts, radius, spacing, type Tone } from '../src/theme'
import { useToast } from '../src/ui/Toast'
import {
  Badge,
  Btn,
  Card,
  Chip,
  EmptyState,
  Header,
  Screen,
  ScreenScroll,
  Section,
  Segmented,
  ToggleRow,
  Wrap,
} from '../src/ui/Ui'

const STATUS_TONE: Record<BroadcastRow['status'], Tone> = {
  draft: 'neutral',
  sending: 'accent',
  paused: 'warn',
  done: 'ok',
  cancelled: 'danger',
}

type Lang = 'any' | 'ml' | 'en'
type Days = '7' | '30' | '90'

export default function BroadcastsScreen() {
  const toast = useToast()
  const [rows, setRows] = useState<BroadcastRow[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [composing, setComposing] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [days, setDays] = useState<Days>('30')
  const [lang, setLang] = useState<Lang>('any')
  const [leadsOnly, setLeadsOnly] = useState(false)
  const [preview, setPreview] = useState<{ count: number; matched: number; optedOut: number; cap: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const audience: BroadcastAudience = {
    activeWithinDays: Number(days),
    ...(lang !== 'any' ? { lang } : {}),
    ...(leadsOnly ? { leadsOnly: true } : {}),
  }

  const load = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([paAdmin.broadcasts(), paAdmin.templates()])
      setRows(b)
      setTemplates(t)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load broadcasts')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  // Live progress while anything is sending.
  useEffect(() => {
    if (!rows.some((r) => r.status === 'sending')) return
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [rows, load])

  useEffect(() => {
    if (!composing) return
    let alive = true
    const t = setTimeout(() => {
      paAdmin
        .previewAudience(audience)
        .then((p) => alive && setPreview(p))
        .catch(() => alive && setPreview(null))
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing, days, lang, leadsOnly])

  async function create(sendNow: boolean) {
    if (!name.trim() || !message.trim()) return toast.error('Name and message are required')
    setBusy(true)
    try {
      const b = await paAdmin.createBroadcast({ name: name.trim(), message: message.trim(), audience })
      if (sendNow) await paAdmin.broadcastAction(b._id, 'send')
      toast.success(sendNow ? 'Broadcast started' : 'Draft saved')
      setComposing(false)
      setName('')
      setMessage('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  function confirmSend() {
    const n = preview?.count ?? 0
    Alert.alert('Send broadcast', `Send to ${n} chat${n === 1 ? '' : 's'}? Messages go out slowly (one every ~10s) to protect your number.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void create(true) },
    ])
  }

  async function act(row: BroadcastRow, action: 'send' | 'pause' | 'cancel') {
    try {
      await paAdmin.broadcastAction(row._id, action)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function saveTemplate() {
    if (!message.trim()) return
    try {
      await paAdmin.createTemplate({ name: name.trim() || message.trim().slice(0, 30), body: message.trim() })
      toast.success('Saved as template')
      setTemplates(await paAdmin.templates())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <Screen>
      <Header
        title="Broadcasts"
        subtitle="Message many chats at once"
        back
        right={!composing ? <Btn label="New" icon="add" compact onPress={() => setComposing(true)} /> : null}
      />
      <ScreenScroll onRefresh={load}>
        {composing ? (
          <Card style={{ gap: spacing.sm }}>
            <Input value={name} onChange={setName} placeholder="Name (only you see this)" />
            {templates.filter((t) => t.usage !== 'reply').length ? (
              <Wrap>
                {templates
                  .filter((t) => t.usage !== 'reply')
                  .map((t) => (
                    <Chip key={t._id} label={t.name} icon="document-text-outline" onPress={() => setMessage(t.body)} />
                  ))}
              </Wrap>
            ) : null}
            <Input value={message} onChange={setMessage} placeholder="Hi {{name}}, …" multiline />
            <Text style={styles.hint}>{'{{name}} becomes the contact’s first name. “Reply STOP to opt out.” is added automatically.'}</Text>

            <Text style={styles.label}>Active in the last</Text>
            <Segmented
              options={[
                { id: '7', label: '7 days' },
                { id: '30', label: '30 days' },
                { id: '90', label: '90 days' },
              ]}
              value={days}
              onChange={setDays}
            />
            <Text style={styles.label}>Language</Text>
            <Segmented
              options={[
                { id: 'any', label: 'Any' },
                { id: 'ml', label: 'Malayalam' },
                { id: 'en', label: 'English' },
              ]}
              value={lang}
              onChange={setLang}
            />
            <ToggleRow icon="person-add" tone="ok" title="Leads only" subtitle="Chats that became a lead" value={leadsOnly} onChange={setLeadsOnly} />

            <View style={styles.previewBox}>
              <Text style={styles.previewText}>
                {preview
                  ? `${preview.count} recipient${preview.count === 1 ? '' : 's'}${preview.matched > preview.cap ? ` (capped from ${preview.matched})` : ''} · ${preview.optedOut} opted out`
                  : 'Counting recipients…'}
              </Text>
            </View>

            <View style={styles.actions}>
              <Btn label="Cancel" variant="ghost" compact onPress={() => setComposing(false)} style={{ flex: 1 }} />
              <Btn label="Save template" variant="secondary" compact disabled={!message.trim()} onPress={() => void saveTemplate()} style={{ flex: 1 }} />
            </View>
            <View style={styles.actions}>
              <Btn label="Save draft" variant="secondary" compact loading={busy} onPress={() => void create(false)} style={{ flex: 1 }} />
              <Btn
                label="Send"
                icon="send"
                compact
                disabled={busy || !preview?.count}
                onPress={confirmSend}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : null}

        <Section title="History">
          {!rows.length ? (
            <EmptyState icon="megaphone-outline" title="No broadcasts yet" message="Send an update to recent chats or leads. Customers can reply STOP to opt out." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {rows.map((r) => (
                <Card key={r._id} style={{ gap: 6 }}>
                  <View style={styles.rowHead}>
                    <Text style={styles.title} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Badge label={r.status} tone={STATUS_TONE[r.status]} />
                  </View>
                  <Text style={styles.body} numberOfLines={3}>
                    {r.message}
                  </Text>
                  <Text style={styles.hint}>
                    {r.total ? `${r.sent}/${r.total} sent · ${r.failed} failed/skipped` : 'Not sent'} · {timeAgo(r.startedAt ?? r.createdAt)}
                  </Text>
                  {r.status === 'sending' && r.total ? (
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${((r.sent + r.failed) / r.total) * 100}%` }]} />
                    </View>
                  ) : null}
                  <View style={styles.actions}>
                    {r.status === 'draft' || r.status === 'paused' ? (
                      <Btn label={r.status === 'draft' ? 'Send' : 'Resume'} icon="play" compact onPress={() => void act(r, 'send')} style={{ flex: 1 }} />
                    ) : null}
                    {r.status === 'sending' ? (
                      <Btn label="Pause" icon="pause" variant="secondary" compact onPress={() => void act(r, 'pause')} style={{ flex: 1 }} />
                    ) : null}
                    {r.status === 'draft' || r.status === 'sending' || r.status === 'paused' ? (
                      <Btn label="Cancel" variant="ghost" compact onPress={() => void act(r, 'cancel')} style={{ flex: 1 }} />
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )}
        </Section>
      </ScreenScroll>
    </Screen>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  multiline,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      multiline={multiline}
      style={[styles.input, multiline && { minHeight: 110, textAlignVertical: 'top' }]}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { fontFamily: fonts.medium, color: colors.textDim, fontSize: 12, marginTop: 4 },
  hint: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11, lineHeight: 15 },
  previewBox: { backgroundColor: colors.panel2, borderRadius: radius.md, padding: 10 },
  previewText: { fontFamily: fonts.medium, color: colors.text, fontSize: 13, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  body: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 13, lineHeight: 18 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.panel2, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
})
