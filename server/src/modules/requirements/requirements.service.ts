/**
 * Requirements, customer sign-off and change requests (AUT-44). See requirement.models.ts for the flow.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { notifyUsers } from '../notifications/domainNotify';
import { logAudit } from '../auditLogs/logAudit';
import {
  APPROVAL_ORDER,
  ChangeRequest,
  Requirement,
  RequirementSettings,
  type ApprovalRole,
  type ChangeRequestStatus,
  type RequirementStatus,
} from './requirement.models';

type Oid = mongoose.Types.ObjectId;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
const isId = (v: unknown) => v != null && v !== '' && mongoose.isValidObjectId(String(v));
const text = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const ROLE_LABEL: Record<ApprovalRole, string> = { ba_lead: 'BA lead', pm: 'project manager', customer: 'customer' };

export type CustomerActor = { id: string; orgId: string; name: string; email: string };

// ── Settings and numbering ────────────────────────────────────────────────

async function settingsFor(projectId: string) {
  return RequirementSettings.findOneAndUpdate({ project: oid(projectId) }, { $setOnInsert: { project: oid(projectId) } }, { upsert: true, new: true }).lean();
}

async function nextKey(projectId: string, kind: 'requirement' | 'change'): Promise<string> {
  const field = kind === 'requirement' ? 'lastRequirementNumber' : 'lastChangeRequestNumber';
  const s = await RequirementSettings.findOneAndUpdate({ project: oid(projectId) }, { $inc: { [field]: 1 } }, { upsert: true, new: true }).lean();
  return `${kind === 'requirement' ? 'REQ' : 'CR'}-${s![field]}`;
}

export async function getSettings(projectId: string) {
  const [s, project] = await Promise.all([
    RequirementSettings.findOne({ project: oid(projectId) }).populate('baLeadUserId', 'name email').lean(),
    Project.findById(projectId).select('lead').populate('lead', 'name email').lean(),
  ]);
  return { baLeadUserId: s?.baLeadUserId ?? null, projectManager: (project as { lead?: unknown } | null)?.lead ?? null };
}

/** Choose the project's BA lead: a member of the project. */
export async function updateSettings(projectId: string, input: { baLeadUserId?: unknown }) {
  const $set: Record<string, unknown> = {};
  if ('baLeadUserId' in input) {
    if (!input.baLeadUserId) $set.baLeadUserId = null;
    else {
      if (!isId(input.baLeadUserId) || !(await ProjectMember.exists({ project: oid(projectId), user: oid(input.baLeadUserId) }))) {
        throw new ApiError(400, 'Choose a BA lead who is a member of this project');
      }
      $set.baLeadUserId = oid(input.baLeadUserId);
    }
  }
  await RequirementSettings.updateOne({ project: oid(projectId) }, { $set, $setOnInsert: { project: oid(projectId) } }, { upsert: true });
  return getSettings(projectId);
}

// ── Requirements ──────────────────────────────────────────────────────────

const populateRequirement = <T extends { populate: (path: string, select: string) => T }>(q: T) =>
  q.populate('createdBy', 'name').populate('versions.createdBy', 'name').populate('versions.sentBy', 'name').populate('versions.changeRequestId', 'key title status');

async function requirementIn(projectId: string, id: string) {
  if (!isId(id)) throw new ApiError(404, 'Requirement not found');
  const r = await Requirement.findOne({ _id: id, project: oid(projectId) });
  if (!r) throw new ApiError(404, 'Requirement not found');
  return r;
}

const latest = <V extends { version: number }>(r: { versions: V[] }): V | undefined => r.versions[r.versions.length - 1];

function statusOf(v: { sentAt?: Date | null; signOff?: { decision: string } | null } | undefined): RequirementStatus {
  if (!v?.sentAt) return 'draft';
  if (!v.signOff) return 'awaiting_signoff';
  return v.signOff.decision === 'signed' ? 'signed_off' : 'rejected';
}

export async function listRequirements(projectId: string, query: { status?: string } = {}) {
  const filter: Record<string, unknown> = { project: oid(projectId) };
  if (query.status) filter.status = query.status;
  return populateRequirement(Requirement.find(filter)).sort({ updatedAt: -1 }).lean();
}

