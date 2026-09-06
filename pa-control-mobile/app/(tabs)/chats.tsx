import { useCallback, useState } from 'react'
import { FlatList, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import {
  type ConversationListItem,
  paAdmin,
} from '../../src/api/paAdmin'
import { spacing } from '../../src/theme'
import {
  Badge,
  Btn,
  EmptyState,
  ErrorText,
  Input,
  ListRow,
  Loading,
  PageHeader,
  Row,
  Screen,
} from '../../src/ui/Ui'

export default function ChatsScreen() {
  const [rows, setRows] = useState<ConversationListItem[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (search = q) => {
    setError('')
    try {
      setRows(await paAdmin.listConversations(search))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats')
    } finally {
      setLoading(false)
    }
  }, [q])

  useFocusEffect(
    useCallback(() => {
      void load('')
    }, [load])
  )

  async function toggle(row: ConversationListItem) {
    setBusyId(row.chatId)
    setError('')
    try {
      if (row.autoReplyPaused) await paAdmin.resume(row.chatId)
      else await paAdmin.pause(row.chatId)
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }

  if (loading && !rows.length) return <Loading />

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <PageHeader
        title="Chats"
        subtitle="Search and pause / resume auto-reply per chat"
      />
      <ErrorText>{error}</ErrorText>
      <Row style={{ marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Search name, phone, chat id"
            onSubmitEditing={() => void load(q)}
            style={{ marginBottom: 0 }}
          />
        </View>
        <Btn label="Search" variant="ghost" compact onPress={() => void load(q)} />
      </Row>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.chatId}
        contentContainerStyle={{ paddingBottom: 40, gap: spacing.sm }}
        ListEmptyComponent={<EmptyState message="No conversations" />}
        renderItem={({ item }) => (
          <ListRow
            title={item.contactName || item.contactPhone || item.chatId}
            subtitle={item.preview || '—'}
            meta={`${item.messageCount} msgs`}
            onPress={() =>
              router.push({
                pathname: '/chat/[chatId]',
                params: { chatId: item.chatId },
              })
            }
            trailing={
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <Badge
                  label={item.autoReplyPaused ? 'Paused' : 'Active'}
                  tone={item.autoReplyPaused ? 'warn' : 'ok'}
                />
                <Btn
                  label={item.autoReplyPaused ? 'Resume' : 'Pause'}
                  variant={item.autoReplyPaused ? 'primary' : 'ghost'}
                  compact
                  disabled={busyId === item.chatId}
                  onPress={() => void toggle(item)}
                />
              </View>
            }
          />
        )}
      />
    </Screen>
  )
}
