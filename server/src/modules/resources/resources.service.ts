import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { WorkLog } from '../workLogs/workLog.model';
import { Issue } from '../issues/issue.model';
import { ResourceAllocation } from './models/resourceAllocation.model';
import { ResourceDemand, type IResourceDemand } from './models/resourceDemand.model';
import { ResourceProfile } from './models/resourceProfile.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';
import { getResourceSettings, type ResourceSettingsValues } from './resourceSettings.service';
import {
  DAY_MS,
  type AllocLike,
  type LoadSegment,
  type PlanningMember,
  activeMemberIds,
  addDays,
  allocationHours,
  dayKey,
  groupByUser,
  loadMembers,
  loadOn,
  loadSegments,
  normalizeSkill,
  overlapDays,
  parseDay,
  refId,
  round1,
  startOfUtcDay,
  today as todayUtc,
  weekStart,
  weightedPercent,
} from './planning';

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

const OPEN_DEMAND = ['open', 'partially_filled'] as const;
const DEMAND_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const DEMAND_STATUSES = ['open', 'partially_filled', 'filled', 'cancelled'] as const;

async function workspaceProjectIds(orgId: string): Promise<mongoose.Types.ObjectId[]> {
  return Project.find({ taskflowOrganizationId: orgId }).distinct('_id') as Promise<mongoose.Types.ObjectId[]>;
}

async function assertProjectInWorkspace(orgId: string, projectId: string) {
  if (!mongoose.Types.ObjectId.isValid(projectId)) throw new ApiError(400, 'Invalid project');
  const ok = await Project.exists({ _id: projectId, taskflowOrganizationId: orgId });
  if (!ok) throw new ApiError(400, 'Project is not in this workspace');
}

async function assertActiveMember(orgOid: mongoose.Types.ObjectId, userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) throw new ApiError(400, 'Invalid user');
  const ok = await OrganizationMember.exists({ organization: orgOid, user: userId, status: 'active' });
  if (!ok) throw new ApiError(400, 'User is not an active workspace member');
}

function parsePercent(v: unknown): number {
  const percent = Number(v);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new ApiError(400, 'percent must be between 1 and 100');
  }
  return Math.round(percent * 10) / 10;
}

function populateAllocationQuery<T>(q: T): T {
  return (q as unknown as mongoose.Query<unknown, unknown>)
    .populate('userId', 'name email')
    .populate('projectId', 'name key')
    .populate('demandId', 'title status') as unknown as T;
}

async function populateAllocation(id: unknown) {
  return populateAllocationQuery(ResourceAllocation.findById(id)).lean();
}

function departmentsOf(members: PlanningMember[]): string[] {
  return [...new Set(members.map((m) => m.department).filter((d): d is string => Boolean(d)))].sort();
}

function capacityMap(members: PlanningMember[], settings: ResourceSettingsValues) {
  const map = new Map(members.map((m) => [m.userId, m.capacityHoursPerWeek]));
  return (userId: string) => map.get(userId) ?? settings.defaultCapacityHoursPerWeek;
}

/** Merges consecutive segments that pass `test` into windows. */
function windowsWhere(segments: LoadSegment[], test: (s: LoadSegment) => boolean) {
  const out: Array<{ start: Date; end: Date; peakHard: number; peakTotal: number; ids: Set<string> }> = [];
  for (const s of segments) {
    if (!test(s)) continue;
    const last = out[out.length - 1];
    if (last && last.end.getTime() + DAY_MS === s.start.getTime()) {
      last.end = s.end;
      last.peakHard = Math.max(last.peakHard, s.hardPct);
      last.peakTotal = Math.max(last.peakTotal, s.hardPct + s.softPct);
      s.allocationIds.forEach((id) => last.ids.add(id));
    } else {
      out.push({ start: s.start, end: s.end, peakHard: s.hardPct, peakTotal: s.hardPct + s.softPct, ids: new Set(s.allocationIds) });
    }
  }
  return out;
}

/* ─── Allocation load checks ─────────────────────────────────────────────── */

async function allocationLoadCheck(
  orgOid: mongoose.Types.ObjectId,
  settings: ResourceSettingsValues,
  candidate: { userId: string; startDate: Date; endDate: Date | null; percent: number; softBooked: boolean; excludeId?: string }
) {
  const others = await ResourceAllocation.find({
    taskflowOrganizationId: orgOid,
    userId: candidate.userId,
    ...(candidate.excludeId ? { _id: { $ne: candidate.excludeId } } : {}),
  }).lean();
  const from = candidate.startDate;
  // An open-ended booking is checked across the conflict look-ahead from whichever is later: its start or today.
  const to =
    candidate.endDate ??
    addDays(from > todayUtc() ? from : todayUtc(), settings.conflictLookaheadDays);
  const all: AllocLike[] = [
    ...others,
    { _id: 'candidate', userId: candidate.userId, projectId: null, percent: candidate.percent, startDate: from, endDate: candidate.endDate, softBooked: candidate.softBooked },
  ];
  const segments = loadSegments(all, from, to);
  const existing = loadSegments(others, from, to);
  const peakHard = segments.reduce((m, s) => Math.max(m, s.hardPct), 0);
  const peakTotal = segments.reduce((m, s) => Math.max(m, s.hardPct + s.softPct), 0);
  const overlapping = new Set(existing.flatMap((s) => s.allocationIds));
  const windows = windowsWhere(segments, (s) => s.hardPct > settings.overAllocationPct).map((w) => ({
    start: dayKey(w.start),
    end: dayKey(w.end),
    peakPercent: w.peakHard,
  }));
  return {
    overlappingCount: overlapping.size,
    /** Peak hard-booked % during the allocation, including it when it is a hard booking. */
    committedPercent: peakHard,
    peakWithSoftPercent: peakTotal,
    existingPeakPercent: existing.reduce((m, s) => Math.max(m, s.hardPct), 0),
    overAllocated: peakHard > settings.overAllocationPct,
    softRisk: peakHard <= settings.overAllocationPct && peakTotal > settings.overAllocationPct,
    overAllocationPct: settings.overAllocationPct,
    headroomPercent: Math.max(0, settings.overAllocationPct - existing.reduce((m, s) => Math.max(m, s.hardPct), 0)),
    windows,
  };
}

export async function checkAllocation(
  workspaceId: string | null | undefined,
  query: { userId?: string; startDate?: string; endDate?: string; percent?: string; softBooked?: string; excludeId?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!query.userId || !mongoose.Types.ObjectId.isValid(query.userId)) throw new ApiError(400, 'userId is required');
  const settings = await getResourceSettings(orgId);
  const startDate = parseDay(query.startDate, todayUtc());
  const endDate = query.endDate ? parseDay(query.endDate, startDate) : null;
  if (endDate && endDate < startDate) throw new ApiError(400, 'endDate must be on or after startDate');
  const percent = query.percent ? parsePercent(query.percent) : 0;
  return allocationLoadCheck(orgOid, settings, {
    userId: query.userId,
    startDate,
    endDate,
    percent,
    softBooked: query.softBooked === 'true',
    excludeId: query.excludeId && mongoose.Types.ObjectId.isValid(query.excludeId) ? query.excludeId : undefined,
  });
}

/* ─── Demand progress ────────────────────────────────────────────────────── */

type DemandLean = Pick<IResourceDemand, 'hoursNeeded' | 'periodStart' | 'periodEnd' | 'status'> & { _id: unknown };

function demandProgress(
  demand: DemandLean,
  linked: AllocLike[],
  capacityOf: (userId: string) => number
) {
  const fulfilledHours = linked.reduce(
    (s, a) => s + allocationHours(a, capacityOf(refId(a.userId)), demand.periodStart, demand.periodEnd),
    0
  );
  const remainingHours = Math.max(0, demand.hoursNeeded - fulfilledHours);
  return {
    fulfilledHours: round1(fulfilledHours),
    remainingHours: round1(remainingHours),
    fillPct: demand.hoursNeeded > 0 ? Math.min(100, Math.round((fulfilledHours / demand.hoursNeeded) * 100)) : 100,
    allocationCount: linked.length,
  };
}

export interface DemandRow {
  _id: string;
  title: string;
  projectId: { _id: string; name?: string; key?: string } | null;
  roleLabel?: string;
  hoursNeeded: number;
  periodStart: Date;
  periodEnd: Date;
  priority: IResourceDemand['priority'];
  status: IResourceDemand['status'];
  skills: string[];
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  fulfilledHours: number;
  remainingHours: number;
  fillPct: number;
  allocationCount: number;
}

