import { useCallback, useEffect, useRef, useState } from 'react'
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
  type AgentDeviceRow,
  type AgentJobRow,
  type AtriumProject,
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

type Tab = 'devices' | 'jobs'

function statusTone(
  status: string
): 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' {
  if (status === 'needs_review') return 'warn'
  if (status === 'done' || status === 'online') return 'ok'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'running' || status === 'queued') return 'accent'
  return 'neutral'
}

export default function AgentScreen() {
  const [tab, setTab] = useState<Tab>('devices')
  const [devices, setDevices] = useState<AgentDeviceRow[]>([])
  const [jobs, setJobs] = useState<AgentJobRow[]>([])
  const [projects, setProjects] = useState<AtriumProject[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [deviceName, setDeviceName] = useState('PC')

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [issueKey, setIssueKey] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [instruction, setInstruction] = useState('')

  const [jobDetail, setJobDetail] = useState<AgentJobRow | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [deployCmd, setDeployCmd] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [devs, jobList, atrium] = await Promise.all([
        paAdmin.listAgentDevices(),
        paAdmin.listAgentJobs({}),
        paAdmin.listAtriumProjects().catch(() => ({
          available: false,
          projects: [] as AtriumProject[],
        })),
      ])
      setDevices(devs || [])
      setJobs(jobList || [])
      setProjects(atrium.projects || [])
      if (!selectedDeviceId && devs?.[0]) {
        setSelectedDeviceId(devs[0].deviceId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [selectedDeviceId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    if (!jobDetail?.id) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    const tick = async () => {
      try {
        const j = await paAdmin.getAgentJob(jobDetail.id)
        setJobDetail(j)
      } catch {
        // ignore transient
      }
    }
    void tick()
    pollRef.current = setInterval(() => void tick(), 2500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobDetail?.id])

  async function onPair() {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const data = await paAdmin.createAgentPairing({ name: deviceName })
      setPairingCode(data.pairingCode)
      setSuccess(`Run on PC: ivx pair ${data.pairingCode}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed')
    } finally {
      setBusy(false)
    }
  }

  async function onCreateFix() {
    if (!selectedDeviceId || !issueKey.trim() || !projectId.trim()) {
      setError('Device, issue key, and project id required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const job = await paAdmin.createAgentJob({
        type: 'fix_issue',
        deviceId: selectedDeviceId,
        issueKey: issueKey.trim().toUpperCase(),
        projectId: projectId.trim(),
        projectKey: projectKey.trim().toUpperCase() || undefined,
        instruction: instruction.trim(),
      })
      setCreateOpen(false)
      setSuccess(`Job ${job.id} queued`)
      setTab('jobs')
      setJobDetail(job)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function onApproveDeploy() {
    if (!jobDetail) return
    setBusy(true)
    setError('')
    try {
      const data = await paAdmin.approveAgentDeploy(
        jobDetail.id,
        deployCmd.trim() || undefined
      )
      setSuccess(`Deploy job ${data.deployJob.id} queued`)
      setJobDetail(data.deployJob)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function onFollowUp() {
    if (!jobDetail || !followUp.trim()) {
      setError('Enter follow-up instructions')
      return
    }
    setBusy(true)
    setError('')
    try {
      const job = await paAdmin.createAgentJob({
        type: 'follow_up',
        deviceId: jobDetail.deviceId,
        issueKey: jobDetail.issueKey,
        projectId: jobDetail.projectId,
        projectKey: jobDetail.projectKey,
        instruction: followUp.trim(),
        parentJobId: jobDetail.id,
      })
      setFollowUp('')
      setSuccess(`Follow-up ${job.id} queued`)
      setJobDetail(job)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow-up failed')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel() {
    if (!jobDetail) return
    setBusy(true)
    try {
      const job = await paAdmin.cancelAgentJob(jobDetail.id)
      setJobDetail(job)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!jobDetail) return
    setBusy(true)
    try {
      const job = await paAdmin.rejectAgentJob(jobDetail.id)
      setJobDetail(job)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Screen>
        <PageHeader title="Agent" subtitle="Remote PC jobs" />
        <Loading />
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHeader
        title="Agent"
        subtitle="Pair a PC CLI and push fix / deploy jobs"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {success ? <SuccessText>{success}</SuccessText> : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { id: 'devices', label: 'Devices' },
          { id: 'jobs', label: 'Jobs' },
        ]}
      />

      {tab === 'devices' ? (
        <ScrollView contentContainerStyle={styles.pad}>
          <Panel>
            <Title>Pair new device</Title>
            <Muted>Show this code on the PC: ivx pair CODE</Muted>
            <Input
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder="Device name"
            />
            <Btn label={busy ? '…' : 'Create pairing code'} onPress={onPair} />
            {pairingCode ? (
              <Text style={styles.code}>{pairingCode}</Text>
            ) : null}
          </Panel>

          <Btn label="New fix job" onPress={() => setCreateOpen(true)} />

          {devices.length === 0 ? (
            <EmptyState message="No devices — create a pairing code, then run ivx pair on your PC." />
          ) : (
            devices.map((d) => (
              <ListRow
                key={d.deviceId}
                title={d.name || d.deviceId}
                subtitle={`${d.deviceId} · ${d.workspaces?.length || 0} workspaces · ${d.allowCommands?.length || 0} cmds`}
                trailing={
                  <Badge
                    tone={d.online ? 'ok' : 'neutral'}
                    label={d.online ? 'online' : 'offline'}
                  />
                }
                onPress={() => {
                  setSelectedDeviceId(d.deviceId)
                  setSuccess(`Selected ${d.name}`)
                }}
              />
            ))
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
          contentContainerStyle={styles.pad}
          ListEmptyComponent={
            <EmptyState message="No jobs — create a fix job from Devices." />
          }
          renderItem={({ item }) => (
            <ListRow
              title={`${item.type} ${item.issueKey || ''}`.trim()}
              subtitle={`${item.status} · ${item.deviceId}`}
              trailing={
                <Badge tone={statusTone(item.status)} label={item.status} />
              }
              onPress={() => setJobDetail(item)}
            />
          )}
        />
      )}

      <Modal visible={createOpen} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <Panel style={styles.modalCard}>
            <Title>Fix on my PC</Title>
            <Muted>Uses TaskFlow issue context via PA</Muted>
            <Input
              value={selectedDeviceId}
              onChangeText={setSelectedDeviceId}
              placeholder="Device id"
            />
            <Row style={styles.wrap}>
              {devices.map((d) => (
                <Chip
                  key={d.deviceId}
                  label={d.name}
                  active={selectedDeviceId === d.deviceId}
                  onPress={() => setSelectedDeviceId(d.deviceId)}
                />
              ))}
            </Row>
            <Input
              value={issueKey}
              onChangeText={setIssueKey}
              placeholder="Issue key e.g. APP-12"
              autoCapitalize="characters"
            />
            <Input
              value={projectId}
              onChangeText={setProjectId}
              placeholder="Project id"
            />
            <Input
              value={projectKey}
              onChangeText={setProjectKey}
              placeholder="Project key (optional)"
              autoCapitalize="characters"
            />
            <Row style={styles.wrap}>
              {projects.slice(0, 8).map((p) => (
                <Chip
                  key={p.id}
                  label={p.key || p.name}
                  active={projectId === p.id}
                  onPress={() => {
                    setProjectId(p.id)
                    if (p.key) setProjectKey(p.key)
                  }}
                />
              ))}
            </Row>
            <Input
              value={instruction}
              onChangeText={setInstruction}
              placeholder="Extra instructions"
              multiline
            />
            <Row>
              <Btn
                label="Cancel"
                variant="ghost"
                onPress={() => setCreateOpen(false)}
              />
              <Btn label={busy ? '…' : 'Queue fix'} onPress={onCreateFix} />
            </Row>
          </Panel>
        </View>
      </Modal>

      <Modal visible={Boolean(jobDetail)} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <Panel style={styles.modalCard}>
            <ScrollView>
              <Title>
                {jobDetail?.type} {jobDetail?.issueKey}
              </Title>
              <Badge
                tone={statusTone(jobDetail?.status || '')}
                label={jobDetail?.status || ''}
              />
              {jobDetail?.summary ? (
                <Muted>{jobDetail.summary.slice(0, 800)}</Muted>
              ) : null}
              {jobDetail?.diffStat ? (
                <Text style={styles.mono}>{jobDetail.diffStat}</Text>
              ) : null}
              <Text style={styles.logTitle}>Logs</Text>
              <View style={styles.logBox}>
                {(jobDetail?.logs || []).slice(-80).map((l, i) => (
                  <Text key={`${i}-${l.line.slice(0, 12)}`} style={styles.mono}>
                    {l.line}
                  </Text>
                ))}
              </View>
              {jobDetail?.status === 'needs_review' ? (
                <>
                  <Input
                    value={deployCmd}
                    onChangeText={setDeployCmd}
                    placeholder="Deploy command (must be allowlisted)"
                  />
                  <Row>
                    <Btn label="Approve deploy" onPress={onApproveDeploy} />
                    <Btn label="Reject" variant="ghost" onPress={onReject} />
                  </Row>
                  <Input
                    value={followUp}
                    onChangeText={setFollowUp}
                    placeholder="More instructions"
                    multiline
                  />
                  <Btn label="Follow-up" onPress={onFollowUp} />
                </>
              ) : null}
              {jobDetail &&
              !['done', 'cancelled', 'failed'].includes(jobDetail.status) ? (
                <Btn label="Cancel job" variant="danger" onPress={onCancel} />
              ) : null}
              <Btn
                label="Close"
                variant="ghost"
                onPress={() => setJobDetail(null)}
              />
            </ScrollView>
          </Panel>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  pad: { paddingBottom: spacing.lg, gap: spacing.sm },
  code: {
    fontFamily: fonts.semiBold,
    fontSize: 28,
    letterSpacing: 4,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '88%',
    margin: spacing.md,
    gap: spacing.sm,
  },
  wrap: { flexWrap: 'wrap', gap: 6 },
  mono: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  },
  logTitle: {
    fontFamily: fonts.semiBold,
    color: colors.text,
    marginTop: spacing.sm,
  },
  logBox: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: spacing.sm,
    maxHeight: 220,
    gap: 2,
  },
})