export async function getRequirement(projectId: string, id: string) {
  const r = await requirementIn(projectId, id);
  return populateRequirement(Requirement.findById(r._id)).lean();
}

export async function createRequirement(projectId: string, input: Record<string, unknown>, actorId: string) {
  const title = text(input.title, 300).trim();
  if (!title) throw new ApiError(400, 'Title is required');
  const key = await nextKey(projectId, 'requirement');
  const r = await Requirement.create({
    project: oid(projectId),
    key,
    title,
    status: 'draft',
    versions: [{ version: 1, content: text(input.content, 100_000), summary: text(input.summary, 2000) || 'First version', createdBy: oid(actorId) }],
    createdBy: oid(actorId),
  });
  logAudit({ userId: actorId, action: 'requirement.create', resourceType: 'requirement', resourceId: String(r._id), meta: { projectId, key } });
  return getRequirement(projectId, String(r._id));
}

/** Change the title, or the content of the latest version while it is still a draft. */
export async function updateRequirement(projectId: string, id: string, input: Record<string, unknown>) {
  const r = await requirementIn(projectId, id);
  if (input.title !== undefined) {
    const title = text(input.title, 300).trim();
    if (!title) throw new ApiError(400, 'Title is required');
    r.title = title;
  }
  if (input.content !== undefined || input.summary !== undefined) {
    const v = latest(r)!;
    if (v.sentAt) throw new ApiError(409, `Version ${v.version} was sent for sign-off and cannot be changed. Start a new version.`);
    if (input.content !== undefined) v.content = text(input.content, 100_000);
    if (input.summary !== undefined) v.summary = text(input.summary, 2000);
  }
  await r.save();
  return getRequirement(projectId, id);
}

/**
 * Start the next version from the latest one. After a signed-off version, an approved change request for
 * this requirement is needed, and each change request can be used once.
 */
export async function newVersion(projectId: string, id: string, input: Record<string, unknown>, actorId: string) {
  const r = await requirementIn(projectId, id);
  const last = latest(r)!;
  if (!last.sentAt) throw new ApiError(409, `Version ${last.version} is still a draft: change it instead of starting another`);
  if (last.sentAt && !last.signOff) throw new ApiError(409, `Version ${last.version} is waiting for the customer's sign-off`);
  const everSigned = r.versions.some((v) => v.signOff?.decision === 'signed');
  let changeRequestId: Oid | undefined;
  if (input.changeRequestId) {
    if (!isId(input.changeRequestId)) throw new ApiError(400, 'Change request not found');
    changeRequestId = oid(input.changeRequestId);
  }
  if (everSigned && !changeRequestId) throw new ApiError(400, 'This requirement was signed off: a new version needs an approved change request');
  if (changeRequestId) {
    const cr = await ChangeRequest.findOne({ _id: changeRequestId, project: oid(projectId) }).lean();
    if (!cr) throw new ApiError(400, 'Change request not found');
    if (cr.status !== 'approved') throw new ApiError(400, `${cr.key} is not approved yet`);
    if (cr.requirementId && String(cr.requirementId) !== String(r._id)) throw new ApiError(400, `${cr.key} is for another requirement`);
    if (await Requirement.exists({ 'versions.changeRequestId': changeRequestId })) throw new ApiError(409, `${cr.key} was already used for a version`);
  }
  const next = last.version + 1;
  // Only if nobody added a version meanwhile.
  const done = await Requirement.updateOne(
    { _id: r._id, 'versions.version': { $ne: next } },
    {
      $push: { versions: { version: next, content: input.content !== undefined ? text(input.content, 100_000) : last.content, summary: text(input.summary, 2000), changeRequestId, createdBy: oid(actorId), createdAt: new Date() } },
      $set: { status: 'draft' },
    }
  );
  if (!done.modifiedCount) throw new ApiError(409, 'Someone else just started a new version');
  logAudit({ userId: actorId, action: 'requirement.new_version', resourceType: 'requirement', resourceId: id, meta: { version: next, changeRequestId: changeRequestId ? String(changeRequestId) : undefined } });
  return getRequirement(projectId, id);
}