function toDemandRow(d: Record<string, unknown> & DemandLean, progress: ReturnType<typeof demandProgress>): DemandRow {
  const proj = d.projectId as { _id?: unknown; name?: string; key?: string } | null | undefined;
  return {
    _id: String(d._id),
    title: String(d.title ?? ''),
    projectId: proj && typeof proj === 'object' && proj._id ? { _id: String(proj._id), name: proj.name, key: proj.key } : null,
    roleLabel: d.roleLabel as string | undefined,
    hoursNeeded: d.hoursNeeded,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    priority: (d.priority as IResourceDemand['priority']) ?? 'medium',
    status: d.status,
    skills: (d.skills as string[] | undefined) ?? [],
    notes: d.notes as string | undefined,
    createdAt: d.createdAt as Date | undefined,
    updatedAt: d.updatedAt as Date | undefined,
    ...progress,
  };
}

/** Moves a demand between open / partially filled / filled to match the allocations linked to it. */
async function syncDemandStatus(orgId: string, demandId: unknown) {
  if (!demandId) return;
  const orgOid = toOrgOid(orgId);
  const demand = await ResourceDemand.findOne({ _id: demandId, taskflowOrganizationId: orgOid });
  if (!demand || demand.status === 'cancelled') return;
  const [settings, linked] = await Promise.all([
    getResourceSettings(orgId),
    ResourceAllocation.find({ taskflowOrganizationId: orgOid, demandId: demand._id }).lean(),
  ]);
  const caps = await ResourceProfile.find({ taskflowOrganizationId: orgOid, userId: { $in: linked.map((a) => a.userId) } })
    .select('userId capacityHoursPerWeek')
    .lean();
  const capByUser = new Map(caps.map((c) => [String(c.userId), c.capacityHoursPerWeek]));
  const progress = demandProgress(demand, linked, (u) => capByUser.get(u) ?? settings.defaultCapacityHoursPerWeek);
  const next =
    linked.length === 0
      ? 'open'
      : progress.remainingHours <= 0.05
        ? 'filled'
        : 'partially_filled';
  if (next !== demand.status) {
    demand.status = next;
    await demand.save();
  }
}

/* ─── Conflicts ──────────────────────────────────────────────────────────── */

export type ConflictSeverity = 'over' | 'soft_risk' | 'inactive_member';

async function computeConflicts(orgId: string, settings: ResourceSettingsValues) {
  const orgOid = toOrgOid(orgId);
  const from = todayUtc();
  const to = addDays(from, settings.conflictLookaheadDays);
  const [allocations, memberIds] = await Promise.all([
    populateAllocationQuery(
      ResourceAllocation.find({
        taskflowOrganizationId: orgOid,
        startDate: { $lte: to },
        $or: [{ endDate: null }, { endDate: { $gte: from } }],
      })
    ).lean(),
    activeMemberIds(orgOid),
  ]);
  const active = new Set(memberIds.map(String));
  const byId = new Map(allocations.map((a) => [String(a._id), a]));

  const conflicts: Array<{
    id: string;
    severity: ConflictSeverity;
    userId: string;
    userName: string;
    userEmail?: string;
    start: string;
    end: string;
    days: number;
    peakPercent: number;
    hardPercent: number;
    startsInDays: number;
    allocations: typeof allocations;
  }> = [];

  for (const [userId, list] of groupByUser(allocations as unknown as AllocLike[])) {
    const user = (list[0].userId ?? {}) as { name?: string; email?: string };
    const base = { userId, userName: user.name ?? 'Former member', userEmail: user.email };
    if (!active.has(userId)) {
      const first = list.reduce((m, a) => (a.startDate < m ? a.startDate : m), list[0].startDate);
      const start = first > from ? startOfUtcDay(first) : from;
      conflicts.push({
        ...base,
        id: `${userId}|inactive`,
        severity: 'inactive_member',
        start: dayKey(start),
        end: dayKey(to),
        days: overlapDays(start, to, start, to),
        peakPercent: loadSegments(list, from, to).reduce((m, s) => Math.max(m, s.hardPct + s.softPct), 0),
        hardPercent: loadSegments(list, from, to).reduce((m, s) => Math.max(m, s.hardPct), 0),
        startsInDays: Math.round((start.getTime() - from.getTime()) / DAY_MS),
        allocations: list.map((a) => byId.get(String(a._id))!),
      });
      continue;
    }
    const segments = loadSegments(list, from, to);
    const over = windowsWhere(segments, (s) => s.hardPct > settings.overAllocationPct);
    const soft = windowsWhere(
      segments,
      (s) => s.hardPct <= settings.overAllocationPct && s.hardPct + s.softPct > settings.overAllocationPct
    );
    for (const [severity, windows] of [['over', over], ['soft_risk', soft]] as const) {
      for (const w of windows) {
        conflicts.push({
          ...base,
          id: `${userId}|${severity}|${dayKey(w.start)}`,
          severity,
          start: dayKey(w.start),
          end: dayKey(w.end),
          days: overlapDays(w.start, w.end, w.start, w.end),
          peakPercent: severity === 'over' ? w.peakHard : w.peakTotal,
          hardPercent: w.peakHard,
          startsInDays: Math.round((w.start.getTime() - from.getTime()) / DAY_MS),
          allocations: [...w.ids].map((id) => byId.get(id)!).filter(Boolean),
        });
      }
    }
  }

  const rank: Record<ConflictSeverity, number> = { over: 0, inactive_member: 1, soft_risk: 2 };
  conflicts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.start.localeCompare(b.start) || b.peakPercent - a.peakPercent);
  return {
    from: dayKey(from),
    to: dayKey(to),
    lookaheadDays: settings.conflictLookaheadDays,
    overAllocationPct: settings.overAllocationPct,
    conflicts,
    count: conflicts.length,
    overCount: conflicts.filter((c) => c.severity === 'over').length,
    softRiskCount: conflicts.filter((c) => c.severity === 'soft_risk').length,
    inactiveCount: conflicts.filter((c) => c.severity === 'inactive_member').length,
    peopleAffected: new Set(conflicts.filter((c) => c.severity !== 'soft_risk').map((c) => c.userId)).size,
  };
}

export async function getConflicts(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return computeConflicts(orgId, await getResourceSettings(orgId));
}

/* ─── Weekly supply vs demand ────────────────────────────────────────────── */

function weeklySupplyDemand(
  members: PlanningMember[],
  allocsByUser: Map<string, AllocLike[]>,
  demands: Array<DemandLean & { remainingHours: number }>,
  from: Date,
  weeks: number
) {
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(from, w * 7);
    const we = addDays(ws, 6);
    let capacity = 0;
    let committed = 0;
    let soft = 0;
    let available = 0;
    let overHours = 0;
    for (const m of members) {
      const list = allocsByUser.get(m.userId) ?? [];
      const hard = (weightedPercent(list, ws, we) / 100) * m.capacityHoursPerWeek;
      const softH = (weightedPercent(list, ws, we, (a) => a.softBooked) / 100) * m.capacityHoursPerWeek;
      capacity += m.capacityHoursPerWeek;
      committed += Math.min(hard, m.capacityHoursPerWeek);
      overHours += Math.max(0, hard - m.capacityHoursPerWeek);
      soft += softH;
      available += Math.max(0, m.capacityHoursPerWeek - hard);
    }
    // Remaining demand hours are spread evenly across the demand's period.
    const demand = demands.reduce((s, d) => {
      const total = overlapDays(d.periodStart, d.periodEnd, d.periodStart, d.periodEnd);
      return total === 0 ? s : s + (d.remainingHours * overlapDays(d.periodStart, d.periodEnd, ws, we)) / total;
    }, 0);
    rows.push({
      weekStart: dayKey(ws),
      capacityHours: Math.round(capacity),
      committedHours: Math.round(committed),
      softHours: Math.round(soft),
      overHours: Math.round(overHours),
      availableHours: Math.round(available),
      demandHours: Math.round(demand),
      gapHours: Math.round(demand - available),
      committedPct: capacity > 0 ? Math.round((committed / capacity) * 100) : 0,
      softPct: capacity > 0 ? Math.round((soft / capacity) * 100) : 0,
    });
  }
  return rows;
}

async function openDemandsWithProgress(
  orgId: string,
  members: PlanningMember[],
  settings: ResourceSettingsValues,
  extraFilter: Record<string, unknown> = {}
): Promise<DemandRow[]> {
  const orgOid = toOrgOid(orgId);
  const demands = await ResourceDemand.find({ taskflowOrganizationId: orgOid, status: { $in: OPEN_DEMAND }, ...extraFilter })
    .populate('projectId', 'name key')
    .lean();
  const linked = demands.length
    ? await ResourceAllocation.find({ taskflowOrganizationId: orgOid, demandId: { $in: demands.map((d) => d._id) } }).lean()
    : [];
  const capacityOf = capacityMap(members, settings);
  return demands.map((d) =>
    toDemandRow(d as unknown as Record<string, unknown> & DemandLean, demandProgress(d, linked.filter((a) => String(a.demandId) === String(d._id)), capacityOf))
  );
}

/* ─── Dashboard ──────────────────────────────────────────────────────────── */

