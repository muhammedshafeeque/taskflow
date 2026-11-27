import { type Reach, assertReaches, employeeFilter, reaches } from './dataScope';
import { cancelForRecord, decideForRecord, isApprovalChainEnabled, submitForApproval } from '../approvals/approvals.service';
import mongoose from 'mongoose';
import { applyLeaveUsage, getBalances, leaveYearOf, splitByLeaveYear, workingDaysFor } from './policy.service';
import { HrmsLeaveType } from './models/hrmsPolicy.model';
import { ApiError } from '../../utils/ApiError';
import { escapeRegex } from '../../utils/safeUrl';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { logAudit } from '../auditLogs/logAudit';
import { ATTENDANCE_STATUSES, attendanceDay } from './attendanceDay';
import { withRuleGainCheck } from '../auth/accessProfile';
import { getHrSettings } from './policy.service';
import { assertValidManager } from './managers';
import { createWithCode } from './employeeCode';
import { assertCanSetPay, payAccessFor, withoutPay } from './payAccess';
import type { GrantActor } from '../auth/grantGuard';
import { accessIsDue, assertCanTerminate, closeAccess } from './exit.service';
import { upsertContactByEmail } from '../crm/contacts/contacts.service';

/** Someone whose reach is limited can add people only beneath a manager they reach (or into their own department). */
function assertCanPlace(reach: Reach, input: Record<string, unknown>) {
  if (reach === null) return;
  const dept = String(input.department ?? '').trim();
  if (input.managerId && reaches(reach, input.managerId)) return;
  if (dept && reach.departments.includes(dept)) return;
  throw new ApiError(403, reach.level === 'department' ? 'Add people to your own department, or under a manager you reach' : 'Add people under a manager within your team');
}

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** An amount from a form: blank → undefined, otherwise a number, zero or more unless negatives are allowed. */
function amount(value: unknown, label: string, allowNegative = false): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) throw new ApiError(400, `${label} must be a number${allowNegative ? '' : ' of zero or more'}`);
  return n;
}

const AMOUNT_FIELDS = { annualCtc: 'Annual CTC', hourlyCostRate: 'Hourly cost', leaveBalanceDays: 'Leave balance' } as const;

/** Three-letter currency code, or the given default when blank. */
function currencyCode(value: unknown, fallback: string): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) return fallback;
  if (!/^[A-Z]{3}$/.test(code)) throw new ApiError(400, 'Currency must be a three-letter code, such as INR');
  return code;
}

function daysBetween(start: Date, end: Date): number {
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}

// ── Employees ───────────────────────────────────────────────────────────────

export async function listEmployees(
  workspaceId: string | null | undefined,
  query: { status?: string; department?: string; search?: string; archived?: string },
  permissions: string[],
  reach: Reach = null
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), ...employeeFilter(reach) };
  // Archived people are hidden unless asked for (AUT-38): archived=only shows just them, archived=all shows everyone.
  if (query.archived === 'only') filter.archivedAt = { $ne: null };
  else if (query.archived !== 'all') filter.archivedAt = null;
  if (query.status) filter.status = query.status;
  if (query.department) filter.department = query.department;
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), 'i');
  const access = payAccessFor(permissions);
  return (await HrmsEmployee.find(filter).sort({ name: 1 }).lean()).map((e) => withoutPay(e, access));
}

/** A level from the HR settings list ('' clears it). */
async function levelOf(orgOid: mongoose.Types.ObjectId, value: unknown): Promise<string | null> {
  const level = String(value ?? '').trim();
  if (!level) return null;
  const levels = ((await getHrSettings(String(orgOid))) as { levels?: string[] }).levels ?? [];
  const match = levels.find((l) => l.toLowerCase() === level.toLowerCase());
  if (!match) throw new ApiError(400, `Level must be one of: ${levels.join(', ')}`);
  return match;
}

async function assertValidMentor(orgOid: mongoose.Types.ObjectId, mentorId: unknown, employeeId?: unknown) {
  if (!mentorId) return;
  if (!mongoose.isValidObjectId(mentorId)) throw new ApiError(400, 'Mentor not found');
  if (employeeId && String(mentorId) === String(employeeId)) throw new ApiError(400, 'Someone cannot mentor themselves');
  const m = await HrmsEmployee.findOne({ _id: mentorId, taskflowOrganizationId: orgOid }).select('status name').lean();
  if (!m) throw new ApiError(400, 'Mentor not found');
  if (m.status === 'terminated') throw new ApiError(400, `${m.name} has left and cannot be a mentor`);
}

