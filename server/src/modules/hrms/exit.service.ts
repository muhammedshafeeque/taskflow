/**
 * When someone leaves: close their sign-in, and hand their open work to someone else.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { User } from '../auth/user.model';
import { assertCanManageAdmin, type GrantActor } from '../auth/grantGuard';
import { ApiToken } from '../apiTokens/apiToken.model';
import { PushSubscription } from '../pushSubscriptions/pushSubscription.model';
import { logAudit } from '../auditLogs/logAudit';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { Issue } from '../issues/issue.model';
import * as issueHistoryService from '../issues/issueHistory.service';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { OPEN_LEAD_STATUSES } from '../crm/leads/leads.constants';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { TimesheetSubmission } from '../workLogs/timesheetApproval';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { usersWithPermission } from '../auth/usersWithPermission';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { disconnectUser, notifyProjectRefresh } from '../../websocket';
import { HrmsEmployee, type IHrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsSettings } from './models/hrmsPolicy.model';
import { HrmsChecklist, HrmsReview } from './models/hrmsPeople.model';

type Oid = mongoose.Types.ObjectId;
type EmployeeLike = Pick<IHrmsEmployee, 'taskflowOrganizationId' | 'userId' | 'email' | 'name' | 'status' | 'exitDate' | 'accessClosedAt'> & { _id: unknown };

const DAY = 86_400_000;
const startOfTodayUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** The sign-in account of an employee in this workspace: linked, or (not linked yet) the member with the same email. */
async function accountOf(e: EmployeeLike) {
  const user = e.userId
    ? await User.findById(e.userId).select('role email enabled isServiceAccount').lean()
    : e.email
      ? await User.findOne({ email: e.email.toLowerCase() }).select('role email enabled isServiceAccount').lean()
      : null;
  if (!user || user.isServiceAccount) return null;
  const member = await OrganizationMember.exists({ organization: e.taskflowOrganizationId, user: user._id, status: 'active' });
  return member ? user : null;
}

/** A leaver's access ends once they are terminated and the exit date has come (no date: now). */
export function accessIsDue(e: Pick<EmployeeLike, 'status' | 'exitDate'>, now = new Date()): boolean {
  return e.status === 'terminated' && (!e.exitDate || new Date(e.exitDate).getTime() < startOfTodayUtc(now).getTime() + DAY);
}

/** Refuse up front, before anything is saved. */
export async function assertCanTerminate(e: EmployeeLike, actor: GrantActor): Promise<void> {
  const user = await accountOf(e);
  if (!user) return;
  if (String(user._id) === actor.id) throw new ApiError(403, 'You cannot terminate yourself');
  assertCanManageAdmin(actor, user.role === 'admin', { employeeId: String(e._id) });
}

export type CloseAccessResult = 'closed' | 'workspace_removed' | 'no_account' | 'admin_skipped' | 'other_record';

/**
 * Ends every way in: sign-in, refresh, API and MCP tokens, push and live sockets. Someone who also works in
 * another workspace keeps their account and loses only this workspace.
 */
