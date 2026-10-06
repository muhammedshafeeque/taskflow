import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as setup from './setup.service';
import { ingestWithKey } from './ingest.service';
import * as query from './query.service';
import * as alerts from './alert.service';

function ws(req: Request & { user?: AuthPayload; activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

function monitorKey(req: Request): string {
  const header = req.headers['x-monitor-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function param(req: Request, name: string): string {
  const v = req.params[name];
  if (!v) throw new ApiError(400, `${name} is required`);
  return v;
}

export async function ingest(req: Request, res: Response) {
  const kind = param(req, 'kind');
  const data = await ingestWithKey(monitorKey(req), kind, (req.body ?? {}) as Record<string, unknown>);
  res.json({ success: true, data });
}

export async function listProjects(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.listProjects(ws(req));
  res.json({ success: true, data });
}

export async function listPmSuggestions(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.listPmSuggestions(ws(req));
  res.json({ success: true, data });
}

export async function getProject(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.getProject(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function createProject(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.createProject(ws(req), req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function deleteProject(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.deleteProject(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function listEnvironments(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.listEnvironments(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function createEnvironment(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.createEnvironment(ws(req), req.params.projectId, req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function deleteEnvironment(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.deleteEnvironment(ws(req), req.params.projectId, req.params.id);
  res.json({ success: true, data });
}

export async function listApps(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { environmentId?: string };
  const data = await setup.listApps(ws(req), req.params.projectId, q.environmentId);
  res.json({ success: true, data });
}

export async function createApp(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.createApp(ws(req), req.params.projectId, req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function rotateKey(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.rotateAppKey(ws(req), req.params.projectId, req.params.appId);
  res.json({ success: true, data });
}

export async function deleteApp(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await setup.deleteApp(ws(req), req.params.projectId, req.params.appId);
  res.json({ success: true, data });
}

function q(req: Request) {
  const r = req.query as Record<string, string | undefined>;
  return {
    environmentId: r.environmentId,
    appId: r.appId,
    release: r.release,
    q: r.q,
    level: r.level,
    from: r.from,
    to: r.to,
    limit: r.limit ? Number(r.limit) : undefined,
    status: r.status,
  };
}

export async function overview(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.overview(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function logs(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listLogs(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function errors(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listErrorGroups(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function errorGroup(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.getErrorGroup(ws(req), req.params.projectId, req.params.groupId);
  res.json({ success: true, data });
}

export async function patchErrorGroup(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const body = (req.body ?? {}) as query.ErrorGroupPatch;
  const data = await query.updateErrorGroup(
    ws(req),
    req.params.projectId,
    req.params.groupId,
    { status: body.status, acknowledged: body.acknowledged, assigneeId: body.assigneeId, snoozeMinutes: body.snoozeMinutes },
    req.user?.id
  );
  res.json({ success: true, data });
}

export async function liveUsers(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listLiveUsers(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function transactions(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listTransactions(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function httpCalls(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listHttp(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function vitals(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listVitals(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function events(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listEvents(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function releases(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listReleases(ws(req), req.params.projectId, q(req));
  res.json({ success: true, data });
}

export async function devices(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.deviceBreakdown(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function uptimeChecks(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listUptimeChecks(ws(req), req.params.projectId);
  res.json({ success: true, data });
}

export async function createUptime(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.createUptimeCheck(ws(req), req.params.projectId, req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function deleteUptime(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.deleteUptimeCheck(ws(req), req.params.projectId, req.params.checkId);
  res.json({ success: true, data });
}

export async function uptimeSamples(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await query.listUptimeSamples(ws(req), req.params.projectId, req.query.checkId as string | undefined);
  res.json({ success: true, data });
}

export async function listAlerts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.listAlertRules(ws(req), param(req, 'projectId'));
  res.json({ success: true, data });
}

export async function createAlert(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.createAlertRule(ws(req), param(req, 'projectId'), (req.body ?? {}) as Record<string, unknown>);
  res.status(201).json({ success: true, data });
}

export async function updateAlert(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.updateAlertRule(
    ws(req),
    param(req, 'projectId'),
    param(req, 'alertId'),
    (req.body ?? {}) as Record<string, unknown>
  );
  res.json({ success: true, data });
}

export async function deleteAlert(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.deleteAlertRule(ws(req), param(req, 'projectId'), param(req, 'alertId'));
  res.json({ success: true, data });
}

export async function testAlert(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.testAlertRule(ws(req), param(req, 'projectId'), param(req, 'alertId'));
  res.json({ success: true, data });
}

export async function alertDeliveries(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await alerts.listAlertDeliveries(ws(req), param(req, 'projectId'), req.query.ruleId as string | undefined);
  res.json({ success: true, data });
}
