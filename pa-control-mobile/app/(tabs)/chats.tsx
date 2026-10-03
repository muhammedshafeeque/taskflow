import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { type ConversationListItem, paAdmin } from '../../src/api/paAdmin'
import { timeAgo } from '../../src/lib/format'
import { colors, fonts, spacing } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Avatar,
  Badge,
  Btn,
  Chip,
  ChipScroll,
  EmptyState,
  Header,
  ListRow,
  Screen,
  SearchBar,
  Sheet,
  SkeletonList,
} from '../../src/ui/Ui'

type Filter = 'all' | 'active' | 'paused' | 'leads'

export default function ChatsScreen() {
  const toast = useToast()
  const [rows, setRows] = useState<ConversationListItem[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<ConversationListItem | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (search: string) => {
      try {
        setRows(await paAdmin.listConversations(search))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load chats')
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useFocusEffect(
    useCallback(() => {
      void load(q)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  )

  useEffect(() => {
    const t = setTimeout(() => void load(q), 350)
    return () => clearTimeout(t)
  }, [q, load])

  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        filter === 'all'
          ? true
          : filter === 'paused'
            ? r.autoReplyPaused
            : filter === 'active'
              ? !r.autoReplyPaused
              : Boolean(r.crmLeadId || r.localLeadId)
      ),
    [rows, filter]
  )

  const counts = useMemo(
    () => ({
      paused: rows.filter((r) => r.autoReplyPaused).length,
      leads: rows.filter((r) => r.crmLeadId || r.localLeadId).length,
    }),
    [rows]
  )

  async function act(row: ConversationListItem, kind: 'pause' | 'resume' | 'reset') {
    setBusy(true)
    try {
      if (kind === 'pause') await paAdmin.pause(row.chatId)
      else if (kind === 'resume') await paAdmin.resume(row.chatId)
      else await paAdmin.reset(row.chatId)
      toast.success(kind === 'reset' ? 'Memory cleared' : kind === 'pause' ? 'Auto-reply paused' : 'Auto-reply resumed')
      setSelected(null)
      await load(q)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const name = (r: ConversationListItem) => r.contactName || r.contactPhone || r.chatId.split('@')[0]

  return (
    <Screen>
      <Header title="Inbox" subtitle={`${rows.length} WhatsApp conversations`} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search name, phone, chat id" />
      <View style={{ paddingLeft: spacing.md }}>
        <ChipScroll>
          <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} count={rows.length} />
          <Chip label="Active" tone="ok" active={filter === 'active'} onPress={() => setFilter('active')} />
          <Chip label="Paused" tone="warn" icon="pause" active={filter === 'paused'} onPress={() => setFilter('paused')} count={counts.paused} />
          <Chip label="Leads" tone="info" icon="person-add" active={filter === 'leads'} onPress={() => setFilter('leads')} count={counts.leads} />
        </ChipScroll>
      </View>
      {loading && !rows.length ? (
        <SkeletonList count={7} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.chatId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.panel}
              onRefresh={async () => {
                setRefreshing(true)
                await load(q)
                setRefreshing(false)
              }}
            />
          }
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No conversations" message="Try another search or filter." />}
          renderItem={({ item }) => (
            <ListRow
              leading={<Avatar name={name(item)} />}
              title={name(item)}
              subtitle={item.preview || '—'}
              meta={`${item.messageCount} msgs · ${timeAgo(item.updatedAt)}${item.lastLang ? ` · ${item.lastLang}` : ''}`}
              onPress={() => router.push({ pathname: '/chat/[chatId]', params: { chatId: item.chatId } })}
              onLongPress={() => setSelected(item)}
              trailing={
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  {item.autoReplyPaused ? <Badge label="Paused" tone="warn" icon="pause" /> : <Badge label="Bot" tone="ok" icon="flash" />}
                  {item.crmLeadId || item.localLeadId ? <Badge label="Lead" tone="info" /> : null}
                </View>
              }
            />
          )}
        />
      )}
      <Text style={styles.hint}>Long-press a chat for quick actions</Text>

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? name(selected) : ''} subtitle={selected?.chatId}>
        {selected ? (
          <View style={{ gap: spacing.sm }}>
            <Btn
              block
              icon={selected.autoReplyPaused ? 'play' : 'pause'}
              label={selected.autoReplyPaused ? 'Resume auto-reply' : 'Pause auto-reply'}
              variant={selected.autoReplyPaused ? 'success' : 'secondary'}
              loading={busy}
              onPress={() => void act(selected, selected.autoReplyPaused ? 'resume' : 'pause')}
            />
            <Btn
              block
              icon="open"
              label="Open conversation"
              variant="secondary"
              onPress={() => {
                const id = selected.chatId
                setSelected(null)
                router.push({ pathname: '/chat/[chatId]', params: { chatId: id } })
              }}
            />
            <Btn block icon="trash" label="Reset memory" variant="danger" loading={busy} onPress={() => void act(selected, 'reset')} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: 110, gap: spacing.sm },
  hint: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 11,
    opacity: 0.7,
  },
})
