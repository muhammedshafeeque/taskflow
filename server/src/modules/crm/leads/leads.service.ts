import mongoose from 'mongoose';
import { CrmContact } from '../models/crmContact.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmPipeline } from '../models/crmPipeline.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmCampaign } from '../models/crmCampaign.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { upsertContactByEmail } from '../contacts/contacts.service';
import { ApiError } from '../../../utils/ApiError';
import { escapeRegex } from '../../../utils/safeUrl';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { logAudit } from '../../auditLogs/logAudit';
import {
  computeLeadScore,
  CRM_LEAD_COMPANY_SIZES,
  CRM_LEAD_DECISION_ROLES,
  CRM_LEAD_SERVICES,
  CRM_LEAD_SOURCES,
  CRM_LEAD_STATUSES,
  CRM_LEAD_TIMELINES,
  normalizeLeadStatus,
  OPEN_LEAD_STATUSES,
  type CrmLeadStatus,
} from './leads.constants';

const LEAD_POPULATE = { path: 'assigneeId', select: 'name email' } as const;

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

function dateVal(v: unknown): Date | undefined {
  if (v == null || v === '') return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function inList(v: unknown, allowed: readonly string[]): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return allowed.includes(s) ? s : undefined;
}

function strList(v: unknown, allowed?: readonly string[]): string[] {
  const raw = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(',').map((x) => x.trim())
      : [];
  const cleaned = raw.map((x) => String(x).trim()).filter(Boolean);
  if (!allowed) return [...new Set(cleaned)];
  return [...new Set(cleaned.filter((x) => allowed.includes(x)))];
}

function oid(v: unknown): mongoose.Types.ObjectId | undefined {
  const s = str(v);
  if (!s || !mongoose.isValidObjectId(s)) return undefined;
  return new mongoose.Types.ObjectId(s);
}

type LeadPatch = Record<string, unknown>;

function pickLeadFields(input: Record<string, unknown>, opts?: { allowStatus?: boolean }): LeadPatch {
  const patch: LeadPatch = {};
  const title = str(input.title);
  if (title !== undefined) patch.title = title;
  const source = str(input.source);
  if (source !== undefined) patch.source = source;
  if (opts?.allowStatus) {
    const status = normalizeLeadStatus(input.status);
    if (status) patch.status = status;
  }
  const assigneeId = oid(input.assigneeId);
  if (input.assigneeId === null || input.assigneeId === '') patch.assigneeId = undefined;
  else if (assigneeId) patch.assigneeId = assigneeId;
  const accountId = oid(input.accountId);
  if (input.accountId === null || input.accountId === '') patch.accountId = undefined;
  else if (accountId) patch.accountId = accountId;
  const customerOrgId = oid(input.customerOrgId);
  if (input.customerOrgId === null || input.customerOrgId === '') patch.customerOrgId = undefined;
  else if (customerOrgId) patch.customerOrgId = customerOrgId;
  const campaignId = oid(input.campaignId);
  if (input.campaignId === null || input.campaignId === '') patch.campaignId = undefined;
  else if (campaignId) patch.campaignId = campaignId;

  const scalars: Array<[string, (v: unknown) => unknown]> = [
    ['contactName', str],
    ['contactEmail', (v) => str(v)?.toLowerCase()],
    ['contactPhone', str],
    ['jobTitle', str],
    ['companyName', str],
    ['website', str],
    ['industry', str],
    ['country', str],
    ['techStack', str],
    ['campaign', str],
    ['competitor', str],
    ['notes', str],
    ['disqualifyReason', str],
    ['currency', (v) => str(v)?.toUpperCase()],
    ['estimatedBudget', num],
    ['ndaRequired', bool],
    ['rfpReceived', bool],
    ['nextFollowUpAt', dateVal],
    ['companySize', (v) => inList(v, CRM_LEAD_COMPANY_SIZES)],
    ['timeline', (v) => inList(v, CRM_LEAD_TIMELINES)],
    ['decisionRole', (v) => inList(v, CRM_LEAD_DECISION_ROLES)],
  ];
  for (const [key, fn] of scalars) {
    if (!(key in input)) continue;
    const next = fn(input[key]);
    patch[key] = next === undefined ? undefined : next;
  }
  if ('serviceInterest' in input) patch.serviceInterest = strList(input.serviceInterest, CRM_LEAD_SERVICES);
  if ('tags' in input) patch.tags = strList(input.tags);
  if ('additionalContacts' in input) patch.additionalContacts = parseAdditionalContacts(input.additionalContacts);
  return patch;
}

