import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { ResourceProfile } from './models/resourceProfile.model';
import type { ResourceSettingsValues } from './resourceSettings.service';

/**
 * Shared date and load math for resource planning.
 *
 * All dates are handled as UTC day starts and every range is inclusive of both ends.
 * Allocation % is of a person's weekly capacity, and an hour figure for a span is
 * capacity/7 per calendar day — weekends and leave are the engagement view's concern.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Stand-in end for open-ended allocations. */
export const FAR_FUTURE = new Date(Date.UTC(2099, 11, 31));

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function today(): Date {
  return startOfUtcDay(new Date());
}

export function parseDay(v: unknown, fallback: Date): Date {
  if (v === undefined || v === null || v === '') return fallback;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid date: ${String(v)}`);
  return startOfUtcDay(d);
}

/** Monday on or before the given day. */
export function weekStart(d: Date): Date {
  const day = startOfUtcDay(d);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Inclusive number of days two ranges share (0 when they don't touch). */
export function overlapDays(aStart: Date, aEnd: Date | null | undefined, bStart: Date, bEnd: Date | null | undefined): number {
  const s = Math.max(startOfUtcDay(aStart).getTime(), startOfUtcDay(bStart).getTime());
  const e = Math.min(startOfUtcDay(aEnd ?? FAR_FUTURE).getTime(), startOfUtcDay(bEnd ?? FAR_FUTURE).getTime());
  return e < s ? 0 : Math.round((e - s) / DAY_MS) + 1;
}

export interface AllocLike {
  _id: unknown;
  userId: unknown;
  projectId: unknown;
  percent: number;
  startDate: Date;
  endDate?: Date | null;
  softBooked: boolean;
  billable?: boolean;
  demandId?: unknown;
}

/** Id of a ref that may or may not have been populated. */
export function refId(ref: unknown): string {
  if (ref && typeof ref === 'object' && '_id' in ref) return String((ref as { _id: unknown })._id);
  return String(ref);
}

export interface LoadSegment {
  start: Date;
  end: Date;
  days: number;
  hardPct: number;
  softPct: number;
  allocationIds: string[];
}

/**
 * Splits [from, to] into runs of constant load for one person's allocations.
 * Each segment carries the summed hard and soft % and the allocations active in it.
 */
export function loadSegments(allocs: AllocLike[], from: Date, to: Date): LoadSegment[] {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  if (end < start) return [];
  const cuts = new Set<number>([start.getTime(), end.getTime() + DAY_MS]);
  for (const a of allocs) {
    const s = startOfUtcDay(a.startDate).getTime();
    const e = startOfUtcDay(a.endDate ?? FAR_FUTURE).getTime() + DAY_MS;
    if (s > start.getTime() && s <= end.getTime()) cuts.add(s);
    if (e > start.getTime() && e <= end.getTime()) cuts.add(e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: LoadSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = new Date(points[i]);
    const segEnd = new Date(points[i + 1] - DAY_MS);
    let hardPct = 0;
    let softPct = 0;
    const ids: string[] = [];
    for (const a of allocs) {
      if (overlapDays(a.startDate, a.endDate, segStart, segStart) === 0) continue;
      if (a.softBooked) softPct += a.percent;
      else hardPct += a.percent;
      ids.push(String(a._id));
    }
    segments.push({
      start: segStart,
      end: segEnd,
      days: Math.round((segEnd.getTime() - segStart.getTime()) / DAY_MS) + 1,
      hardPct,
      softPct,
      allocationIds: ids,
    });
  }
  return segments;
}

/** Load on a single day. */
export function loadOn(allocs: AllocLike[], day: Date): { hardPct: number; softPct: number } {
  let hardPct = 0;
  let softPct = 0;
  for (const a of allocs) {
    if (overlapDays(a.startDate, a.endDate, day, day) === 0) continue;
    if (a.softBooked) softPct += a.percent;
    else hardPct += a.percent;
  }
  return { hardPct, softPct };
}

/** Time-weighted average % over [from, to] for the allocations matching `pick`. */
export function weightedPercent(allocs: AllocLike[], from: Date, to: Date, pick: (a: AllocLike) => boolean = (a) => !a.softBooked): number {
  const span = overlapDays(from, to, from, to);
  if (span === 0) return 0;
  return allocs.filter(pick).reduce((s, a) => s + (a.percent * overlapDays(a.startDate, a.endDate, from, to)) / span, 0);
}

/** Hours an allocation books over [from, to] for someone with the given weekly capacity. */
export function allocationHours(a: AllocLike, weeklyCapacity: number, from: Date, to: Date | null): number {
  return ((a.percent / 100) * weeklyCapacity * overlapDays(a.startDate, a.endDate, from, to)) / 7;
}

export function groupByUser<T extends AllocLike>(allocs: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const a of allocs) {
    const key = refId(a.userId);
    const list = map.get(key) ?? [];
    list.push(a);
    map.set(key, list);
  }
  return map;
}

export interface PlanningMember {
  userId: string;
  name: string;
  email: string;
  capacityHoursPerWeek: number;
  skills: string[];
  seniority?: string;
  department?: string;
  location?: string;
  availableFrom: Date | null;
  notes?: string;
  profileId: string | null;
}

export async function activeMemberIds(orgOid: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> {
  return (await OrganizationMember.find({ organization: orgOid, status: 'active' }).distinct('user')) as mongoose.Types.ObjectId[];
}

/** Active workspace members with their resource profile; department falls back to the HR record. */
export async function loadMembers(
  orgOid: mongoose.Types.ObjectId,
  settings: Pick<ResourceSettingsValues, 'defaultCapacityHoursPerWeek'>
): Promise<PlanningMember[]> {
  const ids = await activeMemberIds(orgOid);
  const [users, profiles, employees] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('name email').sort({ name: 1 }).lean(),
    ResourceProfile.find({ taskflowOrganizationId: orgOid, userId: { $in: ids } }).lean(),
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId: { $in: ids } }).select('userId department').lean(),
  ]);
  const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));
  const deptByUser = new Map(
    employees.map((e) => [String((e as { userId?: unknown }).userId), (e as { department?: string }).department])
  );
  return users.map((u) => {
    const id = String(u._id);
    const p = profileByUser.get(id);
    return {
      userId: id,
      name: u.name ?? u.email ?? 'Unknown',
      email: u.email,
      capacityHoursPerWeek: p?.capacityHoursPerWeek ?? settings.defaultCapacityHoursPerWeek,
      skills: p?.skills ?? [],
      seniority: p?.seniority,
      department: p?.department || deptByUser.get(id) || undefined,
      location: p?.location,
      availableFrom: p?.availableFrom ?? null,
      notes: p?.notes,
      profileId: p ? String(p._id) : null,
    };
  });
}

export function normalizeSkill(s: string): string {
  return s.trim().toLowerCase();
}
