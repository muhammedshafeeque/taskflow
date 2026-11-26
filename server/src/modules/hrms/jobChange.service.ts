/**
 * Promotions, transfers, intern conversions and pay changes as one flow.
 *
 * A change is proposed with an effective date, approved (by a second person, unless HR settings say otherwise),
 * and applied on that date: the employee record, the person's platform role, their resource profile seniority and
 * their project designations move together. Applied changes are the job and salary history.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { roleTreePermissions, permissionsFor } from '../auth/accessProfile';
import { assertCanAssignRole, assertNotSelf, type GrantActor } from '../auth/grantGuard';
import { usersWithPermission } from '../auth/usersWithPermission';
import * as usersService from '../users/users.service';
import { ResourceProfile } from '../resources/models/resourceProfile.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ProjectDesignation } from '../projects/projectDesignation.model';
import { suggestDesignation } from '../projects/designationTemplates.service';
import { updateMemberDesignation } from '../projects/projectInvitations.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { logAudit } from '../auditLogs/logAudit';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsJobChange, JOB_FIELDS, type IHrmsJobChange, type JobState } from './models/hrmsJobChange.model';
import { getHrSettings } from './policy.service';
import { assertValidManager } from './managers';
import { assertCanSetPay, payAccessFor } from './payAccess';
import { updateEmployee } from './hrms.service';
import { attendanceDay } from './attendanceDay';
import { calendarDay } from './lossOfPay';
import { type Reach, assertReaches, employeeFilter, reaches } from './dataScope';

type Oid = mongoose.Types.ObjectId;
const J = TASK_FLOW_PERMISSIONS.TASKFLOW.HR.JOB_CHANGE;
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
const OPEN = ['pending', 'scheduled'];
const today = () => new Date(`${calendarDay(new Date())}T00:00:00Z`);
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

type EmployeeLike = Record<string, unknown> & { _id: unknown; userId?: unknown; employmentType?: string };

/** What a change asks for, checked and reduced to the fields that actually change. */
async function cleanTarget(orgOid: Oid, employee: EmployeeLike, input: Record<string, unknown>): Promise<JobState> {
  const to: JobState = {};
  for (const f of ['designation', 'department'] as const) {
    if (input[f] !== undefined) to[f] = String(input[f] ?? '').trim().slice(0, 120);
  }
  if (input.level !== undefined && input.level !== '') {
    const levels = (((await getHrSettings(String(orgOid))) as { levels?: string[] }).levels ?? []);
    const level = levels.find((l) => l.toLowerCase() === String(input.level).trim().toLowerCase());
    if (!level) throw new ApiError(400, `Level must be one of: ${levels.join(', ')}`);
    to.level = level;
  }
  if (input.employmentType !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(String(input.employmentType))) throw new ApiError(400, 'Unknown employment type');
    to.employmentType = String(input.employmentType);
  }
  if (input.managerId !== undefined && input.managerId !== '') {
    await assertValidManager(orgOid, input.managerId, employee._id);
    to.managerId = String(input.managerId);
  }
  if (input.annualCtc !== undefined && input.annualCtc !== '') {
    const n = Number(input.annualCtc);
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Annual CTC must be zero or more');
    to.annualCtc = n;
  }
  if (input.currency !== undefined && input.currency !== '') {
    const c = String(input.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new ApiError(400, 'Currency must be a 3-letter code');
    to.currency = c;
  }
  if (input.roleId !== undefined && input.roleId !== '') {
    if (!employee.userId) throw new ApiError(400, 'This employee has no account, so there is no role to change');
    if (!mongoose.isValidObjectId(input.roleId) || !(await Role.exists({ _id: input.roleId }))) throw new ApiError(400, 'Role not found');
    to.roleId = String(input.roleId);
  }
  // Only what differs from today.
  for (const f of JOB_FIELDS) if (f in to && same(to[f], employee[f])) delete to[f];
  if (to.roleId) {
    const user = await User.findById(employee.userId).select('roleId').lean();
    if (same(user?.roleId, to.roleId)) delete to.roleId;
  }
  return to;
}