function parseAdditionalContacts(v: unknown) {
  if (!Array.isArray(v)) return [];
  const rows: Array<{
    name?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    decisionRole?: string;
    contactId?: mongoose.Types.ObjectId;
  }> = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const name = str(row.name);
    const email = str(row.email)?.toLowerCase();
    const phone = str(row.phone);
    const jobTitle = str(row.jobTitle);
    const decisionRole = inList(row.decisionRole, CRM_LEAD_DECISION_ROLES);
    const contactId = oid(row.contactId);
    if (!name && !email && !phone && !jobTitle && !contactId) continue;
    rows.push({
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(jobTitle ? { jobTitle } : {}),
      ...(decisionRole ? { decisionRole } : {}),
      ...(contactId ? { contactId } : {}),
    });
  }
  return rows;
}

function applyScore(patch: LeadPatch, existing?: Record<string, unknown>): number {
  const merged = { ...(existing ?? {}), ...patch };
  return computeLeadScore({
    contactEmail: str(merged.contactEmail),
    companyName: str(merged.companyName),
    website: str(merged.website),
    estimatedBudget: num(merged.estimatedBudget),
    companySize: str(merged.companySize),
    serviceInterest: Array.isArray(merged.serviceInterest) ? (merged.serviceInterest as string[]) : [],
    timeline: str(merged.timeline),
    decisionRole: str(merged.decisionRole),
    rfpReceived: Boolean(merged.rfpReceived),
    source: str(merged.source),
    jobTitle: str(merged.jobTitle),
  });
}

async function applyCampaignAttribution(
  orgId: string,
  fields: LeadPatch
): Promise<void> {
  const campaignId = fields.campaignId as mongoose.Types.ObjectId | undefined;
  if (!campaignId) return;
  const campaign = await CrmCampaign.findOne({
    _id: campaignId,
    taskflowOrganizationId: toOrgOid(orgId),
  }).lean();
  if (!campaign) throw new ApiError(400, 'Campaign not found');
  if (!str(fields.campaign)) {
    fields.campaign = campaign.utmCampaign || campaign.code;
  }
}

async function logLeadActivity(
  orgId: string,
  leadId: mongoose.Types.ObjectId,
  userId: string,
  subject: string,
  body?: string,
  type: 'note' | 'follow_up' | 'task' = 'note'
) {
  try {
    await CrmActivity.create({
      taskflowOrganizationId: toOrgOid(orgId),
      type,
      subject,
      body,
      createdBy: userId,
      relatedType: 'lead',
      relatedId: leadId,
    });
  } catch {
    /* best-effort */
  }
}

const AUTO_FOLLOW_PREFIX = 'Follow up:';

async function syncLeadFollowUp(
  orgId: string,
  lead: { _id: mongoose.Types.ObjectId; title?: string; nextFollowUpAt?: Date | null; assigneeId?: mongoose.Types.ObjectId },
  userId?: string
) {
  const orgOid = toOrgOid(orgId);
  const open = await CrmActivity.findOne({
    taskflowOrganizationId: orgOid,
    relatedType: 'lead',
    relatedId: lead._id,
    type: 'follow_up',
    completedAt: { $exists: false },
    subject: { $regex: `^${AUTO_FOLLOW_PREFIX}` },
  });
  const due = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  if (!due || Number.isNaN(due.getTime())) {
    if (open) {
      open.completedAt = new Date();
      await open.save();
    }
    return;
  }
  const subject = `${AUTO_FOLLOW_PREFIX} ${lead.title || 'Lead'}`;
  const actor = userId || (lead.assigneeId ? String(lead.assigneeId) : '');
  if (open) {
    open.dueAt = due;
    open.subject = subject;
    if (lead.assigneeId) open.assigneeId = lead.assigneeId;
    await open.save();
    return;
  }
  if (!actor) return;
  await CrmActivity.create({
    taskflowOrganizationId: orgOid,
    type: 'follow_up',
    subject,
    dueAt: due,
    assigneeId: lead.assigneeId,
    createdBy: actor,
    relatedType: 'lead',
    relatedId: lead._id,
  });
}

