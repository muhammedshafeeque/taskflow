import type { Request, Response } from 'express';
import { getIssueByKey } from '../Support/context/ecosystemIngest';
import { emitAgentJobEvent, subscribeAgentJob } from './events';
import {
  AgentDevice,
  generateDeviceId,
  generateDeviceToken,
  generatePairingCode,
  hashSecret,
  type AgentDeviceDoc,
  type AgentWorkspace,
} from './models/AgentDevice';
import {
  AgentJob,
  type AgentJobDoc,
  type AgentJobType,
} from './models/AgentJob';
import {
  assertPathJail,
  isCommandAllowed,
  mergeAllowCommands,
  redactLogLine,
  requireWorkspaceRoots,
  workspaceRootsFromEnv,
} from './security';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const ONLINE_TTL_MS = 90 * 1000;

function publicDevice(d: AgentDeviceDoc) {
  return {
    deviceId: d.deviceId,
    name: d.name,
    userLabel: d.userLabel || '',
    lastSeenAt: d.lastSeenAt,
    online: Boolean(
      d.online &&
        d.lastSeenAt &&
        Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_TTL_MS
    ),
    workspaces: d.workspaces || [],
    allowCommands: d.allowCommands || [],
    aiProviders: d.aiProviders || [],
    revokedAt: d.revokedAt,
    createdAt: d.createdAt,
  };
}

