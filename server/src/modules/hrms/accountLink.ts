/**
 * Employees and sign-in accounts, connected on purpose rather than matched by email (AUT-35).
 *
 * - Adding a user can link them to an existing employee record or create one.
 * - Hiring can create the new hire's account, or ask someone who can create accounts to do it.
 * The link is the employee's `userId`; it is always written through updateEmployee/createEmployee,
 * so the HR permissions, the actor's HR reach and the access-rule gain check all apply.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { toOrgOid } from '../crm/crmWorkspace';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import type { GrantActor } from '../auth/grantGuard';
import { usersWithPermission } from '../auth/usersWithPermission';
import { notifyUsers } from '../notifications/domainNotify';
import { logAudit } from '../auditLogs/logAudit';
import { Role } from '../roles/role.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { reachOf, scopeLevel } from './dataScope';

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;
const can = (actor: GrantActor, code: string) => actor.role === 'admin' || userHasPermission(actor.permissions, code);
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type EmployeeChoice =
  | { mode: 'auto' }
  | { mode: 'none' }
  | { mode: 'link'; employeeId: string }
  | {
      mode: 'create';
      employeeCode?: string;
      department?: string;
      designation?: string;
      joinedDate?: string;
      managerId?: string;
      level?: string;
    };

export type EmployeeLinkResult = {
  status: 'linked' | 'created' | 'already_linked' | 'match_found' | 'none' | 'failed';
  employeeId?: string;
  message?: string;
};

/** Unlinked employees in this workspace with this email (case-insensitive). */
async function unlinkedByEmail(orgId: string, email: string) {
  return HrmsEmployee.find({
    taskflowOrganizationId: toOrgOid(orgId),
    email: new RegExp(`^${escapeRx(email.trim())}$`, 'i'),
    $or: [{ userId: null }, { userId: { $exists: false } }],
    status: { $ne: 'terminated' },
  })
    .select('_id name accountRequest')
    .lean();
}

/**
 * Connect a user account to an employee record in this workspace. Never throws: the account already
 * exists, so a problem here is reported back instead of undoing the invite.
 */
export async function connectEmployee(
  orgId: string,
  user: { id: string; email: string; name: string },
  choice: EmployeeChoice | undefined,
  actor: GrantActor
): Promise<EmployeeLinkResult> {
  const orgOid = toOrgOid(orgId);
  try {
    const already = await HrmsEmployee.findOne({ taskflowOrganizationId: orgOid, userId: user.id }).select('_id').lean();
    const mode = choice?.mode ?? 'auto';
    const linkId = choice?.mode === 'link' ? choice.employeeId : '';
    if (already) {
      if (mode === 'link' && String(already._id) !== linkId) {
        return { status: 'failed', employeeId: String(already._id), message: 'This person is already linked to another employee record' };
      }
      await markRequestDone(orgId, String(already._id));
      return { status: 'already_linked', employeeId: String(already._id) };
    }
    if (mode === 'none') return { status: 'none' };

    const { updateEmployee, createEmployee } = await import('./hrms.service');
    const reach = await reachOf(orgOid, actor.id, scopeLevel(actor.permissions, 'hr'));

    if (mode === 'link' || mode === 'auto') {
      let employeeId = linkId;
      if (mode === 'auto') {
        const matches = await unlinkedByEmail(orgId, user.email);
        if (matches.length !== 1) return { status: 'none' };
        employeeId = String(matches[0]._id);
        // Found by email; only someone who may edit employees links it, others are told it is there.
        if (!can(actor, H.EMPLOYEE.UPDATE)) {
          return { status: 'match_found', employeeId, message: `${matches[0].name} in HR has this email. Ask HR to link the account to that employee.` };
        }
      } else if (!can(actor, H.EMPLOYEE.UPDATE)) {
        return { status: 'failed', message: 'Linking an employee needs the employee update permission' };
      }
      if (!mongoose.isValidObjectId(employeeId)) return { status: 'failed', message: 'Choose an employee to link' };
      const target = await HrmsEmployee.findOne({ _id: employeeId, taskflowOrganizationId: orgOid }).select('userId').lean();
      if (!target) return { status: 'failed', message: 'Employee not found' };
      if (target.userId && String(target.userId) !== user.id) return { status: 'failed', employeeId, message: 'That employee is already linked to another account' };
      await updateEmployee(employeeId, orgId, { userId: user.id }, actor, reach);
      await markRequestDone(orgId, employeeId);
      logAudit({ userId: actor.id, action: 'hr.employee.account_linked', resourceType: 'employee', resourceId: employeeId, meta: { userId: user.id, via: mode } });
      return { status: 'linked', employeeId };
    }

    // mode === 'create'
    if (!can(actor, H.EMPLOYEE.CREATE)) return { status: 'failed', message: 'Creating an employee needs the employee create permission' };
    const c = choice as Extract<EmployeeChoice, { mode: 'create' }>;
    const created = (await createEmployee(
      orgId,
      {
        name: user.name,
        email: user.email,
        userId: user.id,
        employeeCode: c.employeeCode,
        department: c.department,
        designation: c.designation,
        joinedDate: c.joinedDate,
        managerId: c.managerId,
        level: c.level,
      },
      actor.permissions,
      actor,
      reach
    )) as { _id: unknown };
    logAudit({ userId: actor.id, action: 'hr.employee.account_linked', resourceType: 'employee', resourceId: String(created._id), meta: { userId: user.id, via: 'create' } });
    return { status: 'created', employeeId: String(created._id) };
  } catch (err) {
    return { status: 'failed', message: err instanceof ApiError || err instanceof Error ? err.message : 'Could not connect the employee record' };
  }
}