/** Send the latest draft version to the customer for sign-off. The project must be shared with a customer. */
export async function sendForSignOff(projectId: string, id: string, actorId: string) {
  const r = await requirementIn(projectId, id);
  const v = latest(r)!;
  if (v.sentAt) throw new ApiError(409, `Version ${v.version} was already sent`);
  if (!String(v.content ?? '').trim()) throw new ApiError(400, 'Write the requirement before sending it for sign-off');
  if (!(await CustomerProjectMapping.exists({ projectId: oid(projectId), status: 'active' }))) {
    throw new ApiError(400, 'This project is not shared with a customer in the portal yet, so nobody can sign it off');
  }
  const done = await Requirement.updateOne(
    { _id: r._id, versions: { $elemMatch: { version: v.version, sentAt: null } } },
    { $set: { 'versions.$.sentAt': new Date(), 'versions.$.sentBy': oid(actorId), status: 'awaiting_signoff' } }
  );
  if (!done.modifiedCount) throw new ApiError(409, `Version ${v.version} was already sent`);
  logAudit({ userId: actorId, action: 'requirement.send', resourceType: 'requirement', resourceId: id, meta: { version: v.version } });
  return getRequirement(projectId, id);
}

// ── Change requests ───────────────────────────────────────────────────────

const populateChange = <T extends { populate: (path: string, select: string) => T }>(q: T) =>
  q.populate('createdBy', 'name').populate('steps.userId', 'name').populate('requirementId', 'key title').populate('linkedIssueIds', 'key title status type');

async function changeIn(projectId: string, id: string) {
  if (!isId(id)) throw new ApiError(404, 'Change request not found');
  const cr = await ChangeRequest.findOne({ _id: id, project: oid(projectId) });
  if (!cr) throw new ApiError(404, 'Change request not found');
  return cr;
}

function parseChange(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined) {
    out.title = text(input.title, 300).trim();
    if (!out.title) throw new ApiError(400, 'Title is required');
  }
  if (input.description !== undefined) out.description = text(input.description, 20_000);
  if (input.costImpact !== undefined) {
    const n = Number(input.costImpact);
    if (!Number.isFinite(n)) throw new ApiError(400, 'Cost impact must be a number');
    out.costImpact = Math.round(n * 100) / 100;
  }
  if (typeof input.currency === 'string' && input.currency.trim()) out.currency = input.currency.trim().toUpperCase().slice(0, 3);
  if (input.scheduleImpactDays !== undefined) {
    const n = Number(input.scheduleImpactDays);
    if (!Number.isInteger(n) || Math.abs(n) > 3650) throw new ApiError(400, 'Date impact must be a whole number of days');
    out.scheduleImpactDays = n;
  }
  return out;
}

export async function listChangeRequests(projectId: string, query: { status?: string; requirementId?: string } = {}) {
  const filter: Record<string, unknown> = { project: oid(projectId) };
  if (query.status) filter.status = query.status;
  if (query.requirementId && isId(query.requirementId)) filter.requirementId = oid(query.requirementId);
  return populateChange(ChangeRequest.find(filter)).sort({ updatedAt: -1 }).lean();
}

export async function getChangeRequest(projectId: string, id: string) {
  const cr = await changeIn(projectId, id);
  return populateChange(ChangeRequest.findById(cr._id)).lean();
}

export async function createChangeRequest(projectId: string, input: Record<string, unknown>, actorId: string) {
  const data = parseChange({ ...input, title: input.title ?? '' });
  if (input.requirementId) {
    if (!isId(input.requirementId) || !(await Requirement.exists({ _id: input.requirementId, project: oid(projectId) }))) throw new ApiError(400, 'Requirement not found in this project');
    data.requirementId = oid(input.requirementId);
  }
  const key = await nextKey(projectId, 'change');
  const cr = await ChangeRequest.create({ ...data, project: oid(projectId), key, createdBy: oid(actorId), status: 'draft' });
  logAudit({ userId: actorId, action: 'change_request.create', resourceType: 'change_request', resourceId: String(cr._id), meta: { projectId, key } });
  return getChangeRequest(projectId, String(cr._id));
}

