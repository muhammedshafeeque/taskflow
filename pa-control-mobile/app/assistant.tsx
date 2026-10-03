import { Ionicons } from '@expo/vector-icons'
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { assistantApi } from '../src/api/paAdmin'
import { clock, humanize } from '../src/lib/format'
import { haptic } from '../src/lib/haptics'
import { colors, fonts, gradients, radius, spacing } from '../src/theme'
import { useToast } from '../src/ui/Toast'
import { Badge, Chip, Header, IconButton, Screen, StatusDot } from '../src/ui/Ui'

type Msg = { id: string; role: 'user' | 'assistant'; text: string; action?: string; at: number }

const NON_OPS = new Set(['none', 'assistant', 'assistant_error', 'unknown'])

const SUGGESTIONS = [
  'Give me a status summary',
  'What issues are overdue?',
  'What is in progress this sprint?',
  'Any new CRM leads this week?',
  'Open service tickets breaching SLA?',
  'Any new errors in Monitor?',
  "What's on my calendar today?",
  'How many chats are paused?',
  'Pause the bot',
]

export default function AssistantScreen() {
  const toast = useToast()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 'hello',
      role: 'assistant',
      text: 'Hi! I have live access to Atrium — projects, issues, sprints, CRM, service desk, calendar, Monitor and HR — plus the WhatsApp bot. Ask anything or tell me to update an issue. Type or hold the mic to talk.',
      at: Date.now(),
    },
  ])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [recording, setRecording] = useState(false)
  const [speak, setSpeak] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const player = useRef<AudioPlayer | null>(null)
  const scroll = useRef<ScrollView>(null)

  useEffect(() => {
    return () => player.current?.remove()
  }, [])

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60)
  }, [messages, thinking])

  async function playReply(reply: string) {
    try {
      const lang = /[ഀ-ൿ]/.test(reply) ? 'ml' : 'en'
      const audio = await assistantApi.speak(reply.slice(0, 600), lang)
      const file = new File(Paths.cache, `pa-reply-${Date.now()}.mp3`)
      file.write(audio.audioBase64, { encoding: 'base64' })
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })
      player.current?.remove()
      player.current = createAudioPlayer(file.uri)
      player.current.play()
    } catch {
      // speech is best-effort
    }
  }

  async function send(raw: string) {
    const q = raw.trim()
    if (!q || thinking) return
    setText('')
    haptic.tap()
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: q, at: Date.now() }])
    setThinking(true)
    try {
      const res = await assistantApi.command(q, 'chat')
      setMessages((m) => [
        ...m,
        { id: `a${Date.now()}`, role: 'assistant', text: res.reply || 'Done.', action: res.action, at: Date.now() },
      ])
      if (res.action && !NON_OPS.has(res.action)) haptic.success()
      if (speak && res.reply) void playReply(res.reply)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assistant failed')
    } finally {
      setThinking(false)
    }
  }

  async function startRecording() {
    if (Platform.OS === 'web') {
      toast.error('Voice input is available on the phone app')
      return
    }
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) {
      toast.error('Microphone permission denied')
      return
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setRecording(true)
      haptic.impact()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start recording')
    }
  }

  async function stopRecording() {
    if (!recording) return
    setRecording(false)
    haptic.tap()
    try {
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) return
      setThinking(true)
      const b64 = await new File(uri).base64()
      const { text: heard } = await assistantApi.transcribe(b64, 'audio/mp4', 'auto')
      setThinking(false)
      if (heard?.trim()) await send(heard)
      else toast.show({ message: "Didn't catch that — try again", tone: 'warn' })
    } catch (err) {
      setThinking(false)
      toast.error(err instanceof Error ? err.message : 'Transcription failed')
    }
  }

  return (
    <Screen>
      <Header
        title="Ask PA"
        subtitle="Atrium + WhatsApp · voice & text"
        back
        right={
          <IconButton
            icon={speak ? 'volume-high' : 'volume-mute'}
            tone={speak ? 'accent' : undefined}
            onPress={() => {
              setSpeak((s) => !s)
              toast.show({ message: speak ? 'Spoken replies off' : 'Spoken replies on', tone: 'info' })
            }}
          />
        }
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {messages.map((m) => (
            <View key={m.id} style={[styles.bubbleWrap, m.role === 'user' ? styles.right : styles.left]}>
              {m.role === 'user' ? (
                <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, styles.userBubble]}>
                  <Text style={[styles.msg, { color: '#fff' }]}>{m.text}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.bubble, styles.botBubble]}>
                  {m.action && !NON_OPS.has(m.action) ? (
                    <Badge label={humanize(m.action)} tone="ok" icon="checkmark" />
                  ) : null}
                  <Text style={styles.msg} selectable>
                    {m.text}
                  </Text>
                </View>
              )}
              <Text style={[styles.time, m.role === 'user' && { textAlign: 'right' }]}>{clock(m.at)}</Text>
            </View>
          ))}
          {thinking ? (
            <View style={[styles.bubble, styles.botBubble, styles.left, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <StatusDot tone="accent" pulse />
              <Text style={[styles.msg, { color: colors.muted }]}>Thinking…</Text>
            </View>
          ) : null}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}
          style={{ flexGrow: 0 }}
        >
          {SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} onPress={() => void send(s)} />
          ))}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={recording ? 'Listening…' : 'Ask or command…'}
            placeholderTextColor={recording ? colors.danger : colors.muted}
            style={styles.input}
            multiline
            onSubmitEditing={() => void send(text)}
            blurOnSubmit
            returnKeyType="send"
          />
          {text.trim() ? (
            <Pressable onPress={() => void send(text)} style={styles.sendBtn}>
              <LinearGradient colors={gradients.brand} style={styles.sendGrad}>
                <Ionicons name="arrow-up" size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable
              onPressIn={() => void startRecording()}
              onPressOut={() => void stopRecording()}
              style={styles.sendBtn}
            >
              <LinearGradient colors={recording ? gradients.danger : gradients.brand} style={[styles.sendGrad, recording && styles.recording]}>
                <Ionicons name={recording ? 'radio' : 'mic'} size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  bubbleWrap: { maxWidth: '86%', gap: 3 },
  left: { alignSelf: 'flex-start' },
  right: { alignSelf: 'flex-end' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  userBubble: { borderBottomRightRadius: 6 },
  botBubble: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  msg: { fontFamily: fonts.regular, color: colors.text, fontSize: 15, lineHeight: 21 },
  time: { fontFamily: fonts.regular, color: colors.muted, fontSize: 10, paddingHorizontal: 4 },
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
  recording: { transform: [{ scale: 1.12 }] },
})
