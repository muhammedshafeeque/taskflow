/**
 * Shared approval engine (AUT-27).
 *
 * A workspace sets an approval chain per record type: ordered steps, each naming who approves —
 * the requester's manager (n levels up), a role, named people, or a permission — and optionally
 * applying only above an amount ("lead, then head above 1,000, then CEO above 10,000").
 *
 * Rules every chain follows:
 * - Nobody approves their own request, directly or as someone's delegate.
 * - One person decides at most one step of a request; a later step they would also own is skipped.
 * - A step nobody can approve uses the policy's fallback people, or is skipped (logged); a request
 *   that would need no approval at all is refused.
 * - Approvers can delegate for a period (e.g. while on leave); the delegate decides "on behalf of".
 * - Every decision is kept in the request's history and the audit log.
 * - If the record's amount changes while it waits, the chain restarts for the new amount.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { usersWithPermission } from '../auth/usersWithPermission';
import { ruleRolesByUser } from '../auth/accessProfile';
import { User } from '../auth/user.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { logAudit } from '../auditLogs/logAudit';
import { notifyUsers } from '../notifications/domainNotify';
import {
  APPROVAL_RECORD_TYPES,
  APPROVER_KINDS,
  ApprovalDelegation,
  ApprovalPolicy,
  ApprovalRequest,
  type ApprovalRecordType,
  type IApprovalPolicy,
  type IApprovalPolicyStep,
  type IApprovalRequest,
  type IApprovalRequestStep,
} from './approval.models';
import { getApprovalAdapter, listApprovalAdapters } from './approvalRegistry';
import { usersWhoseLimitCovers } from '../crm/quotes/discountLimits';

const AP = TASK_FLOW_PERMISSIONS.TASKFLOW.APPROVALS;
const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ApprovalActor {
  userId: string;
  permissions?: string[];
}

type RequestDoc = mongoose.HydratedDocument<IApprovalRequest>;

export function assertRecordType(raw: unknown): ApprovalRecordType {
  if (typeof raw !== 'string' || !APPROVAL_RECORD_TYPES.includes(raw as ApprovalRecordType)) {
    throw new ApiError(400, `Unknown record type. Use one of: ${APPROVAL_RECORD_TYPES.join(', ')}`);
  }
  return raw as ApprovalRecordType;
}

// ── Policies ─────────────────────────────────────────────────────────────────

export async function getPolicy(orgId: string, type: ApprovalRecordType) {
  return ApprovalPolicy.findOne({ taskflowOrganizationId: toOrgOid(orgId), recordType: type }).lean();
}

/** True when this workspace runs this record type through the engine. */
export async function isApprovalChainEnabled(orgId: string, type: ApprovalRecordType): Promise<boolean> {
  const p = await getPolicy(orgId, type);
  return Boolean(p?.enabled && p.steps.length > 0);
}

export async function listPolicies(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const [policies, adapters] = await Promise.all([
    ApprovalPolicy.find({ taskflowOrganizationId: toOrgOid(orgId) }).lean(),
    listApprovalAdapters(),
  ]);
  const byType = new Map(policies.map((p) => [p.recordType, p]));
  return APPROVAL_RECORD_TYPES.map((type) => {
    const a = adapters.find((x) => x.type === type);
    const p = byType.get(type);
    return {
      recordType: type,
      label: a?.label ?? type,
      mode: a?.mode ?? 'decision',
      amountLabel: a?.amountLabel ?? 'Amount',
      enabled: Boolean(p?.enabled),
      steps: (p?.steps ?? []).map(serializePolicyStep),
      fallbackUserIds: (p?.fallbackUserIds ?? []).map(String),
      updatedAt: p?.updatedAt ?? null,
    };
  });
}

function serializePolicyStep(s: IApprovalPolicyStep) {
  return {
    name: s.name,
    kind: s.kind,
    ...(s.level != null ? { level: s.level } : {}),
    ...(s.roleId ? { roleId: String(s.roleId) } : {}),
    ...(s.userIds?.length ? { userIds: s.userIds.map(String) } : {}),
    ...(s.permission ? { permission: s.permission } : {}),
    aboveAmount: s.aboveAmount ?? null,
  };
}

