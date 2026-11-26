/** Days of pay lost in a month: absences and approved unpaid leave, each date counted once. */
import mongoose from 'mongoose';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsHoliday, HrmsLeaveType, HrmsSettings } from './models/hrmsPolicy.model';

const DAY = 86_400_000;
const HALF = 12 * 60 * 60 * 1000;

/**
 * The calendar day a stored date stands for. HR marks attendance at the server's local midnight and self-service
 * at UTC midnight; east of UTC the first lands on the previous UTC date. Noon of the stored instant is on the
 * intended day for any offset between UTC−12 and UTC+12.
 */
export function calendarDay(d: Date | string): string {
  return new Date(new Date(d).getTime() + HALF).toISOString().slice(0, 10);
}

export interface Absence {
  employeeId: string;
  date: Date | string;
  status: 'absent' | 'half_day';
}
export interface UnpaidLeave {
  employeeId: string;
  startDate: Date | string;
  endDate: Date | string;
  halfDay?: boolean;
}
export interface WorkCalendar {
  /** First day of the month and the first day after it, YYYY-MM-DD. */
  from: string;
  to: string;
  weekendDays: number[];
  /** Mandatory holidays that apply to this employee, YYYY-MM-DD. */
  holidaysFor: (employeeId: string) => Set<string>;
}

/**
 * Per employee, the share of each date that is unpaid (1 or ½) — the larger of attendance and leave on that date,
 * never their sum — added up over the month. Leave skips weekends and holidays, as its day count does.
 */
export function lossOfPayDays(absences: Absence[], leaves: UnpaidLeave[], cal: WorkCalendar): Map<string, number> {
  const byEmployee = new Map<string, Map<string, number>>();
  const mark = (employeeId: string, day: string, share: number) => {
    if (day < cal.from || day >= cal.to) return;
    const days = byEmployee.get(employeeId) ?? new Map<string, number>();
    days.set(day, Math.max(days.get(day) ?? 0, share));
    byEmployee.set(employeeId, days);
  };
  for (const a of absences) mark(String(a.employeeId), calendarDay(a.date), a.status === 'half_day' ? 0.5 : 1);
  for (const l of leaves) {
    const id = String(l.employeeId);
    const holidays = cal.holidaysFor(id);
    const first = calendarDay(l.startDate);
    const last = calendarDay(l.endDate);
    // A half day only means anything on a one-day request.
    const share = l.halfDay && first === last ? 0.5 : 1;
    for (let t = Date.parse(first); t <= Date.parse(last); t += DAY) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (cal.weekendDays.includes(new Date(t).getUTCDay()) || holidays.has(day)) continue;
      mark(id, day, share);
    }
  }
  return new Map([...byEmployee].map(([id, days]) => [id, [...days.values()].reduce((s, n) => s + n, 0)]));
}

/** Working days between two calendar days (inclusive), for one employee's location. */
export function workingDaysBetween(first: string, last: string, weekendDays: number[], holidays: Set<string>): number {
  let n = 0;
  for (let t = Date.parse(first); t <= Date.parse(last); t += DAY) {
    if (!weekendDays.includes(new Date(t).getUTCDay()) && !holidays.has(new Date(t).toISOString().slice(0, 10))) n++;
  }
  return n;
}

/** Weekends and mandatory holidays for a month, by location. */
export async function loadWorkCalendar(orgOid: mongoose.Types.ObjectId, start: Date, end: Date) {
  const [settings, holidays] = await Promise.all([
    HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).select('weekendDays').lean(),
    HrmsHoliday.find({ taskflowOrganizationId: orgOid, optional: false, date: { $gte: new Date(start.getTime() - HALF), $lt: new Date(end.getTime() + HALF) } })
      .select('date location')
      .lean(),
  ]);
  return {
    weekendDays: settings?.weekendDays ?? [0, 6],
    holidaysAt: (location?: string | null) => new Set(holidays.filter((h) => !h.location || h.location === (location ?? '')).map((h) => calendarDay(h.date))),
  };
}

/** Loss-of-pay days per employee for a payroll month (`start` inclusive, `end` exclusive, UTC midnights). */
export async function lossOfPayForMonth(orgOid: mongoose.Types.ObjectId, start: Date, end: Date): Promise<Map<string, number>> {
  const unpaidTypes = await HrmsLeaveType.find({ taskflowOrganizationId: orgOid, paid: false }).distinct('_id');
  const [attendance, leaves, settings, holidays] = await Promise.all([
    // Half a day either side, so local-midnight records at the month's edges are found; calendarDay sorts them out.
    HrmsAttendance.find({
      taskflowOrganizationId: orgOid,
      date: { $gte: new Date(start.getTime() - HALF), $lt: new Date(end.getTime() + HALF) },
      status: { $in: ['absent', 'half_day'] },
    })
      .select('employeeId date status')
      .lean(),
    HrmsLeaveRequest.find({
      taskflowOrganizationId: orgOid,
      status: 'approved',
      startDate: { $lt: new Date(end.getTime() + HALF) },
      endDate: { $gte: new Date(start.getTime() - HALF) },
      $or: [{ leaveTypeId: { $in: unpaidTypes } }, { leaveTypeId: null, type: 'unpaid' }],
    })
      .select('employeeId startDate endDate halfDay')
      .lean(),
    HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).select('weekendDays').lean(),
    HrmsHoliday.find({ taskflowOrganizationId: orgOid, optional: false, date: { $gte: new Date(start.getTime() - HALF), $lt: new Date(end.getTime() + HALF) } })
      .select('date location')
      .lean(),
  ]);
  const ids = [...new Set(leaves.map((l) => String(l.employeeId)))];
  const locationOf = new Map(
    (await HrmsEmployee.find({ _id: { $in: ids } }).select('location').lean()).map((e) => [String(e._id), e.location ?? ''])
  );
  const holidaysFor = (employeeId: string) =>
    new Set(holidays.filter((h) => !h.location || h.location === locationOf.get(employeeId)).map((h) => calendarDay(h.date)));
  return lossOfPayDays(
    attendance.map((a) => ({ employeeId: String(a.employeeId), date: a.date, status: a.status as Absence['status'] })),
    leaves.map((l) => ({ employeeId: String(l.employeeId), startDate: l.startDate, endDate: l.endDate, halfDay: Boolean(l.halfDay) })),
    {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      weekendDays: settings?.weekendDays ?? [0, 6],
      holidaysFor,
    }
  );
}
