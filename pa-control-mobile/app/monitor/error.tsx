import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { monitorApi, type MonitorErrorGroup } from '../../src/api/paAdmin'
import { compact, timeAgo } from '../../src/lib/format'
import { useAlerts } from '../../src/state/AlertsContext'
import { colors, fonts, radius, spacing } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Badge,
  Btn,
  Card,
  Header,
  KeyValue,
  Loading,
  Mono,
  Screen,
  ScreenScroll,
  StatGrid,
  StatTile,
  Wrap,
} from '../../src/ui/Ui'

export default function ErrorDetailScreen() {
  const { projectId = '', groupId = '' } = useLocalSearchParams<{ projectId: string; groupId: string }>()
  const toast = useToast()
  const { feed, refresh: refreshFeed } = useAlerts()
  const [group, setGroup] = useState<MonitorErrorGroup | null>(null)
  const [busy, setBusy] = useState(false)
  const projectName = feed?.projects.find((p) => p.id === projectId)?.name

  const load = useCallback(async () => {
    try {
      setGroup(await monitorApi.errorGroup(projectId, groupId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load error')
    }
  }, [projectId, groupId, toast])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(status: 'open' | 'resolved') {
    setBusy(true)
    try {
      setGroup(await monitorApi.setErrorStatus(projectId, groupId, status))
      toast.success(status === 'resolved' ? 'Marked resolved' : 'Reopened')
      void refreshFeed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const report = group
    ? `${group.type || 'Error'}: ${group.message}\nProject: ${projectName || projectId}\nCount: ${group.count}\nFirst: ${group.firstSeen}\nLast: ${group.lastSeen}\n\n${group.sampleStack || ''}`
    : ''

  if (!group) {
    return (
      <Screen>
        <Header title="Error" back />
        <Loading />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header title={group.type || 'Error'} subtitle={projectName} back />
      <ScreenScroll onRefresh={load}>
        <Card tone={group.status === 'open' ? 'danger' : 'ok'}>
          <Wrap>
            <Badge label={group.status === 'open' ? 'Open' : 'Resolved'} tone={group.status === 'open' ? 'danger' : 'ok'} />
            <Badge label={group.kind || 'unhandled'} tone="neutral" />
          </Wrap>
          <Text style={styles.message} selectable>
            {group.message}
          </Text>
        </Card>

        <View style={{ marginTop: spacing.sm }}>
          <StatGrid>
            <StatTile label="Occurrences" value={compact(group.count)} icon="repeat" tone={group.count >= 10 ? 'danger' : 'warn'} />
            <StatTile label="Last seen" value={timeAgo(group.lastSeen)} icon="time" tone="info" hint={`First ${timeAgo(group.firstSeen)}`} />
          </StatGrid>
        </View>

        <Card style={{ marginTop: spacing.sm }}>
          <KeyValue k="Group id" v={group._id} mono />
          <KeyValue k="App" v={group.appId} mono />
          <KeyValue k="Environment" v={group.environmentId} mono />
          <KeyValue k="First seen" v={group.firstSeen ? new Date(group.firstSeen).toLocaleString() : ''} />
          <KeyValue k="Last seen" v={group.lastSeen ? new Date(group.lastSeen).toLocaleString() : ''} />
        </Card>

        <Text style={styles.label}>Stack trace</Text>
        <View style={styles.stackBox}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Mono style={{ color: colors.textDim, lineHeight: 18 }}>{group.sampleStack || 'No stack captured.'}</Mono>
          </ScrollView>
        </View>

        <View style={styles.actions}>
          {group.status === 'open' ? (
            <Btn label="Resolve" icon="checkmark-done" variant="success" loading={busy} onPress={() => void setStatus('resolved')} style={{ flex: 1 }} />
          ) : (
            <Btn label="Reopen" icon="refresh" variant="danger" loading={busy} onPress={() => void setStatus('open')} style={{ flex: 1 }} />
          )}
          <Btn
            label="Copy"
            icon="copy"
            variant="secondary"
            onPress={() => {
              void Clipboard.setStringAsync(report).then(() => toast.success('Copied to clipboard'))
            }}
            style={{ flex: 1 }}
          />
          <Btn
            label="Share"
            icon="share-social"
            variant="secondary"
            onPress={() => void Share.share({ message: report })}
            style={{ flex: 1 }}
          />
        </View>
      </ScreenScroll>
    </Screen>
  )
}

const styles = StyleSheet.create({
  message: {
    fontFamily: fonts.medium,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    fontFamily: fonts.semiBold,
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  stackBox: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    maxHeight: 420,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
})