async function markRequestDone(orgId: string, employeeId: string) {
  await HrmsEmployee.updateOne(
    { _id: employeeId, taskflowOrganizationId: toOrgOid(orgId), 'accountRequest.status': 'pending' },
    { $set: { 'accountRequest.status': 'done', 'accountRequest.doneAt': new Date() } }
  );
}

/**
 * Hiring could not create the account: record the request on the employee and tell the people who can
 * add users. Inviting that email later (Users screen) links the employee and closes the request.
 */
export async function requestAccount(orgId: string, employeeId: string, roleId: string | undefined, actorId: string, who: { name: string; email?: string }) {
  if (roleId && !(mongoose.isValidObjectId(roleId) && (await Role.exists({ _id: roleId })))) throw new ApiError(400, 'Choose a valid role for the account');
  await HrmsEmployee.updateOne(
    { _id: employeeId, taskflowOrganizationId: toOrgOid(orgId) },
    {
      $set: {
        accountRequest: {
          roleId: roleId ? new mongoose.Types.ObjectId(roleId) : undefined,
          requestedBy: new mongoose.Types.ObjectId(actorId),
          requestedAt: new Date(),
          status: 'pending',
        },
      },
    }
  );
  const admins = (await usersWithPermission(TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE, orgId)).filter((u) => u !== actorId);
  const role = roleId ? await Role.findById(roleId).select('name').lean() : null;
  void notifyUsers(admins, 'hr_account_requested', {
    title: `Account needed for new hire: ${who.name}`,
    body: [who.email, role ? `suggested role ${role.name}` : null].filter(Boolean).join(' · '),
    link: '/users?requests=1',
  }, actorId);
  logAudit({ userId: actorId, action: 'hr.employee.account_requested', resourceType: 'employee', resourceId: employeeId, meta: { roleId } });
}

/** Account requests waiting for someone who can add users. */
export async function listAccountRequests(orgId: string) {
  const rows = await HrmsEmployee.find({ taskflowOrganizationId: toOrgOid(orgId), 'accountRequest.status': 'pending' })
    .select('name email designation department joinedDate accountRequest')
    .populate('accountRequest.roleId', 'name')
    .populate('accountRequest.requestedBy', 'name')
    .sort({ 'accountRequest.requestedAt': 1 })
    .lean();
  return rows.map((e) => {
    const r = e.accountRequest as unknown as { roleId?: { _id: unknown; name?: string } | null; requestedBy?: { name?: string } | null; requestedAt: Date };
    return {
      employeeId: String(e._id),
      name: e.name,
      email: e.email,
      designation: e.designation,
      department: e.department,
      joinedDate: e.joinedDate,
      roleId: r.roleId ? String(r.roleId._id) : null,
      roleName: r.roleId?.name ?? null,
      requestedBy: r.requestedBy?.name ?? null,
      requestedAt: r.requestedAt,
    };
  });
}

/** Dismiss a request (e.g. the hire will not need an account). */
export async function cancelAccountRequest(orgId: string, employeeId: string, actorId: string) {
  const res = await HrmsEmployee.updateOne(
    { _id: employeeId, taskflowOrganizationId: toOrgOid(orgId), 'accountRequest.status': 'pending' },
    { $set: { 'accountRequest.status': 'cancelled', 'accountRequest.doneAt': new Date() } }
  );
  if (!res.matchedCount) throw new ApiError(404, 'No open account request for this employee');
  logAudit({ userId: actorId, action: 'hr.employee.account_request_cancelled', resourceType: 'employee', resourceId: employeeId });
  return { cancelled: true };
}
