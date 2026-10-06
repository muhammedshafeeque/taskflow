import * as Clipboard from 'expo-clipboard'
import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { type ConversationDetail, type MessageTemplate, paAdmin } from '../../src/api/paAdmin'
import { clock, phoneFromChatId } from '../../src/lib/format'
import { haptic } from '../../src/lib/haptics'
import { colors, fonts, gradients, radius, spacing } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import { Avatar, Badge, Btn, Card, Chip, Header, IconButton, Loading, Screen } from '../../src/ui/Ui'

export default function ChatDetailScreen() {
  const { chatId: raw } = useLocalSearchParams<{ chatId: string }>()
  const chatId = decodeURIComponent(raw || '')
  const toast = useToast()
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [quickReplies, setQuickReplies] = useState<MessageTemplate[]>([])
  useEffect(() => {
    paAdmin
      .templates()
      .then((t) => setQuickReplies(t.filter((x) => x.usage !== 'broadcast')))
      .catch(() => undefined)
  }, [])
  const insets = useSafeAreaInsets()
  const scroll = useRef<ScrollView>(null)

  const load = useCallback(async () => {
    if (!chatId) return
    try {
      setDetail(await paAdmin.getConversation(chatId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [chatId, toast])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15000)
    return () => clearInterval(t)
  }, [load])

  async function act(kind: 'pause' | 'resume' | 'reset') {
    setBusy(true)
    try {
      const next =
        kind === 'pause'
          ? await paAdmin.pause(chatId)
          : kind === 'resume'
            ? await paAdmin.resume(chatId)
            : await paAdmin.reset(chatId)
      setDetail(next)
      toast.success(kind === 'reset' ? 'Memory cleared' : kind === 'pause' ? 'Auto-reply paused' : 'Auto-reply resumed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const next = await paAdmin.sendMessage(chatId, text)
      setDraft('')
      setDetail(next)
      haptic.success()
      if (!detail?.autoReplyPaused) toast.success('Sent · bot paused for this chat')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!detail) {
    return (
      <Screen>
        <Header title="Chat" back />
        <Loading />
      </Screen>
    )
  }

  const name = detail.contactName || detail.contactPhone || chatId.split('@')[0]
  const phone = (detail.contactPhone || phoneFromChatId(chatId)).replace(/[^\d]/g, '')

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Header
        title={name}
        subtitle={detail.autoReplyPaused ? 'Auto-reply paused' : 'Bot is replying'}
        back
        right={
          phone ? (
            <>
              <IconButton icon="call" onPress={() => void Linking.openURL(`tel:+${phone}`)} />
              <IconButton icon="logo-whatsapp" tone="ok" onPress={() => void Linking.openURL(`https://wa.me/${phone}`)} />
            </>
          ) : null
        }
      />
      <View style={styles.actions}>
        <Btn
          label={detail.autoReplyPaused ? 'Resume bot' : 'Pause bot'}
          icon={detail.autoReplyPaused ? 'play' : 'pause'}
          variant={detail.autoReplyPaused ? 'success' : 'secondary'}
          compact
          loading={busy}
          onPress={() => void act(detail.autoReplyPaused ? 'resume' : 'pause')}
          style={{ flex: 1 }}
        />
        <Btn
          label="Reset memory"
          icon="trash"
          variant="ghost"
          compact
          disabled={busy}
          onPress={() =>
            Alert.alert('Reset memory', 'Clear the conversation memory for this chat?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => void act('reset') },
            ])
          }
          style={{ flex: 1 }}
        />
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <View style={styles.profile}>
          <Avatar name={name} size={64} />
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profileSub}>{chatId}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {detail.lastLang ? <Badge label={detail.lastLang.toUpperCase()} tone="neutral" /> : null}
            {detail.crmLeadId ? <Badge label={`CRM ${detail.crmLeadId.slice(-6)}`} tone="info" /> : null}
            <Badge label={`${detail.messages.length} msgs`} tone="neutral" />
          </View>
        </View>
        {detail.lead?.summary ? (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={styles.leadTitle}>Lead notes</Text>
            <Text style={styles.leadBody}>{detail.lead.summary}</Text>
          </Card>
        ) : null}
        {detail.messages.map((m, i) => {
          const bot = m.role === 'assistant'
          const human = bot && m.by === 'human'
          const copy = () => {
            haptic.impact()
            void Clipboard.setStringAsync(m.content).then(() => toast.success('Message copied'))
          }
          return (
            <Pressable key={`${m.at}-${i}`} onLongPress={copy} style={[styles.bubbleWrap, bot ? styles.left : styles.right]}>
              {bot ? (
                <LinearGradient colors={human ? gradients.ok : gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, styles.botBubble]}>
                  <Text style={[styles.msg, { color: '#fff' }]}>{m.content}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.bubble, styles.userBubble]}>
                  <Text style={styles.msg}>{m.content}</Text>
                </View>
              )}
              <Text style={[styles.time, !bot && { textAlign: 'right' }]}>
                {human ? 'You' : bot ? 'PA' : 'Customer'}
                {m.at ? ` · ${clock(m.at)}` : ''}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      {quickReplies.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.quick}>
          {quickReplies.map((t) => (
            <Chip
              key={t._id}
              label={t.name}
              icon="flash-outline"
              onPress={() => setDraft(t.body.replace(/\{\{\s*name\s*\}\}/gi, (detail.contactName || '').split(/\s+/)[0] || 'there'))}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={detail.autoReplyPaused ? 'Reply as the business…' : 'Reply — this pauses the bot for this chat'}
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
          maxLength={4000}
        />
        <Pressable onPress={() => void send()} disabled={!draft.trim() || sending} style={[styles.sendBtn, !draft.trim() && { opacity: 0.4 }]}>
          <LinearGradient colors={gradients.brand} style={styles.sendGrad}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </LinearGradient>
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  thread: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  profile: { alignItems: 'center', gap: 4, marginBottom: spacing.lg },
  profileName: { fontFamily: fonts.bold, color: colors.text, fontSize: 18, marginTop: spacing.xs },
  profileSub: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  leadTitle: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 14 },
  leadBody: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  bubbleWrap: { maxWidth: '84%', gap: 3 },
  left: { alignSelf: 'flex-start' },
  right: { alignSelf: 'flex-end' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  botBubble: { borderBottomLeftRadius: 6 },
  userBubble: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomRightRadius: 6,
  },
  msg: { fontFamily: fonts.regular, color: colors.text, fontSize: 15, lineHeight: 21 },
  time: { fontFamily: fonts.regular, color: colors.muted, fontSize: 10, paddingHorizontal: 4 },
  quick: { gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  sendBtn: { borderRadius: 22, overflow: 'hidden' },
  sendGrad: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