export async function createEmployee(workspaceId: string | null | undefined, input: Record<string, unknown>, permissions: string[], actor?: GrantActor, reach: Reach = null) {
  const access = payAccessFor(permissions);
  assertCanSetPay(input, access);
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Name is required');
  assertCanPlace(reach, input);
  await assertValidManager(orgOid, input.managerId);
  await assertValidMentor(orgOid, input.mentorId);
  const level = await levelOf(orgOid, input.level);
  const currency = currencyCode(input.currency, 'USD');
  const create = () => createWithCode(orgOid, input.employeeCode, (code) =>
    HrmsEmployee.create({
      taskflowOrganizationId: orgOid,
      userId: input.userId || undefined,
      employeeCode: code,
      name: String(input.name).trim(),
      email: input.email,
      phone: input.phone,
      department: input.department,
      designation: input.designation,
      managerId: input.managerId || undefined,
      employmentType: input.employmentType ?? 'full_time',
      status: input.status ?? 'active',
      joinedDate: asDate(input.joinedDate) ?? new Date(),
      exitDate: asDate(input.exitDate),
      location: input.location,
      annualCtc: amount(input.annualCtc, AMOUNT_FIELDS.annualCtc) ?? 0,
      hourlyCostRate: amount(input.hourlyCostRate, AMOUNT_FIELDS.hourlyCostRate),
      currency,
      leaveBalanceDays: amount(input.leaveBalanceDays, AMOUNT_FIELDS.leaveBalanceDays, true) ?? 20,
      notes: input.notes,
      level,
      mentorId: input.mentorId || null,
    })
  );
  // A linked account with a level can fall under access rules.
  let created: Awaited<ReturnType<typeof create>> | undefined;
  const doc =
    actor && input.userId && level
      ? await withRuleGainCheck(orgOid, actor, async () => (created = await create()), async () => created && HrmsEmployee.deleteOne({ _id: created._id }))
      : await create();
  if (doc.email) {
    await upsertContactByEmail(orgId, {
      email: String(doc.email),
      name: doc.name,
      phone: doc.phone,
      title: doc.designation,
      origin: 'hrms',
      employeeId: String(doc._id),
      userId: doc.userId ? String(doc.userId) : undefined,
    }).catch(() => undefined);
  }
  return withoutPay(doc.toObject(), access);
}

