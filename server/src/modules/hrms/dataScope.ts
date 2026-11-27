/**
 * Data scope: whose records a permission reaches.
 *
 * HR permissions (and timesheet approval) say what someone may do; the scope codes say to whom:
 *   own        — nothing beyond your own record (no scope code held)
 *   team       — also people who report to you, at any depth, and members of teams you lead
 *   department — also everyone in your own department(s)
 *   all        — everyone in the workspace
 * The widest code held applies. Admins hold every code, so they reach everyone.
 */
import mongoose from 'mongoose';
import type { Request } from 'express';
import { ApiError } from '../../utils/ApiError';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';

type Oid = mongoose.Types.ObjectId;
export type ScopeArea = 'hr' | 'timesheet' | 'crm';
export type ScopeLevel = 'own' | 'team' | 'department' | 'all';

const CODES: Record<ScopeArea, { TEAM: string; DEPARTMENT: string; ALL: string }> = {
  hr: TASK_FLOW_PERMISSIONS.TASKFLOW.HR.SCOPE,
  timesheet: TASK_FLOW_PERMISSIONS.TASKFLOW.TIMESHEET.SCOPE,
  crm: TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.SCOPE,
};

export function scopeLevel(permissions: string[], area: ScopeArea): ScopeLevel {
  const c = CODES[area];
  if (userHasPermission(permissions, c.ALL)) return 'all';
  if (userHasPermission(permissions, c.DEPARTMENT)) return 'department';
  if (userHasPermission(permissions, c.TEAM)) return 'team';
  return 'own';
}

/** Who a viewer reaches; `null` means everyone. */
export type Reach = {
  level: Exclude<ScopeLevel, 'all'>;
  employeeIds: Set<string>;
  /** Accounts reached: the employees' accounts, team members without an HR record, and the viewer. */
  userIds: Set<string>;
  /** The viewer's own departments (department level only). */
  departments: string[];
} | null;

export async function reachOf(orgOid: Oid, userId: string, level: ScopeLevel): Promise<Reach> {
  if (level === 'all') return null;
  const own = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId }).select('_id department').lean();
  const employeeIds = new Set(own.map((e) => String(e._id)));
  const userIds = new Set<string>([userId]);
  const departments: string[] = [];
  if (level === 'team' || level === 'department') {
    // Reports at any depth.
    let frontier = [...employeeIds];
    for (let depth = 0; frontier.length && depth < 20; depth++) {
      const below = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, managerId: { $in: frontier } }).select('_id').lean();
      frontier = below.map((e) => String(e._id)).filter((id) => !employeeIds.has(id));
      frontier.forEach((id) => employeeIds.add(id));
    }
    // Members of teams the viewer leads.
    const led = await ResourceTeam.find({ taskflowOrganizationId: orgOid, leadId: userId }).select('memberIds').lean();
    const members = [...new Set(led.flatMap((t) => (t.memberIds ?? []).map(String)))];
    members.forEach((m) => userIds.add(m));
    if (members.length) {
      (await HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId: { $in: members } }).select('_id').lean()).forEach((e) => employeeIds.add(String(e._id)));
    }
  }
  if (level === 'department') {
    departments.push(...new Set(own.map((e) => (e.department ?? '').trim()).filter(Boolean)));
    if (departments.length) {
      (await HrmsEmployee.find({ taskflowOrganizationId: orgOid, department: { $in: departments } }).select('_id').lean()).forEach((e) => employeeIds.add(String(e._id)));
    }
  }
  const accounts = await HrmsEmployee.find({ _id: { $in: [...employeeIds] }, userId: { $ne: null } }).distinct('userId');
  accounts.forEach((u) => userIds.add(String(u)));
  return { level, employeeIds, userIds, departments };
}

type ScopedReq = Request & { activeOrganizationId?: string; user?: { id: string; permissions?: string[] } };
const cache = new WeakMap<object, Map<ScopeArea, Promise<Reach>>>();

/** The signed-in user's reach for one area, worked out once per request. */
export function reachFor(req: ScopedReq, area: ScopeArea): Promise<Reach> {
  let byArea = cache.get(req);
  if (!byArea) cache.set(req, (byArea = new Map()));
  let p = byArea.get(area);
  if (!p) {
    const orgOid = toOrgOid(requireWorkspaceId(req.activeOrganizationId));
    p = reachOf(orgOid, req.user!.id, scopeLevel(req.user?.permissions ?? [], area));
    byArea.set(area, p);
  }
  return p;
}

export function reaches(reach: Reach, employeeId: unknown): boolean {
  return reach === null || (employeeId != null && reach.employeeIds.has(String((employeeId as { _id?: unknown })?._id ?? employeeId)));
}

/** 404 rather than 403, so a record outside the scope looks the same as one that does not exist. */
export function assertReaches(reach: Reach, employeeId: unknown, what = 'Employee'): void {
  if (!reaches(reach, employeeId)) throw new ApiError(404, `${what} not found`);
}

/** Mongo filter for employee records within reach (on `_id`, or on another field holding the employee id). */
export function employeeFilter(reach: Reach, field = '_id'): Record<string, unknown> {
  if (reach === null) return {};
  return { [field]: { $in: [...reach.employeeIds].map((id) => new mongoose.Types.ObjectId(id)) } };
}

/** Mongo filter for records keyed by an account id. */
export function userFilter(reach: Reach, field: string): Record<string, unknown> {
  if (reach === null) return {};
  return { [field]: { $in: [...reach.userIds].map((id) => new mongoose.Types.ObjectId(id)) } };
}

/** Company-wide work (payroll runs, review cycles) needs the whole company in reach. */
export function assertReachesEveryone(reach: Reach, what: string): void {
  if (reach !== null) throw new ApiError(403, `${what} covers the whole company; your access reaches only part of it`);
}