export async function getDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const now = todayUtc();
  const trendFrom = weekStart(now);
  const trendTo = addDays(trendFrom, settings.forecastHorizonWeeks * 7 - 1);
  const soonTo = addDays(now, settings.freeingSoonDays);

  const members = await loadMembers(orgOid, settings);
  const [allocations, demandsP, conflicts] = await Promise.all([
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: trendTo },
      $or: [{ endDate: null }, { endDate: { $gte: trendFrom } }],
    })
      .populate('projectId', 'name key')
      .populate('userId', 'name email')
      .lean(),
    openDemandsWithProgress(orgId, members, settings),
    computeConflicts(orgId, settings),
  ]);
  const capacityOf = capacityMap(members, settings);

  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const loads = members.map((m) => ({ member: m, ...loadOn(byUser.get(m.userId) ?? [], now) }));
  const { benchThresholdPct: bench, busyThresholdPct: busy, overAllocationPct: over } = settings;

  const counts = {
    teamSize: members.length,
    profiles: members.filter((m) => m.profileId).length,
    activeAllocations: allocations.filter((a) => overlapDays(a.startDate, a.endDate, now, now) > 0).length,
    softBookings: allocations.filter((a) => a.softBooked && overlapDays(a.startDate, a.endDate, now, now) > 0).length,
    upcomingAllocations: allocations.filter((a) => startOfUtcDay(a.startDate) > now).length,
    openDemands: demandsP.length,
    overAllocated: loads.filter((l) => l.hardPct > over).length,
    fullyBooked: loads.filter((l) => l.hardPct >= busy && l.hardPct <= over).length,
    partiallyBooked: loads.filter((l) => l.hardPct >= bench && l.hardPct < busy).length,
    onBench: loads.filter((l) => l.hardPct < bench).length,
    upcomingConflicts: conflicts.overCount,
  };

  const avgUtilization =
    members.length === 0 ? 0 : round1(loads.reduce((s, l) => s + Math.min(l.hardPct, 100), 0) / members.length);

  const bands = [
    { name: 'Unassigned', test: (p: number) => p === 0 },
    { name: `Bench (<${bench}%)`, test: (p: number) => p > 0 && p < bench },
    { name: `Partial (${bench}–${busy}%)`, test: (p: number) => p >= bench && p < busy },
    { name: `Booked (${busy}–${over}%)`, test: (p: number) => p >= busy && p <= over },
    { name: `Over (>${over}%)`, test: (p: number) => p > over },
  ];

  const projectLoad = new Map<string, { name: string; percent: number; people: Set<string>; hours: number }>();
  for (const a of allocations) {
    if (a.softBooked || overlapDays(a.startDate, a.endDate, now, now) === 0) continue;
    const proj = a.projectId as { _id?: unknown; name?: string; key?: string } | null;
    const key = refId(a.projectId);
    const cur = projectLoad.get(key) ?? { name: proj?.key || proj?.name || 'Project', percent: 0, people: new Set(), hours: 0 };
    cur.percent += a.percent;
    cur.people.add(refId(a.userId));
    cur.hours += (a.percent / 100) * capacityOf(refId(a.userId));
    projectLoad.set(key, cur);
  }

  const trend = weeklySupplyDemand(members, byUser, demandsP, trendFrom, settings.forecastHorizonWeeks);
  const demandHrs = demandsP.reduce((s, d) => s + d.remainingHours, 0);
  const capacityHrsWeek = members.reduce((s, m) => s + m.capacityHoursPerWeek, 0);
  const availableHrsWeek = loads.reduce((s, l) => s + Math.max(0, l.member.capacityHoursPerWeek * (1 - l.hardPct / 100)), 0);
  const horizonAvailable = trend.reduce((s, w) => s + w.availableHours, 0);
  const horizonDemand = trend.reduce((s, w) => s + w.demandHours, 0);

  const nameOf = (ref: unknown) => (ref as { name?: string; key?: string } | null)?.key ?? (ref as { name?: string } | null)?.name;
  const alerts = {
    endingSoon: allocations
      .filter((a) => !a.softBooked && a.endDate && startOfUtcDay(a.endDate) >= now && startOfUtcDay(a.endDate) <= soonTo)
      .sort((a, b) => +a.endDate! - +b.endDate!)
      .slice(0, 8)
      .map((a) => ({ allocationId: String(a._id), user: (a.userId as { name?: string })?.name, project: nameOf(a.projectId), percent: a.percent, date: a.endDate })),
    softStartingSoon: allocations
      .filter((a) => a.softBooked && startOfUtcDay(a.startDate) <= addDays(now, 14) && (!a.endDate || a.endDate >= now))
      .slice(0, 8)
      .map((a) => ({ allocationId: String(a._id), user: (a.userId as { name?: string })?.name, project: nameOf(a.projectId), percent: a.percent, date: a.startDate })),
    demandsStartingSoon: demandsP
      .filter((d) => d.periodStart <= addDays(now, 14) && d.remainingHours > 0)
      .sort((a, b) => +a.periodStart - +b.periodStart)
      .slice(0, 8)
      .map((d) => ({ demandId: String(d._id), title: d.title, priority: d.priority, remainingHours: d.remainingHours, date: d.periodStart })),
    conflicts: conflicts.conflicts
      .filter((c) => c.severity !== 'soft_risk')
      .slice(0, 8)
      .map((c) => ({ id: c.id, userId: c.userId, user: c.userName, severity: c.severity, peakPercent: c.peakPercent, start: c.start, end: c.end })),
    missingProfiles: members.length - counts.profiles,
  };

  return {
    settings,
    counts,
    avgUtilization,
    charts: {
      loadDistribution: bands.map((b) => ({ name: b.name, count: loads.filter((l) => b.test(l.hardPct)).length })),
      topLoaded: loads
        .map((l) => ({ userId: l.member.userId, name: l.member.name, plannedPercent: round1(l.hardPct), softPercent: round1(l.softPct) }))
        .sort((a, b) => b.plannedPercent - a.plannedPercent)
        .slice(0, 8),
      allocationsByProject: [...projectLoad.values()]
        .map((p) => ({ name: p.name, percent: Math.round(p.percent), people: p.people.size, fte: round1(p.percent / 100), hours: Math.round(p.hours) }))
        .sort((a, b) => b.percent - a.percent)
        .slice(0, 8),
      allocationMix: [
        { name: 'Committed', value: Math.max(0, counts.activeAllocations - counts.softBookings) },
        { name: 'Soft booked', value: counts.softBookings },
      ],
      staffingMix: [
        { name: 'On bench', value: counts.onBench },
        { name: 'Partial', value: counts.partiallyBooked },
        { name: 'Fully booked', value: counts.fullyBooked },
        { name: 'Over-allocated', value: counts.overAllocated },
      ],
      capacity: {
        capacityHoursWeek: Math.round(capacityHrsWeek),
        availableHoursWeek: Math.round(availableHrsWeek),
        demandHoursOpen: Math.round(demandHrs),
        horizonAvailableHours: horizonAvailable,
        horizonDemandHours: horizonDemand,
        gapHours: horizonDemand - horizonAvailable,
      },
      demandByPriority: [...DEMAND_PRIORITIES].reverse().map((priority) => {
        const list = demandsP.filter((d) => (d.priority ?? 'medium') === priority);
        return { name: priority, count: list.length, hours: Math.round(list.reduce((s, d) => s + d.remainingHours, 0)) };
      }),
      trend,
    },
    alerts,
  };
}

/* ─── Allocations ────────────────────────────────────────────────────────── */

export async function listAllocations(
  workspaceId: string | null | undefined,
  query: {
    userId?: string;
    projectId?: string;
    demandId?: string;
    status?: 'active' | 'upcoming' | 'past' | 'current' | 'all';
    activeOnly?: boolean;
    includeSoft?: boolean;
    from?: string;
    to?: string;
  } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const now = todayUtc();
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  const and: Record<string, unknown>[] = [];
  if (query.userId && mongoose.Types.ObjectId.isValid(query.userId)) filter.userId = query.userId;
  if (query.projectId && mongoose.Types.ObjectId.isValid(query.projectId)) filter.projectId = query.projectId;
  if (query.demandId && mongoose.Types.ObjectId.isValid(query.demandId)) filter.demandId = query.demandId;
  const status = query.activeOnly ? 'active' : query.status ?? 'all';
  if (status === 'active') {
    filter.startDate = { $lte: now };
    and.push({ $or: [{ endDate: null }, { endDate: { $gte: now } }] });
  } else if (status === 'upcoming') {
    filter.startDate = { $gt: now };
  } else if (status === 'current') {
    // Active or still to come.
    and.push({ $or: [{ endDate: null }, { endDate: { $gte: now } }] });
  } else if (status === 'past') {
    filter.endDate = { $lt: now, $ne: null };
  }
  if (query.from || query.to) {
    const from = parseDay(query.from, new Date(0));
    const to = parseDay(query.to, new Date(Date.UTC(2099, 11, 31)));
    and.push({ startDate: { $lte: to } }, { $or: [{ endDate: null }, { endDate: { $gte: from } }] });
  }
  if (query.includeSoft === false) filter.softBooked = false;
  if (and.length) filter.$and = and;

  return populateAllocationQuery(ResourceAllocation.find(filter)).sort({ startDate: -1 }).lean();
}

