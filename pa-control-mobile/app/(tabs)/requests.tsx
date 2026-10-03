import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { type CustomerRequestRow, type ServiceTicketRow, paAdmin } from '../../src/api/paAdmin'
import { humanize } from '../../src/lib/format'
import { colors, fonts, spacing, type Tone } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Badge,
  Btn,
  Card,
  Chip,
  EmptyState,
  Header,
  IconTile,
  Input,
  ListRow,
  Screen,
  Segmented,
  Sheet,
  SkeletonList,
  Wrap,
} from '../../src/ui/Ui'

type Tab = 'pending' | 'all' | 'tickets'

function labelOf(v: unknown): string {
  if (!v) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as { name?: string; key?: string; title?: string }
    if (o.name && o.key) return `${o.name} (${o.key})`
    return o.name || o.key || o.title || '—'
  }
  return String(v)
}

function statusTone(status: string): Tone {
  if (status.includes('pending')) return 'warn'
  if (status.includes('reject') || status.includes('closed')) return 'danger'
  if (status.includes('approv') || status.includes('resolv')) return 'ok'
  if (status.includes('progress')) return 'accent'
  return 'neutral'
}

function priorityTone(p?: string): Tone {
  if (!p) return 'neutral'
  if (/urgent|critical|highest/i.test(p)) return 'danger'
  if (/high/i.test(p)) return 'warn'
  return 'neutral'
}

