import { CrmPipeline } from '../models/crmPipeline.model';
import { CrmDeal } from '../models/crmDeal.model';
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
  const { pickUpdateFields } = await import('../../../utils/pickUpdateFields');
  const $set = pickUpdateFields(input, ['name', 'stages', 'isDefault', 'active']);
  if (Array.isArray($set.stages)) {
    const stages = $set.stages as Array<{ _id?: string; name?: string }>;
    if (!stages.length) throw new ApiError(400, 'A pipeline needs at least one stage');
    if (stages.some((st) => !String(st.name ?? '').trim())) throw new ApiError(400, 'Every stage needs a name');
    // Refuse to drop a stage that still holds deals — they would vanish from the board.
    const kept = new Set(stages.filter((st) => st._id).map((st) => String(st._id)));
    const current = await CrmPipeline.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
    const removed = (current?.stages ?? []).filter((st) => !kept.has(String(st._id)));
    if (removed.length) {
      const inUse = await CrmDeal.countDocuments({
        taskflowOrganizationId: toOrgOid(orgId),
        stageId: { $in: removed.map((st) => st._id) },
      });
      if (inUse) throw new ApiError(400, `Move the ${inUse} deal(s) out of the removed stage(s) first`);
    }
    $set.stages = stages.map((st, i) => ({ ...st, name: String(st.name).trim(), order: i }));
  }
  const updated = await CrmPipeline.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Pipeline not found');
  if ($set.isDefault) {
    await CrmPipeline.updateMany(
      { taskflowOrganizationId: toOrgOid(orgId), _id: { $ne: updated._id } },
      { $set: { isDefault: false } }
    );
  }
  return updated;
}

export async function deletePipeline(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const pipeline = await CrmPipeline.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!pipeline) throw new ApiError(404, 'Pipeline not found');
  if (pipeline.isDefault) throw new ApiError(400, 'Make another pipeline the default before deleting this one');
  const deals = await CrmDeal.countDocuments({ taskflowOrganizationId: toOrgOid(orgId), pipelineId: pipeline._id });
  if (deals) throw new ApiError(400, `This pipeline still has ${deals} deal(s)`);
  await pipeline.deleteOne();
  return { deleted: true };
}