interface AllocationInput {
  userId?: string;
  projectId?: string;
  percent?: number;
  startDate?: string;
  endDate?: string | null;
  billable?: boolean;
  softBooked?: boolean;
  roleLabel?: string;
  notes?: string;
  demandId?: string | null;
}

async function assertDemandInWorkspace(orgOid: mongoose.Types.ObjectId, demandId: string) {
  if (!mongoose.Types.ObjectId.isValid(demandId)) throw new ApiError(400, 'Invalid demand');
  const ok = await ResourceDemand.exists({ _id: demandId, taskflowOrganizationId: orgOid });
  if (!ok) throw new ApiError(400, 'Demand is not in this workspace');
}

export async function createAllocation(workspaceId: string | null | undefined, actorId: string, input: AllocationInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.userId || !input.projectId || !input.startDate) {
    throw new ApiError(400, 'userId, projectId, and startDate are required');
  }
  const percent = parsePercent(input.percent);
  await assertActiveMember(orgOid, input.userId);
  await assertProjectInWorkspace(orgId, input.projectId);
  if (input.demandId) await assertDemandInWorkspace(orgOid, input.demandId);

  const startDate = parseDay(input.startDate, todayUtc());
  const endDate = input.endDate ? parseDay(input.endDate, startDate) : null;
  if (endDate && endDate < startDate) throw new ApiError(400, 'endDate must be on or after startDate');

  const doc = await ResourceAllocation.create({
    taskflowOrganizationId: orgOid,
    userId: input.userId,
    projectId: input.projectId,
    percent,
    startDate,
    endDate,
    billable: input.billable !== false,
    softBooked: Boolean(input.softBooked),
    roleLabel: input.roleLabel?.trim() || undefined,
    notes: input.notes,
    demandId: input.demandId || null,
    createdBy: actorId,
  });

  const settings = await getResourceSettings(orgId);
  const conflicts = await allocationLoadCheck(orgOid, settings, {
    userId: input.userId,
    startDate,
    endDate,
    percent: 0,
    softBooked: false,
  });
  if (doc.demandId) await syncDemandStatus(orgId, doc.demandId);
  logAudit({
    userId: actorId,
    action: 'create',
    resourceType: 'resource_allocation',
    resourceId: String(doc._id),
    projectId: input.projectId,
    meta: { userId: input.userId, percent, startDate, endDate, softBooked: doc.softBooked, demandId: doc.demandId ?? undefined },
  });
  return { allocation: await populateAllocation(doc._id), conflicts };
}

export async function updateAllocation(
  workspaceId: string | null | undefined,
  actorId: string,
  id: string,
  input: AllocationInput
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Allocation not found');
  const existing = await ResourceAllocation.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Allocation not found');
  const previousDemand = existing.demandId ? String(existing.demandId) : null;
  const changed: string[] = [];

  if (input.percent != null) {
    existing.percent = parsePercent(input.percent);
    changed.push('percent');
  }
  if (input.userId && input.userId !== String(existing.userId)) {
    await assertActiveMember(orgOid, input.userId);
    existing.userId = new mongoose.Types.ObjectId(input.userId);
    changed.push('userId');
  }
  if (input.projectId && input.projectId !== String(existing.projectId)) {
    await assertProjectInWorkspace(orgId, input.projectId);
    existing.projectId = new mongoose.Types.ObjectId(input.projectId);
    changed.push('projectId');
  }
  if (input.startDate) {
    existing.startDate = parseDay(input.startDate, existing.startDate);
    changed.push('startDate');
  }
  if (input.endDate !== undefined) {
    existing.endDate = input.endDate ? parseDay(input.endDate, existing.startDate) : null;
    changed.push('endDate');
  }
  if (input.billable !== undefined) {
    existing.billable = Boolean(input.billable);
    changed.push('billable');
  }
  if (input.softBooked !== undefined) {
    existing.softBooked = Boolean(input.softBooked);
    changed.push('softBooked');
  }
  if (input.roleLabel !== undefined) existing.roleLabel = String(input.roleLabel ?? '').trim() || undefined;
  if (input.notes !== undefined) existing.notes = input.notes;
  if (input.demandId !== undefined) {
    if (input.demandId) await assertDemandInWorkspace(orgOid, input.demandId);
    existing.demandId = input.demandId ? new mongoose.Types.ObjectId(input.demandId) : null;
    changed.push('demandId');
  }
  if (existing.endDate && existing.endDate < existing.startDate) {
    throw new ApiError(400, 'endDate must be on or after startDate');
  }

  await existing.save();
  const settings = await getResourceSettings(orgId);
  const conflicts = await allocationLoadCheck(orgOid, settings, {
    userId: String(existing.userId),
    startDate: existing.startDate,
    endDate: existing.endDate ?? null,
    percent: 0,
    softBooked: false,
  });
  const nextDemand = existing.demandId ? String(existing.demandId) : null;
  await syncDemandStatus(orgId, nextDemand);
  if (previousDemand && previousDemand !== nextDemand) await syncDemandStatus(orgId, previousDemand);
  logAudit({
    userId: actorId,
    action: 'update',
    resourceType: 'resource_allocation',
    resourceId: id,
    projectId: String(existing.projectId),
    meta: { changed },
  });
  return { allocation: await populateAllocation(existing._id), conflicts };
}

export async function deleteAllocation(workspaceId: string | null | undefined, actorId: string, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Allocation not found');
  const result = await ResourceAllocation.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid });
  if (!result) throw new ApiError(404, 'Allocation not found');
  if (result.demandId) await syncDemandStatus(orgId, result.demandId);
  logAudit({
    userId: actorId,
    action: 'delete',
    resourceType: 'resource_allocation',
    resourceId: id,
    projectId: String(result.projectId),
    meta: { userId: String(result.userId), percent: result.percent },
  });
  return { deleted: true };
}

/* ─── Utilization ────────────────────────────────────────────────────────── */

