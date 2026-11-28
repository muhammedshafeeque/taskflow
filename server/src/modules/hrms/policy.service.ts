import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsHoliday, HrmsLeaveLedger, HrmsLeaveType, HrmsSettings } from './models/hrmsPolicy.model';
import { CODE_PREFIX_PATTERN, employeeCodeSettings, setNextEmployeeNumber } from './employeeCode';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Settings ─────────────────────────────────────────────────────────────

export async function getHrSettings(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  return (
    doc ?? {
      taskflowOrganizationId: orgOid,
      weekendDays: [0, 6],
      leaveYearStartMonth: 1,
      recruitmentStages: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'],
      levels: ['Intern', 'Junior', 'Senior', 'Lead', 'Manager'],
      jobChangeNeedsApproval: true,
      leaveApproverUserIds: [],
      standardHoursPerDay: 8,
      workingDaysPerYear: 260,
      requireAcceptedOffer: false,
      offerLetterTemplate: '',
      careersPageEnabled: false,
      careersIntro: '',
      employeeCodePrefix: 'EMP-',
      employeeCodeDigits: 4,
    }
  );
}

/** HR settings as the settings screen shows them, with the next automatic employee code (AUT-40). */
export async function getHrSettingsForEditing(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const codes = await employeeCodeSettings(orgOid);
  const { employeeCodeLastNumber: _counter, ...settings } = (await getHrSettings(workspaceId)) as Record<string, unknown>;
  return { ...settings, ...codes };
}

/** Cost of one hour of an employee's time (explicit rate, else CTC / standard hours). */
export function hourlyCost(
  employee: { hourlyCostRate?: number | null; annualCtc?: number | null },
  settings: { standardHoursPerDay?: number; workingDaysPerYear?: number }
): number {
  if (employee.hourlyCostRate && employee.hourlyCostRate > 0) return employee.hourlyCostRate;
  const hours = (settings.workingDaysPerYear ?? 260) * (settings.standardHoursPerDay ?? 8);
  return hours > 0 ? round2((employee.annualCtc ?? 0) / hours) : 0;
}

