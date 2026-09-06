import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import {
  type ConversationDetail,
  paAdmin,
} from '../../src/api/paAdmin'
import { colors, fonts, radius, spacing } from '../../src/theme'
import {
  Badge,
  Btn,
  ErrorText,
  Loading,
  Muted,
  PageHeader,
  Panel,
  Row,
  Screen,
  SectionLabel,
} from '../../src/ui/Ui'

export default function ChatDetailScreen() {
  const { chatId: raw } = useLocalSearchParams<{ chatId: string }>()
  const chatId = decodeURIComponent(raw || '')
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!chatId) return
    setError('')
    try {
      setDetail(await paAdmin.getConversation(chatId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [chatId])

  useEffect(() => {
    void load()
  }, [load])

  async function act(kind: 'pause' | 'resume' | 'reset') {
    setBusy(true)
    setError('')
    try {
      const next =
        kind === 'pause'
          ? await paAdmin.pause(chatId)
          : kind === 'resume'
            ? await paAdmin.resume(chatId)
            : await paAdmin.reset(chatId)
      setDetail(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  if (!detail && !error) return <Loading />

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <PageHeader
          title={detail?.contactName || detail?.contactPhone || chatId}
          subtitle={chatId}
          right={
            detail ? (
              <Badge
                label={detail.autoReplyPaused ? 'Paused' : 'Active'}
                tone={detail.autoReplyPaused ? 'warn' : 'ok'}
              />
            ) : null
          }
        />
        <ErrorText>{error}</ErrorText>
        <Row style={{ marginBottom: spacing.md }}>
          <Btn
            label={detail?.autoReplyPaused ? 'Resume' : 'Pause'}
            disabled={busy}
            onPress={() =>
              void act(detail?.autoReplyPaused ? 'resume' : 'pause')
            }
          />
          <Btn
            label="Reset memory"
            variant="danger"
            disabled={busy}
            onPress={() => void act('reset')}
          />
        </Row>
        {detail?.lead?.summary ? (
          <Panel>
            <SectionLabel>Lead notes</SectionLabel>
            <Muted style={{ marginBottom: 0 }}>{detail.lead.summary}</Muted>
          </Panel>
        ) : null}
        <SectionLabel>Messages</SectionLabel>
        {(detail?.messages || []).map((m, i) => {
          const isAssistant = m.role === 'assistant'
          return (
            <View
              key={`${m.at}-${i}`}
              style={[
                styles.bubbleWrap,
                isAssistant ? styles.wrapLeft : styles.wrapRight,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isAssistant ? styles.assistant : styles.user,
                ]}
              >
                <Badge
                  label={m.role}
                  tone={isAssistant ? 'accent' : 'neutral'}
                />
                <Text style={styles.msg}>{m.content}</Text>
              </View>
            </View>
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  bubbleWrap: {
    marginBottom: spacing.sm,
    maxWidth: '88%',
  },
  wrapLeft: { alignSelf: 'flex-start' },
  wrapRight: { alignSelf: 'flex-end' },
  bubble: {
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  user: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(61,139,253,0.35)',
  },
  assistant: {
    backgroundColor: colors.panel,
  },
  msg: {
    fontFamily: fonts.regular,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
})