/** Change a draft, or a rejected request before sending it again. */
export async function updateChangeRequest(projectId: string, id: string, input: Record<string, unknown>) {
  const cr = await changeIn(projectId, id);
  if (cr.status !== 'draft' && cr.status !== 'rejected') throw new ApiError(409, `A change request that is ${cr.status} cannot be changed`);
  cr.set(parseChange(input));
  if (input.requirementId !== undefined) {
    if (!input.requirementId) cr.requirementId = undefined;
    else if (!isId(input.requirementId) || !(await Requirement.exists({ _id: input.requirementId, project: oid(projectId) }))) throw new ApiError(400, 'Requirement not found in this project');
    else cr.requirementId = oid(input.requirementId);
  }
  await cr.save();
  return getChangeRequest(projectId, id);
}

/** Who must decide each staff step: the BA lead from settings, then the project lead. */
async function approversOf(projectId: string): Promise<Record<'ba_lead' | 'pm', string | null>> {
  const [s, project] = await Promise.all([settingsFor(projectId), Project.findById(projectId).select('lead').lean()]);
  return { ba_lead: s?.baLeadUserId ? String(s.baLeadUserId) : null, pm: (project as { lead?: unknown } | null)?.lead ? String((project as { lead?: unknown }).lead) : null };
}

/** Send for approval: BA lead first, then the PM, then the customer. All steps start again on a resend. */
export async function submitChangeRequest(projectId: string, id: string, actorId: string) {
  const cr = await changeIn(projectId, id);
  if (cr.status !== 'draft' && cr.status !== 'rejected') throw new ApiError(409, cr.status === 'pending' ? 'This change request is already waiting for approval' : `This change request is ${cr.status}`);
  if (!String(cr.description ?? '').trim()) throw new ApiError(400, 'Describe the change before sending it for approval');
  const who = await approversOf(projectId);
  if (!who.ba_lead) throw new ApiError(400, 'Choose the BA lead in requirement settings first');
  if (!who.pm) throw new ApiError(400, 'This project has no project lead to approve it');
  if (!(await CustomerProjectMapping.exists({ projectId: oid(projectId), status: 'active' }))) {
    throw new ApiError(400, 'This project is not shared with a customer in the portal yet, so the customer cannot approve it');
  }
  const steps = APPROVAL_ORDER.map((role, i) => ({ role, status: i === 0 ? 'pending' : 'waiting' }));
  const done = await ChangeRequest.updateOne({ _id: cr._id, status: { $in: ['draft', 'rejected'] } }, { $set: { status: 'pending', steps, submittedAt: new Date() }, $unset: { decidedAt: 1 } });
  if (!done.modifiedCount) throw new ApiError(409, 'This change request is already waiting for approval');
  void notifyUsers([who.ba_lead], 'approval_requested', { title: `Change request to approve: ${cr.key} ${cr.title}`, body: impactText(cr), link: `/projects/${projectId}/requirements?cr=${id}` }, actorId);
  logAudit({ userId: actorId, action: 'change_request.submit', resourceType: 'change_request', resourceId: id });
  return getChangeRequest(projectId, id);
}

function impactText(cr: { costImpact?: number | null; currency?: string | null; scheduleImpactDays?: number | null }) {
  const days = cr.scheduleImpactDays ?? 0;
  return `Cost ${cr.currency ?? ''} ${(cr.costImpact ?? 0).toLocaleString('en')} · ${days === 0 ? 'no date change' : `${days > 0 ? '+' : ''}${days} day(s)`}`;
}

/**
 * Record one step's decision. Only the step whose turn it is can be decided, and only once, even if two
 * people answer at the same moment. A rejection ends the request; the last approval approves it.
 */