export async function updateEmployee(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>, actor: GrantActor, reach: Reach = null) {
  assertReaches(reach, id);
  const access = payAccessFor(actor.permissions);
  assertCanSetPay(input, access);
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await HrmsEmployee.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Employee not found');
  if (existing.archivedAt) throw new ApiError(409, `${existing.name} is archived. Restore them before making changes.`);
  const previousStatus = existing.status;
  const before = existing.toObject();
  const managerChanged = 'managerId' in input && String(input.managerId || '') !== String(existing.managerId ?? '');
  if (managerChanged) {
    await assertValidManager(existing.taskflowOrganizationId, input.managerId, existing._id);
    if (reach && !reaches(reach, input.managerId)) throw new ApiError(403, 'You can only move people to managers within your reach');
  }
  if ('employeeCode' in input) {
    const code = String(input.employeeCode ?? '').trim();
    if (!code) throw new ApiError(400, 'Employee code is required');
    existing.employeeCode = code;
  }
  if ('currency' in input) existing.currency = currencyCode(input.currency, existing.currency);
  if ('level' in input) existing.level = await levelOf(existing.taskflowOrganizationId, input.level);
  if ('mentorId' in input && String(input.mentorId || '') !== String(existing.mentorId ?? '')) {
    await assertValidMentor(existing.taskflowOrganizationId, input.mentorId, existing._id);
    existing.mentorId = input.mentorId ? new mongoose.Types.ObjectId(String(input.mentorId)) : null;
  }
  const fields = [
    'name', 'email', 'phone', 'whatsappPhone', 'department', 'designation', 'managerId', 'employmentType',
    'status', 'location', 'annualCtc', 'hourlyCostRate', 'leaveBalanceDays', 'notes', 'userId',
  ] as const;
  for (const key of fields) {
    if (!(key in input)) continue;
    const val = input[key];
    if (key === 'annualCtc' || key === 'leaveBalanceDays' || key === 'hourlyCostRate') {
      const n = amount(val, AMOUNT_FIELDS[key], key === 'leaveBalanceDays');
      // Blank clears the hourly cost (it is then worked out from CTC); CTC and balance fall back to 0.
      (existing as unknown as Record<string, unknown>)[key] = key === 'hourlyCostRate' ? n : (n ?? 0);
    } else {
      (existing as unknown as Record<string, unknown>)[key] = val === '' ? undefined : val;
    }
  }
  if ('joinedDate' in input) existing.joinedDate = asDate(input.joinedDate) ?? existing.joinedDate;
  if ('exitDate' in input) existing.exitDate = asDate(input.exitDate);
  if (existing.status === 'terminated' && previousStatus !== 'terminated') {
    if (!existing.exitDate) existing.exitDate = new Date();
  } else if (existing.status !== 'terminated' && previousStatus === 'terminated') {
    // Rehired. The account stays closed until an administrator turns it back on.
    if (!input.exitDate || String(input.exitDate).slice(0, 10) === before.exitDate?.toISOString().slice(0, 10)) existing.exitDate = undefined;
    existing.accessClosedAt = null;
  }
  // Checked against the account before and after, so relinking in the same request can't dodge or redirect it.
  const exiting = existing.status === 'terminated' || ('exitDate' in input && Boolean(existing.exitDate));
  if (exiting) {
    await assertCanTerminate(before as never, actor);
    await assertCanTerminate(existing, actor);
  }
  // Level and the linked account decide which access rules apply.
  const rulesMayChange = existing.isModified('level') || existing.isModified('userId') || existing.isModified('status');
  const save = () => existing.save();
  try {
    if (rulesMayChange) {
      await withRuleGainCheck(existing.taskflowOrganizationId, actor, save, () => HrmsEmployee.replaceOne({ _id: existing._id }, before));
    } else await save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Employee code already exists');
    throw err;
  }
  if (managerChanged) {
    logAudit({ userId: actor.id, action: 'hr.employee.manager_changed', resourceType: 'employee', resourceId: id, meta: { from: before.managerId ? String(before.managerId) : null, to: input.managerId ? String(input.managerId) : null } });
  }
  if (accessIsDue(existing) && !existing.accessClosedAt) await closeAccess(existing, actor);
  if (existing.email) {
    await upsertContactByEmail(orgId, {
      email: String(existing.email),
      name: existing.name,
      phone: existing.phone,
      title: existing.designation,
      origin: 'hrms',
      employeeId: String(existing._id),
      userId: existing.userId ? String(existing.userId) : undefined,
    }).catch(() => undefined);
  }
  return withoutPay((await HrmsEmployee.findById(existing._id).lean()) ?? existing.toObject(), access);
}

/**
 * What would be orphaned if this employee record disappeared (AUT-38): their attendance, leave,
 * payroll, checklists, reviews, job changes, policy acceptances, hire record, and people who report
 * to them or whom they mentor. Empty means the record can safely be deleted (e.g. added by mistake).
 */