export async function getUtilization(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string; department?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const to = parseDay(query.to, todayUtc());
  const from = parseDay(query.from, addDays(to, -29));
  if (to < from) throw new ApiError(400, 'to must be on or after from');
  if ((to.getTime() - from.getTime()) / DAY_MS > 400) throw new ApiError(400, 'Date range cannot exceed 400 days');
  const periodDays = overlapDays(from, to, from, to);

  const allMembers = await loadMembers(orgOid, settings);
  const members = query.department ? allMembers.filter((m) => (m.department ?? '') === query.department) : allMembers;
  const memberIds = members.map((m) => new mongoose.Types.ObjectId(m.userId));

  const [allocations, projectIds] = await Promise.all([
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      userId: { $in: memberIds },
      startDate: { $lte: to },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    })
      .populate('projectId', 'name key')
      .lean(),
    workspaceProjectIds(orgId),
  ]);
  const rawLogs = await WorkLog.find({
    author: { $in: memberIds },
    date: { $gte: from, $lte: new Date(to.getTime() + DAY_MS - 1) },
  })
    .select('author minutesSpent billable issue date')
    .lean();
  const issues = rawLogs.length
    ? await Issue.find({ _id: { $in: [...new Set(rawLogs.map((w) => String(w.issue)))] }, project: { $in: projectIds } })
        .select('project')
        .lean()
    : [];
  const projectByIssue = new Map(issues.map((i) => [String(i._id), String(i.project)]));
  const workLogs = rawLogs.filter((w) => projectByIssue.has(String(w.issue)));
  const projects = await Project.find({ _id: { $in: projectIds } }).select('name key').lean();
  const projectName = new Map(projects.map((p) => [String(p._id), p.key || p.name]));

  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const logsByUser = new Map<string, { total: number; billable: number }>();
  const projectRows = new Map<string, { plannedHours: number; loggedHours: number }>();
  const weeks: Array<{ weekStart: string; start: Date; end: Date; capacityHours: number; plannedHours: number; loggedHours: number; billableHours: number }> = [];
  for (let ws = weekStart(from); ws <= to; ws = addDays(ws, 7)) {
    weeks.push({ weekStart: dayKey(ws), start: ws, end: addDays(ws, 6), capacityHours: 0, plannedHours: 0, loggedHours: 0, billableHours: 0 });
  }

  for (const w of workLogs) {
    const key = String(w.author);
    const hours = (w.minutesSpent ?? 0) / 60;
    const cur = logsByUser.get(key) ?? { total: 0, billable: 0 };
    cur.total += hours;
    if (w.billable !== false) cur.billable += hours;
    logsByUser.set(key, cur);
    const pid = projectByIssue.get(String(w.issue))!;
    const pr = projectRows.get(pid) ?? { plannedHours: 0, loggedHours: 0 };
    pr.loggedHours += hours;
    projectRows.set(pid, pr);
    const wk = weeks.find((x) => w.date >= x.start && w.date < addDays(x.end, 1));
    if (wk) {
      wk.loggedHours += hours;
      if (w.billable !== false) wk.billableHours += hours;
    }
  }

  const people = members.map((m) => {
    const list = byUser.get(m.userId) ?? [];
    const capacityHours = (m.capacityHoursPerWeek * periodDays) / 7;
    let plannedHours = 0;
    let billablePlanned = 0;
    let softHours = 0;
    for (const a of list) {
      const h = allocationHours(a, m.capacityHoursPerWeek, from, to);
      if (a.softBooked) {
        softHours += h;
        continue;
      }
      plannedHours += h;
      if (a.billable !== false) billablePlanned += h;
      const pid = refId(a.projectId);
      const pr = projectRows.get(pid) ?? { plannedHours: 0, loggedHours: 0 };
      pr.plannedHours += h;
      projectRows.set(pid, pr);
    }
    for (const wk of weeks) {
      const days = overlapDays(wk.start, wk.end, from, to);
      wk.capacityHours += (m.capacityHoursPerWeek * days) / 7;
      for (const a of list) {
        if (!a.softBooked) wk.plannedHours += allocationHours(a, m.capacityHoursPerWeek, wk.start < from ? from : wk.start, wk.end > to ? to : wk.end);
      }
    }
    const logged = logsByUser.get(m.userId) ?? { total: 0, billable: 0 };
    const pct = (n: number) => (capacityHours > 0 ? round1((n / capacityHours) * 100) : 0);
    const plannedPercent = round1(weightedPercent(list, from, to));
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      department: m.department,
      skills: m.skills,
      capacityHoursPerWeek: m.capacityHoursPerWeek,
      capacityHours: round1(capacityHours),
      plannedPercent,
      billablePercent: round1(weightedPercent(list, from, to, (a) => !a.softBooked && a.billable !== false)),
      plannedHours: round1(plannedHours),
      billablePlannedHours: round1(billablePlanned),
      softHours: round1(softHours),
      loggedHours: round1(logged.total),
      billableLoggedHours: round1(logged.billable),
      utilizationPct: pct(logged.total),
      billableUtilizationPct: pct(logged.billable),
      varianceHours: round1(logged.total - plannedHours),
      overAllocated: plannedPercent > settings.overAllocationPct,
      peakPercent: loadSegments(list, from, to).reduce((mx, s) => Math.max(mx, s.hardPct), 0),
    };
  });
  people.sort((a, b) => b.plannedPercent - a.plannedPercent);

  const sum = (f: (p: (typeof people)[number]) => number) => people.reduce((s, p) => s + f(p), 0);
  const totalCapacity = sum((p) => p.capacityHours);
  const totals = {
    capacityHours: round1(totalCapacity),
    plannedHours: round1(sum((p) => p.plannedHours)),
    loggedHours: round1(sum((p) => p.loggedHours)),
    billableLoggedHours: round1(sum((p) => p.billableLoggedHours)),
  };

  return {
    from: dayKey(from),
    to: dayKey(to),
    periodDays,
    settings,
    departments: departmentsOf(allMembers),
    summary: {
      teamSize: people.length,
      ...totals,
      avgPlannedUtilization: totalCapacity > 0 ? round1((totals.plannedHours / totalCapacity) * 100) : 0,
      avgLoggedUtilization: totalCapacity > 0 ? round1((totals.loggedHours / totalCapacity) * 100) : 0,
      billableUtilization: totalCapacity > 0 ? round1((totals.billableLoggedHours / totalCapacity) * 100) : 0,
      overAllocated: people.filter((p) => p.overAllocated || p.peakPercent > settings.overAllocationPct).length,
      underUtilized: people.filter((p) => p.plannedPercent < settings.benchThresholdPct).length,
      loggedBelowPlan: people.filter((p) => p.plannedHours > 0 && p.loggedHours < p.plannedHours * 0.8).length,
    },
    weeks: weeks.map(({ start: _s, end: _e, ...w }) => ({
      ...w,
      capacityHours: Math.round(w.capacityHours),
      plannedHours: Math.round(w.plannedHours),
      loggedHours: round1(w.loggedHours),
      billableHours: round1(w.billableHours),
    })),
    byProject: [...projectRows.entries()]
      .map(([id, r]) => ({ projectId: id, name: projectName.get(id) ?? 'Project', plannedHours: Math.round(r.plannedHours), loggedHours: round1(r.loggedHours) }))
      .sort((a, b) => b.plannedHours + b.loggedHours - (a.plannedHours + a.loggedHours))
      .slice(0, 12),
    people,
  };
}

/* ─── Bench ──────────────────────────────────────────────────────────────── */

export async function getBench(
  workspaceId: string | null | undefined,
  query: { threshold?: number; days?: number } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const threshold = Number.isFinite(query.threshold) ? Math.min(100, Math.max(0, Number(query.threshold))) : settings.benchThresholdPct;
  const days = Number.isFinite(query.days) ? Math.min(366, Math.max(1, Math.round(Number(query.days)))) : settings.freeingSoonDays;
  const now = todayUtc();
  const scanTo = addDays(now, Math.max(days, settings.conflictLookaheadDays));
  const next4w = addDays(now, 27);

  const [members, allocations] = await Promise.all([
    loadMembers(orgOid, settings),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: scanTo },
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    })
      .populate('userId', 'name email')
      .populate('projectId', 'name key')
      .lean(),
  ]);
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const soonTo = addDays(now, days);

  const people = members.map((m) => {
    const list = byUser.get(m.userId) ?? [];
    const { hardPct, softPct } = loadOn(list, now);
    const blockedUntil = m.availableFrom && startOfUtcDay(m.availableFrom) > now ? startOfUtcDay(m.availableFrom) : null;
    const segments = loadSegments(list, blockedUntil ?? now, scanTo);
    const freeSeg = segments.find((s) => s.hardPct < threshold);
    const nextFreeDate = freeSeg ? freeSeg.start : null;
    const freeHours = loadSegments(list, blockedUntil && blockedUntil > now ? blockedUntil : now, next4w).reduce(
      (s, seg) => s + (m.capacityHoursPerWeek / 7) * seg.days * Math.max(0, 100 - seg.hardPct) / 100,
      0
    );
    const onBench = !blockedUntil && hardPct < threshold;
    const current = (list as unknown as typeof allocations).filter((a) => overlapDays(a.startDate, a.endDate, now, now) > 0);
    const upcoming = (list as unknown as typeof allocations).filter((a) => startOfUtcDay(a.startDate) > now);
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      skills: m.skills,
      department: m.department,
      seniority: m.seniority,
      location: m.location,
      capacityHoursPerWeek: m.capacityHoursPerWeek,
      availableFrom: m.availableFrom,
      committedPercent: round1(hardPct),
      softPercent: round1(softPct),
      availablePercent: Math.max(0, round1(100 - hardPct)),
      freeHoursNext4Weeks: round1(freeHours),
      nextFreeDate: nextFreeDate ? dayKey(nextFreeDate) : null,
      onBench,
      rollingOff: !onBench && !!nextFreeDate && nextFreeDate <= soonTo,
      projects: current.map((a) => {
        const proj = a.projectId as { _id?: unknown; name?: string; key?: string } | null;
        return { allocationId: String(a._id), id: refId(a.projectId), name: proj?.name, key: proj?.key, percent: a.percent, softBooked: a.softBooked, endDate: a.endDate ?? null };
      }),
      upcoming: upcoming.map((a) => {
        const proj = a.projectId as { name?: string; key?: string } | null;
        return { allocationId: String(a._id), name: proj?.name, key: proj?.key, percent: a.percent, softBooked: a.softBooked, startDate: a.startDate };
      }),
    };
  });
  people.sort((a, b) => Number(b.onBench) - Number(a.onBench) || b.freeHoursNext4Weeks - a.freeHoursNext4Weeks);

  return {
    threshold,
    days,
    today: dayKey(now),
    summary: {
      onBench: people.filter((p) => p.onBench).length,
      rollingOff: people.filter((p) => p.rollingOff).length,
      freeHoursNext4Weeks: Math.round(people.reduce((s, p) => s + p.freeHoursNext4Weeks, 0)),
      benchHoursPerWeek: Math.round(
        people.filter((p) => p.onBench).reduce((s, p) => s + (p.capacityHoursPerWeek * p.availablePercent) / 100, 0)
      ),
    },
    people,
    /** Back-compat: people currently on the bench. */
    available: people.filter((p) => p.onBench),
    freeingSoon: allocations
      .filter((a) => !a.softBooked && a.endDate && startOfUtcDay(a.endDate) >= now && startOfUtcDay(a.endDate) <= soonTo)
      .sort((a, b) => +a.endDate! - +b.endDate!)
      .map((a) => ({
        allocationId: String(a._id),
        userId: refId(a.userId),
        user: a.userId,
        project: a.projectId,
        percent: a.percent,
        endDate: a.endDate,
      })),
  };
}