export async function closeAccess(e: EmployeeLike, actor: GrantActor | null): Promise<CloseAccessResult> {
  const org = e.taskflowOrganizationId;
  const user = await accountOf(e);
  let result: CloseAccessResult = 'no_account';
  if (user) {
    const userId = user._id as Oid;
    // Rehired or entered twice: another live record still needs the account.
    const otherRecord = await HrmsEmployee.exists({ taskflowOrganizationId: org, _id: { $ne: e._id }, status: { $ne: 'terminated' }, $or: [{ userId }, { userId: null, email: user.email }] });
    if (otherRecord) result = 'other_record';
    else if (user.role === 'admin' && actor?.role !== 'admin') result = 'admin_skipped';
    else {
      const elsewhere = await OrganizationMember.exists({ user: userId, organization: { $ne: org }, status: 'active' });
      const revoke = { $set: { revokedAt: new Date() } };
      if (elsewhere) {
        await OrganizationMember.deleteOne({ organization: org, user: userId });
        const projectIds = await Project.find({ taskflowOrganizationId: org }).distinct('_id');
        await ProjectMember.deleteMany({ user: userId, project: { $in: projectIds } });
        await ApiToken.updateMany({ userId, organizationId: org, revokedAt: null }, revoke);
        result = 'workspace_removed';
      } else {
        await User.updateOne(
          { _id: userId },
          { $set: { enabled: false, refreshTokenJti: crypto.randomUUID() }, $unset: { passwordResetToken: 1, passwordResetExpires: 1 } }
        );
        await ApiToken.updateMany({ userId, revokedAt: null }, revoke);
        await PushSubscription.deleteMany({ user: userId });
        result = 'closed';
      }
      disconnectUser(String(userId));
    }
  }
  await HrmsEmployee.updateOne({ _id: e._id }, { $set: { accessClosedAt: new Date(), ...(user ? { userId: user._id } : {}) } });
  logAudit({
    userId: actor?.id,
    ...(actor ? {} : { actorType: 'system' as const, actorLabel: 'Employee exits' }),
    action: 'hr.employee.access_closed',
    resourceType: 'employee',
    resourceId: String(e._id),
    meta: { result, accountId: user ? String(user._id) : null },
  });
  if (result === 'admin_skipped') {
    const admins = await usersWithPermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE, String(org));
    await Promise.all(
      admins
        .filter((id) => id !== String(user?._id))
        .map((userId) =>
          notifyUser({ userId, eventKey: 'system_alert', title: `${e.name} has left but is an administrator`, body: 'Their sign-in was not closed automatically. An administrator must disable it.', link: '/users' }).catch(() => undefined)
        )
    );
  }
  return result;
}

/**
 * Hourly. Terminated people whose exit date has come, and people whose exit date passed in the last week without
 * anyone marking them (older dates on a working employee are more likely stale than a missed exit).
 * Status is left to HR: terminated people drop out of payroll.
 */
export async function closeDueExits(now = new Date()): Promise<number> {
  const today = startOfTodayUtc(now);
  const due = await HrmsEmployee.find({
    accessClosedAt: null,
    $or: [
      { status: 'terminated', $or: [{ exitDate: null }, { exitDate: { $lt: new Date(today.getTime() + DAY) } }] },
      { status: { $ne: 'terminated' }, exitDate: { $gte: new Date(today.getTime() - 7 * DAY), $lt: today } },
    ],
  })
    .limit(500)
    .lean();
  let closed = 0;
  for (const e of due) {
    try {
      const r = await closeAccess(e as unknown as EmployeeLike, null);
      if (r === 'closed' || r === 'workspace_removed') closed++;
    } catch (err) {
      console.error(`[exits] ${e.employeeCode}`, err);
    }
  }
  return closed;
}

// ── Open work ─────────────────────────────────────────────────────────────

