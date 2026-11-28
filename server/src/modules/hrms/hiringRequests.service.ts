/**
 * Hiring requests, the hiring plan, and resource demand to recruitment (AUT-41).
 *
 * A department head raises a hiring request (role, headcount, pay budget, why). It is approved through
 * the "Hiring requests" chain in Approvals when one is on; otherwise by someone with the hiring request
 * approve permission, other than whoever raised it. Recruiters then open a job from the approved request.
 * An unfilled resource demand can open a job directly, or raise a hiring request for approval first.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { notifyUsers } from '../notifications/domainNotify';
import { logAudit } from '../auditLogs/logAudit';
import { isApprovalChainEnabled, submitForApproval, cancelForRecord } from '../approvals/approvals.service';
import { HrmsHiringRequest, type HiringRequestStatus } from './models/hrmsHiringRequest.model';
import { HrmsJobOpening } from './models/hrmsPeople.model';
import { ResourceDemand } from '../resources/models/resourceDemand.model';
import { getHrSettings } from './policy.service';

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;
type Oid = mongoose.Types.ObjectId;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
const isId = (v: unknown) => v != null && v !== '' && mongoose.isValidObjectId(String(v));
const has = (perms: string[], ...p: string[]) => p.some((x) => userHasPermission(perms, x));
const EDITABLE: HiringRequestStatus[] = ['draft', 'rejected'];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
const OPEN_DEMAND = ['open', 'partially_filled'];

export type HiringActor = { id: string; permissions: string[] };

/** Approvers and recruiters see every request; anyone else sees the ones they raised. */
const seesAll = (a: HiringActor) => has(a.permissions, H.HIRING_REQUEST.APPROVE, H.RECRUITMENT.READ, H.RECRUITMENT.MANAGE);

async function requestIn(orgId: string, id: string, actor?: HiringActor) {
  if (!isId(id)) throw new ApiError(404, 'Hiring request not found');
  const doc = await HrmsHiringRequest.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!doc || (actor && !seesAll(actor) && String(doc.requestedBy) !== actor.id)) throw new ApiError(404, 'Hiring request not found');
  return doc;
}

