import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './monitor.controller';
import { createIssueFromErrorGroup } from './errorIssue.service';
import { getOnCall, setOnCall } from './onCall.service';

const M = TASK_FLOW_PERMISSIONS.TASKFLOW.MONITOR;
const read = [M.PROJECT.READ, M.LOG.READ, M.ERROR.READ];
const manageEnv = [M.ENVIRONMENT.MANAGE];
const manageApp = [M.APP.MANAGE];
const manageProject = [M.PROJECT.MANAGE];
const manageUptime = [M.UPTIME.MANAGE];
const readAlert = [M.ALERT.READ, ...read];
const manageAlert = [M.ALERT.MANAGE];

const staff = Router();
staff.use(authMiddleware);
staff.use(requireTaskflowUser);
staff.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

staff.get('/projects', requireAnyPermission(read), asyncHandler(ctrl.listProjects));
staff.get('/pm-suggestions', requireAnyPermission(read), asyncHandler(ctrl.listPmSuggestions));
staff.post('/projects', requireAnyPermission(manageProject), asyncHandler(ctrl.createProject));
staff.get('/projects/:projectId', requireAnyPermission(read), asyncHandler(ctrl.getProject));
staff.get(
  '/projects/:projectId/on-call',
  requireAnyPermission(read),
  asyncHandler(async (req, res) => {
    const r = req as typeof req & { activeOrganizationId?: string };
    res.json({ success: true, data: await getOnCall(r.activeOrganizationId, req.params.projectId) });
  })
);
staff.put(
  '/projects/:projectId/on-call',
  requireAnyPermission(manageAlert),
  asyncHandler(async (req, res) => {
    const r = req as typeof req & { activeOrganizationId?: string };
    res.json({ success: true, data: await setOnCall(r.activeOrganizationId, req.params.projectId, req.body ?? {}) });
  })
);
staff.delete('/projects/:projectId', requireAnyPermission(manageProject), asyncHandler(ctrl.deleteProject));

staff.get('/projects/:projectId/overview', requireAnyPermission(read), asyncHandler(ctrl.overview));
staff.get('/projects/:projectId/environments', requireAnyPermission(read), asyncHandler(ctrl.listEnvironments));
staff.post('/projects/:projectId/environments', requireAnyPermission(manageEnv), asyncHandler(ctrl.createEnvironment));
staff.delete('/projects/:projectId/environments/:id', requireAnyPermission(manageEnv), asyncHandler(ctrl.deleteEnvironment));

staff.get('/projects/:projectId/apps', requireAnyPermission(read), asyncHandler(ctrl.listApps));
staff.post('/projects/:projectId/apps', requireAnyPermission(manageApp), asyncHandler(ctrl.createApp));
staff.post('/projects/:projectId/apps/:appId/rotate-key', requireAnyPermission(manageApp), asyncHandler(ctrl.rotateKey));
staff.delete('/projects/:projectId/apps/:appId', requireAnyPermission(manageApp), asyncHandler(ctrl.deleteApp));

staff.get('/projects/:projectId/logs', requireAnyPermission([M.LOG.READ, ...read]), asyncHandler(ctrl.logs));
staff.get('/projects/:projectId/errors', requireAnyPermission([M.ERROR.READ, ...read]), asyncHandler(ctrl.errors));
staff.get('/projects/:projectId/errors/:groupId', requireAnyPermission([M.ERROR.READ, ...read]), asyncHandler(ctrl.errorGroup));
staff.patch('/projects/:projectId/errors/:groupId', requireAnyPermission([M.ERROR.UPDATE]), asyncHandler(ctrl.patchErrorGroup));
staff.post(
  '/projects/:projectId/errors/:groupId/issue',
  requireAnyPermission([M.ERROR.UPDATE]),
  asyncHandler(async (req, res) => {
    const r = req as typeof req & { user?: { id: string; permissions?: string[] }; activeOrganizationId?: string };
    const data = await createIssueFromErrorGroup({
      workspaceId: r.activeOrganizationId,
      monitorProjectId: req.params.projectId,
      groupId: req.params.groupId,
      pmProjectId: String(req.body?.pmProjectId ?? ''),
      user: { id: r.user!.id, permissions: r.user!.permissions },
    });
    res.status(201).json({ success: true, data });
  })
);
staff.get('/projects/:projectId/live-users', requireAnyPermission([M.LIVE.READ, ...read]), asyncHandler(ctrl.liveUsers));
staff.get('/projects/:projectId/transactions', requireAnyPermission([M.PERF.READ, ...read]), asyncHandler(ctrl.transactions));
staff.get('/projects/:projectId/http', requireAnyPermission([M.HTTP.READ, ...read]), asyncHandler(ctrl.httpCalls));
staff.get('/projects/:projectId/vitals', requireAnyPermission([M.VITALS.READ, ...read]), asyncHandler(ctrl.vitals));
staff.get('/projects/:projectId/events', requireAnyPermission([M.EVENT.READ, ...read]), asyncHandler(ctrl.events));
staff.get('/projects/:projectId/releases', requireAnyPermission([M.RELEASE.READ, ...read]), asyncHandler(ctrl.releases));
staff.get('/projects/:projectId/devices', requireAnyPermission([M.LIVE.READ, ...read]), asyncHandler(ctrl.devices));
staff.get('/projects/:projectId/uptime', requireAnyPermission([M.UPTIME.READ, ...read]), asyncHandler(ctrl.uptimeChecks));
staff.post('/projects/:projectId/uptime', requireAnyPermission(manageUptime), asyncHandler(ctrl.createUptime));
staff.delete('/projects/:projectId/uptime/:checkId', requireAnyPermission(manageUptime), asyncHandler(ctrl.deleteUptime));
staff.get('/projects/:projectId/uptime-samples', requireAnyPermission([M.UPTIME.READ, ...read]), asyncHandler(ctrl.uptimeSamples));

staff.get('/projects/:projectId/alerts', requireAnyPermission(readAlert), asyncHandler(ctrl.listAlerts));
staff.post('/projects/:projectId/alerts', requireAnyPermission(manageAlert), asyncHandler(ctrl.createAlert));
staff.patch('/projects/:projectId/alerts/:alertId', requireAnyPermission(manageAlert), asyncHandler(ctrl.updateAlert));
staff.delete('/projects/:projectId/alerts/:alertId', requireAnyPermission(manageAlert), asyncHandler(ctrl.deleteAlert));
staff.post('/projects/:projectId/alerts/:alertId/test', requireAnyPermission(manageAlert), asyncHandler(ctrl.testAlert));
staff.get('/projects/:projectId/alert-deliveries', requireAnyPermission(readAlert), asyncHandler(ctrl.alertDeliveries));

const ingest = Router();
ingest.post('/ingest/:kind', asyncHandler(ctrl.ingest));

export const monitorStaffRoutes = staff;
export const monitorIngestRoutes = ingest;