/** Promotion, transfer, conversion or pay change, from what changes. */
export function kindOf(employee: { employmentType?: string }, to: JobState): IHrmsJobChange['kind'] {
  if (employee.employmentType === 'intern' && to.employmentType && to.employmentType !== 'intern') return 'conversion';
  if (to.level !== undefined || to.designation !== undefined || to.roleId !== undefined) return 'promotion';
  if (to.department !== undefined || to.managerId !== undefined) return 'transfer';
  if (to.annualCtc !== undefined || to.currency !== undefined) return 'salary';
  return 'change';
}

/** The approver (or requester) may make every part of this change. Checked when asked, approved and applied. */
async function assertActorCan(actor: GrantActor, employee: EmployeeLike, to: JobState) {
  if (employee.userId && same(employee.userId, actor.id)) throw new ApiError(403, 'You cannot change your own job');
  assertCanSetPay({ annualCtc: to.annualCtc, currency: undefined }, payAccessFor(actor.permissions));
  if (to.roleId) {
    // Same rights as changing someone's role in Auth → Users.
    if (!userHasPermission(actor.permissions, TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE)) throw new ApiError(403, 'Changing someone’s role needs the right to edit users');
    assertNotSelf(actor, String(employee.userId));
    const role = await Role.findById(to.roleId).select('name').lean();
    assertCanAssignRole(actor, { name: role?.name, permissions: await roleTreePermissions([to.roleId]) }, { targetUserId: String(employee.userId), roleId: to.roleId });
  }
}

async function loadEmployee(orgOid: Oid, employeeId: unknown): Promise<EmployeeLike> {
  if (!mongoose.isValidObjectId(employeeId)) throw new ApiError(404, 'Employee not found');
  const e = await HrmsEmployee.findOne({ _id: employeeId, taskflowOrganizationId: orgOid }).lean();
  if (!e) throw new ApiError(404, 'Employee not found');
  if (e.status === 'terminated') throw new ApiError(409, `${e.name} has left`);
  return e as unknown as EmployeeLike;
}

const name = async (userId: unknown) => (await User.findById(userId).select('name').lean())?.name ?? 'Someone';

export async function requestJobChange(workspaceId: string | null | undefined, input: Record<string, unknown>, actor: GrantActor, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  assertReaches(reach, input.employeeId);
  const employee = await loadEmployee(orgOid, input.employeeId);
  if (await HrmsJobChange.exists({ employeeId: employee._id, status: { $in: OPEN } })) {
    throw new ApiError(409, 'This person already has a job change waiting; approve, reject or cancel it first');
  }
  const to = await cleanTarget(orgOid, employee, input);
  if (!Object.keys(to).length) throw new ApiError(400, 'Nothing would change');
  await assertActorCan(actor, employee, to);
  const effectiveDate = input.effectiveDate ? attendanceDay(input.effectiveDate) : today();

  const settings = (await getHrSettings(String(orgOid))) as { jobChangeNeedsApproval?: boolean };
  const selfApproved = settings.jobChangeNeedsApproval === false && userHasPermission(actor.permissions, J.APPROVE);
  const change = await HrmsJobChange.create({
    taskflowOrganizationId: orgOid,
    employeeId: employee._id,
    kind: typeof input.kind === 'string' && ['promotion', 'transfer', 'conversion', 'salary', 'change'].includes(input.kind) ? input.kind : kindOf(employee, to),
    to,
    updateProjectDesignations: input.updateProjectDesignations !== false,
    effectiveDate,
    reason: input.reason ? String(input.reason).slice(0, 1000) : undefined,
    requestedBy: actor.id,
    ...(selfApproved ? { status: 'scheduled', decidedBy: actor.id, decidedAt: new Date(), decisionNote: 'No second approval needed' } : {}),
  });
  logAudit({ userId: actor.id, action: 'hr.job_change.request', resourceType: 'employee', resourceId: String(employee._id), meta: { kind: change.kind, to: redactPay(to) } });
  if (selfApproved) return applyIfDue(change._id, actor);

  const requester = await name(actor.id);
  const approvers = (await usersWithPermission(J.APPROVE, String(orgOid))).filter((u) => u !== actor.id && !same(u, employee.userId));
  await Promise.all(
    approvers.map((u) =>
      notifyUser({ userId: u, eventKey: 'approval_requested', title: `Job change for ${String(employee.name)}`, body: `${requester} proposed a ${change.kind} from ${calendarDay(effectiveDate)}`, link: '/hrms/job-changes' }).catch(() => undefined)
    )
  );
  return change.toObject();
}