export const WORK_KINDS = ['leads', 'deals', 'followUps', 'tasks', 'tickets', 'timesheets', 'reviews', 'checklists', 'reports', 'leaveApprover'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export type OpenWork = Record<WorkKind, number> & { projectsLed: number };

async function openIssueFilter(org: Oid, userId: Oid, onlyProjects?: unknown[]) {
  const projects = await Project.find({ taskflowOrganizationId: org, ...(onlyProjects ? { _id: { $in: onlyProjects } } : {}) }).select('statuses').lean();
  return {
    assignee: userId,
    $or: projects.length
      ? projects.map((p) => ({ project: p._id, status: { $nin: getClosedStatusNamesFromStatuses(p.statuses) } }))
      : [{ _id: null }],
  };
}

function filters(org: Oid, employeeId: unknown, userId: Oid) {
  const o = { taskflowOrganizationId: org };
  return {
    leads: { ...o, assigneeId: userId, status: { $in: OPEN_LEAD_STATUSES } },
    deals: { ...o, ownerId: userId, status: 'open' as const },
    followUps: { ...o, assigneeId: userId, completedAt: null },
    tickets: { ...o, assigneeId: userId, status: { $nin: ['resolved', 'closed'] as const } },
    timesheets: { ...o, approverIds: userId, status: 'submitted' as const },
    reviews: { ...o, reviewerId: userId, status: { $ne: 'completed' as const } },
    checklists: { ...o, status: 'open' as const, tasks: { $elemMatch: { assigneeId: userId, done: false } } },
    reports: { ...o, managerId: employeeId, status: { $ne: 'terminated' as const } },
    leaveApprover: { ...o, leaveApproverUserIds: userId },
  };
}

async function loadLeaver(workspaceId: string | null | undefined, employeeId: string) {
  const org = toOrgOid(requireWorkspaceId(workspaceId));
  if (!mongoose.isValidObjectId(employeeId)) throw new ApiError(404, 'Employee not found');
  const employee = await HrmsEmployee.findOne({ _id: employeeId, taskflowOrganizationId: org }).lean();
  if (!employee) throw new ApiError(404, 'Employee not found');
  const account = employee.userId
    ? { _id: employee.userId as Oid }
    : await accountOf(employee as unknown as EmployeeLike);
  return { org, employee, userId: (account?._id ?? new mongoose.Types.ObjectId()) as Oid };
}

async function countOpenWork(org: Oid, employeeId: unknown, userId: Oid): Promise<OpenWork> {
  const f = filters(org, employeeId, userId);
  const [leads, deals, followUps, tasks, tickets, timesheets, reviews, checklists, reports, leaveApprover, projectsLed] = await Promise.all([
    CrmLead.countDocuments(f.leads),
    CrmDeal.countDocuments(f.deals),
    CrmActivity.countDocuments(f.followUps),
    openIssueFilter(org, userId).then((q) => Issue.countDocuments(q)),
    ServiceTicket.countDocuments(f.tickets as never),
    TimesheetSubmission.countDocuments(f.timesheets),
    HrmsReview.countDocuments(f.reviews),
    HrmsChecklist.countDocuments(f.checklists),
    HrmsEmployee.countDocuments(f.reports),
    HrmsSettings.countDocuments(f.leaveApprover),
    Project.countDocuments({ taskflowOrganizationId: org, lead: userId, archived: { $ne: true } }),
  ]);
  return { leads, deals, followUps, tasks, tickets, timesheets, reviews, checklists, reports, leaveApprover, projectsLed };
}

export async function getOpenWork(workspaceId: string | null | undefined, employeeId: string): Promise<OpenWork> {
  const { org, employee, userId } = await loadLeaver(workspaceId, employeeId);
  return countOpenWork(org, employee._id, userId);
}

/** Swap one id for another in an array field, without leaving duplicates. */
const swapIn = (field: string, from: Oid, to: Oid) => [
  { $set: { [field]: { $setUnion: [{ $setDifference: [`$${field}`, [from]] }, [to]] } } },
];

/** Hand the chosen kinds of open work (default: all) to one person. Run again for a different person per kind. */
export async function reassignWork(
  workspaceId: string | null | undefined,
  employeeId: string,
  input: { toUserId?: string; kinds?: unknown },
  actor: GrantActor
): Promise<{ moved: Partial<Record<WorkKind, number>>; remaining: OpenWork }> {
  const { org, employee, userId: from } = await loadLeaver(workspaceId, employeeId);
  if (!input.toUserId || !mongoose.isValidObjectId(input.toUserId)) throw new ApiError(400, 'Choose who takes over the work');
  const to = new mongoose.Types.ObjectId(input.toUserId);
  if (to.equals(from)) throw new ApiError(400, 'Choose someone other than the person leaving');
  if (input.kinds !== undefined && (!Array.isArray(input.kinds) || input.kinds.some((k) => !WORK_KINDS.includes(k as WorkKind)))) {
    throw new ApiError(400, `kinds must be from: ${WORK_KINDS.join(', ')}`);
  }
  const kinds = new Set<WorkKind>((input.kinds as WorkKind[] | undefined) ?? WORK_KINDS);
  const [user, member, toEmployee] = await Promise.all([
    User.findOne({ _id: to, enabled: { $ne: false }, isServiceAccount: { $ne: true } }).select('_id').lean(),
    OrganizationMember.exists({ organization: org, user: to, status: 'active' }),
    HrmsEmployee.findOne({ taskflowOrganizationId: org, userId: to, status: { $ne: 'terminated' } }).select('managerId').lean(),
  ]);
  if (!user || !member) throw new ApiError(400, 'That person has no active account in this workspace');

  const f = filters(org, employee._id, from);
  const moved: Partial<Record<WorkKind, number>> = {};
  const run = async (kind: WorkKind, fn: () => Promise<number>) => {
    if (kinds.has(kind)) moved[kind] = await fn();
  };

  await run('leads', async () => (await CrmLead.updateMany(f.leads, { $set: { assigneeId: to } })).modifiedCount);
  await run('deals', async () => (await CrmDeal.updateMany(f.deals, { $set: { ownerId: to } })).modifiedCount);
  await run('followUps', async () => (await CrmActivity.updateMany(f.followUps, { $set: { assigneeId: to } })).modifiedCount);
  await run('tickets', async () => (await ServiceTicket.updateMany(f.tickets as never, { $set: { assigneeId: to } })).modifiedCount);
  await run('tasks', async () => {
    // Only where the new person is on the project; the rest stay counted as remaining.
    const projects = await ProjectMember.find({ user: to }).distinct('project');
    const issues = await Issue.find(await openIssueFilter(org, from, projects)).select('_id project').lean();
    if (!issues.length) return 0;
    const res = await Issue.updateMany({ _id: { $in: issues.map((i) => i._id) }, assignee: from }, { $set: { assignee: to } });
    for (const i of issues) {
      await issueHistoryService.recordFieldChanges(String(i._id), actor.id, [{ field: 'assignee', fromValue: String(from), toValue: String(to) }]);
    }
    for (const p of new Set(issues.map((i) => String(i.project)))) notifyProjectRefresh(p);
    return res.modifiedCount;
  });
  // Nobody ends up approving their own timesheet or reviewing themselves.
  await run('timesheets', async () => (await TimesheetSubmission.updateMany({ ...f.timesheets, userId: { $ne: to } }, swapIn('approverIds', from, to))).modifiedCount);
  await run('reviews', async () => (await HrmsReview.updateMany({ ...f.reviews, employeeUserId: { $ne: to } }, { $set: { reviewerId: to } })).modifiedCount);
  await run('checklists', async () =>
    (await HrmsChecklist.updateMany(f.checklists, { $set: { 'tasks.$[t].assigneeId': to } }, { arrayFilters: [{ 't.assigneeId': from, 't.done': false }] })).modifiedCount
  );
  await run('reports', async () => {
    if (!toEmployee) return 0;
    // The new manager may report to the leaver: they move up to the leaver's own manager.
    const up = await HrmsEmployee.updateOne(
      { _id: toEmployee._id, managerId: employee._id },
      employee.managerId && !employee.managerId.equals(toEmployee._id as Oid) ? { $set: { managerId: employee.managerId } } : { $unset: { managerId: 1 } }
    );
    const rest = await HrmsEmployee.updateMany({ ...f.reports, _id: { $ne: toEmployee._id } }, { $set: { managerId: toEmployee._id } });
    return up.modifiedCount + rest.modifiedCount;
  });
  await run('leaveApprover', async () => (await HrmsSettings.updateMany(f.leaveApprover, swapIn('leaveApproverUserIds', from, to))).modifiedCount);

  const total = Object.values(moved).reduce((s, n) => s + (n ?? 0), 0);
  logAudit({ userId: actor.id, action: 'hr.employee.work_reassigned', resourceType: 'employee', resourceId: String(employee._id), meta: { to: String(to), moved } });
  if (total > 0 && String(to) !== actor.id) {
    const list = Object.entries(moved).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
    void notifyUser({ userId: String(to), eventKey: 'system_alert', title: `You took over work from ${employee.name}`, body: list, link: '/' }).catch(() => undefined);
  }
  return { moved, remaining: await countOpenWork(org, employee._id, from) };
}
