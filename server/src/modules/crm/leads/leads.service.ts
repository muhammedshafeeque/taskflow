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
import { CrmQuote } from '../models/crmQuote.model';
import { RecordLink } from '../../links/recordLink.model';
import { DocumentRecord } from '../../documents/models/documentRecord.model';
import { MailMessage } from '../../mail/models/mail.models';
import {
  findCustomerOrgMatches,
  findLeadDuplicates,
  normEmail,
  normPhone,
  type DuplicateCandidate,
} from './leadDuplicates';
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

/** A lead by id, or the lead it was merged into when that id was merged away. */
async function findLeadOrMerged(orgId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  const orgOid = toOrgOid(orgId);
  return (
    (await CrmLead.findOne({ _id: id, taskflowOrganizationId: orgOid })) ??
    (await CrmLead.findOne({ taskflowOrganizationId: orgOid, mergedLeadIds: new mongoose.Types.ObjectId(id) }))
  );
}

function duplicateCandidate(src: Record<string, unknown>): DuplicateCandidate {
  return {
    contactEmail: str(src.contactEmail),
    contactPhone: str(src.contactPhone),
    companyName: str(src.companyName),
    website: str(src.website),
    additionalContacts: Array.isArray(src.additionalContacts)
      ? (src.additionalContacts as Array<Record<string, unknown>>).map((c) => ({ email: str(c?.email), phone: str(c?.phone) }))
      : [],
  };
}

/** Likely duplicate leads and matching customer organisations for unsaved lead details. */
export async function checkLeadDuplicates(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const candidate = duplicateCandidate(input);
  const excludeId = str(input.excludeId);
  const [leads, customerOrgs] = await Promise.all([
    findLeadDuplicates(orgId, candidate, { excludeIds: excludeId ? [excludeId] : [] }),
    findCustomerOrgMatches(orgId, candidate),
  ]);
  return { leads, customerOrgs };
}

/** Likely duplicates of a saved lead, and the customer organisations it could convert into. */
export async function getLeadDuplicates(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const lead = await findLeadOrMerged(orgId, id);
  if (!lead) throw new ApiError(404, 'Lead not found');
  const candidate = duplicateCandidate(lead.toObject() as unknown as Record<string, unknown>);
  const [leads, customerOrgs] = await Promise.all([
    findLeadDuplicates(orgId, candidate, { excludeIds: [String(lead._id)] }),
    findCustomerOrgMatches(orgId, candidate),
  ]);
  return { leads, customerOrgs };
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
    /** Record-level access (AUT-29): extra conditions limiting the leads the viewer reaches. */
    scope?: Record<string, unknown>;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.scope && Object.keys(opts.scope).length) filter.$and = [opts.scope];
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

