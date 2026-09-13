import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import {
  appendJobLogs,
  claimNextJob,
  completeJob,
  findDeviceByToken,
  heartbeatDevice,
  registerDevice,
} from './service';
import type { AgentDeviceDoc } from './models/AgentDevice';

type DeviceRequest = Request & { agentDevice?: AgentDeviceDoc };

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : String(id);
}

async function requireDeviceToken(
  req: DeviceRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : String(req.headers['x-agent-device-token'] || '').trim();
  if (!bearer) {
    res.status(401).json({ success: false, error: 'Device token required' });
    return;
  }
  const device = await findDeviceByToken(bearer);
  if (!device) {
    res.status(401).json({ success: false, error: 'Invalid device token' });
    return;
  }
  req.agentDevice = device;
  next();
}

export const agentDeviceRouter = Router();

agentDeviceRouter.post('/register', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { pairingCode?: string; name?: string };
    const data = await registerDevice(body.pairingCode || '', body.name);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed',
    });
  }
});

agentDeviceRouter.post(
  '/heartbeat',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const body = (req.body ?? {}) as {
        workspaces?: Array<{
          projectKey: string;
          projectId?: string;
          localPath: string;
        }>;
        allowCommands?: string[];
        aiProviders?: string[];
        name?: string;
      };
      const data = await heartbeatDevice(req.agentDevice!, body);
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);

agentDeviceRouter.get(
  '/jobs/next',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const wait =
        typeof req.query.wait === 'string' ? Number(req.query.wait) : 25;
      const job = await claimNextJob(
        req.agentDevice!,
        Number.isFinite(wait) ? wait * 1000 : 25000
      );
      if (!job) {
        res.status(204).end();
        return;
      }
      res.json({ success: true, data: job });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);

agentDeviceRouter.post(
  '/jobs/:id/logs',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const body = (req.body ?? {}) as { lines?: string[]; line?: string };
      const lines = body.lines || (body.line ? [body.line] : []);
      const job = await appendJobLogs(
        req.agentDevice!.deviceId,
        paramId(req),
        lines
      );
      res.json({ success: true, data: job });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);

agentDeviceRouter.post(
  '/jobs/:id/complete',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const body = (req.body ?? {}) as {
        summary?: string;
        diffStat?: string;
        artifacts?: unknown[];
      };
      const job = await completeJob(req.agentDevice!.deviceId, paramId(req), {
        status: 'done',
        ...body,
      });
      res.json({ success: true, data: job });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);

agentDeviceRouter.post(
  '/jobs/:id/needs-review',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const body = (req.body ?? {}) as {
        summary?: string;
        diffStat?: string;
        artifacts?: unknown[];
      };
      const job = await completeJob(req.agentDevice!.deviceId, paramId(req), {
        status: 'needs_review',
        ...body,
      });
      res.json({ success: true, data: job });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);

agentDeviceRouter.post(
  '/jobs/:id/fail',
  requireDeviceToken,
  async (req: DeviceRequest, res) => {
    try {
      const body = (req.body ?? {}) as {
        error?: string;
        summary?: string;
      };
      const job = await completeJob(req.agentDevice!.deviceId, paramId(req), {
        status: 'failed',
        error: body.error,
        summary: body.summary,
      });
      res.json({ success: true, data: job });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  }
);
