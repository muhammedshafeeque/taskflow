import { SlaPolicy } from './models/slaPolicy.model';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';

const DEFAULT_TARGETS = [
  { priority: 'low', firstResponseMinutes: 480, resolutionMinutes: 2880 },
  { priority: 'medium', firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { priority: 'high', firstResponseMinutes: 60, resolutionMinutes: 480 },
  { priority: 'urgent', firstResponseMinutes: 15, resolutionMinutes: 240 },
];

export async function listSlaPolicies(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return SlaPolicy.find({ taskflowOrganizationId: toOrgOid(orgId) }).sort({ name: 1 }).lean();
}

export async function ensureDefaultSla(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await SlaPolicy.findOne({ taskflowOrganizationId: toOrgOid(orgId), enabled: true });
  if (existing) return existing.toObject();
  const doc = await SlaPolicy.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: 'Default SLA',
    targets: DEFAULT_TARGETS,
    enabled: true,
  });
  return doc.toObject();
}

export async function createSlaPolicy(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await SlaPolicy.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? 'SLA Policy').trim(),
    targets: input.targets ?? DEFAULT_TARGETS,
    enabled: input.enabled !== false,
  });
  return doc.toObject();
}

export async function updateSlaPolicy(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await SlaPolicy.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'SLA policy not found');
  return updated;
}
