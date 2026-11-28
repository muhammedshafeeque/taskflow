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
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export async function listDeals(
  workspaceId: string | null | undefined,
  opts: {
    status?: string;
    stageId?: string;
    unlinked?: boolean;
    ownerId?: string;
    search?: string;
    pipelineId?: string;
    /** Record-level access (AUT-29): extra conditions limiting the deals the viewer reaches. */
    scope?: Record<string, unknown>;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.scope && Object.keys(opts.scope).length) filter.$and = [opts.scope];
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

type DealDoc = InstanceType<typeof CrmDeal>;
type PipelineStage = { _id?: mongoose.Types.ObjectId; name?: string; order: number; probability?: number; isWon?: boolean; isLost?: boolean };

/**
 * Every route that wins, loses or reopens a deal goes through here (AUT-32), so they all run the same
 * steps: the stage moves to the pipeline's won/lost stage, probability follows the stage, a lost deal
 * must say why, the workspace's stage rules are checked, and then commission, alerts and webhooks fire.
 *
 * `stageId` moves to that stage (its won/lost flag decides the status); `status` alone closes or
 * reopens the deal in its pipeline.
 */
async function moveDeal(
  orgId: string,
  deal: DealDoc,
  target: { stageId?: string; status?: 'open' | 'won' | 'lost' },
  opts: { winReason?: unknown; lossReason?: unknown; enforceRules?: boolean; probability?: number } = {}
) {
  const pipeline = await CrmPipeline.findOne({ _id: deal.pipelineId, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  const stages = ((pipeline?.stages ?? []) as PipelineStage[]).slice().sort((a, b) => a.order - b.order);
  const openStages = stages.filter((st) => !st.isWon && !st.isLost);
  let stage: PipelineStage | undefined;
  if (target.stageId) {
    stage = stages.find((st) => String(st._id) === String(target.stageId));
    if (!stage) throw new ApiError(400, 'Invalid stage');
  } else if (target.status === 'won') stage = stages.find((st) => st.isWon);
  else if (target.status === 'lost') stage = stages.find((st) => st.isLost);
  else if (target.status === 'open') {
    const current = stages.find((st) => String(st._id) === String(deal.stageId));
    stage = current && !current.isWon && !current.isLost ? current : openStages[0];
  }
  const status: 'open' | 'won' | 'lost' = stage ? (stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open') : (target.status ?? deal.status);

  if (opts.enforceRules && stage) {
    const { getStageRules, assertDealMove } = await import('../stageRules');
    assertDealMove((await getStageRules(orgId)).deals, stages, deal.stageId, stage._id);
  }
  const { requireReason } = await import('../stageRules');
  if (status === 'lost') deal.lossReason = requireReason(opts.lossReason ?? deal.lossReason, 'lost');
  if (opts.winReason !== undefined) deal.winReason = String(opts.winReason ?? '').trim() || undefined;

  const previous = deal.status;
  if (stage?._id) deal.stageId = stage._id;
  deal.status = status;
  deal.probability = opts.probability ?? stage?.probability ?? (status === 'won' ? 100 : status === 'lost' ? 0 : deal.probability);
  await deal.save();
  if (status !== previous) await afterStatusChange(orgId, deal, previous);
  return deal;
}

/** Commission, alerts and webhooks when a deal's status changes. */
async function afterStatusChange(orgId: string, deal: DealDoc, previous: string) {
  const id = String(deal._id);
  if (deal.status === 'won') void accrueDealCommission(id).catch((err) => console.error('[commission]', err));
  else if (previous === 'won') void voidDealCommission(id).catch(() => undefined);
  if (deal.status === 'won' || deal.status === 'lost') {
    void notifyUsers([deal.ownerId], deal.status === 'won' ? 'crm_deal_won' : 'crm_deal_lost', {
      title: `Deal ${deal.status}: ${deal.title}`,
      body: deal.status === 'lost' && deal.lossReason ? `${deal.currency} ${deal.value} · ${deal.lossReason}` : `${deal.currency} ${deal.value}`,
      link: `/crm/deals/${id}`,
    });
  }
  // Sales-to-delivery handover (AUT-41): starts on a win, and no longer applies once the deal is reopened or lost.
  try {
    const handover = await import('../handover/handover.service');
    if (deal.status === 'won') await handover.startHandover(orgId, id);
    else if (previous === 'won') await handover.cancelHandover(orgId, id);
  } catch (err) {
    console.error('[handover]', err);
  }
  if (deal.status === 'won') {
    try {
      const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
      await dispatchWebhook(orgId, 'deal.won', { dealId: id, title: deal.title, value: deal.value });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Win a deal from another module (project created, quotation accepted). Already won: nothing to do.
 * A lost deal is won again when the customer accepts after all.
 */
export async function winDeal(orgId: string, dealId: unknown, winReason?: string) {
  if (!dealId || !mongoose.isValidObjectId(String(dealId))) return null;
  const deal = await CrmDeal.findOne({ _id: dealId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal || deal.status === 'won') return deal;
  return moveDeal(orgId, deal, { status: 'won' }, { winReason: deal.winReason || winReason });
}

export async function updateDeal(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const { pickUpdateFields } = await import('../../../utils/pickUpdateFields');
  const $set = pickUpdateFields(input, [
    'title',
    'value',
    'currency',
    'pipelineId',
    'accountId',
    'contactId',
    'ownerId',
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
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  const status = input.status === undefined ? undefined : String(input.status);
  if (status !== undefined && !['open', 'won', 'lost'].includes(status)) throw new ApiError(400, 'Status must be open, won or lost');
  const stageId = input.stageId ? String(input.stageId) : undefined;
  const pipelineChanged = $set.pipelineId !== undefined && String($set.pipelineId) !== String(deal.pipelineId);
  const statusChanged = status !== undefined && status !== deal.status;
  const stageChanged = stageId !== undefined && stageId !== String(deal.stageId);

  // A lost deal must keep a reason: clearing it is refused.
  if ('lossReason' in $set && deal.status === 'lost' && !statusChanged && !String($set.lossReason ?? '').trim()) {
    throw new ApiError(400, 'Say why the deal was lost');
  }
  deal.set($set);
  if (pipelineChanged) {
    // Moving to another pipeline: the stage must belong to it; rules compare stages within one pipeline.
    deal.stageId = stageId ? new mongoose.Types.ObjectId(stageId) : deal.stageId;
    await deal.save();
    if (stageId || statusChanged) {
      await moveDeal(orgId, deal, { stageId, status: status as 'open' | 'won' | 'lost' | undefined }, { lossReason: input.lossReason, enforceRules: false });
    }
  } else if (statusChanged || stageChanged) {
    await moveDeal(orgId, deal, { stageId: stageChanged ? stageId : undefined, status: status as 'open' | 'won' | 'lost' | undefined }, {
      lossReason: input.lossReason,
      enforceRules: true,
      probability: input.probability !== undefined ? Number(input.probability) : undefined,
    });
  } else {
    await deal.save();
  }
  return CrmDeal.findById(deal._id).lean();
}

export async function moveDealStage(
  id: string,
  workspaceId: string | null | undefined,
  stageId: string,
  opts: { lossReason?: unknown; winReason?: unknown } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const deal = await CrmDeal.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  await moveDeal(orgId, deal, { stageId }, { lossReason: opts.lossReason, winReason: opts.winReason, enforceRules: true });
  return deal.toObject();
}

/**
 * Create the delivery project for a deal, run by the chosen project manager (AUT-30). The deal is
 * marked won if it was still open: creating the project is the explicit "we won it" step. Nobody is
 * booked on the project; the project manager staffs it. The route also needs project create.
 */
export async function createProjectFromDeal(
  dealId: string,
  workspaceId: string | null | undefined,
  userId: string,
  input: { name: string; key: string; templateId?: string; leadId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const deal = await CrmDeal.findOne({ _id: dealId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deal) throw new ApiError(404, 'Deal not found');
  if (deal.status !== 'won' && deal.status !== 'open') {
    throw new ApiError(400, 'Deal must be open or won to create project');
  }
  if (deal.projectId && (await Project.exists({ _id: deal.projectId }))) {
    throw new ApiError(409, 'This deal already has a project');
  }
  const { createDeliveryProject, runCommercialHandoff } = await import('../commercialHandoff.service');
  const projectId = await createDeliveryProject(
    orgId,
    userId,
    { leadId: String(input.leadId ?? ''), name: input.name, key: input.key, templateId: input.templateId },
    { title: deal.title, description: `Created from deal: ${deal.title}`, customerOrgId: deal.customerOrgId ? String(deal.customerOrgId) : undefined }
  );
  deal.projectId = new mongoose.Types.ObjectId(projectId);
  await deal.save();
  // Same steps as any other win: won stage, commission, alert and webhook (AUT-32).
  await winDeal(orgId, deal._id, 'Delivery project created');
  // The deal may have been won before the project existed: its handover now goes to the project's lead.
  const { linkHandoverProject } = await import('../handover/handover.service');
  await linkHandoverProject(orgId, deal._id, projectId);
  // Links the customer, quotes, contracts and invoices of the deal to the project.
  await runCommercialHandoff({
    workspaceId: orgId,
    userId,
    customerOrgId: deal.customerOrgId ? String(deal.customerOrgId) : undefined,
    dealId: String(deal._id),
    createPortalOrg: false,
  });
  const project = await Project.findById(projectId).lean();
  return { deal: await CrmDeal.findById(deal._id).lean(), project };
}

export async function getForecast(workspaceId: string | null | undefined, scope: Record<string, unknown> = {}) {
  const orgId = requireWorkspaceId(workspaceId);
  const deals = await CrmDeal.find({ taskflowOrganizationId: toOrgOid(orgId), ...scope, status: 'open' }).lean();
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
