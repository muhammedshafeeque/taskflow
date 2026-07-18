import { CrmActivity } from '../models/crmActivity.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export async function listActivities(
  workspaceId: string | null | undefined,
  opts: { relatedType?: string; relatedId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.relatedType) filter.relatedType = opts.relatedType;
  if (opts.relatedId) filter.relatedId = opts.relatedId;
  return CrmActivity.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

export async function createActivity(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await CrmActivity.create({
    taskflowOrganizationId: toOrgOid(orgId),
    type: input.type ?? 'note',
    subject: String(input.subject ?? '').trim(),
    body: input.body,
    dueAt: input.dueAt ? new Date(String(input.dueAt)) : undefined,
    assigneeId: input.assigneeId,
    createdBy: userId,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    mailMessageId: input.mailMessageId,
  });
  return doc.toObject();
}

export async function completeActivity(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await CrmActivity.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: { completedAt: new Date() } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Activity not found');
  return updated;
}

export async function deleteActivity(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmActivity.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Activity not found');
  return { ok: true };
}