/* ─── Demands ────────────────────────────────────────────────────────────── */

function parseHours(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'hoursNeeded must be a non-negative number');
  return n;
}

function cleanSkills(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const s = String(raw ?? '').trim();
    if (!s || seen.has(normalizeSkill(s))) continue;
    seen.add(normalizeSkill(s));
    out.push(s);
  }
  return out;
}

async function demandWithProgress(orgId: string, id: unknown): Promise<DemandRow | null> {
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const demand = await ResourceDemand.findOne({ _id: id, taskflowOrganizationId: orgOid }).populate('projectId', 'name key').lean();
  if (!demand) return null;
  const members = await loadMembers(orgOid, settings);
  const linked = await ResourceAllocation.find({ taskflowOrganizationId: orgOid, demandId: demand._id }).lean();
  return toDemandRow(demand as unknown as Record<string, unknown> & DemandLean, demandProgress(demand, linked, capacityMap(members, settings)));
}

export async function listDemands(
  workspaceId: string | null | undefined,
  query: { status?: string } = {}
): Promise<Array<DemandRow & { assignees: Array<{ allocationId: string; userId: string; name?: string; percent: number; softBooked: boolean }> }>> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid };
  if (query.status === 'active') filter.status = { $in: OPEN_DEMAND };
  else if (query.status && (DEMAND_STATUSES as readonly string[]).includes(query.status)) filter.status = query.status;
  const [demands, members] = await Promise.all([
    ResourceDemand.find(filter).populate('projectId', 'name key').sort({ periodStart: 1 }).lean(),
    loadMembers(orgOid, settings),
  ]);
  const linked = demands.length
    ? await ResourceAllocation.find({ taskflowOrganizationId: orgOid, demandId: { $in: demands.map((d) => d._id) } })
        .populate('userId', 'name email')
        .lean()
    : [];
  const capacityOf = capacityMap(members, settings);
  return demands.map((d) => {
    const mine = linked.filter((a) => String(a.demandId) === String(d._id));
    return {
      ...toDemandRow(d as unknown as Record<string, unknown> & DemandLean, demandProgress(d, mine as unknown as AllocLike[], capacityOf)),
      assignees: mine.map((a) => ({
        allocationId: String(a._id),
        userId: refId(a.userId),
        name: (a.userId as { name?: string })?.name,
        percent: a.percent,
        softBooked: a.softBooked,
      })),
    };
  });
}

interface DemandInput {
  title?: string;
  projectId?: string | null;
  roleLabel?: string;
  hoursNeeded?: number;
  periodStart?: string;
  periodEnd?: string;
  priority?: string;
  status?: string;
  skills?: string[];
  notes?: string;
}

export async function createDemand(workspaceId: string | null | undefined, actorId: string, input: DemandInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.title?.trim() || !input.periodStart || !input.periodEnd) {
    throw new ApiError(400, 'title, periodStart, and periodEnd are required');
  }
  const hoursNeeded = parseHours(input.hoursNeeded);
  const periodStart = parseDay(input.periodStart, todayUtc());
  const periodEnd = parseDay(input.periodEnd, periodStart);
  if (periodEnd < periodStart) throw new ApiError(400, 'periodEnd must be on or after periodStart');
  if (input.projectId) await assertProjectInWorkspace(orgId, input.projectId);
  const priority = (DEMAND_PRIORITIES as readonly string[]).includes(input.priority ?? '') ? input.priority : 'medium';
  const status = (DEMAND_STATUSES as readonly string[]).includes(input.status ?? '') ? input.status : 'open';

  const doc = await ResourceDemand.create({
    taskflowOrganizationId: orgOid,
    title: input.title.trim(),
    projectId: input.projectId || null,
    roleLabel: input.roleLabel?.trim() || undefined,
    hoursNeeded,
    periodStart,
    periodEnd,
    priority,
    status,
    skills: cleanSkills(input.skills),
    notes: input.notes,
    createdBy: actorId,
  });
  logAudit({
    userId: actorId,
    action: 'create',
    resourceType: 'resource_demand',
    resourceId: String(doc._id),
    projectId: input.projectId || undefined,
    meta: { title: doc.title, hoursNeeded, priority },
  });
  return demandWithProgress(orgId, doc._id);
}

export async function updateDemand(workspaceId: string | null | undefined, actorId: string, id: string, input: DemandInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Demand not found');
  const existing = await ResourceDemand.findOne({ _id: id, taskflowOrganizationId: orgOid });
  if (!existing) throw new ApiError(404, 'Demand not found');

  if (input.title !== undefined) {
    if (!input.title.trim()) throw new ApiError(400, 'title is required');
    existing.title = input.title.trim();
  }
  if (input.projectId !== undefined) {
    if (input.projectId) {
      await assertProjectInWorkspace(orgId, input.projectId);
      existing.projectId = new mongoose.Types.ObjectId(input.projectId);
    } else {
      existing.projectId = null;
    }
  }
  if (input.roleLabel !== undefined) existing.roleLabel = String(input.roleLabel ?? '').trim() || undefined;
  if (input.hoursNeeded !== undefined) existing.hoursNeeded = parseHours(input.hoursNeeded);
  if (input.periodStart) existing.periodStart = parseDay(input.periodStart, existing.periodStart);
  if (input.periodEnd) existing.periodEnd = parseDay(input.periodEnd, existing.periodEnd);
  if (existing.periodEnd < existing.periodStart) throw new ApiError(400, 'periodEnd must be on or after periodStart');
  if (input.priority) {
    if (!(DEMAND_PRIORITIES as readonly string[]).includes(input.priority)) throw new ApiError(400, 'Invalid priority');
    existing.priority = input.priority as typeof existing.priority;
  }
  if (input.status) {
    if (!(DEMAND_STATUSES as readonly string[]).includes(input.status)) throw new ApiError(400, 'Invalid status');
    existing.status = input.status as typeof existing.status;
  }
  if (input.skills) existing.skills = cleanSkills(input.skills);
  if (input.notes !== undefined) existing.notes = input.notes;

  await existing.save();
  logAudit({
    userId: actorId,
    action: 'update',
    resourceType: 'resource_demand',
    resourceId: id,
    meta: { fields: Object.keys(input) },
  });
  return demandWithProgress(orgId, existing._id);
}

export async function deleteDemand(workspaceId: string | null | undefined, actorId: string, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Demand not found');
  const result = await ResourceDemand.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid });
  if (!result) throw new ApiError(404, 'Demand not found');
  // Allocations stay; they just stop pointing at the removed demand.
  await ResourceAllocation.updateMany({ taskflowOrganizationId: orgOid, demandId: result._id }, { $set: { demandId: null } });
  logAudit({ userId: actorId, action: 'delete', resourceType: 'resource_demand', resourceId: id, meta: { title: result.title } });
  return { deleted: true };
}

/** Ranks workspace members for a demand by skill match and free hours inside the demand period. */
export async function getDemandCandidates(workspaceId: string | null | undefined, id: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const demand = await demandWithProgress(orgId, id);
  if (!demand) throw new ApiError(404, 'Demand not found');
  const now = todayUtc();
  const from = demand.periodStart > now ? startOfUtcDay(demand.periodStart) : now;
  const to = startOfUtcDay(demand.periodEnd);
  const [members, allocations] = await Promise.all([
    loadMembers(orgOid, settings),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: to },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    }).lean(),
  ]);
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const wanted = demand.skills.map(normalizeSkill);
  const role = demand.roleLabel ? normalizeSkill(demand.roleLabel) : '';
  const periodDays = to >= from ? overlapDays(from, to, from, to) : 0;

  const candidates = members.map((m) => {
    const list = byUser.get(m.userId) ?? [];
    const have = new Set(m.skills.map(normalizeSkill));
    const matched = demand.skills.filter((s) => have.has(normalizeSkill(s)));
    const missing = demand.skills.filter((s) => !have.has(normalizeSkill(s)));
    const blockedUntil = m.availableFrom && startOfUtcDay(m.availableFrom) > from ? startOfUtcDay(m.availableFrom) : null;
    const segs = periodDays > 0 ? loadSegments(list, blockedUntil ?? from, to) : [];
    const freeHours = segs.reduce((s, seg) => s + (m.capacityHoursPerWeek / 7) * seg.days * Math.max(0, 100 - seg.hardPct) / 100, 0);
    const peakHard = segs.reduce((mx, s) => Math.max(mx, s.hardPct), 0);
    const roleHit =
      !!role &&
      [m.seniority, m.department, ...m.skills, ...list.map((a) => (a as { roleLabel?: string }).roleLabel)]
        .filter(Boolean)
        .some((v) => normalizeSkill(String(v)).includes(role) || role.includes(normalizeSkill(String(v))));
    const skillScore = wanted.length === 0 ? 1 : matched.length / wanted.length;
    const coverage = demand.remainingHours > 0 ? Math.min(1, freeHours / demand.remainingHours) : 1;
    const score = Math.round(skillScore * 55 + coverage * 35 + (roleHit ? 10 : 0));
    const hoursPerPctPeriod = (m.capacityHoursPerWeek / 7) * periodDays / 100;
    const neededPct = hoursPerPctPeriod > 0 ? Math.ceil(demand.remainingHours / hoursPerPctPeriod) : 100;
    const suggestedPercent = Math.max(0, Math.min(100, neededPct, Math.floor(settings.overAllocationPct - peakHard)));
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      department: m.department,
      seniority: m.seniority,
      skills: m.skills,
      matchedSkills: matched,
      missingSkills: missing,
      roleMatch: roleHit,
      capacityHoursPerWeek: m.capacityHoursPerWeek,
      peakCommittedPercent: peakHard,
      freeHours: round1(freeHours),
      availableFrom: blockedUntil ? dayKey(blockedUntil) : null,
      suggestedPercent,
      score,
    };
  });
  candidates.sort((a, b) => b.score - a.score || b.freeHours - a.freeHours);
  return { demand, period: { from: dayKey(from), to: dayKey(to), days: periodDays }, candidates };
}