async function decideStep(
  projectId: string,
  id: string,
  role: ApprovalRole,
  decision: 'approve' | 'reject',
  who: { userId?: string; customer?: CustomerActor },
  note?: unknown
) {
  const cr = await changeIn(projectId, id);
  if (cr.status !== 'pending') throw new ApiError(409, `This change request is ${cr.status}`);
  const index = APPROVAL_ORDER.indexOf(role);
  const step = cr.steps[index];
  if (step?.status !== 'pending') {
    throw new ApiError(409, step?.status === 'waiting' ? `It is not the ${ROLE_LABEL[role]}'s turn yet` : `The ${ROLE_LABEL[role]} already decided`);
  }
  const msg = text(note, 2000).trim();
  if (decision === 'reject' && !msg) throw new ApiError(400, 'Say why the change is rejected');
  const last = index === APPROVAL_ORDER.length - 1;
  const now = new Date();
  const $set: Record<string, unknown> = {
    [`steps.${index}.status`]: decision === 'approve' ? 'approved' : 'rejected',
    [`steps.${index}.at`]: now,
    [`steps.${index}.note`]: msg || undefined,
  };
  if (who.userId) $set[`steps.${index}.userId`] = oid(who.userId);
  if (who.customer) {
    $set[`steps.${index}.customer`] = { customerUserId: oid(who.customer.id), customerOrgId: oid(who.customer.orgId), name: who.customer.name, email: who.customer.email };
  }
  if (decision === 'reject') Object.assign($set, { status: 'rejected', decidedAt: now });
  else if (last) Object.assign($set, { status: 'approved', decidedAt: now });
  else $set[`steps.${index + 1}.status`] = 'pending';
  const done = await ChangeRequest.updateOne({ _id: cr._id, status: 'pending', [`steps.${index}.status`]: 'pending' }, { $set });
  if (!done.modifiedCount) throw new ApiError(409, `The ${ROLE_LABEL[role]} already decided`);

  const label = `${cr.key} ${cr.title}`;
  if (decision === 'reject') {
    void notifyUsers([cr.createdBy], 'approval_decided', { title: `Change request rejected by the ${ROLE_LABEL[role]}: ${label}`, body: msg, link: `/projects/${projectId}/requirements?cr=${id}` }, who.userId);
  } else if (last) {
    const approvers = await approversOf(projectId);
    void notifyUsers([cr.createdBy, approvers.ba_lead, approvers.pm], 'approval_decided', { title: `Change request approved: ${label}`, body: 'Link the stories that deliver it.', link: `/projects/${projectId}/requirements?cr=${id}` }, who.userId);
  } else if (APPROVAL_ORDER[index + 1] === 'pm') {
    const approvers = await approversOf(projectId);
    void notifyUsers([approvers.pm], 'approval_requested', { title: `Change request to approve: ${label}`, body: impactText(cr), link: `/projects/${projectId}/requirements?cr=${id}` }, who.userId);
  }
  logAudit({ userId: who.userId ?? cr.createdBy.toString(), action: `change_request.${decision}`, resourceType: 'change_request', resourceId: id, meta: { role, customerUserId: who.customer?.id } });
}

/** BA lead or PM decides their step. Which step is worked out from who they are. */
export async function decideAsStaff(projectId: string, id: string, decision: 'approve' | 'reject', actorId: string, note?: unknown) {
  const cr = await changeIn(projectId, id);
  const who = await approversOf(projectId);
  const pending = cr.steps.find((s) => s.status === 'pending');
  if (!pending || cr.status !== 'pending') throw new ApiError(409, `This change request is ${cr.status}`);
  if (pending.role === 'customer') throw new ApiError(409, 'This change request is waiting for the customer, who approves it in the portal');
  if (who[pending.role as 'ba_lead' | 'pm'] !== actorId) {
    throw new ApiError(403, `Only the ${ROLE_LABEL[pending.role as ApprovalRole]} can decide this step`);
  }
  await decideStep(projectId, id, pending.role as ApprovalRole, decision, { userId: actorId }, note);
  return getChangeRequest(projectId, id);
}

/** Withdraw a change request that is not approved yet. */
export async function cancelChangeRequest(projectId: string, id: string, actorId: string) {
  const cr = await changeIn(projectId, id);
  const done = await ChangeRequest.updateOne({ _id: cr._id, status: { $in: ['draft', 'pending', 'rejected'] } }, { $set: { status: 'cancelled' as ChangeRequestStatus } });
  if (!done.modifiedCount) throw new ApiError(409, cr.status === 'approved' ? 'An approved change request cannot be cancelled' : 'This change request is already cancelled');
  logAudit({ userId: actorId, action: 'change_request.cancel', resourceType: 'change_request', resourceId: id });
  return getChangeRequest(projectId, id);
}

