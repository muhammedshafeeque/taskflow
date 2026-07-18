import mongoose from 'mongoose';
import { CrmAccount } from '../models/crmAccount.model';
import { CrmContact } from '../models/crmContact.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmPipeline } from '../models/crmPipeline.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export async function listLeads(workspaceId: string | null | undefined, status?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (status) filter.status = status;
  return CrmLead.find(filter).sort({ createdAt: -1 }).lean();
}

export async function createLead(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await CrmLead.create({
    taskflowOrganizationId: toOrgOid(orgId),
    title: String(input.title ?? '').trim(),
    source: input.source ?? 'web',
    status: 'new',
    score: input.score,
    assigneeId: input.assigneeId,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    companyName: input.companyName,
    notes: input.notes,
  });
  return doc.toObject();
}

export async function updateLead(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await CrmLead.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Lead not found');
  return updated;
}

export async function convertLead(
  id: string,
  workspaceId: string | null | undefined,
  userId: string,
  pipelineId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const lead = await CrmLead.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (lead.status === 'converted') throw new ApiError(400, 'Lead already converted');

  let account = lead.accountId
    ? await CrmAccount.findById(lead.accountId)
    : null;
  if (!account) {
    account = await CrmAccount.create({
      taskflowOrganizationId: toOrgOid(orgId),
      name: lead.companyName || lead.contactName || lead.title,
      type: 'prospect',
      ownerId: lead.assigneeId ?? userId,
      tags: ['from-lead'],
    });
  }

  let contact = lead.contactEmail
    ? await CrmContact.findOne({ accountId: account._id, email: lead.contactEmail })
    : null;
  if (!contact && (lead.contactName || lead.contactEmail)) {
    contact = await CrmContact.create({
      taskflowOrganizationId: toOrgOid(orgId),
      accountId: account._id,
      name: lead.contactName || lead.companyName || 'Contact',
      email: lead.contactEmail,
      phone: lead.contactPhone,
      isPrimary: true,
    });
  }

  const pipeline = pipelineId
    ? await CrmPipeline.findOne({ _id: pipelineId, taskflowOrganizationId: toOrgOid(orgId) })
    : await CrmPipeline.findOne({ taskflowOrganizationId: toOrgOid(orgId), isDefault: true });
  if (!pipeline || !pipeline.stages?.length) throw new ApiError(400, 'No pipeline configured');

  const firstStage = [...pipeline.stages].sort((a, b) => a.order - b.order)[0];
  const deal = await CrmDeal.create({
    taskflowOrganizationId: toOrgOid(orgId),
    accountId: account._id,
    pipelineId: pipeline._id,
    stageId: (firstStage as { _id?: mongoose.Types.ObjectId })._id,
    title: lead.title,
    ownerId: lead.assigneeId ?? userId,
    leadId: lead._id,
    status: 'open',
  });

  lead.status = 'converted';
  lead.accountId = account._id as mongoose.Types.ObjectId;
  lead.dealId = deal._id as mongoose.Types.ObjectId;
  await lead.save();

  try {
    const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
    await dispatchWebhook(orgId, 'lead.converted', {
      leadId: String(lead._id),
      accountId: String(account._id),
      dealId: String(deal._id),
    });
  } catch {
    /* best-effort */
  }

  return { lead: lead.toObject(), account: account.toObject(), deal: deal.toObject(), contact };
}
