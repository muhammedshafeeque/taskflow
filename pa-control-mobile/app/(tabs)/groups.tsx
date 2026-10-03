import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import {
  type AtriumProject,
  type CustomerOrgOption,
  type WhatsappGroupRow,
  paAdmin,
} from '../../src/api/paAdmin'
import { colors, fonts, spacing } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Avatar,
  Badge,
  Banner,
  Btn,
  Card,
  Chip,
  EmptyState,
  Header,
  Screen,
  SearchBar,
  SkeletonList,
  ToggleRow,
  Wrap,
  type IconName,
} from '../../src/ui/Ui'

type CapKey =
  | 'kbEnabled'
  | 'portalRequestsEnabled'
  | 'ticketStatusEnabled'
  | 'issueStatusEnabled'
  | 'billingEnabled'
  | 'hrmsEnabled'
  | 'assetsEnabled'
  | 'procurementEnabled'

const CAP_FLAGS: Array<{ key: CapKey; label: string; icon: IconName }> = [
  { key: 'kbEnabled', label: 'Knowledge base', icon: 'book' },
  { key: 'portalRequestsEnabled', label: 'Portal requests', icon: 'document-text' },
  { key: 'ticketStatusEnabled', label: 'Tickets', icon: 'ticket' },
  { key: 'issueStatusEnabled', label: 'Issues', icon: 'git-branch' },
  { key: 'billingEnabled', label: 'Billing', icon: 'card' },
  { key: 'hrmsEnabled', label: 'HR', icon: 'id-card' },
  { key: 'assetsEnabled', label: 'Assets', icon: 'hardware-chip' },
  { key: 'procurementEnabled', label: 'POs', icon: 'cart' },
]

function projectsFromRow(row: WhatsappGroupRow) {
  return Array.isArray(row.atriumProjects) ? row.atriumProjects : []
}

function idsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export default function GroupsScreen() {
  const toast = useToast()
  const [rows, setRows] = useState<WhatsappGroupRow[]>([])
  const [projects, setProjects] = useState<AtriumProject[]>([])
  const [customerOrgs, setCustomerOrgs] = useState<CustomerOrgOption[]>([])
  const [hint, setHint] = useState('')
  const [busyId, setBusyId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      const [groups, atrium, orgsRes] = await Promise.all([
        paAdmin.listGroups(),
        paAdmin.listAtriumProjects(),
        paAdmin.listCustomerOrgs().catch(() => ({ orgs: [] as CustomerOrgOption[] })),
      ])
      setRows(groups)
      setProjects(atrium.projects || [])
      setCustomerOrgs(orgsRes.orgs || [])
      setHint(
        atrium.available && (atrium.projects || []).length > 0
          ? ''
          : atrium.reason || (atrium.available ? 'No Taskflow projects returned for this org' : 'Could not load Taskflow projects')
      )
      setDrafts(Object.fromEntries(groups.map((g) => [g.chatId, projectsFromRow(g).map((p) => p.id)])))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load groups')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function apply(updated: WhatsappGroupRow) {
    setRows((prev) => prev.map((r) => (r.chatId === updated.chatId ? { ...r, ...updated } : r)))
    setDrafts((d) => ({ ...d, [updated.chatId]: projectsFromRow(updated).map((p) => p.id) }))
  }

  async function patch(row: WhatsappGroupRow, body: Parameters<typeof paAdmin.patchGroup>[1], msg: string) {
    setBusyId(row.chatId)
    try {
      const updated = await paAdmin.patchGroup(row.chatId, { name: row.name, ...body })
      apply({ ...row, ...updated, atriumProjects: updated.atriumProjects ?? projectsFromRow(row) })
      toast.success(msg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }

  async function saveProjects(row: WhatsappGroupRow) {
    const selectedIds = drafts[row.chatId] || []
    const atriumProjects = projects
      .filter((p) => selectedIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, key: p.key }))
    await patch(
      row,
      { atriumProjects, autoReplyEnabled: atriumProjects.length > 0 ? true : row.autoReplyEnabled },
      `${row.name}: projects saved`
    )
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter((r) => (r.name || r.chatId).toLowerCase().includes(s)) : rows
  }, [rows, q])

  const active = rows.filter((r) => r.autoReplyEnabled).length

  return (
    <Screen>
      <Header title="Groups" subtitle={`${rows.length} groups · ${active} with auto-reply`} back />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search groups" />
      {hint ? <Banner tone="warn">{hint}</Banner> : null}
      {loading ? (
        <SkeletonList count={6} />
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
                await load()
                setRefreshing(false)
              }}
            />
          }
          ListEmptyComponent={<EmptyState icon="people-outline" message="No WhatsApp groups found. Ensure PA is ready and joined." />}
          renderItem={({ item }) => {
            const selected = drafts[item.chatId] || []
            const saved = projectsFromRow(item).map((p) => p.id)
            const dirty = !idsEqual(selected, saved)
            const open = expanded === item.chatId
            const busy = busyId === item.chatId
            const caps = CAP_FLAGS.filter((f) => item[f.key]).length
            return (
              <Card onPress={() => setExpanded(open ? '' : item.chatId)} tone={open ? 'accent' : undefined}>
                <View style={styles.head}>
                  <Avatar name={item.name || item.chatId} icon="people" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name || item.chatId}
                    </Text>
                    <Text style={styles.meta}>
                      {saved.length} project{saved.length === 1 ? '' : 's'} · {caps} capabilities
                      {item.customerOrgName ? ` · ${item.customerOrgName}` : ''}
                    </Text>
                  </View>
                  <Badge
                    label={item.autoReplyEnabled ? (saved.length ? 'Support' : '@mention') : 'Off'}
                    tone={item.autoReplyEnabled ? 'ok' : 'neutral'}
                  />
                </View>

                {open ? (
                  <View style={{ gap: spacing.sm }}>
                    <ToggleRow
                      title="Auto-reply"
                      subtitle="PA answers in this group"
                      value={item.autoReplyEnabled}
                      disabled={busy}
                      onChange={(v) => void patch(item, { autoReplyEnabled: v }, `${item.name}: auto-reply ${v ? 'on' : 'off'}`)}
                    />
                    <Text style={styles.label}>Customer org</Text>
                    <Wrap>
                      <Chip label="None" active={!item.customerOrgId} disabled={busy} onPress={() => void patch(item, { customerOrgId: null, customerOrgName: null }, 'Customer org cleared')} />
                      {customerOrgs.map((o) => (
                        <Chip
                          key={o.id}
                          label={o.name}
                          active={item.customerOrgId === o.id}
                          disabled={busy}
                          onPress={() => void patch(item, { customerOrgId: o.id, customerOrgName: o.name }, `Linked to ${o.name}`)}
                        />
                      ))}
                    </Wrap>
                    <Text style={styles.label}>Capabilities</Text>
                    <Wrap>
                      {CAP_FLAGS.map((f) => (
                        <Chip
                          key={f.key}
                          label={f.label}
                          icon={f.icon}
                          tone="info"
                          active={Boolean(item[f.key])}
                          disabled={busy}
                          onPress={() => void patch(item, { [f.key]: !item[f.key] }, `${f.label} ${item[f.key] ? 'disabled' : 'enabled'}`)}
                        />
                      ))}
                    </Wrap>
                    <Text style={styles.label}>Atrium projects</Text>
                    {projects.length ? (
                      <Wrap>
                        {projects.map((p) => (
                          <Chip
                            key={p.id}
                            label={p.key ? `${p.name} · ${p.key}` : p.name}
                            tone="ok"
                            active={selected.includes(p.id)}
                            onPress={() =>
                              setDrafts((d) => {
                                const cur = d[item.chatId] || []
                                return {
                                  ...d,
                                  [item.chatId]: cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id],
                                }
                              })
                            }
                          />
                        ))}
                      </Wrap>
                    ) : (
                      <Text style={styles.meta}>No projects available</Text>
                    )}
                    {dirty ? (
                      <Btn label="Save projects" icon="save" loading={busy} block onPress={() => void saveProjects(item)} />
                    ) : null}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 },
  label: { fontFamily: fonts.semiBold, color: colors.textDim, fontSize: 13, marginTop: spacing.xs },
})