/** Link an approved change to the story that delivers it: an existing issue of the project, or a new story. */
export async function linkIssue(projectId: string, id: string, input: { issueId?: unknown; issueKey?: unknown; title?: unknown }, actorId: string) {
  const cr = await changeIn(projectId, id);
  if (cr.status !== 'approved') throw new ApiError(409, 'Only an approved change request can be linked to stories');
  let issueId: Oid;
  if (input.issueId || input.issueKey) {
    if (input.issueId && !isId(input.issueId)) throw new ApiError(400, 'Issue not found in this project');
    const filter = input.issueId ? { _id: input.issueId } : { key: String(input.issueKey).trim().toUpperCase() };
    const issue = await Issue.findOne({ ...filter, project: oid(projectId) }).select('_id').lean();
    if (!issue) throw new ApiError(400, input.issueKey ? `${String(input.issueKey).trim().toUpperCase()} is not an issue in this project` : 'Issue not found in this project');
    issueId = issue._id as Oid;
  } else {
    const title = text(input.title, 300).trim();
    if (!title) throw new ApiError(400, 'Choose an issue, or give the new story a title');
    const { create } = await import('../issues/issues.service');
    const created = (await create({ project: projectId, title, type: 'Story', description: `Delivers change request ${cr.key}: ${cr.title}\n\n${cr.description ?? ''}`.slice(0, 20_000) }, actorId)) as { _id: unknown };
    issueId = oid(created._id);
  }
  await ChangeRequest.updateOne({ _id: cr._id }, { $addToSet: { linkedIssueIds: issueId } });
  logAudit({ userId: actorId, action: 'change_request.link_issue', resourceType: 'change_request', resourceId: id, meta: { issueId: String(issueId) } });
  return getChangeRequest(projectId, id);
}

export async function unlinkIssue(projectId: string, id: string, issueId: string) {
  const cr = await changeIn(projectId, id);
  if (!isId(issueId)) throw new ApiError(404, 'Issue not found');
  await ChangeRequest.updateOne({ _id: cr._id }, { $pull: { linkedIssueIds: oid(issueId) } });
  return getChangeRequest(projectId, id);
}

/** Change requests linked to an issue, for the issue page. */
export async function changesForIssue(issueId: string) {
  if (!isId(issueId)) return [];
  return ChangeRequest.find({ linkedIssueIds: oid(issueId) }).select('key title status costImpact currency scheduleImpactDays project').lean();
}

// ── Customer portal ───────────────────────────────────────────────────────

async function customerProjects(c: CustomerActor): Promise<Oid[]> {
  return (await CustomerProjectMapping.find({ customerOrgId: oid(c.orgId), status: 'active' }).distinct('projectId')) as Oid[];
}

/** What customers see of a requirement: sent versions only, never drafts or who wrote them. */
function customerRequirement(r: Record<string, any>) {
  const versions = (r.versions ?? [])
    .filter((v: Record<string, any>) => v.sentAt)
    .map((v: Record<string, any>) => ({ version: v.version, content: v.content, summary: v.summary, sentAt: v.sentAt, signOff: v.signOff ? { decision: v.signOff.decision, name: v.signOff.by?.name, note: v.signOff.note, at: v.signOff.at } : null }));
  const current = versions[versions.length - 1];
  return { _id: String(r._id), key: r.key, title: r.title, project: r.project, status: r.status, versions, awaitingSignOff: Boolean(current && !current.signOff) };
}

export async function customerListRequirements(c: CustomerActor) {
  const projects = await customerProjects(c);
  const rows = await Requirement.find({ project: { $in: projects }, status: { $ne: 'draft' } }).populate('project', 'name key').sort({ updatedAt: -1 }).limit(200).lean();
  return rows.map(customerRequirement).filter((r) => r.versions.length);
}

