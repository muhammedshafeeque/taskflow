import { ApiError } from '../../utils/ApiError';
import { calendarDay } from './lossOfPay';

const DAY = 86_400_000;
export const ATTENDANCE_STATUSES = ['present', 'remote', 'absent', 'half_day', 'holiday'] as const;

/**
 * How attendance stores a day: that calendar day at UTC midnight. "2026-12-02" is that day; a full timestamp is the
 * calendar day it stands for (see calendarDay), so records made at local midnight still land on the right day.
 */
export function attendanceDay(value: unknown): Date {
  const s = String(value ?? '').trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s && !Number.isNaN(Date.parse(s)) ? calendarDay(s) : '';
  if (!day || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new ApiError(400, 'Date must be a date such as 2026-12-02');
  return new Date(`${day}T00:00:00Z`);
}

/**
 * "Today" for someone marking their own attendance: the day their browser says, so an employee east or west of
 * the server doesn't land on yesterday or tomorrow — but only within a day of the server's date.
 */
export function ownToday(claimed: unknown, now = new Date()): Date {
  const server = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (claimed === undefined || claimed === null || claimed === '') return server;
  const day = attendanceDay(claimed);
  if (Math.abs(day.getTime() - server.getTime()) > DAY) throw new ApiError(400, 'You can only mark attendance for today');
  return day;
}