export async function employeeHistory(orgOid: mongoose.Types.ObjectId, employeeId: mongoose.Types.ObjectId): Promise<string[]> {
  const { HrmsLeaveLedger } = await import('./models/hrmsPolicy.model');
  const { HrmsPayrollRun } = await import('./models/hrmsPayroll.model');
  const { HrmsChecklist, HrmsReview, HrmsCandidate } = await import('./models/hrmsPeople.model');
  const { HrmsJobChange } = await import('./models/hrmsJobChange.model');
  const { PolicyAcceptance } = await import('../documents/policyAcceptance');
  const org = { taskflowOrganizationId: orgOid };
  const checks: Array<[string, () => Promise<unknown>]> = [
    ['attendance', () => HrmsAttendance.exists({ ...org, employeeId })],
    ['leave', () => HrmsLeaveRequest.exists({ ...org, employeeId })],
    ['leave balances', () => HrmsLeaveLedger.exists({ ...org, employeeId })],
    ['payroll', () => HrmsPayrollRun.exists({ ...org, 'payslips.employeeId': employeeId })],
    ['onboarding or exit checklists', () => HrmsChecklist.exists({ ...org, employeeId })],
    ['reviews', () => HrmsReview.exists({ ...org, employeeId })],
    ['job changes', () => HrmsJobChange.exists({ ...org, employeeId })],
    ['policy acceptances', () => PolicyAcceptance.exists({ ...org, employeeId })],
    ['a hire record', () => HrmsCandidate.exists({ ...org, hiredEmployeeId: employeeId })],
    ['people who report to them', () => HrmsEmployee.exists({ ...org, managerId: employeeId })],
    ['people they mentor', () => HrmsEmployee.exists({ ...org, mentorId: employeeId })],
  ];
  const found = await Promise.all(checks.map(async ([label, check]) => ((await check()) ? label : null)));
  return found.filter((x): x is string => Boolean(x));
}

/**
 * "Delete" an employee (AUT-38). With any history the record is archived instead, so nothing is
 * orphaned: only people who have left can be archived. A record with no history (added by mistake)
 * is deleted for real.
 */
export async function deleteEmployee(id: string, workspaceId: string | null | undefined, reach: Reach = null, actorId?: string) {
  assertReaches(reach, id);
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const emp = await HrmsEmployee.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!emp) throw new ApiError(404, 'Employee not found');
  if (emp.archivedAt) throw new ApiError(409, `${emp.name} is already archived`);
  const history = await employeeHistory(orgOid, emp._id as mongoose.Types.ObjectId);
  if (!history.length) {
    await HrmsEmployee.deleteOne({ _id: emp._id });
    const { CrmContact } = await import('../crm/models/crmContact.model');
    await CrmContact.updateMany({ taskflowOrganizationId: orgOid, employeeId: emp._id }, { $unset: { employeeId: 1 } });
    if (actorId) logAudit({ userId: actorId, action: 'hr.employee.delete', resourceType: 'employee', resourceId: id, meta: { name: emp.name } });
    return { deleted: true, archived: false };
  }
  if (emp.status !== 'terminated') {
    throw new ApiError(409, `${emp.name} has ${history.join(', ')}, so the record is kept and archived rather than deleted. Record their exit (status Left) first, then archive.`);
  }
  emp.archivedAt = new Date();
  if (actorId) emp.archivedBy = new mongoose.Types.ObjectId(actorId);
  await emp.save();
  if (actorId) logAudit({ userId: actorId, action: 'hr.employee.archive', resourceType: 'employee', resourceId: id, meta: { name: emp.name, history } });
  return { deleted: false, archived: true, history };
}

/** Bring an archived employee back into the lists. They stay Left until someone rehires them. */
export async function restoreEmployee(id: string, workspaceId: string | null | undefined, reach: Reach = null, actorId?: string) {
  assertReaches(reach, id);
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const res = await HrmsEmployee.updateOne({ _id: id, taskflowOrganizationId: orgOid, archivedAt: { $ne: null } }, { $set: { archivedAt: null }, $unset: { archivedBy: 1 } });
  if (!res.matchedCount) throw new ApiError(404, 'No archived employee with that id');
  if (actorId) logAudit({ userId: actorId, action: 'hr.employee.restore', resourceType: 'employee', resourceId: id });
  return { restored: true };
}

// ── Leave ─────────────────────────────────────────────────────────────────

