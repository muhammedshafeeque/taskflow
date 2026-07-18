import mongoose from 'mongoose';
import { CrmAccount } from '../models/crmAccount.model';
import { CrmContact } from '../models/crmContact.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmDeal } from '../models/crmDeal.model';
import { Project } from '../../projects/project.model';
import { CustomerRequest } from '../../customer-portal/customer-request/customerRequest.model';
import { Issue } from '../../issues/issue.model';
import { CrmContract } from '../models/crmContract.model';
import { BillingInvoice } from '../../billing/models/billingInvoice.model';
import { BillingSubscription } from '../../billing/models/billingSubscription.model';
import { ServiceTicket } from '../../service-desk/models/serviceTicket.model';
import { Asset } from '../../assets/models/asset.model';
import { DocumentRecord } from '../../documents/models/documentRecord.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { logAudit } from '../../auditLogs/logAudit';

export async function listAccounts(
  workspaceId: string | null | undefined,
  opts: { type?: string; search?: string; page?: number; limit?: number } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.type) filter.type = opts.type;
  if (opts.search?.trim()) {
    filter.name = { $regex: opts.search.trim(), $options: 'i' };
  }
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    CrmAccount.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    CrmAccount.countDocuments(filter),
  ]);
  return { data, total, page, limit };
}

export async function getAccountById(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const account = await CrmAccount.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) })
    .populate('ownerId', 'name email')
    .lean();
  if (!account) throw new ApiError(404, 'Account not found');
  return account;
}

export async function getAccount360(id: string, workspaceId: string | null | undefined) {
  const account = await getAccountById(id, workspaceId);
  const accountOid = new mongoose.Types.ObjectId(id);
  const [contacts, activities, deals, projects, requests, contracts, invoices, subscriptions, tickets, assets, documents] =
    await Promise.all([
      CrmContact.find({ accountId: accountOid }).sort({ isPrimary: -1, name: 1 }).lean(),
      CrmActivity.find({ relatedType: 'account', relatedId: accountOid }).sort({ createdAt: -1 }).limit(50).lean(),
      CrmDeal.find({ accountId: accountOid }).sort({ updatedAt: -1 }).lean(),
      Project.find({ crmAccountId: accountOid }).select('name key archived').lean(),
      (account as { customerOrgId?: mongoose.Types.ObjectId }).customerOrgId
        ? CustomerRequest.find({ customerOrgId: (account as { customerOrgId: mongoose.Types.ObjectId }).customerOrgId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
        : Promise.resolve([]),
      CrmContract.find({ accountId: accountOid }).sort({ updatedAt: -1 }).lean(),
      BillingInvoice.find({ accountId: accountOid }).sort({ issueDate: -1 }).limit(20).lean(),
      BillingSubscription.find({ accountId: accountOid }).sort({ updatedAt: -1 }).lean(),
      ServiceTicket.find({ accountId: accountOid }).sort({ updatedAt: -1 }).limit(20).lean(),
      Asset.find({ accountId: accountOid }).sort({ updatedAt: -1 }).limit(20).lean(),
      DocumentRecord.find({ accountId: accountOid }).sort({ updatedAt: -1 }).limit(20).lean(),
    ]);
  const projectIds = (account as { projectIds?: mongoose.Types.ObjectId[] }).projectIds ?? [];
  const linkedProjects = projects.length
    ? projects
    : projectIds.length
      ? await Project.find({ _id: { $in: projectIds } }).select('name key archived').lean()
      : [];
  const issueIds = (requests as { linkedIssueId?: mongoose.Types.ObjectId }[])
    .map((r) => r.linkedIssueId)
    .filter(Boolean);
  const issues = issueIds.length
    ? await Issue.find({ _id: { $in: issueIds } }).select('key title status').lean()
    : [];

  const invoiced = Math.round(invoices.reduce((s, i) => s + (i.total ?? 0), 0) * 100) / 100;
  const collected = Math.round(invoices.reduce((s, i) => s + (i.amountPaid ?? 0), 0) * 100) / 100;
  const mrr = Math.round(
    subscriptions
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => {
        const monthly = s.billingCycle === 'annual' ? s.amount / 12 : s.billingCycle === 'quarterly' ? s.amount / 3 : s.amount;
        return sum + monthly;
      }, 0) * 100
  ) / 100;
  const financials = {
    lifetimeValue: Math.round((deals.filter((d) => d.status === 'won').reduce((s, d) => s + (d.value ?? 0), 0)) * 100) / 100,
    contractValue: Math.round(contracts.filter((c) => c.status === 'active').reduce((s, c) => s + (c.value ?? 0), 0) * 100) / 100,
    invoiced,
    collected,
    outstanding: Math.round((invoiced - collected) * 100) / 100,
    mrr,
    openTickets: tickets.filter((t) => !['resolved', 'closed'].includes(t.status)).length,
  };

  return {
    account,
    contacts,
    activities,
    deals,
    projects: linkedProjects,
    requests,
    issues,
    contracts,
    invoices,
    subscriptions,
    tickets,
    assets,
    documents,
    financials,
  };
}

export async function createAccount(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await CrmAccount.create({
    taskflowOrganizationId: toOrgOid(orgId),
    name: String(input.name ?? '').trim(),
    type: input.type ?? 'client',
    industry: input.industry,
    size: input.size,
    website: input.website,
    billingAddress: input.billingAddress,
    tags: input.tags ?? [],
    ownerId: input.ownerId,
    notes: input.notes,
    customFields: input.customFields,
  });
  logAudit({
    userId,
    action: 'create',
    resourceType: 'crm_account',
    resourceId: String(doc._id),
    meta: { name: doc.name },
  });
  return doc.toObject();
}

export async function updateAccount(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await CrmAccount.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Account not found');
  logAudit({ userId, action: 'update', resourceType: 'crm_account', resourceId: id, meta: { name: updated.name } });
  return updated;
}

export async function deleteAccount(id: string, workspaceId: string | null | undefined, userId: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmAccount.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Account not found');
  await CrmContact.deleteMany({ accountId: id });
  logAudit({ userId, action: 'delete', resourceType: 'crm_account', resourceId: id });
  return { ok: true };
}

export async function linkProject(accountId: string, projectId: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const account = await CrmAccount.findOne({ _id: accountId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!account) throw new ApiError(404, 'Account not found');
  const project = await Project.findOne({ _id: projectId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!project) throw new ApiError(404, 'Project not found');
  const pid = new mongoose.Types.ObjectId(projectId);
  if (!account.projectIds.some((x) => String(x) === projectId)) {
    account.projectIds.push(pid);
    await account.save();
  }
  await Project.findByIdAndUpdate(projectId, { $set: { crmAccountId: account._id } });
  return account.toObject();
}