/** Books a person against a demand: creates a linked allocation and updates the demand's fill state. */
export async function fulfilDemand(
  workspaceId: string | null | undefined,
  actorId: string,
  id: string,
  input: { userId?: string; percent?: number; startDate?: string; endDate?: string | null; softBooked?: boolean; billable?: boolean; projectId?: string; roleLabel?: string; notes?: string }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Demand not found');
  const demand = await ResourceDemand.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean();
  if (!demand) throw new ApiError(404, 'Demand not found');
  if (demand.status === 'cancelled') throw new ApiError(400, 'Demand is cancelled');
  const projectId = input.projectId || (demand.projectId ? String(demand.projectId) : '');
  if (!projectId) throw new ApiError(400, 'Choose a project for this booking — the demand has none');
  const now = todayUtc();
  const defaultStart = demand.periodStart > now ? demand.periodStart : now;
  const result = await createAllocation(orgId, actorId, {
    userId: input.userId,
    projectId,
    percent: input.percent,
    startDate: input.startDate || dayKey(defaultStart),
    endDate: input.endDate === undefined ? dayKey(demand.periodEnd) : input.endDate,
    softBooked: input.softBooked,
    billable: input.billable,
    roleLabel: input.roleLabel ?? demand.roleLabel,
    notes: input.notes,
    demandId: id,
  });
  logAudit({
    userId: actorId,
    action: 'fulfil',
    resourceType: 'resource_demand',
    resourceId: id,
    meta: { userId: input.userId, percent: input.percent },
  });
  return { ...result, demand: await demandWithProgress(orgId, id) };
}

/* ─── Forecast ───────────────────────────────────────────────────────────── */

export async function getForecast(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const from = weekStart(todayUtc());
  const weeksCount = settings.forecastHorizonWeeks;
  const horizon = addDays(from, weeksCount * 7 - 1);

  const members = await loadMembers(orgOid, settings);
  const [demands, allocations] = await Promise.all([
    openDemandsWithProgress(orgId, members, settings, { periodStart: { $lte: horizon }, periodEnd: { $gte: from } }),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: horizon },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    }).lean(),
  ]);
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const weeks = weeklySupplyDemand(members, byUser, demands, from, weeksCount);
  const totalCapacity = weeks.reduce((s, w) => s + w.capacityHours, 0);
  const committed = weeks.reduce((s, w) => s + w.committedHours, 0);
  const available = weeks.reduce((s, w) => s + w.availableHours, 0);
  const demandHrs = weeks.reduce((s, w) => s + w.demandHours, 0);
  const gapHrs = demandHrs - available;

  // Skill coverage across open demand: how many free-ish people hold each requested skill.
  const skillNeeds = new Map<string, { skill: string; demandHours: number; demands: number; people: number }>();
  for (const d of demands) {
    for (const s of d.skills ?? []) {
      const k = normalizeSkill(s);
      const cur = skillNeeds.get(k) ?? { skill: s, demandHours: 0, demands: 0, people: 0 };
      cur.demandHours += d.remainingHours / Math.max(1, d.skills.length);
      cur.demands += 1;
      skillNeeds.set(k, cur);
    }
  }
  for (const m of members) {
    const load = loadOn(byUser.get(m.userId) ?? [], todayUtc()).hardPct;
    if (load >= settings.busyThresholdPct) continue;
    for (const s of m.skills) {
      const cur = skillNeeds.get(normalizeSkill(s));
      if (cur) cur.people += 1;
    }
  }

  return {
    horizonDays: weeksCount * 7,
    horizonWeeks: weeksCount,
    from: dayKey(from),
    to: dayKey(horizon),
    settings,
    supply: {
      teamSize: members.length,
      totalCapacityHours: Math.round(totalCapacity),
      committedHours: Math.round(committed),
      avgCommittedPercent: totalCapacity > 0 ? round1((committed / totalCapacity) * 100) : 0,
      availableHours: Math.round(available),
    },
    demand: {
      openCount: demands.length,
      hoursNeeded: Math.round(demandHrs),
      unfilledHours: Math.round(demands.reduce((s, d) => s + d.remainingHours, 0)),
      items: demands,
    },
    weeks,
    skillCoverage: [...skillNeeds.values()]
      .map((s) => ({ ...s, demandHours: Math.round(s.demandHours) }))
      .sort((a, b) => a.people - b.people || b.demandHours - a.demandHours),
    gapHours: Math.round(gapHrs),
    shortfall: gapHrs > 0,
    shortWeeks: weeks.filter((w) => w.gapHours > 0).length,
  };
}

/* ─── Team / profiles ────────────────────────────────────────────────────── */

export async function listProfiles(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const now = todayUtc();
  const [members, allocations] = await Promise.all([
    loadMembers(orgOid, settings),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    })
      .populate('projectId', 'name key')
      .lean(),
  ]);
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  return members.map((m) => {
    const list = (byUser.get(m.userId) ?? []) as unknown as typeof allocations;
    const { hardPct, softPct } = loadOn(list, now);
    return {
      ...m,
      committedPercent: round1(hardPct),
      softPercent: round1(softPct),
      activeProjects: list
        .filter((a) => overlapDays(a.startDate, a.endDate, now, now) > 0)
        .map((a) => {
          const p = a.projectId as { _id?: unknown; name?: string; key?: string } | null;
          return { id: refId(a.projectId), name: p?.name, key: p?.key, percent: a.percent, softBooked: a.softBooked };
        }),
      upcomingCount: list.filter((a) => startOfUtcDay(a.startDate) > now).length,
    };
  });
}

interface ProfileInput {
  userId?: string;
  capacityHoursPerWeek?: number;
  skills?: string[];
  seniority?: string;
  department?: string;
  location?: string;
  availableFrom?: string | null;
  notes?: string;
}

function profileUpdate(input: ProfileInput) {
  const update: Record<string, unknown> = {};
  if (input.capacityHoursPerWeek != null && (input.capacityHoursPerWeek as unknown) !== '') {
    const hrs = Number(input.capacityHoursPerWeek);
    if (!Number.isFinite(hrs) || hrs < 1 || hrs > 168) throw new ApiError(400, 'capacityHoursPerWeek must be between 1 and 168');
    update.capacityHoursPerWeek = hrs;
  }
  if (input.skills) update.skills = cleanSkills(input.skills);
  if (input.seniority !== undefined) update.seniority = String(input.seniority ?? '').trim() || undefined;
  if (input.department !== undefined) update.department = String(input.department ?? '').trim() || undefined;
  if (input.location !== undefined) update.location = String(input.location ?? '').trim() || undefined;
  if (input.availableFrom !== undefined) update.availableFrom = input.availableFrom ? parseDay(input.availableFrom, todayUtc()) : null;
  if (input.notes !== undefined) update.notes = input.notes;
  return update;
}

