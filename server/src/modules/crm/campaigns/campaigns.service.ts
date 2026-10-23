import mongoose from 'mongoose';
import { CrmCampaign, CRM_CAMPAIGN_STATUSES, CRM_CAMPAIGN_TYPES } from '../models/crmCampaign.model';
import { CrmLead } from '../models/crmLead.model';
import { ApiError } from '../../../utils/ApiError';
import { escapeRegex } from '../../../utils/safeUrl';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

function slugCode(name: string, fallback?: string): string {
  const from = (fallback || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return from.slice(0, 32) || 'CAMPAIGN';
}

function pick(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (input.name != null) patch.name = String(input.name).trim();
  if (input.code != null) patch.code = slugCode(String(input.code));
  if (input.type != null && CRM_CAMPAIGN_TYPES.includes(input.type as (typeof CRM_CAMPAIGN_TYPES)[number])) {
    patch.type = input.type;
  }
  if (input.status != null && CRM_CAMPAIGN_STATUSES.includes(input.status as (typeof CRM_CAMPAIGN_STATUSES)[number])) {
    patch.status = input.status;
  }
  if ('channel' in input) patch.channel = input.channel ? String(input.channel).trim() : undefined;
  if ('utmSource' in input) patch.utmSource = input.utmSource ? String(input.utmSource).trim() : undefined;
  if ('utmMedium' in input) patch.utmMedium = input.utmMedium ? String(input.utmMedium).trim() : undefined;
  if ('utmCampaign' in input) patch.utmCampaign = input.utmCampaign ? String(input.utmCampaign).trim() : undefined;
  if ('notes' in input) patch.notes = input.notes ? String(input.notes) : undefined;
  if ('budget' in input) {
    const n = Number(input.budget);
    patch.budget = Number.isFinite(n) ? n : undefined;
  }
  if ('currency' in input) patch.currency = String(input.currency || 'USD').trim().toUpperCase();
  if ('startsAt' in input) patch.startsAt = input.startsAt ? new Date(String(input.startsAt)) : undefined;
  if ('endsAt' in input) patch.endsAt = input.endsAt ? new Date(String(input.endsAt)) : undefined;
  return patch;
}

export async function listCampaigns(
  workspaceId: string | null | undefined,
  opts: { status?: string; search?: string } = {}
): Promise<Array<Record<string, unknown>>> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (opts.status) filter.status = opts.status;
  if (opts.search?.trim()) {
    const q = escapeRegex(opts.search.trim());
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { code: { $regex: q, $options: 'i' } },
      { utmCampaign: { $regex: q, $options: 'i' } },
    ];
  }
  const data = await CrmCampaign.find(filter).sort({ updatedAt: -1 }).lean();
  const ids = data.map((c) => c._id);
  const counts = ids.length
    ? await CrmLead.aggregate<{ _id: mongoose.Types.ObjectId; count: number; converted: number }>([
        { $match: { taskflowOrganizationId: orgOid, campaignId: { $in: ids } } },
        {
          $group: {
            _id: '$campaignId',
            count: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const byId = new Map(counts.map((r) => [String(r._id), r]));
  return data.map((c) => {
    const stats = byId.get(String(c._id));
    return { ...c, leadCount: stats?.count ?? 0, convertedCount: stats?.converted ?? 0 };
  }) as Array<Record<string, unknown>>;
}

export async function getCampaign(
  id: string,
  workspaceId: string | null | undefined
): Promise<Record<string, unknown>> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const campaign = await CrmCampaign.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean();
  if (!campaign) throw new ApiError(404, 'Campaign not found');
  const [leadCount, convertedCount, openCount] = await Promise.all([
    CrmLead.countDocuments({ taskflowOrganizationId: orgOid, campaignId: campaign._id }),
    CrmLead.countDocuments({ taskflowOrganizationId: orgOid, campaignId: campaign._id, status: 'converted' }),
    CrmLead.countDocuments({
      taskflowOrganizationId: orgOid,
      campaignId: campaign._id,
      status: { $nin: ['converted', 'unqualified'] },
    }),
  ]);
  return { ...campaign, leadCount, convertedCount, openCount } as Record<string, unknown>;
}

export async function createCampaign(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const name = String(input.name ?? '').trim();
  if (!name) throw new ApiError(400, 'Name is required');
  const code = slugCode(String(input.code ?? name), name);
  try {
    const doc = await CrmCampaign.create({
      taskflowOrganizationId: toOrgOid(orgId),
      ...pick({ ...input, name, code }),
      name,
      code,
    });
    return doc.toObject();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 11000) {
      throw new ApiError(409, 'Campaign code already exists');
    }
    throw e;
  }
}

export async function updateCampaign(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const patch = pick(input);
  try {
    const updated = await CrmCampaign.findOneAndUpdate(
      { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
      { $set: patch },
      { new: true }
    ).lean();
    if (!updated) throw new ApiError(404, 'Campaign not found');
    return updated;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 11000) {
      throw new ApiError(409, 'Campaign code already exists');
    }
    throw e;
  }
}

export async function deleteCampaign(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const linked = await CrmLead.countDocuments({ taskflowOrganizationId: orgOid, campaignId: id });
  if (linked) throw new ApiError(400, 'Cannot delete a campaign that has leads. Pause it instead.');
  const deleted = await CrmCampaign.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid });
  if (!deleted) throw new ApiError(404, 'Campaign not found');
  return { ok: true };
}
