import crypto from 'crypto';
import {
  MonitorCustomEvent,
  MonitorErrorEvent,
  MonitorErrorGroup,
  MonitorHttpCall,
  MonitorLog,
  MonitorPresence,
  MonitorRelease,
  MonitorTransaction,
  MonitorVital,
} from './monitor.models';
import { emitLive, rateLimitKey, resolveAppByKey } from './setup.service';
import { evaluateMonitorAlerts } from './alert.service';
import { pageOnCall } from './onCall.service';
import { ApiError } from '../../utils/ApiError';

function fingerprint(type: string, message: string, stack?: string): string {
  const top = (stack || '').split('\n').slice(0, 3).join('\n');
  return crypto.createHash('sha1').update(`${type}|${message}|${top}`).digest('hex');
}

async function noteRelease(app: {
  _id: unknown;
  taskflowOrganizationId: unknown;
  projectId: unknown;
  environmentId: unknown;
}, version?: string) {
  const v = String(version || '').trim();
  if (!v) return false;
  const res = await MonitorRelease.updateOne(
    { appId: app._id, version: v },
    {
      $setOnInsert: {
        taskflowOrganizationId: app.taskflowOrganizationId,
        projectId: app.projectId,
        environmentId: app.environmentId,
        appId: app._id,
        version: v,
        firstSeen: new Date(),
      },
    },
    { upsert: true }
  );
  return res.upsertedCount > 0;
}

