import * as Clipboard from 'expo-clipboard'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { FlatList, Linking, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { type WhatsappLead, paAdmin } from '../../src/api/paAdmin'
import { phoneFromChatId, timeAgo } from '../../src/lib/format'
import { colors, fonts, spacing } from '../../src/theme'
import { bucketize, MiniBars } from '../../src/ui/Charts'
import { useToast } from '../../src/ui/Toast'
import {
  Avatar,
  Badge,
  Btn,
  Card,
  EmptyState,
  Header,
  Screen,
  SearchBar,
  SkeletonList,
} from '../../src/ui/Ui'

export default function LeadsScreen() {
  const toast = useToast()
  const [rows, setRows] = useState<WhatsappLead[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await paAdmin.listLeads())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) =>
      [r.title, r.summary, r.contactName, r.contactPhone].some((v) => v?.toLowerCase().includes(s))
    )
  }, [rows, q])

  const weekly = useMemo(() => bucketize(rows.map((r) => r.createdAt), 14, 14 * 24 * 3600_000), [rows])
  const synced = rows.filter((r) => r.crmLeadId).length

  return (
    <Screen>
      <Header title="Leads" subtitle={`${rows.length} captured · ${synced} synced to CRM`} back />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search leads" />
      {loading ? (
        <SkeletonList count={5} height={110} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.panel}
              onRefresh={async () => {
                setRefreshing(true)
                await load()
                setRefreshing(false)
              }}
            />
          }
          ListHeaderComponent={
            rows.length ? (
              <Card style={{ marginBottom: spacing.xs }}>
                <Text style={styles.chartTitle}>New leads · last 14 days</Text>
                <MiniBars values={weekly} color={colors.ok} height={44} />
              </Card>
            ) : null
          }
          ListEmptyComponent={<EmptyState icon="person-add-outline" title="No leads" message="Leads appear when PA qualifies a WhatsApp chat." />}
          renderItem={({ item }) => {
            const name = item.contactName || item.contactPhone || item.chatId.split('@')[0]
            const phone = (item.contactPhone || phoneFromChatId(item.chatId)).replace(/[^\d]/g, '')
            const open = expanded === item._id
            return (
              <Card onPress={() => setExpanded(open ? '' : item._id)}>
                <View style={styles.head}>
                  <Avatar name={name} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.meta}>
                      {name} · {timeAgo(item.createdAt)}
                    </Text>
                  </View>
                  {item.crmLeadId ? <Badge label="CRM" tone="ok" icon="checkmark" /> : <Badge label="Local" tone="warn" />}
                </View>
                <Text style={styles.body} numberOfLines={open ? undefined : 3}>
                  {item.summary}
                </Text>
                {open ? (
                  <View style={styles.actions}>
                    {phone ? (
                      <>
                        <Btn label="Call" icon="call" compact variant="secondary" onPress={() => void Linking.openURL(`tel:+${phone}`)} />
                        <Btn label="WhatsApp" icon="logo-whatsapp" compact variant="success" onPress={() => void Linking.openURL(`https://wa.me/${phone}`)} />
                      </>
                    ) : null}
                    <Btn
                      label="Chat"
                      icon="chatbubbles"
                      compact
                      variant="secondary"
                      onPress={() => router.push({ pathname: '/chat/[chatId]', params: { chatId: item.chatId } })}
                    />
                    <Btn
                      label="Copy"
                      icon="copy"
                      compact
                      variant="ghost"
                      onPress={() =>
                        void Clipboard.setStringAsync(`${item.title}\n${name} ${phone ? `+${phone}` : ''}\n\n${item.summary}`).then(() =>
                          toast.success('Lead copied')
                        )
                      }
                    />
                  </View>
                ) : null}
              </Card>
            )
          }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: 110, gap: spacing.sm },
  chartTitle: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 13 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 },
  body: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
