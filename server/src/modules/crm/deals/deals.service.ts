import { accrueDealCommission, voidDealCommission } from '../commissions/commissions';
import { notifyUsers } from '../../notifications/domainNotify';
import mongoose from 'mongoose';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmPipeline } from '../models/crmPipeline.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmQuote } from '../models/crmQuote.model';
import { CrmContract } from '../models/crmContract.model';
import { CrmLead } from '../models/crmLead.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { Project } from '../../projects/project.model';
import * as projectsService from '../../projects/projects.service';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export async function listDeals(
  workspaceId: string | null | undefined,
  opts: { status?: string; stageId?: string; unlinked?: boolean; ownerId?: string; search?: string; pipelineId?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.ownerId && mongoose.isValidObjectId(opts.ownerId)) filter.ownerId = opts.ownerId;
  if (opts.pipelineId && mongoose.isValidObjectId(opts.pipelineId)) filter.pipelineId = opts.pipelineId;
  if (opts.search?.trim()) {
    filter.title = { $regex: opts.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  if (opts.unlinked) {
    filter.$or = [{ customerOrgId: null }, { customerOrgId: { $exists: false } }];
  }
  if (opts.status) filter.status = opts.status;
  if (opts.stageId) filter.stageId = opts.stageId;
  return CrmDeal.find(filter)
    .populate('customerOrgId', 'name status')
    .populate('accountId', 'name type')
    .populate('ownerId', 'name email')
    .populate('contactId', 'name email')
    .sort({ updatedAt: -1 })
    .lean();
}

export async function createDeal(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const customerOrgId = String(input.customerOrgId ?? '');
  if (!customerOrgId) throw new ApiError(400, 'Customer organisation is required');
  const customerOrg = await CustomerOrg.findOne({ _id: customerOrgId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!customerOrg) throw new ApiError(404, 'Customer organisation not found');
  const pipeline = await CrmPipeline.findOne({ _id: input.pipelineId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!pipeline) throw new ApiError(404, 'Pipeline not found');
  const doc = await CrmDeal.create({
    taskflowOrganizationId: toOrgOid(orgId),
    customerOrgId,
    contactId: input.contactId || undefined,
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    title: String(input.title ?? '').trim(),
    value: Number(input.value ?? 0),
    currency: input.currency ?? 'USD',
    probability: Number(input.probability ?? 0),
    expectedCloseDate: input.expectedCloseDate ? new Date(String(input.expectedCloseDate)) : undefined,
    ownerId: input.ownerId || undefined,
    accountId: input.accountId || undefined,
    lineItems: input.lineItems ?? [],
    status: 'open',
  });
  return doc.toObject();
}

/** One deal with its people, stage and related records — powers the deal detail screen. */
export async function getDeal(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Deal not found');
  const orgOid = toOrgOid(orgId);
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: orgOid })
    .populate('customerOrgId', 'name status')
    .populate('accountId', 'name type')
    .populate('ownerId', 'name email')
    .populate('contactId', 'name email phone')
    .populate('leadId', 'title')
    .populate('projectId', 'name key')
    .lean();
  if (!deal) throw new ApiError(404, 'Deal not found');
  const [pipeline, quotes, contracts] = await Promise.all([
    CrmPipeline.findOne({ _id: deal.pipelineId, taskflowOrganizationId: orgOid }).lean(),
    CrmQuote.find({ taskflowOrganizationId: orgOid, dealId: deal._id })
      .select('title status total currency version validUntil createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    CrmContract.find({ taskflowOrganizationId: orgOid, dealId: deal._id })
      .select('title status value currency startDate endDate kind')
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  return { deal, pipeline, quotes, contracts };
}

/** Deletes a deal and its activities; quotes and contracts are kept but unlinked. */
export async function deleteDeal(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!deal) throw new ApiError(404, 'Deal not found');
  if (deal.status === 'won') void voidDealCommission(String(deal._id)).catch(() => undefined);
  await Promise.all([
    CrmActivity.deleteMany({ taskflowOrganizationId: orgOid, relatedType: 'deal', relatedId: deal._id }),
    CrmQuote.updateMany({ taskflowOrganizationId: orgOid, dealId: deal._id }, { $unset: { dealId: 1 } }),
    CrmContract.updateMany({ taskflowOrganizationId: orgOid, dealId: deal._id }, { $unset: { dealId: 1 } }),
    CrmLead.updateMany({ taskflowOrganizationId: orgOid, dealId: deal._id }, { $unset: { dealId: 1 } }),
  ]);
  await deal.deleteOne();
  return { deleted: true };
}

export async function updateDeal(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const { pickUpdateFields } = await import('../../../utils/pickUpdateFields');
  const $set = pickUpdateFields(input, [
    'title',
    'value',
    'currency',
    'stageId',
    'pipelineId',
    'accountId',
    'contactId',
    'ownerId',
    'status',
    'expectedCloseDate',
    'lineItems',
    'probability',
    'customerOrgId',
    'winReason',
    'lossReason',
    'competitorNotes',
  ]);
  for (const k of ['ownerId', 'accountId', 'contactId', 'expectedCloseDate'] as const) {
    if (k in $set && !$set[k]) $set[k] = null;
  }
  // Closing a deal from the detail screen also parks it in the pipeline's won/lost stage.
  if ((input.status === 'won' || input.status === 'lost') && !input.stageId) {
    const current = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('pipelineId').lean();
    const pipeline = current ? await CrmPipeline.findById(current.pipelineId).lean() : null;
    const stage = pipeline?.stages?.find((st) => (input.status === 'won' ? st.isWon : st.isLost));
    if (stage) {
      $set.stageId = stage._id;
      $set.probability = stage.probability ?? (input.status === 'won' ? 100 : 0);
    }
  }
  const previous = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('status').lean();
  const updated = await CrmDeal.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Deal not found');
  const statusChanged = !!input.status && input.status !== previous?.status;
  if (statusChanged && input.status === 'won') void accrueDealCommission(String(updated._id)).catch((err) => console.error('[commission]', err));
  else if (statusChanged && previous?.status === 'won') void voidDealCommission(String(updated._id)).catch(() => undefined);
  if (statusChanged && (input.status === 'won' || input.status === 'lost')) {
    void notifyUsers([updated.ownerId], input.status === 'won' ? 'crm_deal_won' : 'crm_deal_lost', {
      title: `Deal ${input.status}: ${updated.title}`,
      body: `${updated.currency} ${updated.value}`,
      link: `/crm/deals/${updated._id}`,
    });
  }
  return updated;
}

export async function moveDealStage(id: string, workspaceId: string | null | undefined, stageId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  const pipeline = await CrmPipeline.findById(deal.pipelineId);
  const stage = pipeline?.stages?.find((s) => String((s as { _id?: unknown })._id) === stageId);
  if (!stage) throw new ApiError(400, 'Invalid stage');
  deal.stageId = new mongoose.Types.ObjectId(stageId);
  deal.probability = (stage as { probability?: number }).probability ?? deal.probability;
  if ((stage as { isWon?: boolean }).isWon) deal.status = 'won';
  else if ((stage as { isLost?: boolean }).isLost) deal.status = 'lost';
  else deal.status = 'open';
  const previousStatus = (await CrmDeal.findById(deal._id).select('status').lean())?.status;
  await deal.save();
  if (deal.status !== previousStatus) {
    if (deal.status === 'won') void accrueDealCommission(String(deal._id)).catch((err) => console.error('[commission]', err));
    else if (previousStatus === 'won') void voidDealCommission(String(deal._id)).catch(() => undefined);
  }
  if (deal.status !== previousStatus && (deal.status === 'won' || deal.status === 'lost')) {
    void notifyUsers([deal.ownerId], deal.status === 'won' ? 'crm_deal_won' : 'crm_deal_lost', {
      title: `Deal ${deal.status}: ${deal.title}`,
      body: `${deal.currency} ${deal.value}`,
      link: `/crm/deals/${deal._id}`,
    });
  }
  if (deal.status === 'won') {
    try {
      const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
      await dispatchWebhook(orgId, 'deal.won', { dealId: String(deal._id), title: deal.title, value: deal.value });
    } catch {
      /* best-effort */
    }
  }
  return deal.toObject();
}

export async function createProjectFromDeal(
  dealId: string,
  workspaceId: string | null | undefined,
  userId: string,
  input: { name: string; key: string; templateId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const deal = await CrmDeal.findOne({ _id: dealId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  if (deal.status !== 'won' && deal.status !== 'open') {
    throw new ApiError(400, 'Deal must be open or won to create project');
  }
  const project = await projectsService.create(
    {
      name: input.name,
      key: input.key.toUpperCase(),
      lead: userId,
      templateId: input.templateId,
      description: `Created from deal: ${deal.title}`,
    },
    userId,
    orgId
  );
  const projectId = String((project as { _id: unknown })._id);
  deal.projectId = new mongoose.Types.ObjectId(projectId);
  deal.status = 'won';
  await deal.save();
  await Project.findByIdAndUpdate(projectId, {
    $set: { ...(deal.customerOrgId ? { orgId: deal.customerOrgId } : {}) },
  });
  try {
    const { runCommercialHandoff } = await import('../commercialHandoff.service');
    await runCommercialHandoff({
      workspaceId: orgId,
      userId,
      customerOrgId: deal.customerOrgId ? String(deal.customerOrgId) : undefined,
      dealId: String(deal._id),
      createProject: false,
      createPortalOrg: false,
    });
  } catch (err) {
    console.error('commercialHandoff from deal project:', err);
  }
  return { deal: deal.toObject(), project };
}

export async function getForecast(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deals = await CrmDeal.find({ taskflowOrganizationId: toOrgOid(orgId), status: 'open' }).lean();
  const byMonth: Record<string, { weighted: number; total: number; count: number }> = {};
  for (const d of deals) {
    const month = d.expectedCloseDate
      ? d.expectedCloseDate.toISOString().slice(0, 7)
      : 'unscheduled';
    if (!byMonth[month]) byMonth[month] = { weighted: 0, total: 0, count: 0 };
    byMonth[month].total += d.value ?? 0;
    byMonth[month].weighted += (d.value ?? 0) * ((d.probability ?? 0) / 100);
    byMonth[month].count += 1;
  }
  return { byMonth, pipelineValue: deals.reduce((s, d) => s + (d.value ?? 0), 0) };
}