/** A customer signs off (or rejects) the version waiting for them, typing their name as a signature. */
export async function customerSignOff(c: CustomerActor, id: string, input: { decision?: unknown; name?: unknown; note?: unknown; version?: unknown }) {
  if (!isId(id)) throw new ApiError(404, 'Requirement not found');
  const r = await Requirement.findOne({ _id: id, project: { $in: await customerProjects(c) } });
  if (!r) throw new ApiError(404, 'Requirement not found');
  const v = latest(r)!;
  if (!v.sentAt) throw new ApiError(409, 'There is no version waiting for your sign-off');
  if (input.version !== undefined && Number(input.version) !== v.version) throw new ApiError(409, `Version ${input.version} is no longer the latest; please review version ${v.version}`);
  if (v.signOff) throw new ApiError(409, `Version ${v.version} was already ${v.signOff.decision === 'signed' ? 'signed off' : 'rejected'}`);
  const decision = input.decision === 'sign' ? 'signed' : input.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw new ApiError(400, 'Choose sign off or reject');
  const name = text(input.name, 200).trim();
  if (!name) throw new ApiError(400, 'Type your full name to sign');
  const note = text(input.note, 2000).trim();
  if (decision === 'rejected' && !note) throw new ApiError(400, 'Tell us what needs to change');
  const done = await Requirement.updateOne(
    { _id: r._id, versions: { $elemMatch: { version: v.version, signOff: null, sentAt: { $ne: null } } } },
    {
      $set: {
        'versions.$.signOff': { decision, by: { customerUserId: oid(c.id), customerOrgId: oid(c.orgId), name, email: c.email }, note: note || undefined, at: new Date() },
        status: statusOf({ sentAt: v.sentAt, signOff: { decision } }),
      },
    }
  );
  if (!done.modifiedCount) throw new ApiError(409, `Version ${v.version} was already answered`);
  void notifyUsers([v.sentBy, r.createdBy], 'approval_decided', { title: `${r.key} ${decision === 'signed' ? 'signed off' : 'rejected'} by ${name}`, body: note, link: `/projects/${r.project}/requirements?req=${id}` });
  logAudit({ userId: String(v.sentBy ?? r.createdBy), action: `requirement.customer_${decision}`, resourceType: 'requirement', resourceId: id, meta: { version: v.version, customerUserId: c.id } });
  return customerRequirement((await Requirement.findById(r._id).populate('project', 'name key').lean())!);
}

function customerChange(cr: Record<string, any>) {
  const customerStep = (cr.steps ?? []).find((s: Record<string, any>) => s.role === 'customer');
  return {
    _id: String(cr._id),
    key: cr.key,
    title: cr.title,
    description: cr.description,
    project: cr.project,
    requirement: cr.requirementId ?? null,
    costImpact: cr.costImpact,
    currency: cr.currency,
    scheduleImpactDays: cr.scheduleImpactDays,
    status: cr.status,
    waitingForYou: cr.status === 'pending' && customerStep?.status === 'pending',
    yourDecision: customerStep && customerStep.status !== 'waiting' && customerStep.status !== 'pending' ? { status: customerStep.status, name: customerStep.customer?.name, note: customerStep.note, at: customerStep.at } : null,
  };
}

/** Change requests the internal approvers have passed on to the customer, and their history. */
export async function customerListChanges(c: CustomerActor) {
  const projects = await customerProjects(c);
  const rows = await ChangeRequest.find({ project: { $in: projects }, steps: { $elemMatch: { role: 'customer', status: { $ne: 'waiting' } } } })
    .populate('project', 'name key')
    .populate('requirementId', 'key title')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  return rows.map(customerChange);
}

export async function customerDecideChange(c: CustomerActor, id: string, input: { decision?: unknown; note?: unknown }) {
  if (!isId(id)) throw new ApiError(404, 'Change request not found');
  const cr = await ChangeRequest.findOne({ _id: id, project: { $in: await customerProjects(c) } }).lean();
  if (!cr || !cr.steps.some((s) => s.role === 'customer' && s.status !== 'waiting')) throw new ApiError(404, 'Change request not found');
  const decision = input.decision === 'approve' ? 'approve' : input.decision === 'reject' ? 'reject' : null;
  if (!decision) throw new ApiError(400, 'Choose approve or reject');
  await decideStep(String(cr.project), id, 'customer', decision, { customer: c }, input.note);
  return customerChange((await ChangeRequest.findById(id).populate('project', 'name key').populate('requirementId', 'key title').lean())!);
}