export async function listLeads(
  workspaceId: string | null | undefined,
  opts: {
    status?: string;
    source?: string;
    assigneeId?: string;
    serviceInterest?: string;
    search?: string;
    page?: number;
    limit?: number;
    campaignId?: string;
    unlinked?: boolean;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.unlinked) {
    filter.$or = [{ customerOrgId: null }, { customerOrgId: { $exists: false } }];
    filter.status = { $ne: 'unqualified' };
  }
  const status = normalizeLeadStatus(opts.status);
  if (status) filter.status = status;
  if (opts.source?.trim()) filter.source = opts.source.trim();
  if (opts.campaignId && mongoose.isValidObjectId(opts.campaignId)) {
    filter.campaignId = new mongoose.Types.ObjectId(opts.campaignId);
  }
  if (opts.assigneeId && mongoose.isValidObjectId(opts.assigneeId)) {
    filter.assigneeId = new mongoose.Types.ObjectId(opts.assigneeId);
  }
  if (opts.serviceInterest?.trim()) filter.serviceInterest = opts.serviceInterest.trim();
  if (opts.search?.trim()) {
    const q = escapeRegex(opts.search.trim());
    filter.$or = [
      { title: { $regex: q, $options: 'i' } },
      { companyName: { $regex: q, $options: 'i' } },
      { contactName: { $regex: q, $options: 'i' } },
      { contactEmail: { $regex: q, $options: 'i' } },
      { 'additionalContacts.name': { $regex: q, $options: 'i' } },
      { 'additionalContacts.email': { $regex: q, $options: 'i' } },
      { campaign: { $regex: q, $options: 'i' } },
    ];
  }
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    CrmLead.find(filter).populate(LEAD_POPULATE).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    CrmLead.countDocuments(filter),
  ]);
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getLeadStats(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [byStatus, open, overdueFollowUps, convertedThisMonth] = await Promise.all([
    CrmLead.aggregate<{ _id: string; count: number }>([
      { $match: { taskflowOrganizationId: orgOid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CrmLead.countDocuments({ taskflowOrganizationId: orgOid, status: { $in: OPEN_LEAD_STATUSES } }),
    CrmLead.countDocuments({
      taskflowOrganizationId: orgOid,
      status: { $in: OPEN_LEAD_STATUSES },
      nextFollowUpAt: { $lt: new Date() },
    }),
    CrmLead.countDocuments({
      taskflowOrganizationId: orgOid,
      status: 'converted',
      updatedAt: { $gte: startOfMonth },
    }),
  ]);
  const statusCounts: Record<string, number> = {};
  for (const row of byStatus) statusCounts[row._id] = row.count;
  const converted = statusCounts.converted ?? 0;
  const total = Object.values(statusCounts).reduce((s, n) => s + n, 0);
  return {
    statusCounts,
    open,
    overdueFollowUps,
    convertedThisMonth,
    conversionRate: total ? Math.round((converted / total) * 100) : 0,
    total,
  };
}

export async function getLead(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const lead = await CrmLead.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) })
    .populate(LEAD_POPULATE)
    .populate('customerOrgId', 'name status contactEmail')
    .populate('dealId', 'title status value currency')
    .populate('campaignId', 'name code status utmCampaign')
    .lean();
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
}

export async function createLead(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const fields = pickLeadFields(input, { allowStatus: true });
  await applyCampaignAttribution(orgId, fields);
  const title = String(fields.title ?? '').trim();
  if (!title) throw new ApiError(400, 'Title is required');
  const status = (fields.status as CrmLeadStatus | undefined) ?? 'new';
  const score = applyScore({ ...fields, title, status });
  const doc = await CrmLead.create({
    taskflowOrganizationId: toOrgOid(orgId),
    ...fields,
    title,
    source: fields.source ?? 'website',
    status,
    score,
    currency: fields.currency ?? 'USD',
  });
  if (userId) {
    logAudit({
      userId,
      action: 'crm.lead.create',
      resourceType: 'crm_lead',
      resourceId: String(doc._id),
      meta: { title },
    });
    await logLeadActivity(orgId, doc._id as mongoose.Types.ObjectId, userId, 'Lead created', title);
  }
  await syncLeadFollowUp(orgId, doc, userId);
  await upsertPeopleFromLead(orgId, doc);
  return CrmLead.findById(doc._id).populate(LEAD_POPULATE).populate('campaignId', 'name code status').populate('customerOrgId', 'name status').lean();
}

export async function updateLead(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await CrmLead.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Lead not found');
  if (existing.status === 'converted' && normalizeLeadStatus(input.status) && normalizeLeadStatus(input.status) !== 'converted') {
    throw new ApiError(400, 'Converted leads cannot change status');
  }
  const fields = pickLeadFields(input, { allowStatus: existing.status !== 'converted' });
  await applyCampaignAttribution(orgId, fields);
  const score = applyScore(fields, existing.toObject() as unknown as Record<string, unknown>);
  fields.score = score;
  const prevStatus = existing.status;
  const unset: Record<string, 1> = {};
  if (fields.accountId === undefined && (input.accountId === null || input.accountId === '')) {
    unset.accountId = 1;
    delete fields.accountId;
  }
  if (fields.customerOrgId === undefined && (input.customerOrgId === null || input.customerOrgId === '')) {
    unset.customerOrgId = 1;
    delete fields.customerOrgId;
  }
  if (fields.campaignId === undefined && (input.campaignId === null || input.campaignId === '')) {
    unset.campaignId = 1;
    delete fields.campaignId;
  }
  const updated = await CrmLead.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: fields, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true }
  )
    .populate(LEAD_POPULATE)
    .lean();
  if (!updated) throw new ApiError(404, 'Lead not found');
  if (userId) {
    logAudit({
      userId,
      action: 'crm.lead.update',
      resourceType: 'crm_lead',
      resourceId: id,
      meta: { status: updated.status },
    });
    if (fields.status && fields.status !== prevStatus) {
      await logLeadActivity(
        orgId,
        existing._id as mongoose.Types.ObjectId,
        userId,
        `Status → ${String(fields.status)}`,
        prevStatus
      );
    }
  }
  await syncLeadFollowUp(
    orgId,
    {
      _id: existing._id as mongoose.Types.ObjectId,
      title: updated.title,
      nextFollowUpAt: updated.nextFollowUpAt,
      assigneeId: updated.assigneeId as mongoose.Types.ObjectId | undefined,
    },
    userId
  );
  await upsertPeopleFromLead(orgId, updated);
  return updated;
}