export async function listLeave(
  workspaceId: string | null | undefined,
  query: { status?: string; employeeId?: string } = {},
  reach: Reach = null
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), ...employeeFilter(reach, 'employeeId') };
  if (query.status) filter.status = query.status;
  if (query.employeeId) {
    if (!reaches(reach, query.employeeId)) return [];
    filter.employeeId = query.employeeId;
  }
  return HrmsLeaveRequest.find(filter)
    .populate('employeeId', 'name employeeCode department')
    .populate('leaveTypeId', 'name color paid')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createLeave(workspaceId: string | null | undefined, input: Record<string, unknown>, reach: Reach = null, actorUserId?: string) {
  assertReaches(reach, input.employeeId);
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const employee = await HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const start = asDate(input.startDate);
  const end = asDate(input.endDate);
  if (!start || !end) throw new ApiError(400, 'Start and end dates are required');
  if (end < start) throw new ApiError(400, 'End date is before start date');
  const halfDay = Boolean(input.halfDay);
  let leaveTypeId: mongoose.Types.ObjectId | null = null;
  let legacyType = (input.type as string | undefined) ?? 'annual';
  if (input.leaveTypeId) {
    const lt = await HrmsLeaveType.findOne({ _id: input.leaveTypeId, taskflowOrganizationId: orgOid, active: true }).lean();
    if (!lt) throw new ApiError(400, 'Unknown leave type');
    leaveTypeId = lt._id as mongoose.Types.ObjectId;
    legacyType = lt.paid ? 'annual' : 'unpaid';
  } else if (await HrmsLeaveType.exists({ taskflowOrganizationId: orgOid, active: true })) {
    // With leave types set up, every request uses one, so HR and self-service draw on the same balances.
    throw new ApiError(400, 'Choose a leave type');
  }
  // Count working days (weekends and holidays excluded) unless HR overrides.
  const days =
    input.days != null ? Number(input.days) : await workingDaysFor(orgOid, start, end, employee.location, halfDay);
  if (!(days > 0)) throw new ApiError(400, 'The selected dates contain no working days');
  await assertNoOverlap(employee._id as mongoose.Types.ObjectId, start, end, halfDay);
  // Leave across two leave years is charged to each year for its own days (AUT-39).
  const split = await splitByLeaveYear(orgOid, start, end, days, employee.location);
  if (leaveTypeId) {
    for (const part of split) {
      const balance = (await getBalances(orgId, String(employee._id), part.from)).find((b) => b.leaveTypeId === String(leaveTypeId));
      if (!balance?.paid || balance.allowNegative || balance.available === null) continue;
      const pending = await pendingDaysInYear(employee._id as mongoose.Types.ObjectId, leaveTypeId, part.year);
      if (part.days > balance.available - pending) {
        throw new ApiError(400, `Not enough ${balance.name} balance for leave year ${part.year} (${balance.available} available, ${pending} pending, ${part.days} asked)`);
      }
    }
  }
  const doc = await HrmsLeaveRequest.create({
    taskflowOrganizationId: orgOid,
    employeeId: employee._id,
    type: legacyType,
    leaveTypeId,
    halfDay,
    status: 'pending',
    startDate: start,
    endDate: end,
    days,
    reason: input.reason,
    ...(split.length > 1 ? { yearSplit: split.map(({ year, days: d }) => ({ year, days: d })) } : {}),
  });
  if (await isApprovalChainEnabled(orgId, 'leave')) {
    try {
      await submitForApproval(orgId, 'leave', String(doc._id), actorUserId ?? (employee.userId ? String(employee.userId) : ''));
    } catch (err) {
      // No request without someone to approve it: undo, so the balance isn't held by a stuck request.
      await HrmsLeaveRequest.deleteOne({ _id: doc._id });
      throw err;
    }
  }
  return HrmsLeaveRequest.findById(doc._id).populate('employeeId', 'name employeeCode department').lean();
}

/**
 * Leave can't overlap the person's other pending or approved leave (AUT-39). Two half days on the same
 * single day are allowed (morning and afternoon).
 */
async function assertNoOverlap(employeeId: mongoose.Types.ObjectId, start: Date, end: Date, halfDay: boolean) {
  const clashes = await HrmsLeaveRequest.find({
    employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: end },
    endDate: { $gte: start },
  })
    .select('startDate endDate halfDay status')
    .lean();
  if (!clashes.length) return;
  const sameSingleDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  const halfDayPair =
    halfDay && sameSingleDay(start, end) && clashes.length === 1 && clashes[0].halfDay && sameSingleDay(new Date(clashes[0].startDate), new Date(clashes[0].endDate));
  if (halfDayPair) return;
  const c = clashes[0];
  throw new ApiError(
    409,
    `This overlaps ${c.status} leave from ${new Date(c.startDate).toISOString().slice(0, 10)} to ${new Date(c.endDate).toISOString().slice(0, 10)}. Change or cancel that request first.`
  );
}

