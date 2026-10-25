/**
 * Employee 360: one person's assigned work, allocations and capacity, timesheet,
 * leave, attendance, payroll and skills. A section is filled only when the viewer
 * holds its permission — or is looking at themselves (payslips still need the
 * self-service payslip permission). Otherwise it is null.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsAttendance } from '../hrms/models/hrmsAttendance.model';
import { HrmsPayrollRun } from '../hrms/models/hrmsPayroll.model';
import { ResourceAllocation } from '../resources/models/resourceAllocation.model';
import { ResourceProfile } from '../resources/models/resourceProfile.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { WorkLog } from '../workLogs/workLog.model';
import { TimesheetSubmission } from '../workLogs/timesheetApproval';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { GraphAccess } from '../links/links.service';

const P = TASK_FLOW_PERMISSIONS.TASKFLOW;
const DAY = 86_400_000;
const WEEKS_OF_TIMESHEET = 4;
const LEAVE_LOOKAHEAD_DAYS = 30;

const SECTION_PERMS = {
  allocations: [P.RESOURCES.ALLOCATION.READ, P.RESOURCES.ALLOCATION.MANAGE],
  timesheet: [P.TIMESHEET.APPROVE],
  leave: [P.HR.LEAVE.READ, P.HR.LEAVE.MANAGE],
  attendance: [P.HR.ATTENDANCE.READ, P.HR.ATTENDANCE.MANAGE],
  payroll: [P.HR.PAYROLL.READ, P.HR.PAYROLL.MANAGE],
} as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const hours = (minutes: number) => round1(minutes / 60);

/** Monday 00:00 UTC of the week containing `t`. */
export function weekStart(t: number): Date {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export type EmployeeFlag = { level: 'red' | 'amber'; area: string; text: string };

/** `id` is an employee id, or "me" for the viewer's own employee record. */
export async function getEmployee360(access: GraphAccess, id: string) {
  const viewerId = access.viewer.userId;
  const filter =
    id === 'me'
      ? { taskflowOrganizationId: access.orgOid, userId: new mongoose.Types.ObjectId(viewerId) }
      : mongoose.Types.ObjectId.isValid(id)
        ? { taskflowOrganizationId: access.orgOid, _id: new mongoose.Types.ObjectId(id) }
        : null;
  const employee = filter ? await HrmsEmployee.findOne(filter).lean() : null;
  if (!employee) throw new ApiError(404, id === 'me' ? 'You have no employee record in this workspace' : 'Employee not found');

  const isSelf = Boolean(employee.userId && String(employee.userId) === viewerId);
  if (!isSelf && !(await access.canSeeType('employee'))) throw new ApiError(404, 'Employee not found');

  const perms = access.viewer.permissions;
  const allowed = async (section: keyof typeof SECTION_PERMS) => {
    const module = section === 'allocations' ? 'resources' : section === 'timesheet' ? 'pm' : 'hrms';
    if (isSelf) return access.can(module, []);
    return access.can(module, [...SECTION_PERMS[section]]);
  };
  const [canAlloc, canTime, canLeave, canAttend, canPayrollSection] = await Promise.all([
    allowed('allocations'),
    allowed('timesheet'),
    allowed('leave'),
    allowed('attendance'),
    allowed('payroll'),
  ]);
  const payrollReader = SECTION_PERMS.payroll.some((p) => userHasPermission(perms, p));
  const canPayroll = canPayrollSection && (!isSelf || payrollReader || userHasPermission(perms, P.SELF.PAYSLIP.READ));

  const now = Date.now();
  const userOid = employee.userId ? new mongoose.Types.ObjectId(String(employee.userId)) : null;
  const empOid = employee._id as mongoose.Types.ObjectId;

  const [manager, reports, profile, work, allocations, timesheet, leave, attendance, payroll] = await Promise.all([
    employee.managerId
      ? HrmsEmployee.findOne({ _id: employee.managerId, taskflowOrganizationId: access.orgOid }).select('name designation').lean()
      : null,
    HrmsEmployee.find({ taskflowOrganizationId: access.orgOid, managerId: empOid, status: { $ne: 'terminated' } })
      .select('name designation')
      .sort({ name: 1 })
      .lean(),
    userOid ? ResourceProfile.findOne({ taskflowOrganizationId: access.orgOid, userId: userOid }).lean() : null,
    userOid ? loadWork(access, userOid, now) : emptyWork(),
    canAlloc && userOid ? loadAllocations(access, userOid, now) : null,
    canTime && userOid ? loadTimesheet(access, userOid, now) : null,
    canLeave ? loadLeave(access.orgOid, empOid, employee.leaveBalanceDays, now) : null,
    canAttend ? loadAttendance(access.orgOid, empOid, now) : null,
    canPayroll ? loadPayroll(access.orgOid, empOid, payrollReader) : null,
  ]);

  const capacityHours = profile?.capacityHoursPerWeek ?? 40;
  const flags: EmployeeFlag[] = [];
  if (allocations && allocations.currentPercent > 100) {
    flags.push({ level: 'red', area: 'allocations', text: `Allocated ${allocations.currentPercent}% right now` });
  }
  if (leave?.onLeaveNow) flags.push({ level: 'amber', area: 'leave', text: `On leave until ${leave.onLeaveNow.endDate.toISOString().slice(0, 10)}` });
  if (leave && leave.upcoming.length && work.summary.overdue + work.summary.dueSoon > 0) {
    const next = leave.upcoming[0];
    flags.push({
      level: 'amber',
      area: 'leave',
      text: `Leave from ${next.startDate.toISOString().slice(0, 10)} with ${work.summary.overdue + work.summary.dueSoon} open item${work.summary.overdue + work.summary.dueSoon === 1 ? '' : 's'} due`,
    });
  }
  if (work.summary.overdue) flags.push({ level: 'amber', area: 'work', text: `${work.summary.overdue} overdue issue${work.summary.overdue === 1 ? '' : 's'}` });
  if (timesheet && timesheet.lastWeek.loggedHours > 0 && !timesheet.lastWeek.submitted) {
    flags.push({ level: 'amber', area: 'timesheet', text: 'Last week’s timesheet is not submitted' });
  }
  if (timesheet && timesheet.lastWeek.loggedHours > capacityHours * 1.2) {
    flags.push({ level: 'amber', area: 'timesheet', text: `Logged ${timesheet.lastWeek.loggedHours}h last week (capacity ${capacityHours}h)` });
  }
  if (leave?.pending.length && !isSelf) {
    flags.push({ level: 'amber', area: 'leave', text: `${leave.pending.length} leave request${leave.pending.length === 1 ? '' : 's'} awaiting a decision` });
  }

  return {
    isSelf,
    employee: {
      id: String(employee._id),
      userId: employee.userId ? String(employee.userId) : null,
      name: employee.name,
      employeeCode: employee.employeeCode,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      designation: employee.designation,
      employmentType: employee.employmentType,
      status: employee.status,
      joinedDate: employee.joinedDate,
      location: employee.location,
      manager: manager ? { id: String(manager._id), name: manager.name, designation: manager.designation } : null,
      reports: reports.map((r) => ({ id: String(r._id), name: r.name, designation: r.designation })),
    },
    profile: {
      skills: profile?.skills ?? [],
      seniority: profile?.seniority,
      capacityHoursPerWeek: capacityHours,
      availableFrom: profile?.availableFrom ?? null,
    },
    flags,
    work,
    allocations,
    timesheet,
    leave,
    attendance,
    payroll,
  };
}

function emptyWork() {
  return { summary: { open: 0, overdue: 0, dueSoon: 0, doneLast30: 0 }, items: [], hiddenProjects: 0 };
}

/** Assigned issues, limited to projects the viewer can open. */
async function loadWork(access: GraphAccess, userOid: mongoose.Types.ObjectId, now: number) {
  const projectIds = await Issue.find({ assignee: userOid }).distinct('project');
  const projects = await Project.find({ _id: { $in: projectIds }, taskflowOrganizationId: access.orgOid }).select('name key statuses').lean();
  const visible = [];
  for (const p of projects) if (await access.canSeeProject(p._id)) visible.push(p);
  if (!visible.length) return { ...emptyWork(), hiddenProjects: projects.length };

  const closedBy = visible.map((p) => ({ project: p._id, closed: getClosedStatusNamesFromStatuses(p.statuses) }));
  const open = { assignee: userOid, $or: closedBy.map((c) => ({ project: c.project, status: { $nin: c.closed } })) };
  const done = { assignee: userOid, $or: closedBy.map((c) => ({ project: c.project, status: { $in: c.closed } })) };
  const [openCount, overdue, dueSoon, doneLast30, rows] = await Promise.all([
    Issue.countDocuments(open),
    Issue.countDocuments({ ...open, dueDate: { $lt: new Date(now) } }),
    Issue.countDocuments({ ...open, dueDate: { $gte: new Date(now), $lt: new Date(now + 7 * DAY) } }),
    Issue.countDocuments({ ...done, updatedAt: { $gte: new Date(now - 30 * DAY) } }),
    Issue.find(open).select('key title status priority dueDate project').sort({ dueDate: 1, updatedAt: -1 }).limit(40).lean(),
  ]);
  const byId = new Map(visible.map((p) => [String(p._id), p]));
  const ordered = rows.filter((i) => i.dueDate).concat(rows.filter((i) => !i.dueDate)).slice(0, 15);
  return {
    summary: { open: openCount, overdue, dueSoon, doneLast30 },
    items: ordered.map((i) => ({
      id: String(i._id),
      key: i.key,
      title: i.title,
      status: i.status,
      priority: i.priority,
      dueDate: i.dueDate,
      overdue: Boolean(i.dueDate && new Date(i.dueDate).getTime() < now),
      projectId: String(i.project),
      projectKey: byId.get(String(i.project))?.key,
    })),
    hiddenProjects: projects.length - visible.length,
  };
}

async function loadAllocations(access: GraphAccess, userOid: mongoose.Types.ObjectId, now: number) {
  const rows = await ResourceAllocation.find({
    taskflowOrganizationId: access.orgOid,
    userId: userOid,
    $or: [{ endDate: null }, { endDate: { $gte: new Date(now) } }],
  })
    .populate('projectId', 'name key')
    .sort({ startDate: 1 })
    .lean();
  const isCurrent = (a: (typeof rows)[number]) => new Date(a.startDate).getTime() <= now;
  return {
    currentPercent: rows.filter(isCurrent).reduce((s, a) => s + a.percent, 0),
    items: rows.map((a) => {
      const project = a.projectId as unknown as { _id: unknown; name?: string; key?: string } | null;
      return {
        id: String(a._id),
        projectId: project ? String(project._id) : undefined,
        project: project?.name,
        projectKey: project?.key,
        percent: a.percent,
        startDate: a.startDate,
        endDate: a.endDate,
        billable: a.billable,
        softBooked: a.softBooked,
        role: a.roleLabel,
        current: isCurrent(a),
      };
    }),
  };
}

/** Hours by week for the last few weeks, split by project; projects the viewer can't open are grouped. */
async function loadTimesheet(access: GraphAccess, userOid: mongoose.Types.ObjectId, now: number) {
  const thisWeek = weekStart(now);
  const from = new Date(thisWeek.getTime() - (WEEKS_OF_TIMESHEET - 1) * 7 * DAY);
  const logs = await WorkLog.find({ author: userOid, date: { $gte: from } })
    .select('minutesSpent billable date issue approvalStatus')
    .populate('issue', 'project')
    .lean();
  const projectIds = [...new Set(logs.map((l) => String((l.issue as unknown as { project?: unknown } | null)?.project ?? '')).filter(Boolean))];
  const projects = await Project.find({ _id: { $in: projectIds }, taskflowOrganizationId: access.orgOid }).select('name key').lean();
  const inOrg = new Map(projects.map((p) => [String(p._id), p]));
  const visible = new Set<string>();
  for (const p of projects) if (await access.canSeeProject(p._id)) visible.add(String(p._id));

  const weeks = Array.from({ length: WEEKS_OF_TIMESHEET }, (_, i) => new Date(from.getTime() + i * 7 * DAY));
  const byWeek = weeks.map((w) => ({ weekStart: w, minutes: 0, billableMinutes: 0 }));
  const byProject = new Map<string, { projectId?: string; name: string; minutes: number }>();
  for (const l of logs) {
    const projectId = String((l.issue as unknown as { project?: unknown } | null)?.project ?? '');
    if (!inOrg.has(projectId)) continue;
    const idx = Math.floor((weekStart(new Date(l.date).getTime()).getTime() - from.getTime()) / (7 * DAY));
    if (idx >= 0 && idx < byWeek.length) {
      byWeek[idx].minutes += l.minutesSpent;
      if (l.billable) byWeek[idx].billableMinutes += l.minutesSpent;
    }
    const key = visible.has(projectId) ? projectId : 'other';
    const row = byProject.get(key) ?? {
      projectId: visible.has(projectId) ? projectId : undefined,
      name: visible.has(projectId) ? inOrg.get(projectId)!.name : 'Other projects',
      minutes: 0,
    };
    row.minutes += l.minutesSpent;
    byProject.set(key, row);
  }

  const submissions = await TimesheetSubmission.find({ userId: userOid, weekStart: { $gte: from } })
    .select('weekStart status')
    .lean();
  const statusOf = (w: Date) => submissions.find((s) => new Date(s.weekStart).getTime() === w.getTime())?.status as string | undefined;
  const lastWeek = byWeek[byWeek.length - 2];

  return {
    weeks: byWeek.map((w) => ({
      weekStart: w.weekStart,
      hours: hours(w.minutes),
      billableHours: hours(w.billableMinutes),
      submission: statusOf(w.weekStart) ?? null,
    })),
    projects: [...byProject.values()].sort((a, b) => b.minutes - a.minutes).map((p) => ({ ...p, hours: hours(p.minutes) })),
    lastWeek: { loggedHours: lastWeek ? hours(lastWeek.minutes) : 0, submitted: Boolean(lastWeek && statusOf(lastWeek.weekStart)) },
  };
}

async function loadLeave(orgOid: mongoose.Types.ObjectId, empOid: mongoose.Types.ObjectId, balance: number, now: number) {
  const rows = await HrmsLeaveRequest.find({ taskflowOrganizationId: orgOid, employeeId: empOid })
    .select('type status startDate endDate days halfDay reason')
    .sort({ startDate: -1 })
    .limit(30)
    .lean();
  const today = new Date(now);
  const approved = rows.filter((r) => r.status === 'approved');
  const onLeaveNow = approved.find((r) => r.startDate <= today && r.endDate >= today) ?? null;
  const upcoming = approved
    .filter((r) => r.startDate > today && r.startDate.getTime() < now + LEAVE_LOOKAHEAD_DAYS * DAY)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const shape = (r: (typeof rows)[number]) => ({
    id: String(r._id),
    type: r.type,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
  });
  return {
    balanceDays: balance,
    takenThisYear: approved.filter((r) => r.startDate >= yearStart && r.startDate <= today).reduce((s, r) => s + r.days, 0),
    onLeaveNow: onLeaveNow ? shape(onLeaveNow) : null,
    upcoming: upcoming.map(shape),
    pending: rows.filter((r) => r.status === 'pending').map(shape),
    recent: rows.slice(0, 8).map(shape),
  };
}

async function loadAttendance(orgOid: mongoose.Types.ObjectId, empOid: mongoose.Types.ObjectId, now: number) {
  const rows = await HrmsAttendance.find({ taskflowOrganizationId: orgOid, employeeId: empOid, date: { $gte: new Date(now - 30 * DAY) } })
    .select('date status hoursWorked')
    .sort({ date: -1 })
    .lean();
  const counts: Record<string, number> = { present: 0, remote: 0, absent: 0, half_day: 0, holiday: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    days: rows.length,
    counts,
    hours: round1(rows.reduce((s, r) => s + (r.hoursWorked ?? 0), 0)),
    recent: rows.slice(0, 10).map((r) => ({ date: r.date, status: r.status, hours: r.hoursWorked })),
  };
}

/** Recent payslips. Drafts and CTC are for payroll readers; people see their own finalized slips. */
async function loadPayroll(orgOid: mongoose.Types.ObjectId, empOid: mongoose.Types.ObjectId, payrollReader: boolean) {
  const runs = await HrmsPayrollRun.find({
    taskflowOrganizationId: orgOid,
    'payslips.employeeId': empOid,
    ...(payrollReader ? {} : { status: { $in: ['finalized', 'paid'] } }),
  })
    .select('period status paidAt payslips.$')
    .sort({ period: -1 })
    .limit(3)
    .lean();
  return {
    payslips: runs.map((r) => {
      const slip = (r.payslips?.[0] ?? {}) as { currency?: string; gross?: number; totalDeductions?: number; net?: number; lopDays?: number; monthlyCtc?: number };
      return {
        period: r.period,
        status: r.status,
        paidAt: r.paidAt,
        currency: slip.currency,
        gross: slip.gross,
        deductions: slip.totalDeductions,
        net: slip.net,
        lopDays: slip.lopDays,
        ...(payrollReader ? { monthlyCtc: slip.monthlyCtc } : {}),
      };
    }),
  };
}