function money(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${label} must be zero or more`);
  return n;
}

function parse(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ['title', 'department', 'location', 'level'] as const) {
    if (typeof input[k] === 'string') out[k] = (input[k] as string).trim().slice(0, 120);
  }
  if (typeof input.justification === 'string') out.justification = input.justification.slice(0, 10_000);
  if (input.employmentType !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(String(input.employmentType))) throw new ApiError(400, 'Employment type must be full_time, part_time, contract or intern');
    out.employmentType = String(input.employmentType);
  }
  if (input.headcount !== undefined) {
    const n = Number(input.headcount);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new ApiError(400, 'Headcount must be a whole number from 1 to 500');
    out.headcount = n;
  }
  for (const [k, label] of [['budgetMin', 'Minimum budget'], ['budgetMax', 'Maximum budget']] as const) {
    if (input[k] !== undefined) out[k] = money(input[k], label) ?? null;
  }
  if (typeof input.currency === 'string' && input.currency.trim()) out.currency = input.currency.trim().toUpperCase().slice(0, 3);
  if (input.targetStartDate !== undefined) {
    if (input.targetStartDate === null || input.targetStartDate === '') out.targetStartDate = null;
    else {
      const d = new Date(String(input.targetStartDate));
      if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Target start date is not a valid date');
      out.targetStartDate = d;
    }
  }
  return out;
}

function assertBudget(doc: { budgetMin?: number | null; budgetMax?: number | null }) {
  if (doc.budgetMin != null && doc.budgetMax != null && doc.budgetMin > doc.budgetMax) throw new ApiError(400, 'Minimum budget cannot be above the maximum');
}

const populate = <T extends { populate: (path: string, select: string) => T }>(q: T) =>
  q.populate('requestedBy', 'name email').populate('decidedBy', 'name').populate('jobId', 'title status openings filled').populate('demandId', 'title status').populate('projectId', 'name key');

// ── Requests ──────────────────────────────────────────────────────────────

export async function listHiringRequests(ws: string | null | undefined, query: { status?: string; department?: string; mine?: boolean }, actor: HiringActor) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.status) filter.status = query.status;
  if (query.department) filter.department = query.department;
  if (query.mine || !seesAll(actor)) filter.requestedBy = oid(actor.id);
  return populate(HrmsHiringRequest.find(filter)).sort({ updatedAt: -1 }).limit(500).lean();
}

export async function getHiringRequest(ws: string | null | undefined, id: string, actor: HiringActor) {
  const orgId = requireWorkspaceId(ws);
  const doc = await requestIn(orgId, id, actor);
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

/**
 * Raise a request. With `demandId`, the role, project and dates are taken from that unfilled resource
 * demand unless given.
 */
export async function createHiringRequest(ws: string | null | undefined, input: Record<string, unknown>, actor: HiringActor) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const data = parse(input);
  const extra: Record<string, unknown> = {};
  if (input.demandId !== undefined && input.demandId !== '' && input.demandId !== null) {
    const demand = await demandIn(orgOid, input.demandId);
    extra.demandId = demand._id;
    if (demand.projectId) extra.projectId = demand.projectId;
    data.title ??= demand.roleLabel || demand.title;
    data.targetStartDate ??= demand.periodStart;
    data.justification ??= demandSummary(demand);
  }
  if (!data.title) throw new ApiError(400, 'Say which role you want to hire for');
  assertBudget(data as { budgetMin?: number; budgetMax?: number });
  const doc = await HrmsHiringRequest.create({ ...data, ...extra, taskflowOrganizationId: orgOid, requestedBy: oid(actor.id), status: 'draft' });
  logAudit({ userId: actor.id, action: 'hr.hiring_request.create', resourceType: 'hiring_request', resourceId: String(doc._id), meta: { demandId: extra.demandId ? String(extra.demandId) : undefined } });
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

/** Change a draft, or a rejected request before sending it again. Only whoever raised it. */
export async function updateHiringRequest(ws: string | null | undefined, id: string, input: Record<string, unknown>, actor: HiringActor) {
  const orgId = requireWorkspaceId(ws);
  const doc = await requestIn(orgId, id, actor);
  if (String(doc.requestedBy) !== actor.id) throw new ApiError(403, 'Only the person who raised this request can change it');
  if (!EDITABLE.includes(doc.status as HiringRequestStatus)) throw new ApiError(409, `A request that is ${doc.status.replace('_', ' ')} cannot be changed`);
  const data = parse(input);
  if ('title' in data && !data.title) throw new ApiError(400, 'Say which role you want to hire for');
  doc.set(data);
  assertBudget(doc);
  await doc.save();
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

/** Send for approval: through the "Hiring requests" chain when it is on, else to anyone who may approve. */
export async function submitHiringRequest(ws: string | null | undefined, id: string, actor: HiringActor) {
  const orgId = requireWorkspaceId(ws);
  const doc = await requestIn(orgId, id, actor);
  if (String(doc.requestedBy) !== actor.id) throw new ApiError(403, 'Only the person who raised this request can send it');
  if (!EDITABLE.includes(doc.status as HiringRequestStatus)) throw new ApiError(409, doc.status === 'pending_approval' ? 'This request is already waiting for approval' : `This request is ${doc.status}`);
  if (doc.budgetMax == null && doc.budgetMin == null) throw new ApiError(400, 'Add the pay budget before sending the request');
  if (!String(doc.justification ?? '').trim()) throw new ApiError(400, 'Say why this hire is needed before sending the request');
  const sent = await HrmsHiringRequest.updateOne(
    { _id: doc._id, status: { $in: EDITABLE } },
    { $set: { status: 'pending_approval', submittedAt: new Date() }, $unset: { decisionNote: 1, decidedBy: 1, decidedAt: 1 } }
  );
  if (!sent.modifiedCount) throw new ApiError(409, 'This request is already waiting for approval');
  if (await isApprovalChainEnabled(orgId, 'hiring_request')) {
    try {
      await submitForApproval(orgId, 'hiring_request', String(doc._id), actor.id);
    } catch (err) {
      await HrmsHiringRequest.updateOne({ _id: doc._id }, { $set: { status: doc.status } });
      throw err;
    }
  } else {
    const { usersWithPermission } = await import('../auth/usersWithPermission');
    const approvers = (await usersWithPermission(H.HIRING_REQUEST.APPROVE, orgId)).filter((u) => u !== actor.id);
    void notifyUsers(approvers, 'approval_requested', { title: `Hiring request to approve: ${doc.title}`, body: `${doc.headcount} × ${doc.department ?? 'position'}`, link: '/hrms/hiring-requests' }, actor.id);
  }
  logAudit({ userId: actor.id, action: 'hr.hiring_request.submit', resourceType: 'hiring_request', resourceId: id });
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

/** Approve or reject when no hiring request chain is on. Needs the approve permission; never your own request. */
export async function decideHiringRequest(ws: string | null | undefined, id: string, decision: 'approve' | 'reject', actor: HiringActor, note?: unknown) {
  const orgId = requireWorkspaceId(ws);
  const doc = await requestIn(orgId, id);
  if (await isApprovalChainEnabled(orgId, 'hiring_request')) throw new ApiError(409, 'Hiring requests are approved through the approval chain: decide it in Approvals');
  if (!has(actor.permissions, H.HIRING_REQUEST.APPROVE)) throw new ApiError(403, 'Approving hiring requests needs the hiring request approve permission');
  if (String(doc.requestedBy) === actor.id) throw new ApiError(403, 'You cannot approve a hiring request you raised');
  if (doc.status !== 'pending_approval') throw new ApiError(409, 'This request is not waiting for approval');
  const text = String(note ?? '').trim();
  if (decision === 'reject' && !text) throw new ApiError(400, 'Say why the request is rejected');
  await applyHiringRequestDecision(orgId, String(doc._id), decision === 'approve' ? 'approved' : 'rejected', actor.id, text);
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

/** Shared by the manual decision and the approval engine's adapter. Only the first decision counts. */
export async function applyHiringRequestDecision(orgId: string, id: string, outcome: 'approved' | 'rejected', actorId: string, note?: string) {
  const text = note ? String(note).slice(0, 2000) : undefined;
  const done = await HrmsHiringRequest.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId), status: 'pending_approval' },
    { $set: { status: outcome, decidedBy: oid(actorId), decidedAt: new Date(), ...(text ? { decisionNote: text } : {}) } },
    { new: true }
  ).lean();
  if (!done) return;
  logAudit({ userId: actorId, action: outcome === 'approved' ? 'hr.hiring_request.approve' : 'hr.hiring_request.reject', resourceType: 'hiring_request', resourceId: id });
  void notifyUsers([done.requestedBy], 'approval_decided', { title: `Hiring request ${outcome}: ${done.title}`, body: text ?? '', link: '/hrms/hiring-requests' }, actorId);
  if (outcome === 'approved') {
    const { usersWithPermission } = await import('../auth/usersWithPermission');
    const recruiters = await usersWithPermission(H.RECRUITMENT.MANAGE, orgId);
    void notifyUsers(recruiters, 'approval_decided', { title: `Approved hiring request: ${done.title}`, body: 'Open a job for it in Recruitment.', link: '/hrms/hiring-requests' }, actorId);
  }
}

/** Withdraw a request that has no job yet. Whoever raised it, or a recruiter. */
export async function cancelHiringRequest(ws: string | null | undefined, id: string, actor: HiringActor) {
  const orgId = requireWorkspaceId(ws);
  const doc = await requestIn(orgId, id, actor);
  if (String(doc.requestedBy) !== actor.id && !has(actor.permissions, H.RECRUITMENT.MANAGE)) throw new ApiError(403, 'Only the person who raised this request, or a recruiter, can cancel it');
  const done = await HrmsHiringRequest.updateOne(
    { _id: doc._id, status: { $in: ['draft', 'pending_approval', 'approved', 'rejected'] } },
    { $set: { status: 'cancelled' } }
  );
  if (!done.modifiedCount) throw new ApiError(409, doc.status === 'opened' ? 'A job was already opened for this request; close the job instead' : 'This request is already cancelled');
  await cancelForRecord(orgId, 'hiring_request', id, actor.id, 'Hiring request cancelled').catch(() => undefined);
  logAudit({ userId: actor.id, action: 'hr.hiring_request.cancel', resourceType: 'hiring_request', resourceId: id });
  return populate(HrmsHiringRequest.findById(doc._id)).lean();
}

// ── Opening jobs ──────────────────────────────────────────────────────────

async function newJob(orgOid: Oid, data: Record<string, unknown>) {
  const stages = (await getHrSettings(String(orgOid))).recruitmentStages;
  return HrmsJobOpening.create({ status: 'open', ...data, stages, taskflowOrganizationId: orgOid });
}

/** Open a job in Recruitment from an approved request: headcount becomes openings, the budget the salary band. */
export async function openJobFromRequest(ws: string | null | undefined, id: string, actor: HiringActor, input: Record<string, unknown> = {}) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const doc = await requestIn(orgId, id);
  if (doc.status === 'opened') throw new ApiError(409, 'A job was already opened for this request');
  if (doc.status !== 'approved') throw new ApiError(409, 'Only an approved request can open a job');
  // Claim it first, so pressing twice opens one job.
  const claimed = await HrmsHiringRequest.updateOne({ _id: doc._id, status: 'approved' }, { $set: { status: 'opened' } });
  if (!claimed.modifiedCount) throw new ApiError(409, 'A job was already opened for this request');
  try {
    const job = await newJob(orgOid, {
      title: doc.title,
      department: doc.department,
      location: doc.location,
      employmentType: doc.employmentType,
      openings: doc.headcount,
      salaryMin: doc.budgetMin ?? undefined,
      salaryMax: doc.budgetMax ?? undefined,
      currency: doc.currency,
      description: doc.justification,
      hiringManagerId: isId(input.hiringManagerId) ? oid(input.hiringManagerId) : doc.requestedBy,
      hiringRequestId: doc._id,
      demandId: doc.demandId ?? undefined,
    });
    await HrmsHiringRequest.updateOne({ _id: doc._id }, { $set: { jobId: job._id } });
    if (doc.demandId) await ResourceDemand.updateOne({ _id: doc.demandId, jobId: null }, { $set: { jobId: job._id } });
    logAudit({ userId: actor.id, action: 'hr.hiring_request.open_job', resourceType: 'hiring_request', resourceId: id, meta: { jobId: String(job._id) } });
    void notifyUsers([doc.requestedBy], 'approval_decided', { title: `Job opened: ${doc.title}`, body: `${doc.headcount} opening(s) in Recruitment`, link: '/hrms/recruitment' }, actor.id);
    return job.toObject();
  } catch (err) {
    await HrmsHiringRequest.updateOne({ _id: doc._id, status: 'opened' }, { $set: { status: 'approved' } });
    throw err;
  }
}

type DemandLike = { _id: Oid; title: string; roleLabel?: string | null; projectId?: Oid | null; periodStart: Date; periodEnd: Date; hoursNeeded: number; skills?: string[]; notes?: string | null; status: string; jobId?: Oid | null };

async function demandIn(orgOid: Oid, id: unknown): Promise<DemandLike> {
  if (!isId(id)) throw new ApiError(404, 'Resource demand not found');
  const d = (await ResourceDemand.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean()) as DemandLike | null;
  if (!d) throw new ApiError(404, 'Resource demand not found');
  if (!OPEN_DEMAND.includes(d.status)) throw new ApiError(409, `This demand is ${d.status.replace('_', ' ')}`);
  return d;
}

function demandSummary(d: DemandLike) {
  const day = (x: Date) => new Date(x).toISOString().slice(0, 10);
  return [
    `Unfilled resource demand: ${d.title}`,
    `${d.hoursNeeded} hours needed between ${day(d.periodStart)} and ${day(d.periodEnd)}.`,
    d.skills?.length ? `Skills: ${d.skills.join(', ')}.` : '',
    d.notes ?? '',
  ].filter(Boolean).join('\n');
}

/**
 * Open a job in Recruitment for an unfilled resource demand. One job per demand; pressing twice, or
 * two people at once, opens one.
 */
export async function openJobFromDemand(ws: string | null | undefined, demandId: string, actor: HiringActor, input: Record<string, unknown> = {}) {
  const orgId = requireWorkspaceId(ws);
  const orgOid = toOrgOid(orgId);
  const d = await demandIn(orgOid, demandId);
  if (d.jobId && (await HrmsJobOpening.exists({ _id: d.jobId }))) throw new ApiError(409, 'A job is already open for this demand');
  const data = parse(input);
  const openings = data.headcount ?? 1;
  const job = await newJob(orgOid, {
    title: data.title || d.roleLabel || d.title,
    department: data.department,
    location: data.location,
    employmentType: data.employmentType ?? 'full_time',
    openings,
    salaryMin: data.budgetMin ?? undefined,
    salaryMax: data.budgetMax ?? undefined,
    currency: data.currency,
    description: demandSummary(d),
    hiringManagerId: isId(input.hiringManagerId) ? oid(input.hiringManagerId) : oid(actor.id),
    demandId: d._id,
  });
  // Only if nobody linked another job meanwhile (null also matches a demand from before this field).
  const linked = await ResourceDemand.updateOne({ _id: d._id, jobId: d.jobId ?? null }, { $set: { jobId: job._id } });
  if (!linked.modifiedCount) {
    await HrmsJobOpening.deleteOne({ _id: job._id });
    throw new ApiError(409, 'A job is already open for this demand');
  }
  logAudit({ userId: actor.id, action: 'resources.demand.open_job', resourceType: 'resource_demand', resourceId: demandId, meta: { jobId: String(job._id) } });
  return job.toObject();
}

// ── Hiring plan ───────────────────────────────────────────────────────────

type PlanRow = { department: string; currency: string; requested: number; approved: number; opened: number; hired: number; requestedBudget: number; approvedBudget: number };

/**
 * Headcount and annual pay budget by department: waiting for approval, approved (including opened),
 * opened as jobs, and hired into those jobs. Budget = headcount × the top of the band (or the bottom).
 */
export async function hiringPlan(ws: string | null | undefined, query: { from?: string; to?: string } = {}) {
  const orgOid = toOrgOid(requireWorkspaceId(ws));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid, status: { $in: ['pending_approval', 'approved', 'opened'] } };
  const range: Record<string, Date> = {};
  for (const [k, op] of [['from', '$gte'], ['to', '$lte']] as const) {
    if (!query[k]) continue;
    const d = new Date(query[k]!);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `${k} is not a valid date`);
    range[op] = d;
  }
  if (Object.keys(range).length) filter.targetStartDate = range;
  const rows = await HrmsHiringRequest.find(filter).select('department currency headcount budgetMin budgetMax status jobId').lean();
  const jobs = await HrmsJobOpening.find({ _id: { $in: rows.map((r) => r.jobId).filter(Boolean) } }).select('filled').lean();
  const filled = new Map(jobs.map((j) => [String(j._id), j.filled ?? 0]));
  const byKey = new Map<string, PlanRow>();
  for (const r of rows) {
    const department = r.department || 'No department';
    const currency = r.currency || 'USD';
    const key = `${department}\u0000${currency}`;
    const row = byKey.get(key) ?? { department, currency, requested: 0, approved: 0, opened: 0, hired: 0, requestedBudget: 0, approvedBudget: 0 };
    const budget = r.headcount * (r.budgetMax ?? r.budgetMin ?? 0);
    if (r.status === 'pending_approval') {
      row.requested += r.headcount;
      row.requestedBudget += budget;
    } else {
      row.approved += r.headcount;
      row.approvedBudget += budget;
      if (r.status === 'opened') {
        row.opened += r.headcount;
        row.hired += Math.min(r.headcount, r.jobId ? (filled.get(String(r.jobId)) ?? 0) : 0);
      }
    }
    byKey.set(key, row);
  }
  const departments = [...byKey.values()].sort((a, b) => a.department.localeCompare(b.department) || a.currency.localeCompare(b.currency));
  const totals = new Map<string, Omit<PlanRow, 'department'>>();
  for (const r of departments) {
    const t = totals.get(r.currency) ?? { currency: r.currency, requested: 0, approved: 0, opened: 0, hired: 0, requestedBudget: 0, approvedBudget: 0 };
    for (const k of ['requested', 'approved', 'opened', 'hired', 'requestedBudget', 'approvedBudget'] as const) t[k] += r[k];
    totals.set(r.currency, t);
  }
  return { departments, totals: [...totals.values()] };
}