export async function decideJobChange(workspaceId: string | null | undefined, id: string, decision: unknown, note: unknown, actor: GrantActor, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const change = mongoose.isValidObjectId(id) ? await HrmsJobChange.findOne({ _id: id, taskflowOrganizationId: orgOid }) : null;
  if (!change || !reaches(reach, change.employeeId)) throw new ApiError(404, 'Job change not found');
  if (change.status !== 'pending') throw new ApiError(409, `This change is already ${change.status}`);
  if (same(change.requestedBy, actor.id)) throw new ApiError(403, 'Someone else must approve a change you proposed');
  const employee = await loadEmployee(orgOid, change.employeeId);
  const approve = decision === 'approve' || decision === 'approved';
  if (approve) await assertActorCan(actor, employee, change.to);
  // Claim it, so two approvers clicking at once decide it once.
  const won = await HrmsJobChange.updateOne(
    { _id: change._id, status: 'pending' },
    { $set: { status: approve ? 'scheduled' : 'rejected', decidedBy: actor.id, decidedAt: new Date(), decisionNote: note ? String(note).slice(0, 1000) : undefined } }
  );
  if (!won.modifiedCount) throw new ApiError(409, 'This change has just been decided');
  logAudit({ userId: actor.id, action: approve ? 'hr.job_change.approve' : 'hr.job_change.reject', resourceType: 'employee', resourceId: String(change.employeeId), meta: { jobChangeId: id } });
  void notifyUser({
    userId: String(change.requestedBy),
    eventKey: 'approval_decided',
    title: `Job change for ${String(employee.name)} ${approve ? 'approved' : 'rejected'}`,
    body: note ? String(note) : approve ? `Takes effect ${calendarDay(change.effectiveDate)}` : '',
    link: '/hrms/job-changes',
  }).catch(() => undefined);
  return approve ? applyIfDue(change._id, actor) : (await HrmsJobChange.findById(change._id).lean())!;
}

export async function cancelJobChange(workspaceId: string | null | undefined, id: string, actor: GrantActor, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const change = mongoose.isValidObjectId(id) ? await HrmsJobChange.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean() : null;
  if (!change || !reaches(reach, change.employeeId)) throw new ApiError(404, 'Job change not found');
  if (!same(change.requestedBy, actor.id) && !userHasPermission(actor.permissions, J.APPROVE)) throw new ApiError(403, 'Only the person who proposed it, or an approver, can cancel it');
  const done = await HrmsJobChange.updateOne({ _id: change._id, status: { $in: OPEN } }, { $set: { status: 'cancelled', decidedBy: actor.id, decidedAt: new Date() } });
  if (!done.modifiedCount) throw new ApiError(409, `This change is already ${change.status}`);
  return (await HrmsJobChange.findById(change._id).lean())!;
}

async function applyIfDue(id: unknown, actor: GrantActor) {
  const change = await HrmsJobChange.findById(id).lean();
  if (change && change.status === 'scheduled' && change.effectiveDate <= today()) await applyJobChange(change as unknown as IHrmsJobChange, actor);
  return (await HrmsJobChange.findById(id).lean())!;
}