export async function deleteLead(id: string, workspaceId: string | null | undefined, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const lead = await CrmLead.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (lead.status === 'converted') throw new ApiError(400, 'Converted leads cannot be deleted');
  await CrmLead.deleteOne({ _id: lead._id });
  if (userId) {
    logAudit({
      userId,
      action: 'crm.lead.delete',
      resourceType: 'crm_lead',
      resourceId: id,
      meta: { title: lead.title },
    });
  }
  return { ok: true };
}

async function upsertPeopleFromLead(
  orgId: string,
  lead: {
    contactEmail?: string;
    contactName?: string;
    contactPhone?: string;
    jobTitle?: string;
    customerOrgId?: unknown;
    additionalContacts?: Array<{ email?: string; name?: string; phone?: string; jobTitle?: string }>;
  }
) {
  const orgRef = lead.customerOrgId ? String(lead.customerOrgId) : undefined;
  if (lead.contactEmail) {
    await upsertContactByEmail(orgId, {
      email: lead.contactEmail,
      name: lead.contactName,
      phone: lead.contactPhone,
      title: lead.jobTitle,
      origin: 'lead',
      customerOrgId: orgRef,
      isPrimary: true,
    });
  }
  for (const extra of lead.additionalContacts ?? []) {
    if (!extra.email) continue;
    await upsertContactByEmail(orgId, {
      email: extra.email,
      name: extra.name,
      phone: extra.phone,
      title: extra.jobTitle,
      origin: 'lead',
      customerOrgId: orgRef,
    });
  }
}

