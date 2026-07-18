import mongoose from 'mongoose';
import { CrmContract, type CrmContractKind } from '../models/crmContract.model';
import { CrmAccount } from '../models/crmAccount.model';
import { WorkLog } from '../../workLogs/workLog.model';
import { SlaPolicy } from '../../service-desk/models/slaPolicy.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

const ALLOWED_UPDATE = [
  'title',
  'kind',
  'value',
  'currency',
  'billingCycle',
  'startDate',
  'endDate',
  'renewalDate',
  'autoRenew',
  'hoursIncluded',
  'hoursUsed',
  'status',
  'notes',
  'projectId',
  'dealId',
  'slaPolicyId',
  'accountId',
] as const;

export type ListContractsQuery = {
  accountId?: string;
  kind?: string;
  status?: string;
  renewingWithinDays?: number;
};

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function pickUpdates(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_UPDATE) {
    if (!(key in input)) continue;
    const val = input[key];
    if (key === 'startDate' || key === 'endDate' || key === 'renewalDate') {
      out[key] = val === null || val === '' ? null : asDate(val);
      continue;
    }
    if (key === 'value' || key === 'hoursIncluded' || key === 'hoursUsed') {
      out[key] = val === null || val === undefined || val === '' ? undefined : Number(val);
      continue;
    }
    if (key === 'autoRenew') {
      out[key] = Boolean(val);
      continue;
    }
    if (key === 'projectId' || key === 'dealId' || key === 'slaPolicyId' || key === 'accountId') {
      out[key] = val === null || val === '' ? null : val;
      continue;
    }
    out[key] = val;
  }
  return out;
}

export async function listContracts(workspaceId: string | null | undefined, query: ListContractsQuery = {}) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.accountId) filter.accountId = query.accountId;
  if (query.kind) filter.kind = query.kind;
  if (query.status) filter.status = query.status;
  if (query.renewingWithinDays != null && query.renewingWithinDays > 0) {
    const now = new Date();
    const until = new Date(now.getTime() + query.renewingWithinDays * 24 * 60 * 60 * 1000);
    filter.status = query.status ?? 'active';
    filter.renewalDate = { $gte: now, $lte: until };
  }
  return CrmContract.find(filter)
    .populate('accountId', 'name type')
    .populate('slaPolicyId', 'name')
    .sort({ renewalDate: 1, startDate: -1 })
    .lean();
}

export async function createContract(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const account = await CrmAccount.findOne({ _id: input.accountId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!account) throw new ApiError(404, 'Account not found');
  if (!input.title || !String(input.title).trim()) throw new ApiError(400, 'Title is required');
  if (!input.startDate) throw new ApiError(400, 'Start date is required');

  if (input.slaPolicyId) {
    const sla = await SlaPolicy.findOne({ _id: input.slaPolicyId, taskflowOrganizationId: toOrgOid(orgId) });
    if (!sla) throw new ApiError(404, 'SLA policy not found');
  }

  const kind = (String(input.kind ?? 'other') as CrmContractKind) || 'other';
  const endDate = asDate(input.endDate);
  const renewalDate = asDate(input.renewalDate) ?? endDate;

  const doc = await CrmContract.create({
    taskflowOrganizationId: toOrgOid(orgId),
    accountId: input.accountId,
    dealId: input.dealId || undefined,
    projectId: input.projectId || undefined,
    title: String(input.title).trim(),
    kind,
    value: Number(input.value ?? 0),
    currency: input.currency ?? 'USD',
    billingCycle: input.billingCycle ?? 'monthly',
    startDate: asDate(input.startDate)!,
    endDate,
    renewalDate,
    autoRenew: Boolean(input.autoRenew),
    hoursIncluded: input.hoursIncluded != null && input.hoursIncluded !== '' ? Number(input.hoursIncluded) : undefined,
    status: input.status ?? 'draft',
    slaPolicyId: input.slaPolicyId || undefined,
    notes: input.notes,
  });
  return doc.toObject();
}

export async function updateContract(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const updates = pickUpdates(input);
  if (updates.slaPolicyId) {
    const sla = await SlaPolicy.findOne({ _id: updates.slaPolicyId, taskflowOrganizationId: toOrgOid(orgId) });
    if (!sla) throw new ApiError(404, 'SLA policy not found');
  }
  const updated = await CrmContract.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: updates },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Contract not found');
  return updated;
}

export async function deleteContract(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmContract.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Contract not found');
  return { deleted: true };
}

export async function getContractBurnDown(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const contract = await CrmContract.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  if (!contract) throw new ApiError(404, 'Contract not found');
  let hoursUsed = contract.hoursUsed ?? 0;
  if (contract.projectId) {
    const projectOid = new mongoose.Types.ObjectId(String(contract.projectId));
    const logs = await WorkLog.aggregate([
      { $lookup: { from: 'issues', localField: 'issue', foreignField: '_id', as: 'issueDoc' } },
      { $unwind: '$issueDoc' },
      { $match: { 'issueDoc.project': projectOid } },
      { $group: { _id: null, total: { $sum: '$minutesSpent' } } },
    ]);
    hoursUsed = (logs[0]?.total ?? 0) / 60;
  }
  const included = contract.hoursIncluded ?? 0;
  return {
    contract,
    hoursUsed: Math.round(hoursUsed * 10) / 10,
    hoursRemaining: Math.max(0, Math.round((included - hoursUsed) * 10) / 10),
    percentUsed: included > 0 ? Math.round((hoursUsed / included) * 100) : 0,
  };
}