/** Pending days of one leave type charged to one leave year (split requests count their part). */
async function pendingDaysInYear(employeeId: mongoose.Types.ObjectId, leaveTypeId: mongoose.Types.ObjectId, year: number) {
  const settings = await getHrSettings(String((await HrmsEmployee.findById(employeeId).select('taskflowOrganizationId').lean())?.taskflowOrganizationId));
  const startMonth = (settings as { leaveYearStartMonth?: number }).leaveYearStartMonth ?? 1;
  const rows = await HrmsLeaveRequest.find({ employeeId, leaveTypeId, status: 'pending' }).select('startDate days yearSplit').lean();
  let total = 0;
  for (const r of rows) {
    if (r.yearSplit?.length) total += r.yearSplit.filter((p) => p.year === year).reduce((a, p) => a + p.days, 0);
    else if (leaveYearOf(new Date(r.startDate), startMonth) === year) total += r.days;
  }
  return total;
}

/** Which decisions each leave status can take (AUT-39): decided leave can't be decided again. */
const LEAVE_MOVES: Record<string, Array<'approved' | 'rejected' | 'cancelled'>> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: [],
};

/**
 * Approve, reject or cancel a leave request. With a leave approval chain turned on (Approvals → chains),
 * approve/reject act on the chain and the leave is decided when the chain finishes.
 */
export async function decideLeave(
  id: string,
  workspaceId: string | null | undefined,
  status: 'approved' | 'rejected' | 'cancelled',
  userId?: string,
  /** Refuse a request someone has already decided. */
  onlyPending = false,
  reach: Reach = null,
  permissions?: string[]
) {
  const orgId = requireWorkspaceId(workspaceId);
  if (await isApprovalChainEnabled(orgId, 'leave')) {
    const leave = await HrmsLeaveRequest.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('employeeId status').lean();
    if (!leave || !reaches(reach, leave.employeeId)) throw new ApiError(404, 'Leave request not found');
    if (status === 'cancelled') {
      await cancelForRecord(orgId, 'leave', id, userId, 'Leave cancelled');
    } else if (leave.status === 'pending') {
      if (!userId) throw new ApiError(401, 'Authentication required');
      await decideForRecord(orgId, 'leave', id, { userId, permissions }, status === 'approved' ? 'approve' : 'reject');
      return HrmsLeaveRequest.findById(id).populate('employeeId', 'name employeeCode department').lean();
    }
  }
  return applyLeaveDecision(id, orgId, status, userId, onlyPending, reach);
}

/** Write a leave decision and its balance effect. Used directly by the approval engine. */
export async function applyLeaveDecision(
  id: string,
  workspaceId: string | null | undefined,
  status: 'approved' | 'rejected' | 'cancelled',
  userId?: string,
  /** Refuse a request someone has already decided. */
  onlyPending = false,
  reach: Reach = null
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!['approved', 'rejected', 'cancelled'].includes(status)) throw new ApiError(400, 'Status must be approved, rejected or cancelled');
  const leave = await HrmsLeaveRequest.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!leave || !reaches(reach, leave.employeeId)) throw new ApiError(404, 'Leave request not found');
  const wasApproved = leave.status === 'approved';
  // Nobody approves or rejects their own leave, whatever their permissions (they may still cancel it).
  if (status !== 'cancelled' && userId) {
    const owner = await HrmsEmployee.findById(leave.employeeId).select('userId').lean();
    if (owner?.userId && String(owner.userId) === String(userId)) throw new ApiError(403, 'You cannot approve or reject your own leave');
  }
  const from = onlyPending ? ['pending'] : Object.keys(LEAVE_MOVES).filter((k) => LEAVE_MOVES[k].includes(status));
  // Decided once: the move is checked and written in one step, so two people deciding at once can't both win.
  const won = await HrmsLeaveRequest.updateOne(
    { _id: leave._id, status: { $in: from } },
    { $set: { status, decidedBy: userId, decidedAt: new Date() } }
  );
  if (!won.modifiedCount) {
    throw new ApiError(409, leave.status === 'pending' ? 'This request has just been decided by someone else' : `This request is already ${leave.status} and can't be ${status === 'cancelled' ? 'cancelled' : status}`);
  }
  leave.status = status;

  // Typed leave: per-type ledger. Legacy requests keep the old single balance.
  if (leave.leaveTypeId) {
    if (status === 'approved' && !wasApproved) await applyLeaveUsage(leave, 1);
    if (status !== 'approved' && wasApproved) await applyLeaveUsage(leave, -1);
  } else if (leave.type !== 'unpaid') {
    const employee = await HrmsEmployee.findById(leave.employeeId);
    if (employee) {
      if (status === 'approved' && !wasApproved) employee.leaveBalanceDays -= leave.days;
      if (status !== 'approved' && wasApproved) employee.leaveBalanceDays += leave.days;
      await employee.save();
    }
  }
  if (status !== 'cancelled') {
    const person = await HrmsEmployee.findById(leave.employeeId).select('userId').lean();
    if (person?.userId && String(person.userId) !== userId) {
      void notifyUser({
        userId: String(person.userId),
        eventKey: 'approval_decided',
        title: `Leave ${status}`,
        body: `${leave.days} day(s) from ${leave.startDate.toDateString()}`,
        link: '/me?tab=leave',
      }).catch(() => undefined);
    }
  }
  return HrmsLeaveRequest.findById(leave._id).populate('employeeId', 'name employeeCode department').lean();
}

