import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function daysBetween(start: Date, end: Date): number {
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}

// ── Employees ───────────────────────────────────────────────────────────────

export async function listEmployees(
  workspaceId: string | null | undefined,
  query: { status?: string; department?: string; search?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.department) filter.department = query.department;
  if (query.search) filter.name = new RegExp(query.search, 'i');
  return HrmsEmployee.find(filter).sort({ name: 1 }).lean();
}

export async function createEmployee(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.name || !String(input.name).trim()) throw new ApiError(400, 'Name is required');
  const code = input.employeeCode
    ? String(input.employeeCode).trim()
    : `EMP-${String((await HrmsEmployee.countDocuments({ taskflowOrganizationId: orgOid })) + 1).padStart(4, '0')}`;
  try {
    const doc = await HrmsEmployee.create({
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
      annualCtc: Number(input.annualCtc ?? 0),
      currency: input.currency ?? 'USD',
      leaveBalanceDays: Number(input.leaveBalanceDays ?? 20),
      notes: input.notes,
    });
    return doc.toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'Employee code already exists');
    throw err;
  }
}

export async function updateEmployee(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const existing = await HrmsEmployee.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!existing) throw new ApiError(404, 'Employee not found');
  const fields = [
    'name', 'email', 'phone', 'department', 'designation', 'managerId', 'employmentType',
    'status', 'location', 'annualCtc', 'currency', 'leaveBalanceDays', 'notes', 'userId',
  ] as const;
  for (const key of fields) {
    if (!(key in input)) continue;
    const val = input[key];
    if (key === 'annualCtc' || key === 'leaveBalanceDays') {
      (existing as unknown as Record<string, unknown>)[key] = Number(val);
    } else {
      (existing as unknown as Record<string, unknown>)[key] = val === '' ? undefined : val;
    }
  }
  if ('joinedDate' in input) existing.joinedDate = asDate(input.joinedDate) ?? existing.joinedDate;
  if ('exitDate' in input) existing.exitDate = asDate(input.exitDate);
  await existing.save();
  return existing.toObject();
}

export async function deleteEmployee(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await HrmsEmployee.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Employee not found');
  return { deleted: true };
}

// ── Leave ─────────────────────────────────────────────────────────────────

export async function listLeave(
  workspaceId: string | null | undefined,
  query: { status?: string; employeeId?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.status) filter.status = query.status;
  if (query.employeeId) filter.employeeId = query.employeeId;
  return HrmsLeaveRequest.find(filter).populate('employeeId', 'name employeeCode department').sort({ createdAt: -1 }).lean();
}

export async function createLeave(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const employee = await HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const start = asDate(input.startDate);
  const end = asDate(input.endDate);
  if (!start || !end) throw new ApiError(400, 'Start and end dates are required');
  const days = input.days != null ? Number(input.days) : daysBetween(start, end);
  const doc = await HrmsLeaveRequest.create({
    taskflowOrganizationId: orgOid,
    employeeId: employee._id,
    type: input.type ?? 'annual',
    status: 'pending',
    startDate: start,
    endDate: end,
    days,
    reason: input.reason,
  });
  return HrmsLeaveRequest.findById(doc._id).populate('employeeId', 'name employeeCode department').lean();
}

export async function decideLeave(
  id: string,
  workspaceId: string | null | undefined,
  status: 'approved' | 'rejected' | 'cancelled',
  userId?: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const leave = await HrmsLeaveRequest.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!leave) throw new ApiError(404, 'Leave request not found');
  const wasApproved = leave.status === 'approved';
  leave.status = status;
  leave.decidedBy = userId as never;
  leave.decidedAt = new Date();
  await leave.save();

  // Adjust leave balance for paid types on approval / reversal
  if (leave.type !== 'unpaid') {
    const employee = await HrmsEmployee.findById(leave.employeeId);
    if (employee) {
      if (status === 'approved' && !wasApproved) employee.leaveBalanceDays -= leave.days;
      if (status !== 'approved' && wasApproved) employee.leaveBalanceDays += leave.days;
      await employee.save();
    }
  }
  return HrmsLeaveRequest.findById(leave._id).populate('employeeId', 'name employeeCode department').lean();
}

// ── Attendance ──────────────────────────────────────────────────────────────

export async function listAttendance(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string; employeeId?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.employeeId) filter.employeeId = query.employeeId;
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

export async function markAttendance(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const employee = await HrmsEmployee.findOne({ _id: input.employeeId, taskflowOrganizationId: orgOid });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const date = asDate(input.date) ?? new Date();
  date.setHours(0, 0, 0, 0);
  const doc = await HrmsAttendance.findOneAndUpdate(
    { taskflowOrganizationId: orgOid, employeeId: employee._id, date },
    {
      $set: {
        status: input.status ?? 'present',
        hoursWorked: Number(input.hoursWorked ?? 8),
        note: input.note,
      },
    },
    { new: true, upsert: true }
  ).lean();
  return doc;
}

// ── Dashboard / payroll ─────────────────────────────────────────────────────

export async function getHrmsDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [employees, pendingLeave, approvedThisMonth, attendanceMonth] = await Promise.all([
    HrmsEmployee.find({ taskflowOrganizationId: orgOid }).lean(),
    HrmsLeaveRequest.find({ taskflowOrganizationId: orgOid, status: 'pending' })
      .populate('employeeId', 'name employeeCode')
      .sort({ startDate: 1 })
      .limit(10)
      .lean(),
    HrmsLeaveRequest.countDocuments({
      taskflowOrganizationId: orgOid,
      status: 'approved',
      startDate: { $gte: monthStart },
    }),
    HrmsAttendance.find({ taskflowOrganizationId: orgOid, date: { $gte: monthStart } }).lean(),
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
    monthlyPayroll,
    annualPayroll: Math.round(active.reduce((s, e) => s + (e.annualCtc ?? 0), 0) * 100) / 100,
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
