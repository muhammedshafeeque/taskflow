import * as Clipboard from 'expo-clipboard'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  type AgentDeviceRow,
  type AgentJobRow,
  type AtriumProject,
  paAdmin,
} from '../../src/api/paAdmin'
import { humanize, timeAgo } from '../../src/lib/format'
import { colors, fonts, radius, spacing, type Tone } from '../../src/theme'
import { useToast } from '../../src/ui/Toast'
import {
  Badge,
  Btn,
  Card,
  Chip,
  EmptyState,
  GradientCard,
  Header,
  IconButton,
  IconTile,
  Input,
  ListRow,
  Mono,
  Screen,
  ScreenScroll,
  Segmented,
  Sheet,
  SkeletonList,
  StatusDot,
  Wrap,
} from '../../src/ui/Ui'

type Tab = 'jobs' | 'devices'
type JobFilter = 'all' | 'active' | 'needs_review' | 'done' | 'failed'

function statusTone(status: string): Tone {
  if (status === 'needs_review') return 'warn'
  if (status === 'done' || status === 'online') return 'ok'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'running' || status === 'queued') return 'accent'
  return 'neutral'
}

const ACTIVE = new Set(['queued', 'running', 'claimed'])

export default function AgentScreen() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('jobs')
  const [filter, setFilter] = useState<JobFilter>('all')
  const [devices, setDevices] = useState<AgentDeviceRow[]>([])
  const [jobs, setJobs] = useState<AgentJobRow[]>([])
  const [projects, setProjects] = useState<AtriumProject[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [pairOpen, setPairOpen] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [deviceName, setDeviceName] = useState('PC')

  const [createOpen, setCreateOpen] = useState(false)
  const [jobType, setJobType] = useState<'fix_issue' | 'run_command'>('fix_issue')
  const [deviceId, setDeviceId] = useState('')
  const [issueKey, setIssueKey] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [instruction, setInstruction] = useState('')
  const [command, setCommand] = useState('')

  const [jobDetail, setJobDetail] = useState<AgentJobRow | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [deployCmd, setDeployCmd] = useState('')
  const logScroll = useRef<ScrollView>(null)

  const load = useCallback(async () => {
    try {
      const [devs, jobList, atrium] = await Promise.all([
        paAdmin.listAgentDevices(),
        paAdmin.listAgentJobs({}),
        paAdmin.listAtriumProjects().catch(() => ({ available: false, projects: [] as AtriumProject[] })),
      ])
      setDevices(devs || [])
      setJobs(jobList || [])
      setProjects(atrium.projects || [])
      setDeviceId((cur) => cur || devs.find((d) => d.online)?.deviceId || devs[0]?.deviceId || '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useFocusEffect(
    useCallback(() => {
      void load()
      const t = setInterval(() => void load(), 10000)
      return () => clearInterval(t)
    }, [load])
  )

  useEffect(() => {
    if (!jobDetail?.id) return
    const id = jobDetail.id
    const t = setInterval(async () => {
      try {
        setJobDetail(await paAdmin.getAgentJob(id))
      } catch {
        // transient
      }
    }, 2500)
    return () => clearInterval(t)
  }, [jobDetail?.id])

  const filteredJobs = useMemo(
    () =>
      jobs.filter((j) =>
        filter === 'all'
          ? true
          : filter === 'active'
            ? ACTIVE.has(j.status)
            : filter === 'failed'
              ? j.status === 'failed' || j.status === 'cancelled'
              : j.status === filter
      ),
    [jobs, filter]
  )

  const reviewCount = jobs.filter((j) => j.status === 'needs_review').length
  const activeCount = jobs.filter((j) => ACTIVE.has(j.status)).length
  const deviceName_ = (id: string) => devices.find((d) => d.deviceId === id)?.name || id

  async function run<T>(fn: () => Promise<T>, ok: (r: T) => string) {
    setBusy(true)
    try {
      const r = await fn()
      toast.success(ok(r))
      return r
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function onPair() {
    const data = await run(() => paAdmin.createAgentPairing({ name: deviceName }), () => 'Pairing code created')
    if (data) {
      setPairingCode(data.pairingCode)
      void load()
    }
  }

  async function onCreate() {
    if (!deviceId) return toast.error('Pick a device')
    if (jobType === 'fix_issue' && (!issueKey.trim() || !projectId)) return toast.error('Issue key and project required')
    if (jobType === 'run_command' && !command.trim()) return toast.error('Enter a command')
    const job = await run(
      () =>
        paAdmin.createAgentJob(
          jobType === 'fix_issue'
            ? {
                type: 'fix_issue',
                deviceId,
                issueKey: issueKey.trim().toUpperCase(),
                projectId,
                projectKey: projectKey.trim().toUpperCase() || undefined,
                instruction: instruction.trim(),
              }
            : { type: 'run_command', deviceId, command: command.trim() }
        ),
      (j) => `Job ${j.id.slice(-6)} queued`
    )
    if (job) {
      setCreateOpen(false)
      setTab('jobs')
      setJobDetail(job)
      void load()
    }
  }

  async function onApproveDeploy() {
    if (!jobDetail) return
    const data = await run(
      () => paAdmin.approveAgentDeploy(jobDetail.id, deployCmd.trim() || undefined),
      (d) => `Deploy ${d.deployJob.id.slice(-6)} queued`
    )
    if (data) {
      setJobDetail(data.deployJob)
      void load()
    }
  }

  async function onFollowUp() {
    if (!jobDetail || !followUp.trim()) return toast.error('Enter follow-up instructions')
    const job = await run(
      () =>
        paAdmin.createAgentJob({
          type: 'follow_up',
          deviceId: jobDetail.deviceId,
          issueKey: jobDetail.issueKey,
          projectId: jobDetail.projectId,
          projectKey: jobDetail.projectKey,
          instruction: followUp.trim(),
          parentJobId: jobDetail.id,
        }),
      (j) => `Follow-up ${j.id.slice(-6)} queued`
    )
    if (job) {
      setFollowUp('')
      setJobDetail(job)
      void load()
    }
  }

  function revoke(d: AgentDeviceRow) {
    Alert.alert('Revoke device', `Revoke ${d.name}? It will need to pair again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => void run(() => paAdmin.revokeAgentDevice(d.deviceId), () => 'Device revoked').then(() => load()),
      },
    ])
  }

  return (
    <Screen>
      <Header
        title="Agent"
        subtitle="Remote fix & deploy on your PCs"
        back
        right={<IconButton icon="add" tone="accent" onPress={() => setCreateOpen(true)} />}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { id: 'jobs', label: 'Jobs', count: reviewCount || undefined },
          { id: 'devices', label: 'Devices', count: devices.filter((d) => d.online).length || undefined },
        ]}
      />
      <ScreenScroll onRefresh={load}>
        {loading ? <SkeletonList count={5} /> : null}

        {tab === 'jobs' ? (
          <View style={{ gap: spacing.sm }}>
            {reviewCount ? (
              <GradientCard colorsPair={['#3A2A12', '#121722']}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <IconTile icon="eye" tone="warn" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{reviewCount} job(s) need review</Text>
                    <Text style={styles.meta}>Approve the deploy, reject or send follow-up instructions</Text>
                  </View>
                </View>
              </GradientCard>
            ) : null}
            <Wrap>
              {(['all', 'active', 'needs_review', 'done', 'failed'] as const).map((f) => (
                <Chip
                  key={f}
                  label={f === 'needs_review' ? 'Review' : humanize(f)}
                  tone={f === 'needs_review' ? 'warn' : f === 'failed' ? 'danger' : f === 'done' ? 'ok' : 'accent'}
                  active={filter === f}
                  count={f === 'active' ? activeCount : f === 'needs_review' ? reviewCount : undefined}
                  onPress={() => setFilter(f)}
                />
              ))}
            </Wrap>
            {filteredJobs.map((j) => (
              <ListRow
                key={j.id}
                leading={<IconTile icon={j.type === 'deploy' ? 'rocket' : j.type === 'run_command' ? 'terminal' : 'construct'} tone={statusTone(j.status)} size={38} />}
                title={`${humanize(j.type)}${j.issueKey ? ` · ${j.issueKey}` : ''}`}
                subtitle={j.summary?.slice(0, 120) || j.instruction?.slice(0, 120) || j.command || deviceName_(j.deviceId)}
                meta={`${deviceName_(j.deviceId)} · ${timeAgo(j.updatedAt || j.createdAt)}`}
                onPress={() => setJobDetail(j)}
                trailing={<Badge label={humanize(j.status)} tone={statusTone(j.status)} />}
              />
            ))}
            {!loading && !filteredJobs.length ? (
              <EmptyState icon="construct-outline" title="No jobs" message="Queue a fix job and your paired PC will pick it up." action="New job" onAction={() => setCreateOpen(true)} />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Btn label="Pair a new device" icon="link" variant="secondary" block onPress={() => setPairOpen(true)} />
            {devices.map((d) => (
              <Card key={d.deviceId} onPress={() => setDeviceId(d.deviceId)} tone={deviceId === d.deviceId ? 'accent' : undefined}>
                <View style={styles.devHead}>
                  <IconTile icon="desktop" tone={d.online ? 'ok' : 'neutral'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{d.name || d.deviceId}</Text>
                    <Text style={styles.meta}>
                      {d.userLabel ? `${d.userLabel} · ` : ''}seen {timeAgo(d.lastSeenAt)}
                    </Text>
                  </View>
                  <StatusDot tone={d.online ? 'ok' : 'neutral'} pulse={d.online} />
                </View>
                <Wrap>
                  <Badge label={`${d.workspaces?.length || 0} workspaces`} tone="neutral" icon="folder" />
                  <Badge label={`${d.allowCommands?.length || 0} commands`} tone="neutral" icon="terminal" />
                  {(d.aiProviders || []).map((p) => (
                    <Badge key={p} label={p} tone="accent" icon="sparkles" />
                  ))}
                </Wrap>
                {d.workspaces?.length ? (
                  <Text style={styles.meta} numberOfLines={2}>
                    {d.workspaces.map((w) => w.projectKey).join(' · ')}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn label="New job here" icon="add" compact variant="secondary" onPress={() => { setDeviceId(d.deviceId); setCreateOpen(true) }} />
                  <Btn label="Revoke" icon="ban" compact variant="ghost" onPress={() => revoke(d)} />
                </View>
              </Card>
            ))}
            {!loading && !devices.length ? (
              <EmptyState icon="desktop-outline" title="No devices" message="Pair a PC running the ivx CLI to send it jobs." />
            ) : null}
          </View>
        )}
      </ScreenScroll>

      <Sheet visible={pairOpen} onClose={() => { setPairOpen(false); setPairingCode('') }} title="Pair a device" subtitle="Run the code with the ivx CLI on your PC">
        <Input label="Device name" value={deviceName} onChangeText={setDeviceName} />
        {pairingCode ? (
          <View style={styles.codeBox}>
            <Text style={styles.code} selectable>
              {pairingCode}
            </Text>
            <Mono style={{ textAlign: 'center' }}>ivx pair {pairingCode}</Mono>
            <Btn
              label="Copy command"
              icon="copy"
              compact
              variant="secondary"
              style={{ alignSelf: 'center', marginTop: spacing.sm }}
              onPress={() => void Clipboard.setStringAsync(`ivx pair ${pairingCode}`).then(() => toast.success('Copied'))}
            />
          </View>
        ) : (
          <Btn label="Generate pairing code" icon="key" block loading={busy} onPress={() => void onPair()} />
        )}
      </Sheet>

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New agent job"
        footer={
          <>
            <Btn label="Cancel" variant="ghost" onPress={() => setCreateOpen(false)} style={{ flex: 1 }} />
            <Btn label="Queue job" icon="send" loading={busy} onPress={() => void onCreate()} style={{ flex: 1 }} />
          </>
        }
      >
        <Segmented
          style={{ marginHorizontal: 0 }}
          value={jobType}
          onChange={setJobType}
          options={[
            { id: 'fix_issue', label: 'Fix issue' },
            { id: 'run_command', label: 'Run command' },
          ]}
        />
        <Text style={styles.label}>Device</Text>
        <Wrap style={{ marginBottom: spacing.md }}>
          {devices.map((d) => (
            <Chip key={d.deviceId} label={d.name} icon={d.online ? 'radio-button-on' : 'radio-button-off'} tone={d.online ? 'ok' : 'accent'} active={deviceId === d.deviceId} onPress={() => setDeviceId(d.deviceId)} />
          ))}
        </Wrap>
        {jobType === 'fix_issue' ? (
          <>
            <Text style={styles.label}>Project</Text>
            <Wrap style={{ marginBottom: spacing.md }}>
              {projects.slice(0, 20).map((p) => (
                <Chip
                  key={p.id}
                  label={p.key || p.name}
                  active={projectId === p.id}
                  onPress={() => {
                    setProjectId(p.id)
                    setProjectKey(p.key || '')
                  }}
                />
              ))}
            </Wrap>
            <Input label="Issue key" value={issueKey} onChangeText={setIssueKey} placeholder={`${projectKey || 'APP'}-12`} autoCapitalize="characters" />
            <Input label="Extra instructions" value={instruction} onChangeText={setInstruction} placeholder="Optional guidance for the AI" multiline />
          </>
        ) : (
          <>
            <Input label="Command (must be allowlisted on the device)" value={command} onChangeText={setCommand} placeholder="npm test" autoCapitalize="none" />
            {devices.find((d) => d.deviceId === deviceId)?.allowCommands?.length ? (
              <Wrap>
                {devices
                  .find((d) => d.deviceId === deviceId)
                  ?.allowCommands?.map((c) => <Chip key={c} label={c} icon="terminal" onPress={() => setCommand(c)} active={command === c} />)}
              </Wrap>
            ) : null}
          </>
        )}
      </Sheet>

      <Sheet
        visible={Boolean(jobDetail)}
        onClose={() => setJobDetail(null)}
        title={jobDetail ? `${humanize(jobDetail.type)}${jobDetail.issueKey ? ` · ${jobDetail.issueKey}` : ''}` : ''}
        subtitle={jobDetail ? `${deviceName_(jobDetail.deviceId)} · ${timeAgo(jobDetail.updatedAt || jobDetail.createdAt)}` : ''}
      >
        {jobDetail ? (
          <View style={{ gap: spacing.sm }}>
            <Wrap>
              <Badge label={humanize(jobDetail.status)} tone={statusTone(jobDetail.status)} />
              {ACTIVE.has(jobDetail.status) ? <StatusDot tone="accent" pulse /> : null}
            </Wrap>
            {jobDetail.summary ? <Text style={styles.body}>{jobDetail.summary.slice(0, 1200)}</Text> : null}
            {jobDetail.error ? <Text style={[styles.body, { color: colors.danger }]}>{jobDetail.error}</Text> : null}
            {jobDetail.diffStat ? (
              <View style={styles.logBox}>
                <Mono>{jobDetail.diffStat}</Mono>
              </View>
            ) : null}
            <Text style={styles.label}>Logs</Text>
            <ScrollView
              ref={logScroll}
              style={styles.logBox}
              nestedScrollEnabled
              onContentSizeChange={() => logScroll.current?.scrollToEnd({ animated: false })}
            >
              {(jobDetail.logs || []).slice(-150).map((l, i) => (
                <Mono key={`${i}-${l.line.slice(0, 12)}`} style={{ fontSize: 11 }}>
                  {l.line}
                </Mono>
              ))}
              {!jobDetail.logs?.length ? <Mono>Waiting for output…</Mono> : null}
            </ScrollView>
            {jobDetail.status === 'needs_review' ? (
              <>
                <Input label="Deploy command" value={deployCmd} onChangeText={setDeployCmd} placeholder="Allowlisted deploy command" autoCapitalize="none" />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn label="Approve deploy" icon="rocket" variant="success" loading={busy} onPress={() => void onApproveDeploy()} style={{ flex: 1 }} />
                  <Btn
                    label="Reject"
                    icon="close"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => void run(() => paAdmin.rejectAgentJob(jobDetail.id), () => 'Job rejected').then((j) => j && setJobDetail(j))}
                    style={{ flex: 1 }}
                  />
                </View>
                <Input label="Follow-up instructions" value={followUp} onChangeText={setFollowUp} placeholder="Ask the agent to change something" multiline />
                <Btn label="Send follow-up" icon="return-down-forward" variant="secondary" block loading={busy} onPress={() => void onFollowUp()} />
              </>
            ) : null}
            {!['done', 'cancelled', 'failed'].includes(jobDetail.status) ? (
              <Btn
                label="Cancel job"
                icon="stop-circle"
                variant="danger"
                block
                disabled={busy}
                onPress={() => void run(() => paAdmin.cancelAgentJob(jobDetail.id), () => 'Job cancelled').then((j) => j && setJobDetail(j))}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semiBold, color: colors.text, fontSize: 15 },
  meta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 },
  body: { fontFamily: fonts.regular, color: colors.textDim, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.semiBold, color: colors.textDim, fontSize: 13, marginBottom: 6 },
  devHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codeBox: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  code: {
    fontFamily: fonts.bold,
    fontSize: 34,
    letterSpacing: 6,
    color: colors.accent,
    textAlign: 'center',
  },
  logBox: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    maxHeight: 260,
  },
})