// ── Attendance ──────────────────────────────────────────────────────────────

export async function listAttendance(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string; employeeId?: string } = {},
  reach: Reach = null
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId), ...employeeFilter(reach, 'employeeId') };
  if (query.employeeId) {
    if (!reaches(reach, query.employeeId)) return [];
    filter.employeeId = query.employeeId;
  }
  const from = asDate(query.from);
  const to = asDate(query.to);
  if (from || to) {
    filter.date = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }
  return HrmsAttendance.find(filter).populate('employeeId', 'name employeeCode department').sort({ date: -1 }).limit(500).lean();
}

function attendanceFields(input: Record<string, unknown>) {
  const status = String(input.status ?? 'present');
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) throw new ApiError(400, `Status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`);
  const hours = input.hoursWorked === undefined || input.hoursWorked === '' ? (status === 'half_day' ? 4 : status === 'absent' || status === 'holiday' ? 0 : 8) : Number(input.hoursWorked);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new ApiError(400, 'Hours must be between 0 and 24');
  return { status: status as (typeof ATTENDANCE_STATUSES)[number], hoursWorked: hours, note: input.note ? String(input.note).slice(0, 300) : undefined };
}

export async function markAttendance(workspaceId: string | null | undefined, input: Record<string, unknown>, reach: Reach = null) {
  assertReaches(reach, input.employeeId);
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const employee = await HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const date = input.date ? attendanceDay(input.date) : attendanceDay(new Date().toISOString().slice(0, 10));
  return HrmsAttendance.findOneAndUpdate(
    { taskflowOrganizationId: orgOid, employeeId: employee._id, date },
    { $set: attendanceFields(input) },
    { new: true, upsert: true }
  ).lean();
}

/** One day, one status, many people (e.g. everyone present, or an office closed). */
export async function markAttendanceBulk(workspaceId: string | null | undefined, input: Record<string, unknown>, reach: Reach = null) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  if (!input.date) throw new ApiError(400, 'Choose the date');
  const date = attendanceDay(input.date);
  const fields = attendanceFields(input);
  const wanted = Array.isArray(input.employeeIds) ? [...new Set(input.employeeIds.map(String))] : [];
  if (!wanted.length) throw new ApiError(400, 'Choose at least one employee');
  if (wanted.length > 1000) throw new ApiError(400, 'Up to 1000 people at a time');
  if (wanted.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, 'Unknown employee');
  if (!wanted.every((id) => reaches(reach, id))) throw new ApiError(400, 'Some of these people are not current employees of this workspace');
  const employees = await HrmsEmployee.find({ _id: { $in: wanted }, taskflowOrganizationId: orgOid, status: { $ne: 'terminated' } }).select('_id').lean();
  if (employees.length !== wanted.length) throw new ApiError(400, 'Some of these people are not current employees of this workspace');
  const res = await HrmsAttendance.bulkWrite(
    employees.map((e) => ({
      updateOne: { filter: { taskflowOrganizationId: orgOid, employeeId: e._id, date }, update: { $set: fields }, upsert: true },
    }))
  );
  return { marked: employees.length, created: res.upsertedCount, updated: res.modifiedCount };
}