export async function convertLead(
  id: string,
  workspaceId: string | null | undefined,
  userId: string,
  opts: {
    pipelineId?: string;
    customerOrgId?: string;
    dealValue?: number;
    expectedCloseDate?: string;
    createProject?: boolean;
    createPortalOrg?: boolean;
    portalOrg?: {
      name?: string;
      contactEmail?: string;
      contactPhone?: string;
      description?: string;
      adminName?: string;
      adminEmail?: string;
    };
    contactId?: string;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const lead = await CrmLead.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (lead.status === 'converted') throw new ApiError(400, 'Lead already converted');
  if (lead.status === 'unqualified') throw new ApiError(400, 'Unqualified leads cannot be converted');

  let customerOrgId = opts.customerOrgId || (lead.customerOrgId ? String(lead.customerOrgId) : '');
  if (customerOrgId) {
    const org = await CustomerOrg.findOne({ _id: customerOrgId, taskflowOrganizationId: toOrgOid(orgId) });
    if (!org) throw new ApiError(404, 'Customer organisation not found');
  }

  const createPortalOrg = opts.createPortalOrg !== false && !customerOrgId;
  if (createPortalOrg) {
    const email = (opts.portalOrg?.adminEmail || opts.portalOrg?.contactEmail || lead.contactEmail || '').trim();
    if (!email) throw new ApiError(400, 'Customer email is required to create a portal organisation');
  }

  await upsertPeopleFromLead(orgId, lead);

  const pipeline = opts.pipelineId
    ? await CrmPipeline.findOne({ _id: opts.pipelineId, taskflowOrganizationId: toOrgOid(orgId) })
    : await CrmPipeline.findOne({ taskflowOrganizationId: toOrgOid(orgId), isDefault: true });
  if (!pipeline || !pipeline.stages?.length) throw new ApiError(400, 'No pipeline configured');

  const firstStage = [...pipeline.stages].sort((a, b) => a.order - b.order)[0];
  const dealValue = opts.dealValue ?? lead.estimatedBudget ?? 0;
  const primaryContact = lead.contactEmail
    ? await CrmContact.findOne({ taskflowOrganizationId: toOrgOid(orgId), email: lead.contactEmail.toLowerCase() })
    : opts.contactId
      ? await CrmContact.findOne({ _id: opts.contactId, taskflowOrganizationId: toOrgOid(orgId) })
      : null;

  const deal = await CrmDeal.create({
    taskflowOrganizationId: toOrgOid(orgId),
    customerOrgId: customerOrgId || undefined,
    contactId: primaryContact?._id,
    pipelineId: pipeline._id,
    stageId: (firstStage as { _id?: mongoose.Types.ObjectId })._id,
    title: lead.title,
    value: dealValue,
    currency: lead.currency || 'USD',
    ownerId: lead.assigneeId ?? userId,
    leadId: lead._id,
    status: 'open',
    expectedCloseDate: opts.expectedCloseDate ? new Date(opts.expectedCloseDate) : undefined,
    competitorNotes: lead.competitor,
  });

  lead.status = 'converted';
  if (customerOrgId) lead.customerOrgId = new mongoose.Types.ObjectId(customerOrgId);
  lead.dealId = deal._id as mongoose.Types.ObjectId;
  await lead.save();

  await logLeadActivity(
    orgId,
    lead._id as mongoose.Types.ObjectId,
    userId,
    'Converted to deal',
    deal.title
  );
  logAudit({
    userId,
    action: 'crm.lead.convert',
    resourceType: 'crm_lead',
    resourceId: id,
    meta: { customerOrgId: customerOrgId || undefined, dealId: String(deal._id) },
  });

  try {
    const { dispatchWebhook } = await import('../ecosystem/ecosystem.service');
    await dispatchWebhook(orgId, 'lead.converted', {
      leadId: String(lead._id),
      customerOrgId: customerOrgId || undefined,
      dealId: String(deal._id),
    });
  } catch {
    /* best-effort */
  }

  const { runCommercialHandoff } = await import('../commercialHandoff.service');
  const handoff = await runCommercialHandoff({
    workspaceId: orgId,
    userId,
    customerOrgId: customerOrgId || undefined,
    portalOrg: opts.portalOrg,
    dealId: String(deal._id),
    leadId: String(lead._id),
    projectTitle: lead.title,
    createProject: opts.createProject !== false,
    createPortalOrg,
  });

  if (createPortalOrg && !handoff.customerOrgId) {
    const msg = handoff.skipped.includes('portal_org_no_email')
      ? 'Customer email is required to create a portal organisation'
      : 'Failed to create portal organisation during conversion';
    throw new ApiError(400, msg);
  }

  if (handoff.customerOrgId) {
    customerOrgId = handoff.customerOrgId;
    lead.customerOrgId = new mongoose.Types.ObjectId(handoff.customerOrgId);
    await lead.save();
    await CrmDeal.findByIdAndUpdate(deal._id, { $set: { customerOrgId: handoff.customerOrgId } });
    await upsertPeopleFromLead(orgId, { ...lead.toObject(), customerOrgId: handoff.customerOrgId });
  }

  const org = customerOrgId
    ? await CustomerOrg.findById(customerOrgId).lean()
    : null;

  return {
    lead: lead.toObject(),
    customerOrg: org,
    deal: deal.toObject(),
    contact: primaryContact?.toObject?.() ?? primaryContact,
    handoff,
  };
}

export function leadCatalog() {
  return {
    statuses: CRM_LEAD_STATUSES,
    sources: CRM_LEAD_SOURCES,
    services: CRM_LEAD_SERVICES,
    companySizes: CRM_LEAD_COMPANY_SIZES,
    timelines: CRM_LEAD_TIMELINES,
    decisionRoles: CRM_LEAD_DECISION_ROLES,
  };
}