export async function updateHrSettings(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const $set: Record<string, unknown> = {};
  if (Array.isArray(input.weekendDays)) {
    $set.weekendDays = [...new Set(input.weekendDays.map(Number).filter((d) => d >= 0 && d <= 6))];
  }
  if (input.leaveYearStartMonth !== undefined) {
    const m = Number(input.leaveYearStartMonth);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new ApiError(400, 'leaveYearStartMonth must be 1–12');
    $set.leaveYearStartMonth = m;
  }
  if (Array.isArray(input.levels)) {
    const levels = [...new Set(input.levels.map((s) => String(s).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
    if (!levels.length) throw new ApiError(400, 'Add at least one level');
    $set.levels = levels;
  }
  if (input.jobChangeNeedsApproval !== undefined) $set.jobChangeNeedsApproval = Boolean(input.jobChangeNeedsApproval);
  if (Array.isArray(input.recruitmentStages)) {
    const stages = input.recruitmentStages.map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
    if (stages.length < 2) throw new ApiError(400, 'Add at least two recruitment stages');
    $set.recruitmentStages = stages;
  }
  if (input.timesheetReminderWeekday !== undefined) {
    const d = input.timesheetReminderWeekday;
    $set.timesheetReminderWeekday = d === null || d === '' ? null : Math.min(6, Math.max(0, Number(d)));
  }
  if (input.expectedWeeklyHours !== undefined) $set.expectedWeeklyHours = Math.min(80, Math.max(1, Number(input.expectedWeeklyHours) || 40));
  if (input.standardHoursPerDay !== undefined) $set.standardHoursPerDay = Math.min(24, Math.max(1, Number(input.standardHoursPerDay) || 8));
  if (input.workingDaysPerYear !== undefined) $set.workingDaysPerYear = Math.min(366, Math.max(100, Number(input.workingDaysPerYear) || 260));
  if (Array.isArray(input.leaveApproverUserIds)) {
    $set.leaveApproverUserIds = input.leaveApproverUserIds
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
  }
  if (input.requireAcceptedOffer !== undefined) $set.requireAcceptedOffer = Boolean(input.requireAcceptedOffer);
  if (input.careersPageEnabled !== undefined) $set.careersPageEnabled = Boolean(input.careersPageEnabled);
  if (typeof input.offerLetterTemplate === 'string') $set.offerLetterTemplate = input.offerLetterTemplate.slice(0, 20_000);
  if (typeof input.careersIntro === 'string') $set.careersIntro = input.careersIntro.slice(0, 2_000);
  if (input.employeeCodePrefix !== undefined) {
    const prefix = String(input.employeeCodePrefix ?? '').trim();
    if (!CODE_PREFIX_PATTERN.test(prefix)) throw new ApiError(400, 'Employee code prefix can be up to 20 letters, digits, or - _ / .');
    $set.employeeCodePrefix = prefix;
  }
  if (input.employeeCodeDigits !== undefined) {
    const d = Number(input.employeeCodeDigits);
    if (!Number.isInteger(d) || d < 1 || d > 9) throw new ApiError(400, 'Employee code digits must be 1–9');
    $set.employeeCodeDigits = d;
  }
  // Checked before saving anything else, so a refused number leaves the settings as they were.
  if (input.employeeCodeNextNumber !== undefined && input.employeeCodeNextNumber !== null && input.employeeCodeNextNumber !== '') {
    await setNextEmployeeNumber(orgOid, input.employeeCodeNextNumber);
  }
  await HrmsSettings.findOneAndUpdate({ taskflowOrganizationId: orgOid }, { $set }, { upsert: true, new: true });
  return getHrSettingsForEditing(workspaceId);
}

// ── Leave types ──────────────────────────────────────────────────────────

export async function listLeaveTypes(workspaceId: string | null | undefined, activeOnly = false) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  return HrmsLeaveType.find({ taskflowOrganizationId: orgOid, ...(activeOnly ? { active: true } : {}) }).sort({ name: 1 }).lean();
}

export async function upsertLeaveType(workspaceId: string | null | undefined, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const name = String(input.name ?? '').trim();
  if (!id && !name) throw new ApiError(400, 'Name is required');
  const data: Record<string, unknown> = {};
  if (name) data.name = name.slice(0, 60);
  if (input.code !== undefined || !id) {
    data.code = String(input.code ?? name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  }
  for (const k of ['paid', 'allowNegative', 'active'] as const) if (typeof input[k] === 'boolean') data[k] = input[k];
  for (const k of ['annualAllowance', 'carryForwardMax'] as const) {
    if (input[k] !== undefined) {
      const n = Number(input[k]);
      if (!Number.isFinite(n) || n < 0 || n > 366) throw new ApiError(400, `${k} must be 0–366`);
      data[k] = n;
    }
  }
  if (input.accrual === 'yearly' || input.accrual === 'monthly') data.accrual = input.accrual;
  if (typeof input.color === 'string') data.color = input.color.slice(0, 20);
  try {
    if (id) {
      const doc = await HrmsLeaveType.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true }).lean();
      if (!doc) throw new ApiError(404, 'Leave type not found');
      return doc;
    }
    return (await HrmsLeaveType.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'A leave type with that code already exists');
    throw err;
  }
}

// ── Holidays & working days ──────────────────────────────────────────────

export async function listHolidays(workspaceId: string | null | undefined, year?: number) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (year) filter.date = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
  return HrmsHoliday.find(filter).sort({ date: 1 }).lean();
}

export async function createHoliday(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const date = new Date(String(input.date ?? ''));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Valid date required');
  if (!String(input.name ?? '').trim()) throw new ApiError(400, 'Name required');
  return (
    await HrmsHoliday.create({
      taskflowOrganizationId: orgOid,
      date,
      name: String(input.name).trim().slice(0, 80),
      optional: Boolean(input.optional),
      location: input.location ? String(input.location).slice(0, 60) : undefined,
    })
  ).toObject();
}