/** The approver as they are now: a change approved by someone who has since lost the right does not go through. */
async function actorFromApprover(change: IHrmsJobChange): Promise<GrantActor | null> {
  const user = await User.findById(change.decidedBy).select('role roleId mustChangePassword permissionOverrides enabled').lean();
  if (!user || user.enabled === false) return null;
  return { id: String(user._id), role: user.role, permissions: await permissionsFor(user as never, change.taskflowOrganizationId) };
}

/** Everything in one go; if any part fails, the employee record is put back and the change is marked failed. */
async function applyJobChange(change: IHrmsJobChange, actor: GrantActor): Promise<void> {
  const claim = await HrmsJobChange.updateOne({ _id: change._id, status: 'scheduled' }, { $set: { status: 'applied', appliedAt: new Date() } });
  if (!claim.modifiedCount) return;
  const orgOid = change.taskflowOrganizationId;
  const before = await HrmsEmployee.findById(change.employeeId).lean();
  const fail = async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await HrmsJobChange.updateOne({ _id: change._id }, { $set: { status: 'failed', error: message.slice(0, 500) }, $unset: { appliedAt: 1 } });
    void notifyUser({ userId: String(change.decidedBy ?? change.requestedBy), eventKey: 'system_alert', title: 'A job change could not be applied', body: message, link: '/hrms/job-changes' }).catch(() => undefined);
  };
  if (!before || before.status === 'terminated') return fail(new Error('The employee has left'));
  const userId = before.userId ? String(before.userId) : null;
  const user = userId ? await User.findById(userId).select('roleId').lean() : null;
  const profile = userId ? await ResourceProfile.findOne({ taskflowOrganizationId: orgOid, userId }).select('seniority department').lean() : null;
  const to = change.to;
  const from: JobState = {};
  for (const f of JOB_FIELDS) if (f in to) from[f] = (before as Record<string, unknown>)[f] ?? null;
  if ('roleId' in to) from.roleId = user?.roleId ? String(user.roleId) : null;
  if (to.level !== undefined) from.seniority = profile?.seniority ?? null;

  try {
    await assertActorCan(actor, before as unknown as EmployeeLike, to);
    const fields: Record<string, unknown> = {};
    for (const f of JOB_FIELDS) if (f in to) fields[f] = to[f];
    if (Object.keys(fields).length) await updateEmployee(String(before._id), String(orgOid), fields, actor);
    if (to.roleId && userId) await usersService.update(userId, { roleId: to.roleId } as never, actor, userHasPermission(actor.permissions, TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE));
  } catch (err) {
    await HrmsEmployee.replaceOne({ _id: before._id }, before);
    return fail(err);
  }

  // Resource planning follows the new level and department.
  if (userId && (to.level !== undefined || to.department !== undefined)) {
    await ResourceProfile.updateOne(
      { taskflowOrganizationId: orgOid, userId },
      { $set: { ...(to.level !== undefined ? { seniority: to.level } : {}), ...(to.department !== undefined ? { department: to.department } : {}) } },
      { upsert: true }
    );
  }

  // Project designations follow the new job, except where the person leads the project.
  const projectChanges: IHrmsJobChange['projectChanges'] = [];
  if (userId && change.updateProjectDesignations) {
    const memberships = await ProjectMember.find({ user: userId }).populate('designationId', 'code name').lean();
    for (const m of memberships) {
      const current = m.designationId as unknown as { _id: Oid; code?: string; name?: string } | null;
      if (current?.code === 'project_lead') continue;
      const project = await Project.findOne({ _id: m.project, taskflowOrganizationId: orgOid }).select('name').lean();
      if (!project) continue;
      const suggestion = await suggestDesignation(String(m.project), userId);
      if (!suggestion?.designationId || same(suggestion.designationId, current?._id)) continue;
      await updateMemberDesignation(String(m.project), String(m._id), suggestion.designationId);
      projectChanges.push({ projectId: m.project as Oid, projectName: project.name, from: current?.name, to: suggestion.name });
    }
  }

  await HrmsJobChange.updateOne({ _id: change._id }, { $set: { from, projectChanges } });
  logAudit({ userId: actor.id, action: 'hr.job_change.apply', resourceType: 'employee', resourceId: String(before._id), meta: { jobChangeId: String(change._id), kind: change.kind, from: redactPay(from), to: redactPay(to), projects: projectChanges.length } });
  if (userId) {
    void notifyUser({ userId, eventKey: 'system_alert', title: 'Your job details have changed', body: [to.designation, to.level, to.department].filter(Boolean).join(' · ') || 'See your profile', link: '/me' }).catch(() => undefined);
  }
}