export default function RequestsScreen() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('pending')
  const [requests, setRequests] = useState<CustomerRequestRow[]>([])
  const [tickets, setTickets] = useState<ServiceTicketRow[]>([])
  const [selected, setSelected] = useState<CustomerRequestRow | null>(null)
  const [ticket, setTicket] = useState<ServiceTicketRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [workClassification, setWorkClassification] = useState<'billable_change' | 'fix' | ''>('')
  const [note, setNote] = useState('')
  const [comment, setComment] = useState('')

  const load = useCallback(async () => {
    try {
      if (tab === 'tickets') {
        const data = await paAdmin.listServiceTickets({})
        setTickets(data.tickets || [])
      } else {
        const data = await paAdmin.listServiceRequests({ pendingOnly: tab === 'pending', limit: 80 })
        setRequests(data.requests || [])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tab, toast])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load()
    }, [load])
  )

  async function onApprove() {
    if (!selected) return
    if (!workClassification) return toast.error('Choose a work classification')
    setBusy(true)
    try {
      await paAdmin.approveServiceRequest(selected._id, { workClassification, note: note || undefined })
      toast.success('Request approved')
      setSelected(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!selected) return
    setBusy(true)
    try {
      await paAdmin.rejectServiceRequest(selected._id, { reason: note || undefined })
      toast.success('Request rejected')
      setSelected(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  async function updateTicket(body: { status?: string; priority?: string; comment?: string }, msg: string) {
    if (!ticket) return
    setBusy(true)
    try {
      await paAdmin.patchServiceTicket(ticket._id, body)
      toast.success(msg)
      setTicket((t) => (t ? { ...t, ...(body.status ? { status: body.status } : {}), ...(body.priority ? { priority: body.priority } : {}) } : t))
      if (body.comment) setComment('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const refresh = (
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
  )

  return (
    <Screen>
      <Header title="Requests" subtitle="Portal approvals & service tickets" back />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { id: 'pending', label: 'Pending', count: tab === 'pending' ? requests.length : undefined },
          { id: 'all', label: 'All' },
          { id: 'tickets', label: 'Tickets' },
        ]}
      />
      {loading ? (
        <SkeletonList count={6} />
      ) : tab !== 'tickets' ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          refreshControl={refresh}
          ListEmptyComponent={
            <EmptyState icon="checkmark-done-outline" title={tab === 'pending' ? 'Inbox zero' : 'No requests'} message="Nothing waiting for approval." />
          }
          renderItem={({ item }) => (
            <Card
              onPress={() => {
                setSelected(item)
                setWorkClassification('')
                setNote('')
              }}
            >
              <View style={styles.head}>
                <IconTile icon="document-text" tone={statusTone(item.status)} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {labelOf(item.customerOrgId)} · {labelOf(item.projectId)}
                  </Text>
                </View>
              </View>
              <Wrap>
                <Badge label={humanize(item.status)} tone={statusTone(item.status)} />
                {item.type ? <Badge label={humanize(item.type)} tone="neutral" /> : null}
                {item.priority ? <Badge label={humanize(item.priority)} tone={priorityTone(item.priority)} /> : null}
              </Wrap>
            </Card>
          )}
        />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          refreshControl={refresh}
          ListEmptyComponent={<EmptyState icon="ticket-outline" message="No service tickets." />}
          renderItem={({ item }) => (
            <ListRow
              leading={<IconTile icon="ticket" tone={statusTone(item.status)} size={38} />}
              title={item.subject}
              subtitle={`${labelOf(item.projectId)}${item.linkedIssueId ? ` · ${labelOf(item.linkedIssueId)}` : ''}`}
              onPress={() => {
                setTicket(item)
                setComment('')
              }}
              trailing={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={humanize(item.status)} tone={statusTone(item.status)} />
                  <Badge label={humanize(item.priority)} tone={priorityTone(item.priority)} />
                </View>
              }
            />
          )}
        />
      )}

      <Sheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title}
        subtitle={selected ? `${labelOf(selected.customerOrgId)} · ${labelOf(selected.projectId)}` : ''}
        footer={
          selected?.status === 'pending_taskflow_approval' ? (
            <>
              <Btn label="Reject" icon="close" variant="danger" loading={busy} onPress={() => void onReject()} style={{ flex: 1 }} />
              <Btn label="Approve" icon="checkmark" variant="success" loading={busy} onPress={() => void onApprove()} style={{ flex: 1 }} />
            </>
          ) : undefined
        }
      >
        {selected ? (
          <View style={{ gap: spacing.sm }}>
            <Wrap>
              <Badge label={humanize(selected.status)} tone={statusTone(selected.status)} />
              {selected.type ? <Badge label={humanize(selected.type)} tone="neutral" /> : null}
              {selected.priority ? <Badge label={humanize(selected.priority)} tone={priorityTone(selected.priority)} /> : null}
            </Wrap>
            <Text style={styles.body} selectable>
              {selected.description || 'No description provided.'}
            </Text>
            {selected.status === 'pending_taskflow_approval' ? (
              <>
                <Text style={styles.label}>Work classification</Text>
                <Wrap>
                  <Chip label="Billable change" icon="cash" tone="warn" active={workClassification === 'billable_change'} onPress={() => setWorkClassification('billable_change')} />
                  <Chip label="Fix (no charge)" icon="build" tone="ok" active={workClassification === 'fix'} onPress={() => setWorkClassification('fix')} />
                </Wrap>
                <Input label="Note / reject reason" value={note} onChangeText={setNote} placeholder="Optional" multiline />
              </>
            ) : (
              <Text style={styles.meta}>This request is not awaiting TaskFlow approval.</Text>
            )}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(ticket)} onClose={() => setTicket(null)} title={ticket?.subject} subtitle={ticket ? labelOf(ticket.projectId) : ''}>
        {ticket ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.label}>Status</Text>
            <Wrap>
              {['open', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => (
                <Chip
                  key={s}
                  label={humanize(s)}
                  tone={statusTone(s)}
                  active={ticket.status === s}
                  disabled={busy || ticket.status === s}
                  onPress={() => void updateTicket({ status: s }, `Status → ${humanize(s)}`)}
                />
              ))}
            </Wrap>
            <Text style={styles.label}>Priority</Text>
            <Wrap>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <Chip
                  key={p}
                  label={humanize(p)}
                  tone={priorityTone(p) === 'neutral' ? 'accent' : priorityTone(p)}
                  active={ticket.priority === p}
                  disabled={busy || ticket.priority === p}
                  onPress={() => void updateTicket({ priority: p }, `Priority → ${humanize(p)}`)}
                />
              ))}
            </Wrap>
            <Input label="Add comment" value={comment} onChangeText={setComment} placeholder="Visible on the ticket" multiline />
            <Btn label="Post comment" icon="chatbubble" block loading={busy} disabled={!comment.trim()} onPress={() => void updateTicket({ comment: comment.trim() }, 'Comment added')} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: 110, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 },
  body: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 14, lineHeight: 21 },
  label: { fontFamily: fonts.semiBold, color: colors.textDim, fontSize: 13, marginTop: spacing.xs },
})