export async function ingestWithKey(plainKey: string, kind: string, body: Record<string, unknown>) {
  const app = await resolveAppByKey(plainKey);
  if (!app) throw new ApiError(401, 'Invalid monitor key');
  if (!rateLimitKey(app.keyHash)) throw new ApiError(429, 'Rate limit exceeded');
  const base = {
    taskflowOrganizationId: app.taskflowOrganizationId,
    projectId: app.projectId,
    environmentId: app.environmentId,
    appId: app._id,
  };
  const release = body.release ? String(body.release) : undefined;
  await noteRelease(app, release);
  const envId = String(app.environmentId);
  const projectId = String(app.projectId);

  if (kind === 'logs') {
    const message = String(body.message ?? '').slice(0, 8000);
    if (!message) throw new ApiError(400, 'message is required');
    const doc = await MonitorLog.create({
      ...base,
      level: String(body.level ?? 'info').slice(0, 20),
      message,
      release,
      meta: body.meta,
      timestamp: body.timestamp ? new Date(String(body.timestamp)) : new Date(),
    });
    emitLive(projectId, envId, 'log', doc.toObject());
    evaluateMonitorAlerts({
      kind: 'logs',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      fields: { message, level: String(doc.level), release: release || '' },
    });
    return { ok: true, id: String(doc._id) };
  }

  if (kind === 'errors') {
    const message = String(body.message ?? 'Error').slice(0, 4000);
    const type = String(body.type ?? 'Error');
    const stack = body.stack ? String(body.stack).slice(0, 16000) : undefined;
    const fp = fingerprint(type, message, stack);
    const ev = await MonitorErrorEvent.create({
      ...base,
      fingerprint: fp,
      type,
      message,
      stack,
      kind: body.kind === 'crash' ? 'crash' : 'unhandled',
      release,
      breadcrumbs: Array.isArray(body.breadcrumbs) ? body.breadcrumbs.slice(0, 50) : [],
      userAgent: body.userAgent ? String(body.userAgent).slice(0, 500) : undefined,
    });
    const group = await MonitorErrorGroup.findOneAndUpdate(
      { appId: app._id, fingerprint: fp },
      {
        $setOnInsert: {
          ...base,
          fingerprint: fp,
          type,
          message,
          kind: ev.kind,
          firstSeen: new Date(),
          status: 'open',
        },
        // sampleStack only in $set — cannot also appear in $setOnInsert (ConflictingUpdateOperators)
        $set: {
          lastSeen: new Date(),
          ...(stack ? { sampleStack: stack } : {}),
        },
        $inc: { count: 1 },
      },
      { upsert: true, new: true }
    );
    emitLive(projectId, envId, 'error', { fingerprint: fp, message });
    // A resolved error that happens again is a regression: reopen it.
    let regressed = false;
    if (group?.status === 'resolved') {
      regressed = true;
      await MonitorErrorGroup.updateOne(
        { _id: group._id },
        { $set: { status: 'open', regressedAt: new Date(), acknowledgedAt: null, acknowledgedBy: null } }
      );
    }
    const snoozed = Boolean(!regressed && group?.snoozedUntil && new Date(group.snoozedUntil) > new Date());
    if (!snoozed && ((group?.count ?? 0) === 1 || regressed)) {
      void pageOnCall({
        projectId,
        title: regressed ? `Regression: ${message}` : `New error: ${message}`,
        body: `${type || 'Error'} in ${app.name ?? 'app'}`,
        link: `/monitor/${projectId}/errors?group=${group?._id}`,
        dedupeKey: `error:${fp}`,
      });
    }
    if (!snoozed) evaluateMonitorAlerts({
      kind: 'errors',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      // Regressions alert like brand-new errors.
      isNewErrorGroup: (group?.count ?? 0) === 1 || regressed,
      fields: { message: regressed ? `[regression] ${message}` : message, type, release: release || '', fingerprint: fp },
    });
    return { ok: true, id: String(ev._id), fingerprint: fp };
  }

  if (kind === 'presence') {
    const sessionId = String(body.sessionId ?? '').trim();
    if (!sessionId) throw new ApiError(400, 'sessionId is required');
    await MonitorPresence.findOneAndUpdate(
      { appId: app._id, sessionId },
      {
        $set: {
          ...base,
          sessionId,
          userId: body.userId ? String(body.userId) : undefined,
          page: body.page ? String(body.page).slice(0, 500) : undefined,
          userAgent: body.userAgent ? String(body.userAgent).slice(0, 500) : undefined,
          lastSeen: new Date(),
        },
      },
      { upsert: true }
    );
    emitLive(projectId, envId, 'presence', { sessionId });
    return { ok: true };
  }

  if (kind === 'transactions') {
    const name = String(body.name ?? '').trim();
    if (!name) throw new ApiError(400, 'name is required');
    const doc = await MonitorTransaction.create({
      ...base,
      name: name.slice(0, 300),
      durationMs: Number(body.durationMs ?? 0),
      status: body.status ? String(body.status) : undefined,
      release,
    });
    emitLive(projectId, envId, 'transaction', { name, durationMs: doc.durationMs });
    evaluateMonitorAlerts({
      kind: 'transactions',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      fields: { name, durationMs: String(doc.durationMs), status: String(doc.status || ''), release: release || '', message: name },
    });
    return { ok: true, id: String(doc._id) };
  }

  if (kind === 'http') {
    const url = String(body.url ?? '').slice(0, 2000);
    if (!url) throw new ApiError(400, 'url is required');
    const doc = await MonitorHttpCall.create({
      ...base,
      method: String(body.method ?? 'GET').slice(0, 10),
      url,
      status: body.status != null ? Number(body.status) : undefined,
      durationMs: body.durationMs != null ? Number(body.durationMs) : undefined,
      direction: body.direction === 'in' ? 'in' : 'out',
      release,
    });
    emitLive(projectId, envId, 'http', { url, status: doc.status });
    evaluateMonitorAlerts({
      kind: 'http',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      fields: {
        url,
        method: String(doc.method),
        status: String(doc.status ?? ''),
        durationMs: String(doc.durationMs ?? ''),
        message: url,
        release: release || '',
      },
    });
    return { ok: true, id: String(doc._id) };
  }

  if (kind === 'vitals') {
    const name = String(body.name ?? '').toLowerCase();
    if (!['lcp', 'inp', 'cls', 'ttfb'].includes(name)) throw new ApiError(400, 'Invalid vital name');
    const doc = await MonitorVital.create({
      ...base,
      name,
      value: Number(body.value ?? 0),
      release,
    });
    emitLive(projectId, envId, 'vital', { name, value: doc.value });
    evaluateMonitorAlerts({
      kind: 'vitals',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      fields: { vitalName: name, vitalValue: String(doc.value), message: `${name}=${doc.value}`, release: release || '' },
    });
    return { ok: true, id: String(doc._id) };
  }

  if (kind === 'events') {
    const name = String(body.name ?? '').trim();
    if (!name) throw new ApiError(400, 'name is required');
    const doc = await MonitorCustomEvent.create({
      ...base,
      name: name.slice(0, 120),
      props: body.props,
      release,
    });
    emitLive(projectId, envId, 'event', { name });
    evaluateMonitorAlerts({
      kind: 'events',
      orgId: String(app.taskflowOrganizationId),
      projectId,
      environmentId: envId,
      appId: String(app._id),
      fields: { eventName: name, name, message: name, release: release || '' },
    });
    return { ok: true, id: String(doc._id) };
  }

  if (kind === 'releases') {
    const version = String(body.version ?? body.release ?? '').trim();
    if (!version) throw new ApiError(400, 'version is required');
    const isNew = await noteRelease(app, version);
    if (isNew) {
      evaluateMonitorAlerts({
        kind: 'releases',
        orgId: String(app.taskflowOrganizationId),
        projectId,
        environmentId: envId,
        appId: String(app._id),
        fields: { release: version, version, message: version },
      });
    }
    return { ok: true, version };
  }

  throw new ApiError(404, 'Unknown ingest type');
}
