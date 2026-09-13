import { Router } from 'express';
import {
  approveDeploy,
  cancelJob,
  createJob,
  createPairingDevice,
  getJob,
  listDevices,
  listJobs,
  rejectJob,
  revokeDevice,
  streamJobEvents,
} from './service';
import type { AgentJobType } from './models/AgentJob';

export const agentAdminRouter = Router();

agentAdminRouter.get('/devices', async (_req, res) => {
  try {
    const devices = await listDevices();
    res.json({ success: true, data: devices });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/devices', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: string; userLabel?: string };
    const data = await createPairingDevice(body);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/devices/:id/revoke', async (req, res) => {
  try {
    const device = await revokeDevice(req.params.id);
    res.json({ success: true, data: device });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.get('/jobs', async (req, res) => {
  try {
    const jobs = await listJobs({
      deviceId:
        typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined,
      status:
        typeof req.query.status === 'string' ? req.query.status : undefined,
      limit:
        typeof req.query.limit === 'string'
          ? Number(req.query.limit)
          : undefined,
    });
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.get('/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(404).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/jobs', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      type?: AgentJobType;
      deviceId?: string;
      issueKey?: string;
      projectId?: string;
      projectKey?: string;
      instruction?: string;
      command?: string;
      parentJobId?: string;
    };
    if (!body.type || !body.deviceId) {
      res.status(400).json({
        success: false,
        error: 'type and deviceId required',
      });
      return;
    }
    const job = await createJob({
      type: body.type,
      deviceId: body.deviceId,
      issueKey: body.issueKey,
      projectId: body.projectId,
      projectKey: body.projectKey,
      instruction: body.instruction,
      command: body.command,
      parentJobId: body.parentJobId,
    });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const job = await cancelJob(req.params.id);
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/jobs/:id/approve-deploy', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { command?: string };
    const data = await approveDeploy(req.params.id, body.command);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.post('/jobs/:id/reject', async (req, res) => {
  try {
    const job = await rejectJob(req.params.id);
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentAdminRouter.get('/jobs/:id/events', async (req, res) => {
  try {
    await streamJobEvents(req, res, req.params.id);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
});
