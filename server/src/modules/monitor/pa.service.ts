/**
 * Cross-project monitor summary for the PA Control Center (one round-trip
 * instead of 5 calls per project).
 */
import {
  MonitorAlertDelivery,
  MonitorErrorGroup,
  MonitorProject,
  MonitorUptimeCheck,
  MonitorUptimeSample,
} from './monitor.models';
import { overview } from './query.service';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';

const DAY = 24 * 60 * 60 * 1000;

export async function monitorSummary(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const projects = await MonitorProject.find({ taskflowOrganizationId: orgOid })
    .select('_id name key')
    .sort({ name: 1 })
    .lean();

  const since = new Date(Date.now() - DAY);
  const rows = await Promise.all(
    projects.map(async (p) => {
      const base = { taskflowOrganizationId: orgOid, projectId: p._id };
      const [ov, deliveries, errors, checks, samples] = await Promise.all([
        overview(orgId, String(p._id)).catch(() => null),
        MonitorAlertDelivery.find(base).sort({ timestamp: -1 }).limit(30).lean(),
        MonitorErrorGroup.find({ ...base, status: 'open' }).sort({ lastSeen: -1 }).limit(20).lean(),
        MonitorUptimeCheck.find(base).sort({ name: 1 }).lean(),
        MonitorUptimeSample.find({ ...base, timestamp: { $gte: since } })
          .sort({ timestamp: -1 })
          .limit(500)
          .lean(),
      ]);
      return {
        _id: String(p._id),
        name: p.name,
        key: p.key,
        overview: ov,
        deliveries,
        errors,
        checks,
        samples,
      };
    })
  );

  return { generatedAt: new Date().toISOString(), projects: rows };
}