export async function getLeadStats(workspaceId: string | null | undefined, scope: Record<string, unknown> = {}) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const base = { taskflowOrganizationId: orgOid, ...scope };
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [byStatus, open, overdueFollowUps, convertedThisMonth] = await Promise.all([
    CrmLead.aggregate<{ _id: string; count: number }>([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CrmLead.countDocuments({ ...base, status: { $in: OPEN_LEAD_STATUSES } }),
    CrmLead.countDocuments({
      ...base,
      status: { $in: OPEN_LEAD_STATUSES },
      nextFollowUpAt: { $lt: new Date() },
    }),
    CrmLead.countDocuments({
      ...base,
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
  const found = await findLeadOrMerged(orgId, id);
  if (!found) throw new ApiError(404, 'Lead not found');
  const lead = await CrmLead.findById(found._id)
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
  userId?: string,
  opts: { checkDuplicates?: boolean } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const fields = pickLeadFields(input, { allowStatus: true });
  await applyCampaignAttribution(orgId, fields);
  const title = String(fields.title ?? '').trim();
  if (!title) throw new ApiError(400, 'Title is required');
  // People get a warning with the match and must confirm; automated capture (bots, web forms) is never blocked.
  if (opts.checkDuplicates && bool(input.ignoreDuplicates) !== true) {
    const leads = await findLeadDuplicates(orgId, duplicateCandidate(fields));
    if (leads.length) {
      const customerOrgs = await findCustomerOrgMatches(orgId, duplicateCandidate(fields));
      throw new ApiError(409, 'This looks like a lead you already have', {
        code: 'duplicate_lead',
        leads,
        customerOrgs,
      });
    }
  }
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
  const existing = await findLeadOrMerged(orgId, id);
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
    { _id: existing._id, taskflowOrganizationId: toOrgOid(orgId) },
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
      resourceId: String(existing._id),
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
    /** Refuse (409) to create a new organisation when matching ones exist, unless ignoreDuplicates. */
    checkDuplicates?: boolean;
    /** Create a new organisation even though matching ones exist. */
    ignoreDuplicates?: boolean;
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
    if (opts.checkDuplicates && opts.ignoreDuplicates !== true) {
      const customerOrgs = await findCustomerOrgMatches(orgId, {
        ...duplicateCandidate(lead.toObject() as unknown as Record<string, unknown>),
        orgName: opts.portalOrg?.name,
        contactEmail: lead.contactEmail || opts.portalOrg?.contactEmail || opts.portalOrg?.adminEmail,
        contactPhone: lead.contactPhone || opts.portalOrg?.contactPhone,
      });
      if (customerOrgs.length) {
        throw new ApiError(409, 'This customer may already have an organisation', {
          code: 'duplicate_customer_org',
          customerOrgs,
        });
      }
    }
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

/** Plain fields copied from the merged lead only where the kept lead has no value. */
const MERGE_FILL_FIELDS = [
  'contactName', 'contactEmail', 'contactPhone', 'jobTitle', 'companyName', 'website', 'industry',
  'companySize', 'country', 'techStack', 'estimatedBudget', 'timeline', 'decisionRole', 'campaign',
  'campaignId', 'competitor', 'nextFollowUpAt', 'assigneeId', 'accountId', 'customerOrgId',
] as const;

type MergeContact = {
  name?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  decisionRole?: string;
  contactId?: mongoose.Types.ObjectId;
};

/** Same person: same email, else same phone, else same name with neither email nor phone. */
function contactKey(c: MergeContact): string {
  const e = normEmail(c.email);
  if (e) return `e:${e}`;
  const p = normPhone(c.phone);
  if (p) return `p:${p}`;
  return `n:${String(c.name ?? '').trim().toLowerCase()}`;
}

/**
 * Merge `sourceId` into `targetId`: the kept lead fills its blanks from the other, gains its
 * contacts, tags, services and notes, and takes over its activities, quotations, deals, links,
 * documents and emails. The merged lead is deleted; its id keeps resolving to the kept lead.
 */
export async function mergeLeads(
  targetId: string,
  sourceId: string,
  workspaceId: string | null | undefined,
  userId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.isValidObjectId(sourceId)) throw new ApiError(400, 'Choose the lead to merge');
  if (String(targetId) === String(sourceId)) throw new ApiError(400, 'A lead cannot be merged into itself');
  const [target, source] = await Promise.all([
    CrmLead.findOne({ _id: targetId, taskflowOrganizationId: orgOid }),
    CrmLead.findOne({ _id: sourceId, taskflowOrganizationId: orgOid }),
  ]);
  if (!target) throw new ApiError(404, 'Lead not found');
  if (!source) throw new ApiError(404, 'Lead to merge not found');
  if (source.status === 'converted') {
    throw new ApiError(400, 'A converted lead cannot be merged away. Merge the other lead into it instead.');
  }

  const t = target as unknown as Record<string, unknown>;
  const src = source.toObject() as unknown as Record<string, unknown>;
  const filled: string[] = [];
  for (const key of MERGE_FILL_FIELDS) {
    const cur = t[key];
    const next = src[key];
    const empty = cur == null || cur === '';
    if (empty && next != null && next !== '') {
      target.set(key, next);
      filled.push(key);
    }
  }

  target.tags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])];
  target.serviceInterest = [...new Set([...(target.serviceInterest ?? []), ...(source.serviceInterest ?? [])])];
  target.ndaRequired = Boolean(target.ndaRequired || source.ndaRequired);
  target.rfpReceived = Boolean(target.rfpReceived || source.rfpReceived);

  // Everyone on the merged lead becomes a contact here, without repeating the kept lead's people.
  const seen = new Set<string>();
  const primary: MergeContact = { name: target.contactName, email: target.contactEmail, phone: target.contactPhone };
  if (primary.name || primary.email || primary.phone) seen.add(contactKey(primary));
  const contacts: MergeContact[] = [];
  const pushContact = (c: MergeContact) => {
    if (!c.name && !c.email && !c.phone) return;
    const key = contactKey(c);
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push(c);
  };
  const plain = (c: MergeContact): MergeContact => ({
    ...(c.name ? { name: c.name } : {}),
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.jobTitle ? { jobTitle: c.jobTitle } : {}),
    ...(c.decisionRole ? { decisionRole: c.decisionRole } : {}),
    ...(c.contactId ? { contactId: c.contactId } : {}),
  });
  for (const c of target.additionalContacts ?? []) pushContact(plain(c));
  pushContact({
    name: source.contactName,
    email: source.contactEmail,
    phone: source.contactPhone,
    jobTitle: source.jobTitle,
    decisionRole: source.decisionRole,
  });
  for (const c of source.additionalContacts ?? []) pushContact(plain(c));
  target.set('additionalContacts', contacts.map(plain));

  if (source.notes?.trim() && source.notes.trim() !== target.notes?.trim()) {
    target.notes = [target.notes?.trim(), `Merged from "${source.title}":\n${source.notes.trim()}`]
      .filter(Boolean)
      .join('\n\n');
  }

  const mergedIds = new Map<string, mongoose.Types.ObjectId>();
  for (const x of [...(target.mergedLeadIds ?? []), source._id as mongoose.Types.ObjectId, ...(source.mergedLeadIds ?? [])]) {
    mergedIds.set(String(x), x);
  }
  target.mergedLeadIds = [...mergedIds.values()];
  target.score = applyScore({}, target.toObject() as unknown as Record<string, unknown>);
  await target.save();

  const fromId = source._id as mongoose.Types.ObjectId;
  const toId = target._id as mongoose.Types.ObjectId;

  // The merged lead's own reminder would duplicate the kept lead's.
  await CrmActivity.updateMany(
    {
      taskflowOrganizationId: orgOid,
      relatedType: 'lead',
      relatedId: fromId,
      type: 'follow_up',
      completedAt: { $exists: false },
      subject: { $regex: `^${AUTO_FOLLOW_PREFIX}` },
    },
    { $set: { completedAt: new Date() } }
  );
  await Promise.all([
    CrmActivity.updateMany({ taskflowOrganizationId: orgOid, relatedType: 'lead', relatedId: fromId }, { $set: { relatedId: toId } }),
    CrmQuote.updateMany({ taskflowOrganizationId: orgOid, leadId: fromId }, { $set: { leadId: toId } }),
    CrmDeal.updateMany({ taskflowOrganizationId: orgOid, leadId: fromId }, { $set: { leadId: toId } }),
    DocumentRecord.updateMany({ taskflowOrganizationId: orgOid, entityType: 'lead', entityId: fromId }, { $set: { entityId: toId } }),
    MailMessage.updateMany(
      { taskflowOrganizationId: orgOid, links: { $elemMatch: { type: 'lead', id: fromId } } },
      { $set: { 'links.$[l].id': toId } },
      { arrayFilters: [{ 'l.type': 'lead', 'l.id': fromId }] }
    ),
  ]);
  await moveRecordLinks(orgOid, fromId, toId);

  await CrmLead.deleteOne({ _id: fromId });

  await logLeadActivity(
    orgId,
    toId,
    userId,
    `Merged lead "${source.title}"`,
    filled.length ? `Filled from the merged lead: ${filled.join(', ')}` : undefined
  );
  logAudit({
    userId,
    action: 'crm.lead.merge',
    resourceType: 'crm_lead',
    resourceId: String(toId),
    meta: { mergedLeadId: String(fromId), mergedTitle: source.title, filled },
  });
  await syncLeadFollowUp(orgId, target, userId);
  await upsertPeopleFromLead(orgId, target);
  return getLead(String(toId), orgId);
}

/** Re-point explicit graph edges; an edge the kept lead already has is dropped, not doubled. */
async function moveRecordLinks(
  orgOid: mongoose.Types.ObjectId,
  fromId: mongoose.Types.ObjectId,
  toId: mongoose.Types.ObjectId
) {
  const links = await RecordLink.find({
    taskflowOrganizationId: orgOid,
    $or: [
      { fromType: 'lead', fromId },
      { toType: 'lead', toId: fromId },
    ],
  });
  for (const link of links) {
    if (link.fromType === 'lead' && String(link.fromId) === String(fromId)) link.fromId = toId;
    if (link.toType === 'lead' && String(link.toId) === String(fromId)) link.toId = toId;
    const selfLoop = link.fromType === link.toType && String(link.fromId) === String(link.toId);
    try {
      if (selfLoop) await link.deleteOne();
      else await link.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) await link.deleteOne();
      else throw err;
    }
  }
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
