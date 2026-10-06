import { MonitorUptimeCheck, MonitorUptimeSample } from './monitor.models';
import { evaluateMonitorAlerts } from './alert.service';
import { pageOnCall } from './onCall.service';
import { assertSafeOutboundUrl } from '../../utils/safeUrl';

async function runCheck(check: {
  _id: unknown;
  taskflowOrganizationId: unknown;
  projectId: unknown;
  url: string;
  method?: string;
  expectedStatus?: number;
  intervalMinutes?: number;
}) {
  const started = Date.now();
  let ok = false;
  let status: number | undefined;
  let error: string | undefined;
  try {
    const safeUrl = assertSafeOutboundUrl(check.url, 'Uptime URL');
    const res = await fetch(safeUrl, {
      method: check.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
    ok = status === (check.expectedStatus ?? 200);
  } catch (err) {
    error = err instanceof Error ? err.message : 'request failed';
  }
  const latencyMs = Date.now() - started;
  await MonitorUptimeSample.create({
    taskflowOrganizationId: check.taskflowOrganizationId,
    projectId: check.projectId,
    checkId: check._id,
    ok,
    status,
    latencyMs,
    error,
    timestamp: new Date(),
  });
  const interval = Math.max(1, check.intervalMinutes ?? 5);
  await MonitorUptimeCheck.updateOne(
    { _id: check._id },
    { $set: { nextRunAt: new Date(Date.now() + interval * 60 * 1000) } }
  );
  if (!ok) {
    void pageOnCall({
      projectId: String(check.projectId),
      title: `Down: ${check.url}`,
      body: error || `HTTP ${status ?? '?'}`,
      link: `/monitor/${check.projectId}/uptime`,
      dedupeKey: `uptime:${check._id}`,
    });
    evaluateMonitorAlerts({
      kind: 'uptime',
      orgId: String(check.taskflowOrganizationId),
      projectId: String(check.projectId),
      fields: {
        checkId: String(check._id),
        url: check.url,
        status: String(status ?? ''),
        ok: 'false',
        message: error || `uptime failed ${status ?? ''}`.trim(),
      },
    });
  }
}

export function startMonitorUptimeScheduler(): void {
  setInterval(() => {
    void (async () => {
      const due = await MonitorUptimeCheck.find({
        enabled: true,
        nextRunAt: { $lte: new Date() },
      })
        .limit(20)
        .lean();
      for (const check of due) {
        await runCheck(check);
      }
    })().catch((err) => console.error('monitor uptime:', err));
  }, 30_000);
}