function publicJob(j: AgentJobDoc) {
  return {
    id: String(j._id),
    type: j.type,
    status: j.status,
    deviceId: j.deviceId,
    issueKey: j.issueKey,
    projectId: j.projectId,
    projectKey: j.projectKey,
    instruction: j.instruction,
    command: j.command,
    issueContext: j.issueContext,
    parentJobId: j.parentJobId,
    logs: (j.logs || []).slice(-200),
    summary: j.summary,
    diffStat: j.diffStat,
    artifacts: j.artifacts,
    error: j.error,
    claimedAt: j.claimedAt,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

export async function listDevices() {
  const rows = (await AgentDevice.find({ revokedAt: null })
    .sort({ lastSeenAt: -1, createdAt: -1 })
    .lean()) as unknown as AgentDeviceDoc[];
  return rows.map(publicDevice);
}

export async function createPairingDevice(input: {
  name?: string;
  userLabel?: string;
}) {
  const pairingCode = generatePairingCode();
  const deviceId = generateDeviceId();
  // Placeholder hash until register exchanges code for real token
  const placeholder = hashSecret(`pending:${deviceId}:${pairingCode}`);
  const doc = await AgentDevice.create({
    deviceId,
    name: (input.name || 'PC').trim() || 'PC',
    userLabel: (input.userLabel || '').trim(),
    deviceTokenHash: placeholder,
    pairingCodeHash: hashSecret(pairingCode),
    pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
    online: false,
    workspaces: [],
    allowCommands: [],
    aiProviders: ['claude', 'gemini'],
  });
  return {
    device: publicDevice(doc as unknown as AgentDeviceDoc),
    pairingCode,
    expiresAt: doc.pairingExpiresAt,
  };
}

export async function revokeDevice(deviceId: string) {
  const doc = await AgentDevice.findOneAndUpdate(
    { deviceId, revokedAt: null },
    { $set: { revokedAt: new Date(), online: false } },
    { new: true }
  );
  if (!doc) throw new Error('Device not found');
  return publicDevice(doc as unknown as AgentDeviceDoc);
}

export async function registerDevice(pairingCode: string, name?: string) {
  const code = pairingCode.trim().toUpperCase();
  if (!code) throw new Error('Pairing code required');
  const hash = hashSecret(code);
  const doc = await AgentDevice.findOne({
    pairingCodeHash: hash,
    revokedAt: null,
  });
  if (!doc) throw new Error('Invalid pairing code');
  if (
    !doc.pairingExpiresAt ||
    new Date(doc.pairingExpiresAt).getTime() < Date.now()
  ) {
    throw new Error('Pairing code expired');
  }
  const token = generateDeviceToken();
  doc.deviceTokenHash = hashSecret(token);
  doc.pairingCodeHash = undefined;
  doc.pairingExpiresAt = undefined;
  if (name?.trim()) doc.name = name.trim();
  doc.lastSeenAt = new Date();
  doc.online = true;
  await doc.save();
  return {
    deviceId: doc.deviceId,
    deviceToken: token,
    device: publicDevice(doc as unknown as AgentDeviceDoc),
  };
}

export async function findDeviceByToken(
  token: string
): Promise<AgentDeviceDoc | null> {
  if (!token?.trim()) return null;
  const doc = await AgentDevice.findOne({
    deviceTokenHash: hashSecret(token.trim()),
    revokedAt: null,
  });
  return doc as unknown as AgentDeviceDoc | null;
}

export async function heartbeatDevice(
  device: AgentDeviceDoc,
  body: {
    workspaces?: AgentWorkspace[];
    allowCommands?: string[];
    aiProviders?: string[];
    name?: string;
  }
) {
  const roots = workspaceRootsFromEnv();
  requireWorkspaceRoots(roots);

  const workspaces = (body.workspaces || device.workspaces || []).map((w) => ({
    projectKey: String(w.projectKey || '').trim().toUpperCase(),
    projectId: w.projectId ? String(w.projectId) : undefined,
    localPath: assertPathJail(String(w.localPath || ''), roots),
  }));

  // Devices cannot widen allowCommands after bootstrap — only shrink or keep.
  const allowCommands = mergeAllowCommands(
    device.allowCommands || [],
    body.allowCommands
  );

  const update: Record<string, unknown> = {
    lastSeenAt: new Date(),
    online: true,
    workspaces,
    allowCommands,
  };
  if (body.aiProviders?.length) {
    update.aiProviders = body.aiProviders.filter((p) =>
      ['claude', 'gemini'].includes(p)
    );
  }
  if (body.name?.trim()) update.name = body.name.trim();

  const doc = await AgentDevice.findOneAndUpdate(
    { deviceId: device.deviceId, revokedAt: null },
    { $set: update },
    { new: true }
  );
  return publicDevice((doc || device) as AgentDeviceDoc);
}

export async function listJobs(opts: {
  deviceId?: string;
  status?: string;
  limit?: number;
}) {
  const q: Record<string, unknown> = {};
  if (opts.deviceId) q.deviceId = opts.deviceId;
  if (opts.status) q.status = opts.status;
  const rows = (await AgentJob.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(opts.limit || 50, 100))
    .lean()) as unknown as AgentJobDoc[];
  return rows.map(publicJob);
}

export async function getJob(id: string) {
  const doc = await AgentJob.findById(id);
  if (!doc) throw new Error('Job not found');
  return publicJob(doc as unknown as AgentJobDoc);
}

export async function createJob(input: {
  type: AgentJobType;
  deviceId: string;
  issueKey?: string;
  projectId?: string;
  projectKey?: string;
  instruction?: string;
  command?: string;
  parentJobId?: string;
}) {
  const device = await AgentDevice.findOne({
    deviceId: input.deviceId,
    revokedAt: null,
  });
  if (!device) throw new Error('Device not found');

  let issueContext: unknown;
  let status:
    | 'queued'
    | 'approved_deploy' = 'queued';

  if (input.type === 'fix_issue') {
    const key = (input.issueKey || '').trim().toUpperCase();
    const projectId = (input.projectId || '').trim();
    if (!key || !projectId) {
      throw new Error('issueKey and projectId required for fix_issue');
    }
    try {
      const data = await getIssueByKey(key, projectId);
      issueContext = data.issue;
    } catch (err) {
      throw new Error(
        `Failed to load issue ${key}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (input.type === 'run_command' || input.type === 'deploy') {
    const cmd = (input.command || '').trim();
    if (!cmd) throw new Error('command required');
    if (!isCommandAllowed(cmd, device.allowCommands || [])) {
      throw new Error('Command not in device allowCommands');
    }
  }

  if (input.type === 'deploy') {
    // Deploy jobs created via approve-deploy are already approved_deploy;
    // direct create of deploy still queues until approved unless parent path.
    status = 'queued';
  }

  if (input.type === 'follow_up') {
    if (!input.parentJobId) throw new Error('parentJobId required for follow_up');
    const parent = await AgentJob.findById(input.parentJobId);
    if (parent) {
      issueContext = parent.issueContext;
      if (!input.issueKey) input.issueKey = parent.issueKey ?? undefined;
      if (!input.projectId) input.projectId = parent.projectId ?? undefined;
      if (!input.projectKey) input.projectKey = parent.projectKey ?? undefined;
    }
  }

  const doc = await AgentJob.create({
    type: input.type,
    status,
    deviceId: input.deviceId,
    issueKey: input.issueKey?.trim().toUpperCase(),
    projectId: input.projectId,
    projectKey: input.projectKey?.trim().toUpperCase(),
    instruction: input.instruction || '',
    command: input.command?.trim(),
    issueContext,
    parentJobId: input.parentJobId,
    logs: [],
    updatedAt: new Date(),
  });

  emitAgentJobEvent({
    jobId: String(doc._id),
    type: 'status',
    status: doc.status,
  });

  return publicJob(doc as unknown as AgentJobDoc);
}

export async function cancelJob(id: string) {
  const doc = await AgentJob.findById(id);
  if (!doc) throw new Error('Job not found');
  if (['done', 'cancelled', 'failed'].includes(doc.status)) {
    return publicJob(doc as unknown as AgentJobDoc);
  }
  doc.status = 'cancelled';
  doc.updatedAt = new Date();
  await doc.save();
  emitAgentJobEvent({
    jobId: String(doc._id),
    type: 'status',
    status: 'cancelled',
  });
  return publicJob(doc as unknown as AgentJobDoc);
}

export async function rejectJob(id: string) {
  const doc = await AgentJob.findById(id);
  if (!doc) throw new Error('Job not found');
  if (doc.status !== 'needs_review') {
    throw new Error('Job is not awaiting review');
  }
  doc.status = 'done';
  doc.summary = `${doc.summary || ''}\n[Rejected — no deploy]`.trim();
  doc.updatedAt = new Date();
  await doc.save();
  emitAgentJobEvent({
    jobId: String(doc._id),
    type: 'status',
    status: 'done',
    summary: doc.summary,
  });
  return publicJob(doc as unknown as AgentJobDoc);
}

export async function approveDeploy(id: string, command?: string) {
  const parent = await AgentJob.findById(id);
  if (!parent) throw new Error('Job not found');
  if (parent.status !== 'needs_review') {
    throw new Error('Job is not awaiting review');
  }

  const device = await AgentDevice.findOne({
    deviceId: parent.deviceId,
    revokedAt: null,
  });
  if (!device) throw new Error('Device not found');

  const cmd =
    (command || parent.command || '').trim() ||
    (device.allowCommands || []).find((c) => /deploy/i.test(c)) ||
    '';

  if (!cmd || !isCommandAllowed(cmd, device.allowCommands || [])) {
    throw new Error(
      'Deploy command required and must match device allowCommands'
    );
  }

  parent.status = 'approved_deploy';
  parent.updatedAt = new Date();
  await parent.save();

  const deployJob = await AgentJob.create({
    type: 'deploy',
    status: 'queued',
    deviceId: parent.deviceId,
    issueKey: parent.issueKey,
    projectId: parent.projectId,
    projectKey: parent.projectKey,
    instruction: parent.instruction,
    command: cmd,
    parentJobId: String(parent._id),
    logs: [],
    updatedAt: new Date(),
  });

  emitAgentJobEvent({
    jobId: String(parent._id),
    type: 'status',
    status: 'approved_deploy',
  });
  emitAgentJobEvent({
    jobId: String(deployJob._id),
    type: 'status',
    status: 'queued',
  });

  return {
    parent: publicJob(parent as unknown as AgentJobDoc),
    deployJob: publicJob(deployJob as unknown as AgentJobDoc),
  };
}

export async function claimNextJob(
  device: AgentDeviceDoc,
  waitMs = 25000
): Promise<ReturnType<typeof publicJob> | null> {
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30000);

  while (Date.now() <= deadline) {
    const job = await AgentJob.findOneAndUpdate(
      {
        deviceId: device.deviceId,
        status: 'queued',
      },
      {
        $set: {
          status: 'running',
          claimedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { sort: { createdAt: 1 }, new: true }
    );

    if (job) {
      emitAgentJobEvent({
        jobId: String(job._id),
        type: 'status',
        status: 'running',
      });
      const payload = publicJob(job as unknown as AgentJobDoc);
      return {
        ...payload,
        workspaces: device.workspaces || [],
        allowCommands: device.allowCommands || [],
        aiProviders: device.aiProviders || [],
      } as ReturnType<typeof publicJob> & {
        workspaces: AgentWorkspace[];
        allowCommands: string[];
        aiProviders: string[];
      };
    }

    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

export async function appendJobLogs(
  deviceId: string,
  jobId: string,
  lines: string[]
) {
  const job = await AgentJob.findById(jobId);
  if (!job || job.deviceId !== deviceId) throw new Error('Job not found');
  const entries = (lines || [])
    .map((line) => redactLogLine(String(line || '')))
    .filter(Boolean)
    .map((line) => ({ at: new Date(), line }));
  if (!entries.length) return publicJob(job as unknown as AgentJobDoc);

  job.set(
    'logs',
    [...(job.logs || []), ...entries].slice(-2000)
  );
  job.updatedAt = new Date();
  await job.save();

  for (const e of entries) {
    emitAgentJobEvent({
      jobId,
      type: 'log',
      line: e.line,
    });
  }
  return publicJob(job as unknown as AgentJobDoc);
}

export async function completeJob(
  deviceId: string,
  jobId: string,
  body: {
    status: 'needs_review' | 'done' | 'failed';
    summary?: string;
    diffStat?: string;
    artifacts?: unknown[];
    error?: string;
  }
) {
  const job = await AgentJob.findById(jobId);
  if (!job || job.deviceId !== deviceId) throw new Error('Job not found');
  if (job.status === 'cancelled') {
    return publicJob(job as unknown as AgentJobDoc);
  }
  if (job.status !== 'running') {
    throw new Error(`Job not running (status=${job.status})`);
  }

  job.status = body.status;
  if (body.summary != null) job.summary = String(body.summary).slice(0, 20000);
  if (body.diffStat != null) job.diffStat = String(body.diffStat).slice(0, 8000);
  if (body.artifacts) job.artifacts = body.artifacts;
  if (body.error) job.error = String(body.error).slice(0, 4000);
  job.updatedAt = new Date();
  await job.save();

  emitAgentJobEvent({
    jobId,
    type: body.status === 'failed' ? 'done' : 'status',
    status: job.status,
    summary: job.summary,
  });
  if (body.status === 'done' || body.status === 'failed') {
    emitAgentJobEvent({
      jobId,
      type: 'done',
      status: job.status,
      summary: job.summary,
    });
  }

  return publicJob(job as unknown as AgentJobDoc);
}

export async function streamJobEvents(
  req: Request,
  res: Response,
  jobId: string
) {
  const job = await AgentJob.findById(jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(
    `event: snapshot\ndata: ${JSON.stringify(publicJob(job as unknown as AgentJobDoc))}\n\n`
  );

  const send = (event: unknown) => {
    res.write(`event: agent\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = subscribeAgentJob(jobId, send);
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
