import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  type AtriumProject,
  type WhatsappGroupRow,
  paAdmin,
} from '../../src/api/paAdmin'
import { colors, fonts, spacing } from '../../src/theme'
import {
  Badge,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Loading,
  Muted,
  PageHeader,
  Panel,
  Screen,
  SectionLabel,
  SuccessText,
} from '../../src/ui/Ui'

type Draft = { selectedIds: string[] }

function projectsFromRow(row: WhatsappGroupRow) {
  return Array.isArray(row.atriumProjects) ? row.atriumProjects : []
}

function idsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export default function GroupsScreen() {
  const [rows, setRows] = useState<WhatsappGroupRow[]>([])
  const [projects, setProjects] = useState<AtriumProject[]>([])
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError('')
    setSuccess('')
    try {
      const [groups, atrium] = await Promise.all([
        paAdmin.listGroups(),
        paAdmin.listAtriumProjects(),
      ])
      setRows(groups)
      setProjects(atrium.projects || [])
      setHint(
        atrium.available && (atrium.projects || []).length > 0
          ? ''
          : atrium.reason ||
              (atrium.available
                ? 'No Taskflow projects returned for this org'
                : 'Could not load Taskflow projects')
      )
      const next: Record<string, Draft> = {}
      for (const g of groups) {
        next[g.chatId] = {
          selectedIds: projectsFromRow(g).map((p) => p.id),
        }
      }
      setDrafts(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function applyGroupUpdate(updated: WhatsappGroupRow) {
    const atriumProjects = projectsFromRow(updated)
    setRows((prev) =>
      prev.map((r) => (r.chatId === updated.chatId ? { ...r, ...updated } : r))
    )
    setDrafts((d) => ({
      ...d,
      [updated.chatId]: { selectedIds: atriumProjects.map((p) => p.id) },
    }))
  }

  async function toggleAutoReply(row: WhatsappGroupRow) {
    setBusyId(row.chatId)
    setError('')
    setSuccess('')
    try {
      const updated = await paAdmin.patchGroup(row.chatId, {
        autoReplyEnabled: !row.autoReplyEnabled,
        name: row.name,
      })
      applyGroupUpdate({
        ...row,
        ...updated,
        atriumProjects: updated.atriumProjects ?? projectsFromRow(row),
        autoReplyEnabled:
          typeof updated.autoReplyEnabled === 'boolean'
            ? updated.autoReplyEnabled
            : !row.autoReplyEnabled,
      })
      setSuccess(
        `${row.name}: auto-reply ${!row.autoReplyEnabled ? 'enabled' : 'disabled'}`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }

  function toggleProject(chatId: string, projectId: string) {
    setDrafts((d) => {
      const cur = d[chatId]?.selectedIds || []
      const selectedIds = cur.includes(projectId)
        ? cur.filter((id) => id !== projectId)
        : [...cur, projectId]
      return { ...d, [chatId]: { selectedIds } }
    })
  }

  async function saveProjects(row: WhatsappGroupRow) {
    const selectedIds = drafts[row.chatId]?.selectedIds || []
    const atriumProjects = projects
      .filter((p) => selectedIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, key: p.key }))
    setBusyId(row.chatId)
    setError('')
    setSuccess('')
    try {
      const updated = await paAdmin.patchGroup(row.chatId, {
        name: row.name,
        atriumProjects,
        autoReplyEnabled:
          atriumProjects.length > 0 ? true : row.autoReplyEnabled,
      })
      applyGroupUpdate({
        ...row,
        ...updated,
        atriumProjects: updated.atriumProjects ?? atriumProjects,
      })
      setSuccess(`${row.name}: projects saved`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <Loading />

  return (
    <Screen style={{ paddingTop: spacing.sm }}>
      <PageHeader
        title="Groups"
        subtitle="Assign Atrium projects and enable auto-reply for support channels"
      />
      <ErrorText>{error || hint}</ErrorText>
      <SuccessText>{success}</SuccessText>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.chatId}
        contentContainerStyle={{ paddingBottom: 48, gap: spacing.sm }}
        ListEmptyComponent={
          <EmptyState message="No WhatsApp groups found. Ensure PA is ready and joined." />
        }
        renderItem={({ item }) => {
          const selected = drafts[item.chatId]?.selectedIds || []
          const saved = projectsFromRow(item).map((p) => p.id)
          const dirty = !idsEqual(selected, saved)
          return (
            <Panel>
              <View style={{ gap: 6 }}>
                <Text style={styles.name}>{item.name || item.chatId}</Text>
                <Badge
                  label={
                    item.autoReplyEnabled
                      ? selected.length
                        ? 'Support channel'
                        : '@mention'
                      : 'Disabled'
                  }
                  tone={item.autoReplyEnabled ? 'ok' : 'neutral'}
                />
              </View>
              <Btn
                label={
                  item.autoReplyEnabled
                    ? 'Disable auto-reply'
                    : 'Enable auto-reply'
                }
                variant="ghost"
                compact
                disabled={busyId === item.chatId}
                onPress={() => void toggleAutoReply(item)}
              />
              <SectionLabel>Atrium projects</SectionLabel>
              {projects.length === 0 ? (
                <Muted>No projects available</Muted>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {projects.map((p) => (
                    <Chip
                      key={p.id}
                      active={selected.includes(p.id)}
                      onPress={() => toggleProject(item.chatId, p.id)}
                      label={p.key ? `${p.name} [${p.key}]` : p.name}
                    />
                  ))}
                </View>
              )}
              <Btn
                label={dirty ? 'Save projects' : 'Saved'}
                disabled={!dirty || busyId === item.chatId}
                onPress={() => void saveProjects(item)}
              />
            </Panel>
          )
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  name: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    fontSize: 16,
  },
})