function parseStep(raw: unknown, i: number): IApprovalPolicyStep {
  const s = (raw ?? {}) as Record<string, unknown>;
  const where = `Step ${i + 1}`;
  const name = String(s.name ?? '').trim();
  if (!name) throw new ApiError(400, `${where} needs a name`);
  if (!APPROVER_KINDS.includes(s.kind as never)) throw new ApiError(400, `${where}: approver must be one of ${APPROVER_KINDS.join(', ')}`);
  const kind = s.kind as IApprovalPolicyStep['kind'];
  let aboveAmount: number | null = null;
  if (s.aboveAmount !== undefined && s.aboveAmount !== null && s.aboveAmount !== '') {
    const n = Number(s.aboveAmount);
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${where}: amount must be a non-negative number`);
    aboveAmount = round2(n);
  }
  const step: IApprovalPolicyStep = { name: name.slice(0, 120), kind, aboveAmount };
  if (kind === 'manager') {
    const level = Number(s.level ?? 1);
    if (!Number.isInteger(level) || level < 1 || level > 10) throw new ApiError(400, `${where}: manager level must be 1–10`);
    step.level = level;
  } else if (kind === 'role') {
    if (!mongoose.Types.ObjectId.isValid(String(s.roleId ?? ''))) throw new ApiError(400, `${where}: choose a role`);
    step.roleId = oid(s.roleId);
  } else if (kind === 'users') {
    const ids = Array.isArray(s.userIds) ? s.userIds.map(String).filter((v) => mongoose.Types.ObjectId.isValid(v)) : [];
    if (!ids.length) throw new ApiError(400, `${where}: choose at least one person`);
    step.userIds = [...new Set(ids)].map(oid);
  } else if (kind === 'discount_limit') {
    // Approvers are worked out from the discount limits; nothing more to set.
  } else {
    const perm = String(s.permission ?? '').trim();
    if (!/^[a-z0-9_.]+$/i.test(perm)) throw new ApiError(400, `${where}: enter a permission code`);
    step.permission = perm;
  }
  return step;
}

export async function savePolicy(
  workspaceId: string | null | undefined,
  type: ApprovalRecordType,
  input: Record<string, unknown>,
  actor: ApprovalActor
) {
  const orgId = requireWorkspaceId(workspaceId);
  const $set: Record<string, unknown> = { updatedBy: oid(actor.userId) };
  if (input.steps !== undefined) {
    if (!Array.isArray(input.steps)) throw new ApiError(400, 'steps must be a list');
    if (input.steps.length > 10) throw new ApiError(400, 'A chain can have at most 10 steps');
    $set.steps = input.steps.map(parseStep);
  }
  if (input.fallbackUserIds !== undefined) {
    if (!Array.isArray(input.fallbackUserIds)) throw new ApiError(400, 'fallbackUserIds must be a list');
    $set.fallbackUserIds = [...new Set(input.fallbackUserIds.map(String).filter((v) => mongoose.Types.ObjectId.isValid(v)))].map(oid);
  }
  if (input.enabled !== undefined) $set.enabled = Boolean(input.enabled);
  const current = await getPolicy(orgId, type);
  const steps = ($set.steps as IApprovalPolicyStep[] | undefined) ?? current?.steps ?? [];
  if (($set.enabled ?? current?.enabled) && steps.length === 0) throw new ApiError(400, 'Add at least one step before turning the chain on');
  await ApprovalPolicy.updateOne(
    { taskflowOrganizationId: toOrgOid(orgId), recordType: type },
    { $set, $setOnInsert: { taskflowOrganizationId: toOrgOid(orgId), recordType: type } },
    { upsert: true }
  );
  logAudit({ userId: actor.userId, action: 'approval.policy.update', resourceType: 'approval_policy', resourceId: type, meta: { enabled: $set.enabled, steps: steps.length } });
  return (await listPolicies(orgId)).find((p) => p.recordType === type)!;
}

// ── Who can approve a step ───────────────────────────────────────────────────

async function activeMembers(orgId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const uniq = [...new Set(ids)];
  const [members, enabled] = await Promise.all([
    OrganizationMember.find({ organization: toOrgOid(orgId), user: { $in: uniq.map(oid) }, status: 'active' }).distinct('user'),
    User.find({ _id: { $in: uniq.map(oid) }, enabled: { $ne: false }, isServiceAccount: { $ne: true } }).distinct('_id'),
  ]);
  const m = new Set(members.map(String));
  const e = new Set(enabled.map(String));
  return uniq.filter((id) => m.has(id) && e.has(id));
}

async function managerUserAt(orgId: string, requesterUserId: string, level: number): Promise<string | null> {
  const orgOid = toOrgOid(orgId);
  let emp = await HrmsEmployee.findOne({ taskflowOrganizationId: orgOid, userId: oid(requesterUserId) }).select('managerId').lean();
  const seen = new Set<string>();
  for (let i = 0; i < level; i++) {
    if (!emp?.managerId || seen.has(String(emp.managerId))) return null;
    seen.add(String(emp.managerId));
    emp = await HrmsEmployee.findOne({ _id: emp.managerId, taskflowOrganizationId: orgOid }).select('managerId userId status').lean();
    if (!emp) return null;
  }
  const e = emp as { userId?: unknown; status?: string } | null;
  return e?.userId && e.status !== 'terminated' ? String(e.userId) : null;
}

async function usersWithRole(orgId: string, roleId: string): Promise<string[]> {
  const direct = await User.find({ roleId: oid(roleId) }).distinct('_id');
  const viaRules = [...(await ruleRolesByUser(orgId))].filter(([, roles]) => roles.has(roleId)).map(([u]) => u);
  return [...direct.map(String), ...viaRules];
}

/** Everyone the step names, before excluding the requester and earlier deciders. */
export async function resolveStepApprovers(
  orgId: string,
  step: Pick<IApprovalPolicyStep, 'kind' | 'level' | 'roleId' | 'userIds' | 'permission'>,
  requesterUserId: string,
  ctx: { discountPercent?: number } = {}
): Promise<string[]> {
  let ids: string[] = [];
  if (step.kind === 'manager') {
    const m = await managerUserAt(orgId, requesterUserId, step.level ?? 1);
    ids = m ? [m] : [];
  } else if (step.kind === 'role' && step.roleId) {
    ids = await usersWithRole(orgId, String(step.roleId));
  } else if (step.kind === 'users') {
    ids = (step.userIds ?? []).map(String);
  } else if (step.kind === 'permission' && step.permission) {
    ids = await usersWithPermission(step.permission, orgId);
  } else if (step.kind === 'discount_limit') {
    ids = await usersWhoseLimitCovers(orgId, ctx.discountPercent ?? 0);
  }
  return activeMembers(orgId, ids);
}

/** Active delegations that let `userId` act for others now. */
async function delegatorsFor(orgId: string, userId: string, type?: ApprovalRecordType) {
  const now = new Date();
  const rows = await ApprovalDelegation.find({
    taskflowOrganizationId: toOrgOid(orgId),
    toUserId: oid(userId),
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  }).lean();
  return rows.filter((d) => !type || d.recordTypes.length === 0 || d.recordTypes.includes(type));
}

/** Delegates currently standing in for these approvers (for notifications). */
async function delegatesOf(orgId: string, approverIds: string[], type: ApprovalRecordType): Promise<string[]> {
  if (!approverIds.length) return [];
  const now = new Date();
  const rows = await ApprovalDelegation.find({
    taskflowOrganizationId: toOrgOid(orgId),
    fromUserId: { $in: approverIds.map(oid) },
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  }).lean();
  return rows.filter((d) => d.recordTypes.length === 0 || d.recordTypes.includes(type)).map((d) => String(d.toUserId));
}

// ── Running a request ────────────────────────────────────────────────────────

function applicableSteps(policy: IApprovalPolicy, amount: number): IApprovalPolicyStep[] {
  return policy.steps.filter((s) => s.aboveAmount == null || amount > s.aboveAmount);
}

/**
 * Move to the first step from `from` that someone can decide, skipping (and logging) steps nobody can.
 * Returns false when no step is left, i.e. the chain is complete.
 */
async function activateFrom(req: RequestDoc, policy: IApprovalPolicy, from: number): Promise<boolean> {
  const orgId = String(req.taskflowOrganizationId);
  const requester = String(req.requestedBy);
  const decided = new Set(req.steps.filter((s) => s.decidedBy).flatMap((s) => [String(s.decidedBy), ...(s.onBehalfOf ? [String(s.onBehalfOf)] : [])]));
  const fallback = await activeMembers(orgId, policy.fallbackUserIds.map(String));

  for (let i = from; i < req.steps.length; i++) {
    const step = req.steps[i];
    const named = await resolveStepApprovers(orgId, step, requester, { discountPercent: req.discountPercent });
    let approvers = named.filter((u) => u !== requester && !decided.has(u));
    let note: string | undefined;
    if (!approvers.length) {
      const someoneDecidedAlready = named.some((u) => decided.has(u));
      if (someoneDecidedAlready) {
        note = 'Already approved by the same person at an earlier step';
      } else {
        approvers = fallback.filter((u) => u !== requester && !decided.has(u));
        if (!approvers.length) note = named.includes(requester) ? 'Only the requester could approve this step' : 'No approver found for this step';
      }
    }
    if (approvers.length) {
      step.status = 'pending';
      step.approverIds = approvers.map(oid);
      req.currentStep = i;
      req.currentApproverIds = step.approverIds;
      return true;
    }
    step.status = 'skipped';
    step.note = note;
    req.history.push({ at: new Date(), action: 'skipped', step: i, note });
  }
  req.currentStep = req.steps.length;
  req.currentApproverIds = [];
  return false;
}

async function notifyCurrentStep(req: RequestDoc) {
  if (req.status !== 'pending') return;
  const orgId = String(req.taskflowOrganizationId);
  const approvers = req.currentApproverIds.map(String);
  const delegates = await delegatesOf(orgId, approvers, req.recordType);
  const step = req.steps[req.currentStep];
  await notifyUsers(
    [...approvers, ...delegates],
    'approval_requested',
    { title: `Approval needed: ${req.title}`, body: `${step?.name ?? 'Approval'} · ${req.currency ?? ''} ${req.amount}`.trim(), link: '/approvals' },
    String(req.requestedBy)
  ).catch(() => undefined);
}

function buildSteps(policy: IApprovalPolicy, amount: number): IApprovalRequestStep[] {
  return applicableSteps(policy, amount).map((s) => ({
    name: s.name,
    kind: s.kind,
    level: s.level,
    roleId: s.roleId,
    userIds: s.userIds,
    permission: s.permission,
    status: 'waiting',
    approverIds: [],
  }));
}

/** The built-in approval for a quote above the sender's discount limit, used while the quote chain is off. */
function discountPolicy(orgId: string): IApprovalPolicy {
  return {
    _id: new mongoose.Types.ObjectId(),
    taskflowOrganizationId: toOrgOid(orgId),
    recordType: 'quote',
    enabled: true,
    steps: [{ name: 'Discount approval', kind: 'discount_limit', aboveAmount: null }],
    fallbackUserIds: [],
  } as unknown as IApprovalPolicy;
}

/** The policy a request runs on: the built-in discount approval, or the record type's chain. */
async function policyFor(orgId: string, type: ApprovalRecordType, source: IApprovalRequest['source']): Promise<IApprovalPolicy> {
  return source === 'discount_limit' ? discountPolicy(orgId) : requirePolicy(orgId, type);
}

/** Policy that must be on; refuses when the chain is off for this type. */
async function requirePolicy(orgId: string, type: ApprovalRecordType): Promise<IApprovalPolicy> {
  const policy = await getPolicy(orgId, type);
  if (!policy?.enabled || !policy.steps.length) throw new ApiError(400, 'No approval chain is turned on for this record type');
  return policy as IApprovalPolicy;
}

export async function findOpenRequest(orgId: string, type: ApprovalRecordType, recordId: string) {
  return ApprovalRequest.findOne({ taskflowOrganizationId: toOrgOid(orgId), recordType: type, recordId: oid(recordId), status: 'pending' });
}

/**
 * Start (or return the open) approval request for a record. `actorUserId` is who triggered it;
 * the adapter may name a different requester (e.g. the employee whose leave it is).
 */
export async function submitForApproval(
  orgId: string,
  type: ApprovalRecordType,
  recordId: string,
  actorUserId: string,
  opts: { source?: IApprovalRequest['source'] } = {}
): Promise<RequestDoc> {
  const source = opts.source ?? 'chain';
  const policy = await policyFor(orgId, type, source);
  const adapter = await getApprovalAdapter(type);
  if (!adapter) throw new ApiError(500, `No approval adapter for ${type}`);
  const info = await adapter.load(orgId, recordId);
  if (!info) throw new ApiError(404, 'Record not found');
  const amount = round2(Number(info.amount) || 0);

  const open = await findOpenRequest(orgId, type, recordId);
  if (open && (open.source ?? 'chain') !== source) {
    // The way this record is approved changed (e.g. the chain was turned on): start over on the new one.
    open.status = 'cancelled';
    open.currentApproverIds = [];
    open.completedAt = new Date();
    open.history.push({ at: new Date(), action: 'cancelled', actorId: oid(actorUserId), note: 'Replaced by a new approval request' });
    await open.save();
  } else if (open) {
    if (open.amount === amount && (open.discountPercent ?? 0) === (info.discountPercent ?? 0)) return open;
    open.discountPercent = info.discountPercent;
    await restart(open, policy, amount, actorUserId, 'The amount changed, so approval started again');
    return open;
  }

  // Gate types: whoever asked to send/finalize is the requester. Decision types: the record's owner.
  const requester = adapter.mode === 'gate' ? actorUserId || info.requesterUserId : info.requesterUserId || actorUserId;
  if (!requester) throw new ApiError(400, 'Cannot tell who is asking for this approval');
  const req = new ApprovalRequest({
    taskflowOrganizationId: toOrgOid(orgId),
    recordType: type,
    recordId: oid(recordId),
    title: info.title,
    amount,
    currency: info.currency,
    link: info.link,
    requestedBy: oid(requester),
    status: 'pending',
    source,
    discountPercent: info.discountPercent,
    steps: buildSteps(policy, amount),
    history: [{ at: new Date(), action: 'submitted', actorId: oid(actorUserId || requester) }],
  });
  if (!req.steps.length) throw new ApiError(400, 'No step of the approval chain applies to this amount; check the chain settings');
  const active = await activateFrom(req, policy, 0);
  if (!active) {
    throw new ApiError(400, 'Nobody is available to approve this request. Ask an administrator to add approvers or fallback approvers to the chain.');
  }
  await req.save();
  logAudit({ userId: actorUserId || requester, action: 'approval.submit', resourceType: type, resourceId: recordId, meta: { requestId: String(req._id), amount } });
  await notifyCurrentStep(req);
  return req;
}

async function restart(req: RequestDoc, policy: IApprovalPolicy, amount: number, actorUserId: string, note: string) {
  req.amount = amount;
  req.steps = buildSteps(policy, amount) as never;
  req.history.push({ at: new Date(), action: 'restarted', actorId: oid(actorUserId), note });
  if (!req.steps.length || !(await activateFrom(req, policy, 0))) {
    req.status = 'cancelled';
    req.currentApproverIds = [];
    req.history.push({ at: new Date(), action: 'cancelled', note: 'Nobody is available to approve the new amount' });
  }
  await req.save();
  await notifyCurrentStep(req);
}

/** Can this user decide the current step, and for whom? null = no. */
async function standingFor(req: IApprovalRequest, userId: string): Promise<{ onBehalfOf: string | null } | null> {
  if (req.status !== 'pending') return null;
  const approvers = req.currentApproverIds.map(String);
  if (approvers.includes(userId)) return { onBehalfOf: null };
  const delegations = await delegatorsFor(String(req.taskflowOrganizationId), userId, req.recordType);
  const d = delegations.find((x) => approvers.includes(String(x.fromUserId)));
  return d ? { onBehalfOf: String(d.fromUserId) } : null;
}

/** True when this user can decide the open request for this record right now. */
export async function canDecideRecord(orgId: string, type: ApprovalRecordType, recordId: string, userId: string): Promise<boolean> {
  const open = await findOpenRequest(orgId, type, recordId);
  if (!open || same(open.requestedBy, userId)) return false;
  return Boolean(await standingFor(open, userId));
}

export interface DecisionResult {
  request: IApprovalRequest;
  outcome: 'pending' | 'approved' | 'rejected';
}

export async function decide(
  orgId: string,
  requestId: string,
  actor: ApprovalActor,
  decision: 'approve' | 'reject',
  note?: string
): Promise<DecisionResult> {
  if (!mongoose.Types.ObjectId.isValid(requestId)) throw new ApiError(404, 'Approval request not found');
  const req = await ApprovalRequest.findOne({ _id: requestId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!req) throw new ApiError(404, 'Approval request not found');
  if (req.status !== 'pending') throw new ApiError(409, `This request is already ${req.status}`);
  if (same(req.requestedBy, actor.userId)) throw new ApiError(403, 'You cannot approve or reject your own request');
  const standing = await standingFor(req, actor.userId);
  if (!standing) throw new ApiError(403, 'You are not an approver for the current step of this request');
  if (standing.onBehalfOf && same(standing.onBehalfOf, req.requestedBy)) throw new ApiError(403, 'You cannot approve a request for the person who asked');

  const policy = await policyFor(orgId, req.recordType, req.source);
  const adapter = await getApprovalAdapter(req.recordType);
  const info = await adapter?.load(orgId, String(req.recordId));
  if (!info) {
    req.status = 'cancelled';
    req.currentApproverIds = [];
    req.history.push({ at: new Date(), action: 'cancelled', note: 'The record no longer exists' });
    await req.save();
    throw new ApiError(409, 'The record behind this request no longer exists; the request was cancelled');
  }
  const amount = round2(Number(info.amount) || 0);
  if (amount !== req.amount || (info.discountPercent ?? 0) !== (req.discountPercent ?? 0)) {
    req.discountPercent = info.discountPercent;
    await restart(req, policy, amount, actor.userId, `Amount changed from ${req.amount} to ${amount}`);
    throw new ApiError(409, `The amount changed to ${amount}, so approval started again. Please review it again.`);
  }

  const idx = req.currentStep;
  const step = req.steps[idx];
  const cleanNote = note ? String(note).slice(0, 1000) : undefined;
  step.status = decision === 'approve' ? 'approved' : 'rejected';
  step.decidedBy = oid(actor.userId);
  step.onBehalfOf = standing.onBehalfOf ? oid(standing.onBehalfOf) : undefined;
  step.decidedAt = new Date();
  step.note = cleanNote;
  req.history.push({
    at: new Date(),
    action: decision === 'approve' ? 'approved' : 'rejected',
    step: idx,
    actorId: oid(actor.userId),
    onBehalfOf: step.onBehalfOf,
    note: cleanNote,
  });

  let outcome: DecisionResult['outcome'] = 'pending';
  if (decision === 'reject') {
    req.status = 'rejected';
    req.currentApproverIds = [];
    req.completedAt = new Date();
    outcome = 'rejected';
  } else if (!(await activateFrom(req, policy, idx + 1))) {
    req.status = 'approved';
    req.completedAt = new Date();
    req.history.push({ at: new Date(), action: 'completed' });
    outcome = 'approved';
  }

  try {
    await req.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) throw new ApiError(409, 'Someone else decided this request at the same time; reload and try again');
    throw err;
  }

  logAudit({
    userId: actor.userId,
    onBehalfOf: standing.onBehalfOf ?? undefined,
    action: decision === 'approve' ? 'approval.approve' : 'approval.reject',
    resourceType: req.recordType,
    resourceId: String(req.recordId),
    meta: { requestId: String(req._id), step: idx, stepName: step.name, outcome },
  });

  if (outcome === 'approved') await adapter?.onApproved?.(orgId, String(req.recordId), actor.userId);
  if (outcome === 'rejected') await adapter?.onRejected?.(orgId, String(req.recordId), actor.userId, cleanNote);
  if (outcome === 'pending') await notifyCurrentStep(req);
  else {
    await notifyUsers(
      [req.requestedBy],
      'approval_decided',
      { title: `${req.title} ${outcome}`, body: cleanNote ?? '', link: req.link ?? '/approvals' },
      actor.userId
    ).catch(() => undefined);
  }
  return { request: req.toObject(), outcome };
}

/** Decide the open request for a record (used by module approve/reject buttons). Starts one if needed. */
export async function decideForRecord(
  orgId: string,
  type: ApprovalRecordType,
  recordId: string,
  actor: ApprovalActor,
  decision: 'approve' | 'reject',
  note?: string
): Promise<DecisionResult> {
  const req = (await findOpenRequest(orgId, type, recordId)) ?? (await submitForApproval(orgId, type, recordId, actor.userId));
  return decide(orgId, String(req._id), actor, decision, note);
}

/** Close any open request for a record (withdrawn, cancelled, deleted). */
export async function cancelForRecord(orgId: string, type: ApprovalRecordType, recordId: string, actorUserId: string | undefined, note: string) {
  const open = await findOpenRequest(orgId, type, recordId);
  if (!open) return;
  open.status = 'cancelled';
  open.currentApproverIds = [];
  open.completedAt = new Date();
  open.history.push({ at: new Date(), action: 'cancelled', actorId: actorUserId ? oid(actorUserId) : undefined, note });
  await open.save();
}

export async function cancelRequest(workspaceId: string | null | undefined, requestId: string, actor: ApprovalActor, note?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const req = await ApprovalRequest.findOne({ _id: requestId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!req) throw new ApiError(404, 'Approval request not found');
  if (!same(req.requestedBy, actor.userId) && !canSeeAll(actor)) throw new ApiError(403, 'Only the requester can withdraw this request');
  if (req.status !== 'pending') throw new ApiError(409, `This request is already ${req.status}`);
  req.status = 'cancelled';
  req.currentApproverIds = [];
  req.completedAt = new Date();
  req.history.push({ at: new Date(), action: 'cancelled', actorId: oid(actor.userId), note: note ? String(note).slice(0, 1000) : 'Withdrawn' });
  await req.save();
  logAudit({ userId: actor.userId, action: 'approval.cancel', resourceType: req.recordType, resourceId: String(req.recordId), meta: { requestId } });
  return req.toObject();
}

/**
 * Gate for "send / finalize" actions. Passes when the chain is off, or the record has an approved
 * request for its current amount. Otherwise submits one (if none is open) and refuses with 409.
 */
export async function assertApprovedOrSubmit(orgId: string, type: ApprovalRecordType, recordId: string, actorUserId: string, action: string) {
  if (!(await isApprovalChainEnabled(orgId, type))) return;
  const adapter = await getApprovalAdapter(type);
  const info = await adapter?.load(orgId, recordId);
  const amount = round2(Number(info?.amount) || 0);
  // Only the chain's own requests count here; a built-in discount approval is not the chain's approval.
  const latest = await ApprovalRequest.findOne({
    taskflowOrganizationId: toOrgOid(orgId),
    recordType: type,
    recordId: oid(recordId),
    source: { $ne: 'discount_limit' },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (latest?.status === 'approved' && latest.amount === amount) return;
  if (latest?.status === 'pending' && latest.amount === amount) {
    const step = latest.steps[latest.currentStep];
    throw new ApiError(409, `Waiting for approval (${step?.name ?? 'pending'}). You can ${action} once it is approved.`);
  }
  await submitForApproval(orgId, type, recordId, actorUserId);
  throw new ApiError(409, `Sent for approval. You can ${action} once it is approved; follow it in Approvals.`);
}

/**
 * Gate for sending a quote above the sender's discount limit while the quote chain is off (AUT-31).
 * Passes when the quote has an approved request for its current amount and discount. Otherwise
 * sends it to people whose own limit covers the discount and refuses with 409.
 */
export async function assertDiscountApprovedOrSubmit(
  orgId: string,
  quoteId: string,
  actorUserId: string,
  action: string,
  over: { discountPercent: number; limit: number }
) {
  const adapter = await getApprovalAdapter('quote');
  const info = await adapter?.load(orgId, quoteId);
  if (!info) throw new ApiError(404, 'Quote not found');
  const amount = round2(Number(info.amount) || 0);
  const latest = await ApprovalRequest.findOne({ taskflowOrganizationId: toOrgOid(orgId), recordType: 'quote', recordId: oid(quoteId) })
    .sort({ createdAt: -1 })
    .lean();
  const sameQuote = latest && latest.amount === amount && (latest.discountPercent ?? 0) === (info.discountPercent ?? 0);
  if (sameQuote && latest.status === 'approved') return;
  if (sameQuote && latest.status === 'pending' && latest.source === 'discount_limit') {
    throw new ApiError(409, `Waiting for discount approval (${over.discountPercent}% off). You can ${action} once it is approved.`);
  }
  try {
    await submitForApproval(orgId, 'quote', quoteId, actorUserId, { source: 'discount_limit' });
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 400 && /Nobody is available/.test(err.message)) {
      throw new ApiError(400, `Nobody else's discount limit covers ${over.discountPercent}% off. Lower the discount, or ask an administrator to raise someone's limit.`);
    }
    throw err;
  }
  throw new ApiError(
    409,
    `${over.discountPercent}% off is above your discount limit of ${over.limit}%, so the quotation was sent for approval. You can ${action} once it is approved; follow it in Approvals.`
  );
}

// ── Reading: queue, lists, one request ──────────────────────────────────────

function canSeeAll(actor: ApprovalActor) {
  return Boolean(actor.permissions && userHasPermission(actor.permissions, AP.REQUEST.LIST_ALL));
}

/** My queue: open requests whose current step I can decide, myself or as a delegate. */
export async function myQueue(workspaceId: string | null | undefined, actor: ApprovalActor) {
  const orgId = requireWorkspaceId(workspaceId);
  const delegations = await delegatorsFor(orgId, actor.userId);
  const principals = [actor.userId, ...delegations.map((d) => String(d.fromUserId))];
  const rows = await ApprovalRequest.find({
    taskflowOrganizationId: toOrgOid(orgId),
    status: 'pending',
    currentApproverIds: { $in: principals.map(oid) },
    requestedBy: { $ne: oid(actor.userId) },
  })
    .populate('requestedBy', 'name email')
    .sort({ createdAt: 1 })
    .lean();
  return rows
    .map((r) => {
      const approvers = r.currentApproverIds.map(String);
      if (approvers.includes(actor.userId)) return { ...r, onBehalfOf: null };
      const d = delegations.find((x) => approvers.includes(String(x.fromUserId)) && (x.recordTypes.length === 0 || x.recordTypes.includes(r.recordType)));
      return d && !same(d.fromUserId, (r.requestedBy as { _id?: unknown })?._id ?? r.requestedBy) ? { ...r, onBehalfOf: String(d.fromUserId) } : null;
    })
    .filter(Boolean);
}

export async function listRequests(
  workspaceId: string | null | undefined,
  actor: ApprovalActor,
  query: { scope?: string; status?: string; recordType?: string; recordId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  const scope = query.scope ?? 'mine';
  if (scope === 'mine') filter.requestedBy = oid(actor.userId);
  else if (scope === 'decided') filter['steps.decidedBy'] = oid(actor.userId);
  else if (scope === 'all') {
    if (!canSeeAll(actor)) throw new ApiError(403, 'You can only see your own requests and the ones you decided');
  } else throw new ApiError(400, 'scope must be mine, decided or all');
  if (query.status) filter.status = query.status;
  if (query.recordType) filter.recordType = assertRecordType(query.recordType);
  if (query.recordId && mongoose.Types.ObjectId.isValid(query.recordId)) filter.recordId = oid(query.recordId);
  return ApprovalRequest.find(filter).populate('requestedBy', 'name email').sort({ createdAt: -1 }).limit(200).lean();
}

export async function getRequest(workspaceId: string | null | undefined, id: string, actor: ApprovalActor) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Approval request not found');
  const raw = await ApprovalRequest.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
  if (!raw) throw new ApiError(404, 'Approval request not found');
  const involved =
    same(raw.requestedBy, actor.userId) ||
    raw.steps.some((s) => s.approverIds.some((a) => same(a, actor.userId)) || same(s.decidedBy, actor.userId));
  const standing = await standingFor(raw, actor.userId);
  if (!involved && !standing && !canSeeAll(actor)) throw new ApiError(404, 'Approval request not found');
  const req = await ApprovalRequest.findById(raw._id)
    .populate('requestedBy', 'name email')
    .populate('steps.approverIds', 'name email')
    .populate('steps.decidedBy', 'name email')
    .populate('steps.onBehalfOf', 'name email')
    .populate('history.actorId', 'name email')
    .populate('history.onBehalfOf', 'name email')
    .lean();
  return { ...req, canDecide: Boolean(standing) && !same(raw.requestedBy, actor.userId), onBehalfOf: standing?.onBehalfOf ?? null };
}

/**
 * Approval status of one record, for the record's own page: is a chain on, and where its latest
 * request stands. Only step names, states and current approvers' names are shown here; the full
 * request (title, notes, history) stays behind getRequest's checks.
 */
export async function recordStatus(workspaceId: string | null | undefined, type: ApprovalRecordType, recordId: string, actor: ApprovalActor) {
  const orgId = requireWorkspaceId(workspaceId);
  const chainEnabled = await isApprovalChainEnabled(orgId, type);
  if (!mongoose.Types.ObjectId.isValid(recordId)) return { chainEnabled, request: null };
  const raw = await ApprovalRequest.findOne({ taskflowOrganizationId: toOrgOid(orgId), recordType: type, recordId: oid(recordId) })
    .sort({ createdAt: -1 })
    .populate('requestedBy', 'name')
    .populate('steps.approverIds', 'name')
    .populate('steps.decidedBy', 'name')
    .lean();
  if (!raw) return { chainEnabled, request: null };
  const requesterId = (raw.requestedBy as { _id?: unknown })?._id ?? raw.requestedBy;
  const standing = await standingFor(raw as unknown as IApprovalRequest, actor.userId);
  const nameOf = (p: unknown) => (p && typeof p === 'object' && 'name' in p ? String((p as { name?: unknown }).name ?? '') : '');
  return {
    chainEnabled,
    request: {
      _id: String(raw._id),
      status: raw.status,
      amount: raw.amount,
      currency: raw.currency,
      currentStep: raw.currentStep,
      requestedBy: nameOf(raw.requestedBy),
      createdAt: raw.createdAt,
      completedAt: raw.completedAt,
      steps: raw.steps.map((s) => ({
        name: s.name,
        status: s.status,
        approvers: (s.approverIds as unknown[]).map(nameOf).filter(Boolean),
        decidedBy: nameOf(s.decidedBy) || null,
        decidedAt: s.decidedAt ?? null,
      })),
      canDecide: Boolean(standing) && !same(requesterId, actor.userId),
      isMine: same(requesterId, actor.userId),
    },
  };
}

// ── Delegations ──────────────────────────────────────────────────────────────

export async function listDelegations(workspaceId: string | null | undefined, actor: ApprovalActor, all = false) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), endsAt: { $gt: new Date(Date.now() - 30 * 86400_000) } };
  const manage = actor.permissions && userHasPermission(actor.permissions, AP.DELEGATION.MANAGE);
  if (!(all && manage)) filter.$or = [{ fromUserId: oid(actor.userId) }, { toUserId: oid(actor.userId) }];
  return ApprovalDelegation.find(filter)
    .populate('fromUserId', 'name email')
    .populate('toUserId', 'name email')
    .sort({ startsAt: -1 })
    .lean();
}

export async function createDelegation(workspaceId: string | null | undefined, input: Record<string, unknown>, actor: ApprovalActor) {
  const orgId = requireWorkspaceId(workspaceId);
  const from = String(input.fromUserId ?? actor.userId);
  const to = String(input.toUserId ?? '');
  if (!mongoose.Types.ObjectId.isValid(from) || !mongoose.Types.ObjectId.isValid(to)) throw new ApiError(400, 'Choose who will approve for you');
  if (from === to) throw new ApiError(400, 'You cannot delegate to yourself');
  if (from !== actor.userId && !(actor.permissions && userHasPermission(actor.permissions, AP.DELEGATION.MANAGE))) {
    throw new ApiError(403, 'You can only delegate your own approvals');
  }
  const members = await activeMembers(orgId, [from, to]);
  if (!members.includes(from) || !members.includes(to)) throw new ApiError(400, 'Both people must be active members of this workspace');
  const startsAt = input.startsAt ? new Date(String(input.startsAt)) : new Date();
  const endsAt = new Date(String(input.endsAt ?? ''));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new ApiError(400, 'Enter valid start and end dates');
  if (endsAt <= startsAt) throw new ApiError(400, 'The end must be after the start');
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86400_000) throw new ApiError(400, 'A delegation can last at most a year');
  const recordTypes = Array.isArray(input.recordTypes) ? [...new Set(input.recordTypes.map(assertRecordType))] : [];
  const doc = await ApprovalDelegation.create({
    taskflowOrganizationId: toOrgOid(orgId),
    fromUserId: oid(from),
    toUserId: oid(to),
    startsAt,
    endsAt,
    recordTypes,
    note: input.note ? String(input.note).slice(0, 500) : undefined,
    createdBy: oid(actor.userId),
  });
  logAudit({ userId: actor.userId, action: 'approval.delegation.create', resourceType: 'approval_delegation', resourceId: String(doc._id), meta: { from, to, startsAt, endsAt, recordTypes } });
  void notifyUsers([to], 'approval_requested', { title: 'You are approving on someone’s behalf', body: `Until ${endsAt.toDateString()}`, link: '/approvals' }, actor.userId).catch(() => undefined);
  return doc.toObject();
}

export async function endDelegation(workspaceId: string | null | undefined, id: string, actor: ApprovalActor) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Delegation not found');
  const d = await ApprovalDelegation.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!d) throw new ApiError(404, 'Delegation not found');
  const manage = actor.permissions && userHasPermission(actor.permissions, AP.DELEGATION.MANAGE);
  if (!same(d.fromUserId, actor.userId) && !same(d.createdBy, actor.userId) && !manage) throw new ApiError(403, 'You can only end your own delegations');
  const now = new Date();
  if (d.startsAt > now) await d.deleteOne();
  else if (d.endsAt > now) {
    d.endsAt = now;
    await d.save();
  }
  logAudit({ userId: actor.userId, action: 'approval.delegation.end', resourceType: 'approval_delegation', resourceId: id });
  return { ended: true };
}
