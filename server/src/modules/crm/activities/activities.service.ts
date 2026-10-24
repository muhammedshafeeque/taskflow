import mongoose from 'mongoose';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmAccount } from '../models/crmAccount.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

const RELATED = ['account', 'contact', 'lead', 'deal', 'ticket'] as const;

export async function listActivities(
  workspaceId: string | null | undefined,
  opts: {
    relatedType?: string;
    relatedId?: string;
    type?: string;
    assigneeId?: string;
    mine?: boolean;
    overdue?: boolean;
    completed?: string;
    userId?: string;
  }
): Promise<Array<Record<string, unknown>>> {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.relatedType) filter.relatedType = opts.relatedType;
  if (opts.relatedId && mongoose.isValidObjectId(opts.relatedId)) {
    filter.relatedId = new mongoose.Types.ObjectId(opts.relatedId);
  }
  if (opts.type) filter.type = opts.type;
  if (opts.assigneeId && mongoose.isValidObjectId(opts.assigneeId)) {
    filter.assigneeId = new mongoose.Types.ObjectId(opts.assigneeId);
  }
  if (opts.mine && opts.userId && mongoose.isValidObjectId(opts.userId)) {
    filter.assigneeId = new mongoose.Types.ObjectId(opts.userId);
  }
  if (opts.completed === '1' || opts.completed === 'true') {
    filter.completedAt = { $ne: null };
  } else if (opts.completed === '0' || opts.completed === 'false' || opts.overdue) {
    filter.$and = [...((filter.$and as object[]) ?? []), { $or: [{ completedAt: { $exists: false } }, { completedAt: null }] }];
  }
  if (opts.overdue) {
    filter.dueAt = { $lt: new Date() };
  }
  const rows = await CrmActivity.find(filter)
    .populate('assigneeId', 'name email')
    .populate('createdBy', 'name email')
    .sort({ dueAt: 1, createdAt: -1 })
    .limit(200)
    .lean();

  const leadIds = rows.filter((r) => r.relatedType === 'lead').map((r) => r.relatedId);
  const dealIds = rows.filter((r) => r.relatedType === 'deal').map((r) => r.relatedId);
  const accountIds = rows.filter((r) => r.relatedType === 'account').map((r) => r.relatedId);
  const [leads, deals, accounts] = await Promise.all([
    leadIds.length ? CrmLead.find({ _id: { $in: leadIds } }).select('title').lean() : [],
    dealIds.length ? CrmDeal.find({ _id: { $in: dealIds } }).select('title').lean() : [],
    accountIds.length ? CrmAccount.find({ _id: { $in: accountIds } }).select('name').lean() : [],
  ]);
  const leadMap = new Map(leads.map((l) => [String(l._id), l.title]));
  const dealMap = new Map(deals.map((d) => [String(d._id), d.title]));
  const accountMap = new Map(accounts.map((a) => [String(a._id), a.name]));

  return rows.map((r) => ({
    ...r,
    relatedTitle:
      r.relatedType === 'lead'
        ? leadMap.get(String(r.relatedId))
        : r.relatedType === 'deal'
          ? dealMap.get(String(r.relatedId))
          : r.relatedType === 'account'
            ? accountMap.get(String(r.relatedId))
            : undefined,
  })) as Array<Record<string, unknown>>;
}

export async function createActivity(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const relatedType = String(input.relatedType ?? '');
  const relatedId = String(input.relatedId ?? '');
  if (!RELATED.includes(relatedType as (typeof RELATED)[number])) {
    throw new ApiError(400, 'Related record type is required');
  }
  if (!mongoose.isValidObjectId(relatedId)) throw new ApiError(400, 'Related record is required');
  const subject = String(input.subject ?? '').trim();
  if (!subject) throw new ApiError(400, 'Subject is required');
  const doc = await CrmActivity.create({
    taskflowOrganizationId: toOrgOid(orgId),
    type: input.type ?? 'note',
    subject,
    body: input.body,
    dueAt: input.dueAt ? new Date(String(input.dueAt)) : undefined,
    assigneeId: input.assigneeId && mongoose.isValidObjectId(String(input.assigneeId)) ? input.assigneeId : undefined,
    createdBy: userId,
    relatedType,
    relatedId,
    mailMessageId: input.mailMessageId,
  });
  if (relatedType === 'lead' && input.type === 'follow_up' && input.dueAt) {
    await CrmLead.updateOne(
      { _id: relatedId, taskflowOrganizationId: toOrgOid(orgId) },
      { $set: { nextFollowUpAt: new Date(String(input.dueAt)) } }
    );
  }
  return doc.toObject();
}

export async function updateActivity(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const patch: Record<string, unknown> = {};
  if (input.subject != null) patch.subject = String(input.subject).trim();
  if (input.type != null) patch.type = String(input.type);
  if (input.completed === false) patch.completedAt = null;
  if ('body' in input) patch.body = input.body;
  if ('dueAt' in input) patch.dueAt = input.dueAt ? new Date(String(input.dueAt)) : undefined;
  if ('assigneeId' in input) {
    patch.assigneeId =
      input.assigneeId && mongoose.isValidObjectId(String(input.assigneeId)) ? input.assigneeId : undefined;
  }
  const updated = await CrmActivity.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Activity not found');
  if (updated.relatedType === 'lead' && updated.type === 'follow_up' && 'dueAt' in input) {
    if (input.dueAt) {
      await CrmLead.updateOne(
        { _id: updated.relatedId, taskflowOrganizationId: toOrgOid(orgId) },
        { $set: { nextFollowUpAt: new Date(String(input.dueAt)) } }
      );
    }
  }
  return updated;
}

export async function completeActivity(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const existing = await CrmActivity.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Activity not found');
  existing.completedAt = new Date();
  await existing.save();
  if (existing.relatedType === 'lead' && existing.type === 'follow_up') {
    const lead = await CrmLead.findOne({ _id: existing.relatedId, taskflowOrganizationId: orgOid });
    if (lead?.nextFollowUpAt && existing.dueAt) {
      const a = new Date(lead.nextFollowUpAt).toISOString().slice(0, 10);
      const b = new Date(existing.dueAt).toISOString().slice(0, 10);
      if (a === b) {
        lead.nextFollowUpAt = undefined;
        await lead.save();
      }
    }
  }
  return existing.toObject();
}

export async function deleteActivity(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmActivity.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Activity not found');
  return { ok: true };
}