export async function upsertProfile(workspaceId: string | null | undefined, actorId: string, input: ProfileInput) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  if (!input.userId) throw new ApiError(400, 'userId is required');
  await assertActiveMember(orgOid, input.userId);
  const update = profileUpdate(input);
  const doc = await ResourceProfile.findOneAndUpdate(
    { taskflowOrganizationId: orgOid, userId: input.userId },
    { $set: update, $setOnInsert: { taskflowOrganizationId: orgOid, userId: input.userId } },
    { upsert: true, new: true }
  ).lean();
  logAudit({ userId: actorId, action: 'update', resourceType: 'resource_profile', resourceId: String(doc?._id), meta: { userId: input.userId, fields: Object.keys(update) } });

  const settings = await getResourceSettings(orgId);
  const user = await User.findById(input.userId).select('name email').lean();
  return {
    userId: input.userId,
    name: user?.name,
    email: user?.email,
    capacityHoursPerWeek: doc?.capacityHoursPerWeek ?? settings.defaultCapacityHoursPerWeek,
    skills: doc?.skills ?? [],
    seniority: doc?.seniority,
    department: doc?.department,
    location: doc?.location,
    availableFrom: doc?.availableFrom ?? null,
    notes: doc?.notes,
    profileId: String(doc?._id),
  };
}

/** Applies the same capacity / department / skills change to several people at once. */
export async function bulkUpdateProfiles(
  workspaceId: string | null | undefined,
  actorId: string,
  input: ProfileInput & { userIds?: string[]; addSkills?: string[]; removeSkills?: string[] }
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const ids = [...new Set((input.userIds ?? []).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (ids.length === 0) throw new ApiError(400, 'userIds is required');
  if (ids.length > 500) throw new ApiError(400, 'Too many people in one update');
  const active = new Set((await activeMemberIds(orgOid)).map(String));
  const targets = ids.filter((id) => active.has(id));
  const { skills: _ignored, ...rest } = input;
  const update = profileUpdate({ ...rest, userId: undefined });
  const add = cleanSkills(input.addSkills);
  const remove = new Set(cleanSkills(input.removeSkills).map(normalizeSkill));

  const existing = await ResourceProfile.find({ taskflowOrganizationId: orgOid, userId: { $in: targets } }).lean();
  const byUser = new Map(existing.map((p) => [String(p.userId), p]));
  await Promise.all(
    targets.map((userId) => {
      const set: Record<string, unknown> = { ...update };
      if (add.length || remove.size) {
        const current = byUser.get(userId)?.skills ?? [];
        set.skills = cleanSkills([...current, ...add]).filter((s) => !remove.has(normalizeSkill(s)));
      }
      return ResourceProfile.findOneAndUpdate(
        { taskflowOrganizationId: orgOid, userId },
        { $set: set, $setOnInsert: { taskflowOrganizationId: orgOid, userId } },
        { upsert: true }
      );
    })
  );
  logAudit({ userId: actorId, action: 'bulk_update', resourceType: 'resource_profile', meta: { count: targets.length, fields: Object.keys(update), add, remove: [...remove] } });
  return { updated: targets.length, skipped: ids.length - targets.length };
}

/* ─── Skills ─────────────────────────────────────────────────────────────── */

export async function getSkills(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const now = todayUtc();
  const members = await loadMembers(orgOid, settings);
  const [allocations, demands] = await Promise.all([
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: now },
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    }).lean(),
    openDemandsWithProgress(orgId, members, settings),
  ]);
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const skills = new Map<
    string,
    {
      skill: string;
      people: Array<{ userId: string; name: string; committedPercent: number; available: boolean; department?: string }>;
      demands: Array<{ demandId: string; title: string; remainingHours: number; priority: string }>;
      demandHours: number;
    }
  >();
  const entry = (s: string) => {
    const k = normalizeSkill(s);
    const cur = skills.get(k) ?? { skill: s.trim(), people: [], demands: [], demandHours: 0 };
    skills.set(k, cur);
    return cur;
  };
  for (const m of members) {
    const load = loadOn(byUser.get(m.userId) ?? [], now).hardPct;
    for (const s of m.skills) {
      entry(s).people.push({
        userId: m.userId,
        name: m.name,
        committedPercent: round1(load),
        available: load < settings.busyThresholdPct,
        department: m.department,
      });
    }
  }
  for (const d of demands) {
    for (const s of d.skills ?? []) {
      const e = entry(s);
      e.demands.push({ demandId: String(d._id), title: d.title, remainingHours: d.remainingHours, priority: d.priority });
      e.demandHours += d.remainingHours;
    }
  }
  const rows = [...skills.values()].map((s) => {
    const availablePeople = s.people.filter((p) => p.available).length;
    return {
      ...s,
      demandHours: Math.round(s.demandHours),
      peopleCount: s.people.length,
      availablePeople,
      /** Open demand with nobody holding the skill who has room to take it. */
      gap: s.demands.length > 0 && availablePeople === 0,
    };
  });
  rows.sort((a, b) => Number(b.gap) - Number(a.gap) || b.demandHours - a.demandHours || b.peopleCount - a.peopleCount);
  return {
    skills: rows,
    summary: {
      skills: rows.length,
      gaps: rows.filter((r) => r.gap).length,
      peopleWithoutSkills: members.filter((m) => m.skills.length === 0).length,
      singlePointSkills: rows.filter((r) => r.peopleCount === 1).length,
    },
  };
}

/* ─── Schedule (timeline) ────────────────────────────────────────────────── */

export async function getSchedule(
  workspaceId: string | null | undefined,
  query: { from?: string; weeks?: number; projectId?: string; department?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const from = weekStart(parseDay(query.from, todayUtc()));
  const weeksCount = Number.isFinite(query.weeks) ? Math.min(52, Math.max(1, Math.round(Number(query.weeks)))) : 12;
  const to = addDays(from, weeksCount * 7 - 1);

  const allMembers = await loadMembers(orgOid, settings);
  const members = query.department ? allMembers.filter((m) => (m.department ?? '') === query.department) : allMembers;
  const allocations = await populateAllocationQuery(
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      startDate: { $lte: to },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    })
  ).lean();
  const byUser = groupByUser(allocations as unknown as AllocLike[]);
  const weekStarts = Array.from({ length: weeksCount }, (_, i) => addDays(from, i * 7));

  const people = members
    .map((m) => {
      const list = (byUser.get(m.userId) ?? []) as unknown as typeof allocations;
      const shown = query.projectId ? list.filter((a) => refId(a.projectId) === query.projectId) : list;
      return {
        userId: m.userId,
        name: m.name,
        email: m.email,
        department: m.department,
        capacityHoursPerWeek: m.capacityHoursPerWeek,
        weeks: weekStarts.map((ws) => {
          const we = addDays(ws, 6);
          const segs = loadSegments(list, ws, we);
          return {
            weekStart: dayKey(ws),
            hardPct: Math.round(weightedPercent(list, ws, we)),
            softPct: Math.round(weightedPercent(list, ws, we, (a) => a.softBooked)),
            peakPct: segs.reduce((mx, s) => Math.max(mx, s.hardPct), 0),
          };
        }),
        allocations: shown,
      };
    })
    .filter((p) => !query.projectId || p.allocations.length > 0);

  const projects = new Map<string, { projectId: string; name?: string; key?: string; people: Set<string>; weeks: number[] }>();
  for (const a of allocations) {
    if (a.softBooked) continue;
    const pid = refId(a.projectId);
    if (query.projectId && pid !== query.projectId) continue;
    const proj = a.projectId as { name?: string; key?: string } | null;
    const cur = projects.get(pid) ?? { projectId: pid, name: proj?.name, key: proj?.key, people: new Set(), weeks: weekStarts.map(() => 0) };
    cur.people.add(refId(a.userId));
    weekStarts.forEach((ws, i) => {
      cur.weeks[i] += weightedPercent([a as unknown as AllocLike], ws, addDays(ws, 6)) / 100;
    });
    projects.set(pid, cur);
  }

  return {
    from: dayKey(from),
    to: dayKey(to),
    weeks: weekStarts.map(dayKey),
    settings,
    departments: departmentsOf(allMembers),
    people,
    projects: [...projects.values()]
      .map((p) => ({ projectId: p.projectId, name: p.name, key: p.key, people: p.people.size, weeksFte: p.weeks.map(round1) }))
      .sort((a, b) => (a.key ?? a.name ?? '').localeCompare(b.key ?? b.name ?? '')),
  };
}

/* ─── Options ────────────────────────────────────────────────────────────── */

export async function listTeamOptions(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const settings = await getResourceSettings(orgId);
  const [members, projects, demands] = await Promise.all([
    loadMembers(orgOid, settings),
    Project.find({ taskflowOrganizationId: orgId, archived: { $ne: true } }).select('name key').sort({ name: 1 }).lean(),
    ResourceDemand.find({ taskflowOrganizationId: orgOid, status: { $in: OPEN_DEMAND } }).select('title projectId').sort({ periodStart: 1 }).lean(),
  ]);
  return {
    users: members.map((m) => ({ id: m.userId, name: m.name, email: m.email, department: m.department, skills: m.skills })),
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, key: p.key })),
    demands: demands.map((d) => ({ id: String(d._id), title: d.title, projectId: d.projectId ? String(d.projectId) : null })),
    departments: departmentsOf(members),
    settings,
  };
}
