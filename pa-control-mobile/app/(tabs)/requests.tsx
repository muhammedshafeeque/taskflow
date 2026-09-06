import { useCallback, useState } from 'react'
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  type CustomerRequestRow,
  type ServiceTicketRow,
  paAdmin,
} from '../../src/api/paAdmin'
import { colors, fonts, spacing } from '../../src/theme'
import {
  Badge,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Input,
  ListRow,
  Loading,
  Muted,
  PageHeader,
  Panel,
  Row,
  Screen,
  Segmented,
  SuccessText,
  Title,
} from '../../src/ui/Ui'

type Tab = 'pending' | 'all' | 'tickets'

function labelOf(v: unknown): string {
  if (!v) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as { name?: string; key?: string }
    if (o.name && o.key) return `${o.name} (${o.key})`
    return o.name || '—'
  }
  return String(v)
}

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' {
  if (status.includes('pending')) return 'warn'
  if (status.includes('reject') || status.includes('closed')) return 'danger'
  if (status.includes('approv') || status.includes('resolv')) return 'ok'
  if (status.includes('progress')) return 'accent'
  return 'neutral'
}

export default function RequestsScreen() {
  const [tab, setTab] = useState<Tab>('pending')
  const [requests, setRequests] = useState<CustomerRequestRow[]>([])
  const [tickets, setTickets] = useState<ServiceTicketRow[]>([])
  const [selected, setSelected] = useState<CustomerRequestRow | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [workClassification, setWorkClassification] = useState<
    'billable_change' | 'fix' | ''
  >('')
  const [approveNote, setApproveNote] = useState('')
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      if (tab === 'tickets') {
        const data = await paAdmin.listServiceTickets({})
        setTickets(data.tickets || [])
      } else {
        const data = await paAdmin.listServiceRequests({
          pendingOnly: tab === 'pending',
          limit: 80,
        })
        setRequests(data.requests || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function onApprove() {
    if (!selected || !workClassification) {
      setError('Select work classification')
      return
    }
    setBusy(true)
    setError('')
    try {
      await paAdmin.approveServiceRequest(selected._id, {
        workClassification,
        note: approveNote || undefined,
      })
      setSuccess('Approved')
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await paAdmin.rejectServiceRequest(selected._id, {
        reason: rejectReason || undefined,
      })
      setSuccess('Rejected')
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  async function setTicketStatus(id: string, status: string) {
    setBusy(true)
    try {
      await paAdmin.patchServiceTicket(id, { status })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <PageHeader
        title="Requests"
        subtitle="Approve / reject portal requests and update service tickets"
      />
      <ErrorText>{error}</ErrorText>
      <SuccessText>{success}</SuccessText>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { id: 'pending', label: 'Pending' },
          { id: 'all', label: 'All' },
          { id: 'tickets', label: 'Tickets' },
        ]}
      />

      {tab !== 'tickets' ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState message="No requests" />}
          renderItem={({ item }) => (
            <ListRow
              title={item.title}
              subtitle={labelOf(item.customerOrgId)}
              onPress={() => {
                setSelected(item)
                setWorkClassification('')
                setApproveNote('')
                setRejectReason('')
              }}
              trailing={
                <Badge
                  label={item.status.replace(/_/g, ' ')}
                  tone={statusTone(item.status)}
                />
              }
            />
          )}
        />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState message="No tickets" />}
          renderItem={({ item }) => (
            <Panel>
              <Text style={styles.name}>{item.subject}</Text>
              <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                <Badge label={item.status} tone={statusTone(item.status)} />
                <Badge label={item.priority} tone="neutral" />
              </Row>
              <View style={styles.chipRow}>
                {['in_progress', 'resolved', 'closed'].map((s) => (
                  <Chip
                    key={s}
                    label={s.replace(/_/g, ' ')}
                    active={item.status === s}
                    disabled={busy || item.status === s}
                    onPress={() => void setTicketStatus(item._id, s)}
                  />
                ))}
              </View>
            </Panel>
          )}
        />
      )}

      <Modal visible={Boolean(selected)} animationType="slide">
        <Screen>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Title>{selected?.title || ''}</Title>
                {selected ? (
                  <Badge
                    label={selected.status.replace(/_/g, ' ')}
                    tone={statusTone(selected.status)}
                  />
                ) : null}
              </View>
              <Btn label="Close" variant="ghost" compact onPress={() => setSelected(null)} />
            </Row>
            <Text style={styles.body}>{selected?.description || '—'}</Text>
            {selected?.status === 'pending_taskflow_approval' ? (
              <>
                <Muted>Work classification</Muted>
                <View style={styles.chipRow}>
                  <Chip
                    label="Billable"
                    active={workClassification === 'billable_change'}
                    onPress={() => setWorkClassification('billable_change')}
                  />
                  <Chip
                    label="Fix"
                    active={workClassification === 'fix'}
                    onPress={() => setWorkClassification('fix')}
                  />
                </View>
                <Input
                  placeholder="Approve note"
                  value={approveNote}
                  onChangeText={setApproveNote}
                />
                <Btn
                  label="Approve"
                  disabled={busy}
                  onPress={() => void onApprove()}
                />
                <Input
                  placeholder="Reject reason"
                  value={rejectReason}
                  onChangeText={setRejectReason}
                />
                <Btn
                  label="Reject"
                  variant="danger"
                  disabled={busy}
                  onPress={() => void onReject()}
                />
              </>
            ) : (
              <Muted>Not pending TaskFlow approval</Muted>
            )}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  name: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 15,
  },
  body: {
    fontFamily: fonts.regular,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginVertical: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
})