// ── Dashboard / payroll ─────────────────────────────────────────────────────

export async function getHrmsDashboard(workspaceId: string | null | undefined, permissions: string[], reach: Reach = null) {
  const seePay = payAccessFor(permissions).see;
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [employees, pendingLeave, approvedThisMonth, attendanceMonth] = await Promise.all([
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, ...employeeFilter(reach) }).lean(),
    HrmsLeaveRequest.find({ taskflowOrganizationId: orgOid, status: 'pending', ...employeeFilter(reach, 'employeeId') })
      .populate('employeeId', 'name employeeCode')
      .sort({ startDate: 1 })
      .limit(10)
      .lean(),
    HrmsLeaveRequest.countDocuments({
      taskflowOrganizationId: orgOid,
      status: 'approved',
      startDate: { $gte: monthStart },
      ...employeeFilter(reach, 'employeeId'),
    }),
    HrmsAttendance.find({ taskflowOrganizationId: orgOid, date: { $gte: monthStart }, ...employeeFilter(reach, 'employeeId') }).lean(),
  ]);

  const active = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const headcount = employees.length;
  const monthlyPayroll =
    Math.round(active.reduce((s, e) => s + (e.annualCtc ?? 0) / 12, 0) * 100) / 100;

  const byDepartment = Object.entries(
    employees.reduce<Record<string, number>>((acc, e) => {
      const d = e.department || 'Unassigned';
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const byType = ['full_time', 'part_time', 'contract', 'intern'].map((t) => ({
    name: t.replace('_', ' '),
    value: employees.filter((e) => e.employmentType === t).length,
  }));

  const byStatus = ['active', 'probation', 'on_leave', 'terminated'].map((s) => ({
    name: s.replace('_', ' '),
    value: employees.filter((e) => e.status === s).length,
  }));

  const attendanceMix = ['present', 'remote', 'half_day', 'absent', 'holiday'].map((s) => ({
    name: s.replace('_', ' '),
    value: attendanceMonth.filter((a) => a.status === s).length,
  }));

  // headcount growth over last 6 months by joinedDate
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  let running = employees.filter((e) => new Date(e.joinedDate) < new Date(months[0] + '-01')).length;
  const headcountTrend = months.map((month) => {
    const joined = employees.filter((e) => new Date(e.joinedDate).toISOString().slice(0, 7) === month).length;
    const exited = employees.filter((e) => e.exitDate && new Date(e.exitDate).toISOString().slice(0, 7) === month).length;
    running += joined - exited;
    return { month, headcount: running, joined };
  });

  return {
    counts: {
      headcount,
      active: active.length,
      onLeave: employees.filter((e) => e.status === 'on_leave').length,
      pendingLeave: pendingLeave.length,
      approvedLeaveThisMonth: approvedThisMonth,
      departments: byDepartment.length,
    },
    monthlyPayroll: seePay ? monthlyPayroll : null,
    annualPayroll: !seePay ? null : Math.round(active.reduce((s, e) => s + (e.annualCtc ?? 0), 0) * 100) / 100,
    byDepartment,
    byType,
    byStatus,
    attendanceMix,
    headcountTrend,
    pendingLeaveRequests: pendingLeave,
  };
}

export async function getPayrollRun(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const employees = await HrmsEmployee.find({
    taskflowOrganizationId: toOrgOid(orgId),
    status: { $in: ['active', 'probation', 'on_leave'] },
  })
    .sort({ department: 1, name: 1 })
    .lean();
  const rows = employees.map((e) => ({
    _id: String(e._id),
    name: e.name,
    employeeCode: e.employeeCode,
    department: e.department,
    designation: e.designation,
    currency: e.currency,
    monthly: Math.round(((e.annualCtc ?? 0) / 12) * 100) / 100,
    annualCtc: e.annualCtc ?? 0,
  }));
  const total = Math.round(rows.reduce((s, r) => s + r.monthly, 0) * 100) / 100;
  return { rows, total, count: rows.length };
}