export async function deleteHoliday(workspaceId: string | null | undefined, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  await HrmsHoliday.deleteOne({ _id: id, taskflowOrganizationId: orgOid });
  return { ok: true };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Working days between two dates (inclusive), skipping weekends and mandatory holidays. */
export function countWorkingDays(start: Date, end: Date, weekendDays: number[], holidayKeys: Set<string>, halfDay = false): number {
  if (end < start) return 0;
  let days = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= last) {
    if (!weekendDays.includes(cur.getUTCDay()) && !holidayKeys.has(dayKey(cur))) days++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return halfDay && days === 1 ? 0.5 : days;
}

export async function workingDaysFor(orgOid: mongoose.Types.ObjectId, start: Date, end: Date, location?: string, halfDay = false) {
  const settings = await getHrSettings(String(orgOid));
  const holidays = await HrmsHoliday.find({
    taskflowOrganizationId: orgOid,
    optional: false,
    date: { $gte: new Date(start.getTime() - 86_400_000), $lte: new Date(end.getTime() + 86_400_000) },
    $or: [{ location: null }, { location: '' }, ...(location ? [{ location }] : [])],
  })
    .select('date')
    .lean();
  return countWorkingDays(start, end, settings.weekendDays ?? [0, 6], new Set(holidays.map((h) => dayKey(new Date(h.date)))), halfDay);
}

// ── Balances ─────────────────────────────────────────────────────────────

/** Leave year (labelled by the calendar year it starts in) that contains `date`. */
export function leaveYearOf(date: Date, startMonth: number): number {
  const m = date.getUTCMonth() + 1;
  return m >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** Allocation available so far this leave year (pure, for tests). */
export function accruedAllocation(
  type: { annualAllowance: number; accrual: string },
  now: Date,
  yearStart: Date,
  joinedDate?: Date
): number {
  const effectiveStart = joinedDate && joinedDate > yearStart ? joinedDate : yearStart;
  if (type.accrual === 'monthly') {
    const months =
      (now.getUTCFullYear() - effectiveStart.getUTCFullYear()) * 12 + (now.getUTCMonth() - effectiveStart.getUTCMonth()) + 1;
    return round2(Math.min(12, Math.max(0, months)) * (type.annualAllowance / 12));
  }
  // Yearly: pro-rate the first year for people who joined mid-year.
  const monthsInYear = 12 - ((effectiveStart.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 + (effectiveStart.getUTCMonth() - yearStart.getUTCMonth()));
  return round2((type.annualAllowance * Math.min(12, Math.max(0, monthsInYear))) / 12);
}

export async function getBalances(workspaceId: string | null | undefined, employeeId: string, now = new Date()) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const [settings, types, employee] = await Promise.all([
    getHrSettings(String(orgOid)),
    HrmsLeaveType.find({ taskflowOrganizationId: orgOid, active: true }).sort({ name: 1 }).lean(),
    HrmsEmployee.findOne({ _id: employeeId, taskflowOrganizationId: orgOid }).select('joinedDate').lean(),
  ]);
  if (!employee) throw new ApiError(404, 'Employee not found');
  const startMonth = settings.leaveYearStartMonth ?? 1;
  const year = leaveYearOf(now, startMonth);
  const yearStart = new Date(Date.UTC(year, startMonth - 1, 1));
  const ledgers = await HrmsLeaveLedger.find({ employeeId, year }).lean();
  return types.map((t) => {
    const l = ledgers.find((x) => String(x.leaveTypeId) === String(t._id));
    const allocated = t.paid ? accruedAllocation(t, now, yearStart, employee.joinedDate) : 0;
    const used = l?.used ?? 0;
    const available = t.paid ? round2(allocated + (l?.carriedForward ?? 0) + (l?.adjustment ?? 0) - used) : null;
    return {
      leaveTypeId: String(t._id),
      name: t.name,
      code: t.code,
      paid: t.paid,
      color: t.color,
      year,
      allocated,
      carriedForward: l?.carriedForward ?? 0,
      adjustment: l?.adjustment ?? 0,
      used,
      available,
      allowNegative: t.allowNegative,
    };
  });
}

export async function adjustBalance(
  workspaceId: string | null | undefined,
  employeeId: string,
  leaveTypeId: string,
  delta: number
) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const settings = await getHrSettings(String(orgOid));
  const year = leaveYearOf(new Date(), settings.leaveYearStartMonth ?? 1);
  if (!Number.isFinite(delta)) throw new ApiError(400, 'Invalid adjustment');
  await HrmsLeaveLedger.updateOne(
    { employeeId, leaveTypeId, year },
    { $inc: { adjustment: delta }, $setOnInsert: { taskflowOrganizationId: orgOid } },
    { upsert: true }
  );
  return getBalances(String(orgOid), employeeId);
}

/**
 * How a leave's days fall across leave years (AUT-39). Leave from 28 Dec to 3 Jan with a January leave
 * year is charged partly to each year, by the working days in each part. The days asked for (which HR
 * may have set by hand, or a half day) are shared in proportion and rounded to half days.
 */
export async function splitByLeaveYear(
  orgOid: mongoose.Types.ObjectId,
  start: Date,
  end: Date,
  days: number,
  location?: string
): Promise<Array<{ year: number; days: number; from: Date }>> {
  const settings = await getHrSettings(String(orgOid));
  const startMonth = settings.leaveYearStartMonth ?? 1;
  const parts: Array<{ year: number; from: Date; to: Date }> = [];
  let from = new Date(start);
  for (let guard = 0; guard < 5; guard++) {
    const year = leaveYearOf(from, startMonth);
    const nextYearStart = new Date(Date.UTC(year + 1, startMonth - 1, 1));
    if (end < nextYearStart) {
      parts.push({ year, from, to: end });
      break;
    }
    parts.push({ year, from, to: new Date(nextYearStart.getTime() - 86_400_000) });
    from = nextYearStart;
  }
  if (parts.length === 1) return [{ year: parts[0].year, days, from: parts[0].from }];
  const weights = await Promise.all(parts.map((p) => workingDaysFor(orgOid, p.from, p.to, location)));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Array<{ year: number; days: number; from: Date }> = [];
  let left = days;
  parts.forEach((p, i) => {
    const share = i === parts.length - 1 ? left : total > 0 ? Math.round(((days * weights[i]) / total) * 2) / 2 : 0;
    const d = Math.min(left, Math.max(0, share));
    left = round2(left - d);
    if (d > 0) out.push({ year: p.year, days: d, from: p.from });
  });
  return out;
}

/** Record usage when a leave request is approved (or reverse it when cancelled). */
export async function applyLeaveUsage(leave: {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  employeeId: mongoose.Types.ObjectId;
  leaveTypeId?: mongoose.Types.ObjectId | null;
  startDate: Date;
  days: number;
  yearSplit?: Array<{ year: number; days: number }> | null;
}, sign: 1 | -1) {
  if (!leave.leaveTypeId) return;
  const type = await HrmsLeaveType.findById(leave.leaveTypeId).select('paid').lean();
  if (!type?.paid) return;
  // The split saved when the leave was requested is used both ways, so cancelling undoes exactly what approving did.
  let parts = leave.yearSplit?.length ? leave.yearSplit : null;
  if (!parts) {
    const settings = await getHrSettings(String(leave.taskflowOrganizationId));
    parts = [{ year: leaveYearOf(new Date(leave.startDate), settings.leaveYearStartMonth ?? 1), days: leave.days }];
  }
  for (const p of parts) {
    await HrmsLeaveLedger.updateOne(
      { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year: p.year },
      { $inc: { used: sign * p.days }, $setOnInsert: { taskflowOrganizationId: leave.taskflowOrganizationId } },
      { upsert: true }
    );
  }
}

/** Roll unused days into the new leave year (run once per year; safe to re-run). */
export async function carryForward(workspaceId: string | null | undefined, fromYear: number) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const types = await HrmsLeaveType.find({ taskflowOrganizationId: orgOid, paid: true, carryForwardMax: { $gt: 0 } }).lean();
  const employees = await HrmsEmployee.find({ taskflowOrganizationId: orgOid, status: { $ne: 'terminated' } }).select('_id').lean();
  const settings = await getHrSettings(String(orgOid));
  const yearEnd = new Date(Date.UTC(fromYear + 1, (settings.leaveYearStartMonth ?? 1) - 1, 1) - 86_400_000);
  let updated = 0;
  for (const e of employees) {
    const balances = await getBalances(String(orgOid), String(e._id), yearEnd);
    for (const t of types) {
      const b = balances.find((x) => x.leaveTypeId === String(t._id));
      const carry = Math.min(t.carryForwardMax, Math.max(0, b?.available ?? 0));
      await HrmsLeaveLedger.updateOne(
        { employeeId: e._id, leaveTypeId: t._id, year: fromYear + 1 },
        { $set: { carriedForward: carry }, $setOnInsert: { taskflowOrganizationId: orgOid } },
        { upsert: true }
      );
      updated++;
    }
  }
  return { updated };
}
