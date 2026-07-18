import { CrmPipeline } from '../models/crmPipeline.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

const DEFAULT_STAGES = [
  { name: 'Qualification', order: 0, probability: 10, isWon: false, isLost: false },
  { name: 'Proposal', order: 1, probability: 40, isWon: false, isLost: false },
  { name: 'Negotiation', order: 2, probability: 70, isWon: false, isLost: false },
  { name: 'Won', order: 3, probability: 100, isWon: true, isLost: false },
  { name: 'Lost', order: 4, probability: 0, isWon: false, isLost: true },
];

export async function listPipelines(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return CrmPipeline.find({ taskflowOrganizationId: toOrgOid(orgId) }).sort({ name: 1 }).lean();
}

export async function ensureDefaultPipeline(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await CrmPipeline.findOne({ taskflowOrganizationId: toOrgOid(orgId), isDefault: true });
  if (existing) return existing.toObject();
  const doc = await CrmPipeline.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: 'Default Sales Pipeline',
    isDefault: true,
    stages: DEFAULT_STAGES,
  });
  return doc.toObject();
}

export async function createPipeline(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await CrmPipeline.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? 'Pipeline').trim(),
    isDefault: Boolean(input.isDefault),
    stages: input.stages ?? DEFAULT_STAGES,
  });
  if (doc.isDefault) {
    await CrmPipeline.updateMany(
      { taskflowOrganizationId: toOrgOid(orgId), _id: { $ne: doc._id } },
      { $set: { isDefault: false } }
    );
  }
  return doc.toObject();
}

export async function updatePipeline(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await CrmPipeline.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Pipeline not found');
  return updated;
}