/** Scheduled job: apply approved changes whose day has come, as their approver. */
export async function applyDueJobChanges(now = new Date()): Promise<number> {
  const day = new Date(`${calendarDay(now)}T00:00:00Z`);
  let applied = 0;
  for (const change of await HrmsJobChange.find({ status: 'scheduled', effectiveDate: { $lte: day } }).sort({ effectiveDate: 1 }).limit(500).lean()) {
    const actor = await actorFromApprover(change as unknown as IHrmsJobChange);
    if (!actor) {
      await HrmsJobChange.updateOne({ _id: change._id, status: 'scheduled' }, { $set: { status: 'failed', error: 'The approver can no longer sign in; approve it again' } });
      continue;
    }
    await applyJobChange(change as unknown as IHrmsJobChange, actor);
    if ((await HrmsJobChange.findById(change._id).select('status').lean())?.status === 'applied') applied++;
  }
  return applied;
}

function redactPay(state: JobState): JobState {
  const { annualCtc: _pay, ...rest } = state;
  return _pay === undefined ? rest : { ...rest, annualCtc: 'changed' };
}

/** Pay fields leave the record for people who may not see pay. */
function forViewer<T extends { to?: JobState; from?: JobState }>(c: T, canSeePay: boolean): T {
  if (canSeePay) return c;
  const strip = (s?: JobState) => (s ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'annualCtc' && k !== 'currency')) : s);
  return { ...c, to: strip(c.to), from: strip(c.from) };
}

export async function listJobChanges(workspaceId: string | null | undefined, query: { status?: string; employeeId?: string }, permissions: string[], reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid, ...employeeFilter(reach, 'employeeId') };
  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (query.employeeId) {
    if (!reaches(reach, query.employeeId)) return [];
    filter.employeeId = query.employeeId;
  }
  const rows = await HrmsJobChange.find(filter)
    .populate('employeeId', 'name employeeCode designation level department')
    .populate('requestedBy', 'name')
    .populate('decidedBy', 'name')
    .sort({ effectiveDate: -1, createdAt: -1 })
    .limit(300)
    .lean();
  const canSeePay = payAccessFor(permissions).see;
  return rows.map((r) => forViewer(r, canSeePay));
}

/** Job and salary history: applied changes, oldest first, with what is still to come. */
export async function employeeHistory(workspaceId: string | null | undefined, employeeId: string, permissions: string[], reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  assertReaches(reach, employeeId);
  const employee = await HrmsEmployee.findOne({ _id: employeeId, taskflowOrganizationId: orgOid }).select('name joinedDate designation level department').lean();
  if (!employee) throw new ApiError(404, 'Employee not found');
  const changes = await HrmsJobChange.find({ taskflowOrganizationId: orgOid, employeeId, status: { $in: ['applied', 'scheduled', 'pending'] } })
    .populate('requestedBy', 'name')
    .populate('decidedBy', 'name')
    .sort({ effectiveDate: 1, createdAt: 1 })
    .lean();
  const canSeePay = payAccessFor(permissions).see;
  return { employee, changes: changes.map((c) => forViewer(c, canSeePay)) };
}
