/**
 * Service-to-service Monitor API for the WhatsApp PA / PA Control Center (no JWT).
 * Auth: header x-pa-ingest-secret === PA_INGEST_SECRET.
 * Workspace: x-organization-id header, else PA_DEFAULT_ORG_ID.
 * Mounted at /api/monitor/pa — mirrors the staff routes under /api/monitor.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import type { AuthPayload } from '../../types/express';
import * as ctrl from './monitor.controller';
import { monitorSummary } from './pa.service';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function paServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const configured = String(process.env.PA_INGEST_SECRET ?? '').trim();
  if (!configured) {
    next(new ApiError(503, 'PA ingest is not configured (PA_INGEST_SECRET)'));
    return;
  }
  const provided = String(req.headers['x-pa-ingest-secret'] ?? '').trim();
  if (!provided || !safeEqual(provided, configured)) {
    next(new ApiError(401, 'Invalid ingest secret'));
    return;
  }
  const orgId = String(req.headers['x-organization-id'] ?? process.env.PA_DEFAULT_ORG_ID ?? '').trim();
  if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
    next(new ApiError(400, 'x-organization-id (or PA_DEFAULT_ORG_ID) is required'));
    return;
  }
  const r = req as Request & { user?: AuthPayload; activeOrganizationId?: string };
  r.activeOrganizationId = orgId;
  r.user = { id: 'pa-service', role: 'service', permissions: [] } as unknown as AuthPayload;
  res.setHeader('Cache-Control', 'no-store');
  next();
}

const pa = Router();
pa.use(paServiceAuth);

pa.get(
  '/summary',
  asyncHandler(async (req: Request & { activeOrganizationId?: string }, res: Response) => {
    res.json({ success: true, data: await monitorSummary(req.activeOrganizationId) });
  })
);

pa.get('/projects', asyncHandler(ctrl.listProjects));
pa.get('/pm-suggestions', asyncHandler(ctrl.listPmSuggestions));
pa.get('/projects/:projectId', asyncHandler(ctrl.getProject));
pa.get('/projects/:projectId/overview', asyncHandler(ctrl.overview));
pa.get('/projects/:projectId/environments', asyncHandler(ctrl.listEnvironments));
pa.get('/projects/:projectId/apps', asyncHandler(ctrl.listApps));
pa.get('/projects/:projectId/logs', asyncHandler(ctrl.logs));
pa.get('/projects/:projectId/errors', asyncHandler(ctrl.errors));
pa.get('/projects/:projectId/errors/:groupId', asyncHandler(ctrl.errorGroup));
pa.patch('/projects/:projectId/errors/:groupId', asyncHandler(ctrl.patchErrorGroup));
pa.get('/projects/:projectId/live-users', asyncHandler(ctrl.liveUsers));
pa.get('/projects/:projectId/transactions', asyncHandler(ctrl.transactions));
pa.get('/projects/:projectId/http', asyncHandler(ctrl.httpCalls));
pa.get('/projects/:projectId/vitals', asyncHandler(ctrl.vitals));
pa.get('/projects/:projectId/events', asyncHandler(ctrl.events));
pa.get('/projects/:projectId/releases', asyncHandler(ctrl.releases));
pa.get('/projects/:projectId/devices', asyncHandler(ctrl.devices));
pa.get('/projects/:projectId/uptime', asyncHandler(ctrl.uptimeChecks));
pa.post('/projects/:projectId/uptime', asyncHandler(ctrl.createUptime));
pa.delete('/projects/:projectId/uptime/:checkId', asyncHandler(ctrl.deleteUptime));
pa.get('/projects/:projectId/uptime-samples', asyncHandler(ctrl.uptimeSamples));
pa.get('/projects/:projectId/alerts', asyncHandler(ctrl.listAlerts));
pa.post('/projects/:projectId/alerts', asyncHandler(ctrl.createAlert));
pa.patch('/projects/:projectId/alerts/:alertId', asyncHandler(ctrl.updateAlert));
pa.delete('/projects/:projectId/alerts/:alertId', asyncHandler(ctrl.deleteAlert));
pa.post('/projects/:projectId/alerts/:alertId/test', asyncHandler(ctrl.testAlert));
pa.get('/projects/:projectId/alert-deliveries', asyncHandler(ctrl.alertDeliveries));

export const monitorPaRoutes = pa;
