/** Reporting lines. */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { User } from '../auth/user.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';

type Oid = mongoose.Types.ObjectId;

/** The account of someone's manager, if that manager still works here and can sign in. */
export async function managerUserIdOf(employee: { managerId?: unknown }): Promise<string | undefined> {
  if (!employee.managerId) return undefined;
  const mgr = await HrmsEmployee.findOne({ _id: employee.managerId, status: { $ne: 'terminated' } }).select('userId').lean();
  if (!mgr?.userId || !(await User.exists({ _id: mgr.userId, enabled: { $ne: false } }))) return undefined;
  return String(mgr.userId);
}

/** A manager works in this workspace, still works here, and does not (however indirectly) report to the employee. */
export async function assertValidManager(orgOid: Oid, managerId: unknown, employeeId?: unknown): Promise<void> {
  if (!managerId) return;
  if (!mongoose.isValidObjectId(managerId)) throw new ApiError(400, 'Reporting manager not found');
  const manager = await HrmsEmployee.findOne({ _id: managerId, taskflowOrganizationId: orgOid }).select('name status managerId').lean();
  if (!manager) throw new ApiError(400, 'Reporting manager not found');
  if (manager.status === 'terminated') throw new ApiError(400, `${manager.name} has left and cannot be a reporting manager`);
  if (!employeeId) return;
  if (String(manager._id) === String(employeeId)) throw new ApiError(400, 'Someone cannot report to themselves');
  const seen = new Set<string>([String(manager._id)]);
  for (let up = manager.managerId; up && !seen.has(String(up)); ) {
    if (String(up) === String(employeeId)) throw new ApiError(400, `${manager.name} already reports to this person, directly or through others`);
    seen.add(String(up));
    up = (await HrmsEmployee.findOne({ _id: up, taskflowOrganizationId: orgOid }).select('managerId').lean())?.managerId;
  }
}

/** The caller's own current employee records' ids (by account). */
export async function ownEmployeeIds(orgOid: Oid, userId: string): Promise<Oid[]> {
  return HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId, status: { $ne: 'terminated' } }).distinct('_id') as Promise<Oid[]>;
}

/** People who report straight to the caller, never the caller. */
export async function directReportIds(orgOid: Oid, userId: string): Promise<Oid[]> {
  const own = await ownEmployeeIds(orgOid, userId);
  if (!own.length) return [];
  return HrmsEmployee.find({ taskflowOrganizationId: orgOid, managerId: { $in: own }, _id: { $nin: own }, userId: { $ne: userId } }).distinct('_id') as Promise<Oid[]>;
}