export async function getContractsHubDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [contracts, slaPolicies] = await Promise.all([
    CrmContract.find({ taskflowOrganizationId: orgOid }).lean(),
    SlaPolicy.find({ taskflowOrganizationId: orgOid }).select('name enabled').lean(),
  ]);

  const active = contracts.filter((c) => c.status === 'active');
  const activeValue = active.reduce((s, c) => s + (c.value ?? 0), 0);

  const byStatus = ['draft', 'active', 'expired', 'cancelled'].map((status) => ({
    name: status,
    count: contracts.filter((c) => c.status === status).length,
    value: contracts.filter((c) => c.status === status).reduce((s, c) => s + (c.value ?? 0), 0),
  }));

  const byKind = ['msa', 'retainer', 'amc', 'other'].map((kind) => ({
    name: kind.toUpperCase(),
    kind,
    count: contracts.filter((c) => (c.kind ?? 'other') === kind).length,
    value: contracts
      .filter((c) => (c.kind ?? 'other') === kind)
      .reduce((s, c) => s + (c.value ?? 0), 0),
  }));

  const renewals = contracts
    .filter((c) => c.status === 'active' && c.renewalDate)
    .map((c) => ({
      ...c,
      daysUntilRenewal: Math.ceil((new Date(c.renewalDate!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    }))
    .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);

  const renewalsIn30 = renewals.filter((c) => c.daysUntilRenewal >= 0 && c.renewalDate! <= in30);
  const renewalsIn60 = renewals.filter((c) => c.daysUntilRenewal >= 0 && c.renewalDate! <= in60);
  const renewalsIn90 = renewals.filter((c) => c.daysUntilRenewal >= 0 && c.renewalDate! <= in90);

  const renewalBuckets = [
    { name: '0–30d', count: renewalsIn30.length, value: renewalsIn30.reduce((s, c) => s + (c.value ?? 0), 0) },
    {
      name: '31–60d',
      count: renewals.filter((c) => c.daysUntilRenewal > 30 && c.renewalDate! <= in60).length,
      value: renewals
        .filter((c) => c.daysUntilRenewal > 30 && c.renewalDate! <= in60)
        .reduce((s, c) => s + (c.value ?? 0), 0),
    },
    {
      name: '61–90d',
      count: renewals.filter((c) => c.daysUntilRenewal > 60 && c.renewalDate! <= in90).length,
      value: renewals
        .filter((c) => c.daysUntilRenewal > 60 && c.renewalDate! <= in90)
        .reduce((s, c) => s + (c.value ?? 0), 0),
    },
    {
      name: '90d+',
      count: renewals.filter((c) => c.daysUntilRenewal > 90).length,
      value: renewals.filter((c) => c.daysUntilRenewal > 90).reduce((s, c) => s + (c.value ?? 0), 0),
    },
  ];

  const retainers = active.filter((c) => c.kind === 'retainer' || c.kind === 'amc');
  const retainerBurn = retainers.map((c) => {
    const included = c.hoursIncluded ?? 0;
    const used = c.hoursUsed ?? 0;
    return {
      _id: String(c._id),
      title: c.title,
      kind: c.kind,
      hoursIncluded: included,
      hoursUsed: used,
      percentUsed: included > 0 ? Math.round((used / included) * 100) : 0,
      hoursRemaining: Math.max(0, included - used),
    };
  });

  const billingCycleMix = ['monthly', 'quarterly', 'annual', 'one_time'].map((cycle) => ({
    name: cycle,
    count: active.filter((c) => c.billingCycle === cycle).length,
    value: active.filter((c) => c.billingCycle === cycle).reduce((s, c) => s + (c.value ?? 0), 0),
  }));

  return {
    counts: {
      total: contracts.length,
      active: active.length,
      msas: contracts.filter((c) => c.kind === 'msa').length,
      retainers: contracts.filter((c) => c.kind === 'retainer' || c.kind === 'amc').length,
      renewalsIn30: renewalsIn30.length,
      renewalsIn90: renewalsIn90.length,
      slaPolicies: slaPolicies.length,
      slaEnabled: slaPolicies.filter((p) => p.enabled).length,
      autoRenew: active.filter((c) => c.autoRenew).length,
    },
    activeValue,
    byStatus,
    byKind,
    renewalBuckets,
    upcomingRenewals: renewalsIn90.slice(0, 12).map((c) => ({
      _id: String(c._id),
      title: c.title,
      kind: c.kind ?? 'other',
      value: c.value ?? 0,
      currency: c.currency ?? 'USD',
      renewalDate: c.renewalDate,
      daysUntilRenewal: c.daysUntilRenewal,
      autoRenew: c.autoRenew,
      accountId: String(c.accountId),
    })),
    retainerBurn: retainerBurn.sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 10),
    billingCycleMix,
    slaPolicies: slaPolicies.map((p) => ({
      _id: String(p._id),
      name: p.name,
      enabled: p.enabled,
    })),
  };
}
