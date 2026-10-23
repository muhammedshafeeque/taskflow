import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { Sprint } from '../sprints/sprint.model';
import { Milestone } from '../milestones/milestone.model';
import { WorkLog } from '../workLogs/workLog.model';
import { StageEstimate } from '../stageEstimates/stageEstimate.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsHoliday, HrmsSettings } from '../hrms/models/hrmsPolicy.model';
import { ResourceAllocation } from './models/resourceAllocation.model';
import { ResourceProfile } from './models/resourceProfile.model';
import { ResourceSettings } from './models/resourceSettings.model';
import { requireWorkspaceId, toOrgOid } from './resourcesWorkspace';

/**
 * Employee engagement: how busy each person is on each day of a date range (past or future),
 * and when they become available.
 *
 * Per working day, engagement = max(committed allocation %, task hours / daily capacity).
 *
 * Task hours come from open, assigned leaf issues, using the most specific data available:
 *   hours  — stage (lane) estimates for lanes the issue hasn't passed yet, credited to the lane's
 *            assignee; else the issue time estimate; else story points × hoursPerStoryPoint; else
 *            defaultTaskHours (both workspace settings, off by default). Logged time is subtracted.
 *   window — start: startDate → sprint start → today; end: dueDate → sprint end → milestone due date.
 * Work with a window is spread over the person's working capacity in that window. Overdue work (and work
 * whose window has no capacity, e.g. fully on leave) is placed from today into each day's spare capacity.
 * Work with no end date at all is reported as unscheduled rather than invented onto the calendar.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 184;
const BUSY_PCT = 80;

export type EngagementDayKind = 'work' | 'weekend' | 'holiday' | 'leave' | 'half_leave';
export type EngagementLevel = 'off' | 'free' | 'partial' | 'busy' | 'over';
type HoursSource = 'stage' | 'estimate' | 'points' | 'default' | 'none';
type WindowSource = 'due' | 'sprint' | 'milestone' | 'none';
type Schedule = 'scheduled' | 'overdue' | 'unscheduled';

export interface EngagementDay {
  date: string;
  kind: EngagementDayKind;
  capacityHours: number;
  allocatedPct: number;
  softPct: number;
  taskHours: number;
  /** Portion of taskHours that is overdue work back-filled into spare capacity. */
  overdueHours: number;
  taskCount: number;
  taskPct: number;
  engagementPct: number;
  level: EngagementLevel;
  note?: string;
}

interface WorkItem {
  userId: string;
  issueId: string;
  key?: string;
  title: string;
  status: string;
  priority?: string;
  project?: { id: string; name?: string; key?: string };
  lane?: string;
  hoursSource: HoursSource;
  estimateHours: number;
  loggedHours: number;
  remainingHours: number;
  overEstimate: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  windowSource: WindowSource;
  schedule: Schedule;
  /** Hours that didn't fit before the end of the requested range (overdue work only). */
  unplacedHours: number;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid date: ${v}`);
  return startOfUtcDay(d);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function levelFor(kind: EngagementDayKind, pct: number, threshold: number): EngagementLevel {
  if (kind !== 'work' && kind !== 'half_leave') return 'off';
  if (pct > 100) return 'over';
  if (pct >= BUSY_PCT) return 'busy';
  if (pct >= threshold) return 'partial';
  return 'free';
}

type ProjectStatusLike = { name?: string; order?: number; isClosed?: boolean; userInLane?: string };

export async function getResourceSettings(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await ResourceSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  return {
    hoursPerStoryPoint: doc?.hoursPerStoryPoint ?? null,
    defaultTaskHours: doc?.defaultTaskHours ?? null,
    includePendingStageEstimates: doc?.includePendingStageEstimates ?? true,
  };
}

export async function updateResourceSettings(
  workspaceId: string | null | undefined,
  input: { hoursPerStoryPoint?: number | null; defaultTaskHours?: number | null; includePendingStageEstimates?: boolean }
) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const update: Record<string, unknown> = {};
  for (const field of ['hoursPerStoryPoint', 'defaultTaskHours'] as const) {
    if (input[field] === undefined) continue;
    if (input[field] === null || (input[field] as unknown) === '') {
      update[field] = null;
      continue;
    }
    const n = Number(input[field]);
    if (!Number.isFinite(n) || n < 0 || n > 200) throw new ApiError(400, `${field} must be between 0 and 200`);
    update[field] = n;
  }
  if (input.includePendingStageEstimates !== undefined) {
    update.includePendingStageEstimates = Boolean(input.includePendingStageEstimates);
  }
  await ResourceSettings.findOneAndUpdate(
    { taskflowOrganizationId: orgOid },
    { $set: update, $setOnInsert: { taskflowOrganizationId: orgOid } },
    { upsert: true }
  );
  return getResourceSettings(workspaceId);
}

export async function getEngagement(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string; userId?: string; projectId?: string; threshold?: number } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const today = startOfUtcDay(new Date());
  const from = parseDay(query.from, today);
  const to = parseDay(query.to, new Date(from.getTime() + 27 * DAY_MS));
  if (to < from) throw new ApiError(400, 'to must be on or after from');
  if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw new ApiError(400, `Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  const threshold = Number.isFinite(query.threshold) ? Math.min(100, Math.max(0, Number(query.threshold))) : 20;
  const rangeEnd = new Date(to.getTime() + DAY_MS - 1);
  // Overdue work fills capacity from today, so calendar facts are needed from today even if the range starts later.
  const calStart = today < from ? today : from;

  let memberIds = (await OrganizationMember.find({ organization: orgOid, status: 'active' }).distinct(
    'user'
  )) as mongoose.Types.ObjectId[];
  if (query.userId) memberIds = memberIds.filter((id) => String(id) === query.userId);
  const memberSet = new Set(memberIds.map(String));

  const projects = await Project.find({ taskflowOrganizationId: orgId }).select('name key statuses').lean();
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const scopedProjectIds = query.projectId
    ? projects.filter((p) => String(p._id) === query.projectId).map((p) => p._id)
    : projects.map((p) => p._id);
  const statusesByProject = new Map(
    projects.map((p) => [String(p._id), ((p as { statuses?: ProjectStatusLike[] }).statuses ?? []) as ProjectStatusLike[]])
  );
  const closedByProject = new Map(
    projects.map((p) => [String(p._id), new Set(getClosedStatusNamesFromStatuses(statusesByProject.get(String(p._id))))])
  );

  const [users, profiles, hrSettings, settings, holidays, employees, allocations, stageRows] = await Promise.all([
    User.find({ _id: { $in: memberIds } }).select('name email').sort({ name: 1 }).lean(),
    ResourceProfile.find({ taskflowOrganizationId: orgOid, userId: { $in: memberIds } }).lean(),
    HrmsSettings.findOne({ taskflowOrganizationId: orgOid }).select('weekendDays').lean(),
    getResourceSettings(orgId),
    HrmsHoliday.find({ taskflowOrganizationId: orgOid, optional: { $ne: true }, date: { $gte: calStart, $lte: rangeEnd } })
      .select('date name')
      .lean(),
    HrmsEmployee.find({ taskflowOrganizationId: orgOid, userId: { $in: memberIds } }).select('_id userId').lean(),
    ResourceAllocation.find({
      taskflowOrganizationId: orgOid,
      userId: { $in: memberIds },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      startDate: { $lte: rangeEnd },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    }).lean(),
    StageEstimate.find({
      project: { $in: scopedProjectIds },
      state: { $in: ['approved', 'pending'] },
    })
      .select('issue laneId assigneeId minutes state createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Issues are in scope when assigned to a member, or when a member owns one of their stage estimates.
  const stageIssueIds = [
    ...new Set(stageRows.filter((s) => s.assigneeId && memberSet.has(String(s.assigneeId))).map((s) => String(s.issue))),
  ];
  const issueRows = await Issue.find({
    project: { $in: scopedProjectIds },
    $or: [{ assignee: { $in: memberIds } }, { _id: { $in: stageIssueIds } }],
  })
    .select('title key status project assignee startDate dueDate timeEstimateMinutes storyPoints priority sprint milestone')
    .lean();

  const openIssues = issueRows.filter((i) => !closedByProject.get(String(i.project))?.has(String(i.status ?? '')));
  const openIds = openIssues.map((i) => i._id);

  const [parentIds, loggedRows, sprints, milestones] = await Promise.all([
    openIds.length === 0 ? [] : Issue.distinct('parent', { parent: { $in: openIds } }),
    openIds.length === 0
      ? []
      : WorkLog.aggregate<{ _id: { issue: mongoose.Types.ObjectId; laneId: string | null }; minutes: number }>([
          { $match: { issue: { $in: openIds } } },
          { $group: { _id: { issue: '$issue', laneId: { $ifNull: ['$laneId', null] } }, minutes: { $sum: '$minutesSpent' } } },
        ]),
    Sprint.find({ _id: { $in: openIssues.map((i) => i.sprint).filter(Boolean) }, status: { $ne: 'completed' } })
      .select('startDate endDate')
      .lean(),
    Milestone.find({ _id: { $in: openIssues.map((i) => i.milestone).filter(Boolean) } }).select('dueDate').lean(),
  ]);
  // Work is counted on leaf issues; a parent's own estimate would double-count its sub-tasks.
  const parentSet = new Set((parentIds as mongoose.Types.ObjectId[]).map(String));
  const sprintById = new Map(sprints.map((s) => [String(s._id), s]));
  const milestoneById = new Map(milestones.map((m) => [String(m._id), m]));
  const loggedByIssue = new Map<string, number>();
  const loggedByLane = new Map<string, number>();
  for (const r of loggedRows) {
    const issue = String(r._id.issue);
    loggedByIssue.set(issue, (loggedByIssue.get(issue) ?? 0) + r.minutes);
    if (r._id.laneId) loggedByLane.set(`${issue}|${r._id.laneId}`, r.minutes);
  }

  // Latest approved estimate per issue+lane; a pending one only when nothing is approved yet.
  const laneEstimates = new Map<string, Map<string, { minutes: number; assigneeId?: string; approved: boolean }>>();
  for (const s of stageRows) {
    const issue = String(s.issue);
    if (s.state === 'pending' && !settings.includePendingStageEstimates) continue;
    const lanes = laneEstimates.get(issue) ?? new Map();
    const existing = lanes.get(s.laneId);
    const isApproved = s.state === 'approved';
    if (!existing || (isApproved && !existing.approved)) {
      lanes.set(s.laneId, { minutes: s.minutes, assigneeId: s.assigneeId ? String(s.assigneeId) : undefined, approved: isApproved });
    }
    laneEstimates.set(issue, lanes);
  }

  /** A lane is finished once the issue's status is past every status that belongs to that lane. */
  function laneFinished(projectId: string, status: string, laneId: string): boolean {
    const statuses = statusesByProject.get(projectId) ?? [];
    const laneOrders = statuses.filter((s) => s.userInLane === laneId).map((s) => s.order ?? 0);
    if (laneOrders.length === 0) return false;
    const current = statuses.find((s) => s.name === status);
    return current?.order != null && current.order > Math.max(...laneOrders);
  }

  const workItems: WorkItem[] = [];
  for (const issue of openIssues) {
    const id = String(issue._id);
    if (parentSet.has(id)) continue;
    const projectId = String(issue.project);
    const proj = projectById.get(projectId);
    const sprint = issue.sprint ? sprintById.get(String(issue.sprint)) : undefined;
    const milestone = issue.milestone ? milestoneById.get(String(issue.milestone)) : undefined;

    let windowEnd: Date | null = null;
    let windowSource: WindowSource = 'none';
    if (issue.dueDate) [windowEnd, windowSource] = [issue.dueDate, 'due'];
    else if (sprint?.endDate) [windowEnd, windowSource] = [sprint.endDate, 'sprint'];
    else if (milestone?.dueDate) [windowEnd, windowSource] = [milestone.dueDate, 'milestone'];
    const windowStart = issue.startDate ?? sprint?.startDate ?? null;
    const end = windowEnd ? startOfUtcDay(windowEnd) : null;
    const schedule: Schedule = !end ? 'unscheduled' : end < today ? 'overdue' : 'scheduled';

    const base = {
      issueId: id,
      key: issue.key,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      project: proj ? { id: projectId, name: proj.name, key: proj.key } : undefined,
      windowStart: windowStart ? dayKey(startOfUtcDay(windowStart)) : null,
      windowEnd: end ? dayKey(end) : null,
      windowSource,
      schedule,
      unplacedHours: 0,
    };

    const lanes = laneEstimates.get(id);
    if (lanes && lanes.size > 0) {
      for (const [laneId, est] of lanes) {
        const owner = est.assigneeId ?? (issue.assignee ? String(issue.assignee) : undefined);
        if (!owner || !memberSet.has(owner) || laneFinished(projectId, issue.status, laneId)) continue;
        const logged = loggedByLane.get(`${id}|${laneId}`) ?? 0;
        workItems.push({
          ...base,
          userId: owner,
          lane: laneId,
          hoursSource: 'stage',
          estimateHours: round1(est.minutes / 60),
          loggedHours: round1(logged / 60),
          remainingHours: Math.max(0, est.minutes - logged) / 60,
          overEstimate: logged > est.minutes,
        });
      }
      continue;
    }

    const owner = issue.assignee ? String(issue.assignee) : undefined;
    if (!owner || !memberSet.has(owner)) continue;
    let hoursSource: HoursSource = 'none';
    let estimateMin = 0;
    if (issue.timeEstimateMinutes) [hoursSource, estimateMin] = ['estimate', issue.timeEstimateMinutes];
    else if (issue.storyPoints && settings.hoursPerStoryPoint) {
      [hoursSource, estimateMin] = ['points', issue.storyPoints * settings.hoursPerStoryPoint * 60];
    } else if (settings.defaultTaskHours) [hoursSource, estimateMin] = ['default', settings.defaultTaskHours * 60];
    const logged = loggedByIssue.get(id) ?? 0;
    workItems.push({
      ...base,
      userId: owner,
      hoursSource,
      estimateHours: round1(estimateMin / 60),
      loggedHours: round1(logged / 60),
      remainingHours: Math.max(0, estimateMin - logged) / 60,
      overEstimate: estimateMin > 0 && logged > estimateMin,
    });
  }

  const employeeToUser = new Map(employees.map((e) => [String(e._id), String(e.userId)]));
  const leaves =
    employees.length === 0
      ? []
      : await HrmsLeaveRequest.find({
          taskflowOrganizationId: orgOid,
          employeeId: { $in: employees.map((e) => e._id) },
          status: { $in: ['approved', 'pending'] },
          startDate: { $lte: rangeEnd },
          endDate: { $gte: calStart },
        })
          .select('employeeId status startDate endDate halfDay')
          .lean();

  const weekendDays = new Set<number>((hrSettings as { weekendDays?: number[] } | null)?.weekendDays ?? [0, 6]);
  const workingDaysPerWeek = Math.max(1, 7 - weekendDays.size);
  const holidayByDay = new Map(holidays.map((h) => [dayKey(startOfUtcDay(h.date as Date)), String(h.name)]));
  const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

  const days: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) days.push(new Date(t));

  function isWorkingDay(d: Date): boolean {
    return !weekendDays.has(d.getUTCDay()) && !holidayByDay.has(dayKey(d));
  }

  const people = users.map((u) => {
    const uid = String(u._id);
    const profile = profileByUser.get(uid);
    const weeklyCapacity = profile?.capacityHoursPerWeek ?? 40;
    const dailyCapacity = weeklyCapacity / workingDaysPerWeek;

    const leaveByDay = new Map<string, { half: boolean; pending: boolean }>();
    for (const l of leaves) {
      if (employeeToUser.get(String(l.employeeId)) !== uid) continue;
      const s = startOfUtcDay(l.startDate as Date);
      const e = startOfUtcDay(l.endDate as Date);
      for (let t = s.getTime(); t <= e.getTime(); t += DAY_MS) {
        const key = dayKey(new Date(t));
        // Approved leave wins over a pending request on the same day.
        if (leaveByDay.get(key)?.pending === false) continue;
        leaveByDay.set(key, { half: Boolean(l.halfDay), pending: l.status === 'pending' });
      }
    }

    function dayKind(d: Date): EngagementDayKind {
      if (weekendDays.has(d.getUTCDay())) return 'weekend';
      if (holidayByDay.has(dayKey(d))) return 'holiday';
      const leave = leaveByDay.get(dayKey(d));
      if (leave && !leave.pending) return leave.half ? 'half_leave' : 'leave';
      return 'work';
    }

    /** Hours this person can work on a day (leave beyond the loaded range is unknown → full day). */
    function capacityOn(d: Date): number {
      const kind = dayKind(d);
      return kind === 'work' ? dailyCapacity : kind === 'half_leave' ? dailyCapacity / 2 : 0;
    }

    const items = workItems.filter((w) => w.userId === uid);
    const taskHoursByDay = new Map<string, number>();
    const overdueByDay = new Map<string, number>();
    const taskCountByDay = new Map<string, number>();
    const addHours = (key: string, hours: number, overdue: boolean) => {
      taskHoursByDay.set(key, (taskHoursByDay.get(key) ?? 0) + hours);
      taskCountByDay.set(key, (taskCountByDay.get(key) ?? 0) + 1);
      if (overdue) overdueByDay.set(key, (overdueByDay.get(key) ?? 0) + hours);
    };
    let lastWorkDay: string | null = null;
    const backfill: WorkItem[] = [];

    // Pass 1: spread dated work over the person's capacity within its window.
    for (const item of items) {
      if (item.schedule !== 'scheduled') {
        if (item.schedule === 'overdue') backfill.push(item);
        continue;
      }
      const end = new Date(`${item.windowEnd}T00:00:00Z`);
      const s = item.windowStart ? new Date(`${item.windowStart}T00:00:00Z`) : today;
      const spanStart = s > end ? end : s < today ? today : s;
      const span: Array<{ key: string; cap: number }> = [];
      for (let t = spanStart.getTime(); t <= end.getTime(); t += DAY_MS) {
        const cap = capacityOn(new Date(t));
        if (cap > 0) span.push({ key: dayKey(new Date(t)), cap });
      }
      if (span.length === 0) {
        backfill.push(item);
        continue;
      }
      const totalCap = span.reduce((sum, d) => sum + d.cap, 0);
      for (const d of span) addHours(d.key, (item.remainingHours * d.cap) / totalCap, false);
      if (item.remainingHours > 0 && (!lastWorkDay || item.windowEnd! > lastWorkDay)) lastWorkDay = item.windowEnd;
    }

    // Pass 2: overdue work goes into spare capacity from today, oldest deadline first.
    backfill.sort((a, b) => (a.windowEnd ?? '').localeCompare(b.windowEnd ?? ''));
    for (const item of backfill) {
      let left = item.remainingHours;
      for (let t = today.getTime(); t <= to.getTime() && left > 0.01; t += DAY_MS) {
        const d = new Date(t);
        const key = dayKey(d);
        const spare = capacityOn(d) - (taskHoursByDay.get(key) ?? 0);
        if (spare <= 0.01) continue;
        const take = Math.min(spare, left);
        addHours(key, take, item.schedule === 'overdue');
        left -= take;
        if (!lastWorkDay || key > lastWorkDay) lastWorkDay = key;
      }
      item.unplacedHours = round1(Math.max(0, left));
    }

    const dayRows: EngagementDay[] = days.map((d) => {
      const key = dayKey(d);
      const kind = dayKind(d);
      const note =
        kind === 'holiday'
          ? holidayByDay.get(key)
          : kind === 'work' && leaveByDay.get(key)?.pending
            ? 'Leave pending approval'
            : undefined;
      const capacityHours = capacityOn(d);

      let allocatedPct = 0;
      let softPct = 0;
      for (const a of allocations) {
        if (String(a.userId) !== uid) continue;
        const aStart = startOfUtcDay(a.startDate);
        const aEnd = a.endDate ? startOfUtcDay(a.endDate) : null;
        if (d < aStart || (aEnd && d > aEnd)) continue;
        if (a.softBooked) softPct += a.percent;
        else allocatedPct += a.percent;
      }
      // Allocation % is of a full day; half-day leave doubles its weight on the remaining half.
      if (kind === 'half_leave') {
        allocatedPct *= 2;
        softPct *= 2;
      }

      const taskHours = taskHoursByDay.get(key) ?? 0;
      const taskPct = capacityHours > 0 ? (taskHours / capacityHours) * 100 : 0;
      const working = kind === 'work' || kind === 'half_leave';
      const engagementPct = working ? Math.round(Math.max(allocatedPct, taskPct)) : 0;

      return {
        date: key,
        kind,
        capacityHours: round1(capacityHours),
        allocatedPct: working ? Math.round(allocatedPct) : 0,
        softPct: working ? Math.round(softPct) : 0,
        taskHours: round1(taskHours),
        overdueHours: round1(overdueByDay.get(key) ?? 0),
        taskCount: taskCountByDay.get(key) ?? 0,
        taskPct: Math.round(taskPct),
        engagementPct,
        level: levelFor(kind, engagementPct, threshold),
        ...(note ? { note } : {}),
      };
    });

    const workDays = dayRows.filter((r) => r.level !== 'off');
    const avgEngagement =
      workDays.length === 0 ? 0 : Math.round(workDays.reduce((s, r) => s + r.engagementPct, 0) / workDays.length);
    const availableHours = workDays.reduce(
      (s, r) => s + (r.capacityHours * Math.max(0, 100 - r.engagementPct)) / 100,
      0
    );
    const futureWorkDays = workDays.filter((r) => r.date >= dayKey(today));
    const nextAvailable = futureWorkDays.find((r) => r.engagementPct < threshold)?.date ?? null;
    const lastBusyIdx = futureWorkDays.map((r) => r.engagementPct >= threshold).lastIndexOf(true);
    const busyThroughRangeEnd = lastBusyIdx >= 0 && lastBusyIdx === futureWorkDays.length - 1;
    const freeFrom =
      futureWorkDays.length === 0 || busyThroughRangeEnd
        ? null
        : lastBusyIdx < 0
          ? futureWorkDays[0].date
          : futureWorkDays[lastBusyIdx + 1].date;

    // When current commitments end, looking past the requested range.
    const committed = allocations.filter((a) => String(a.userId) === uid && !a.softBooked);
    const openEndedAllocation = committed.some((a) => !a.endDate);
    const lastAllocationEnd = committed.reduce<string | null>((m, a) => {
      const k = a.endDate ? dayKey(startOfUtcDay(a.endDate)) : null;
      return k && (!m || k > m) ? k : m;
    }, null);
    const unplacedHours = round1(items.reduce((s, w) => s + w.unplacedHours, 0));
    // Task work that can't be placed before the range ends means the clear-out date is beyond it.
    const tasksClearOn = unplacedHours > 0 ? null : lastWorkDay;
    const commitmentsEnd =
      openEndedAllocation || unplacedHours > 0
        ? null
        : [lastAllocationEnd, tasksClearOn].reduce<string | null>((m, d) => (d && (!m || d > m) ? d : m), null);

    const myAllocations = allocations
      .filter((a) => String(a.userId) === uid)
      .map((a) => {
        const proj = projectById.get(String(a.projectId));
        return {
          allocationId: String(a._id),
          id: String(a.projectId),
          name: proj?.name,
          key: proj?.key,
          percent: a.percent,
          softBooked: a.softBooked,
          startDate: a.startDate,
          endDate: a.endDate ?? null,
          roleLabel: a.roleLabel,
        };
      });

    const order: Record<Schedule, number> = { overdue: 0, scheduled: 1, unscheduled: 2 };
    const tasks = items
      .map((w) => ({ ...w, remainingHours: round1(w.remainingHours) }))
      .sort((a, b) => order[a.schedule] - order[b.schedule] || (a.windowEnd ?? '~').localeCompare(b.windowEnd ?? '~'));
    const unscheduled = tasks.filter((t) => t.schedule === 'unscheduled');
    const overdue = tasks.filter((t) => t.schedule === 'overdue');

    return {
      userId: uid,
      name: u.name,
      email: u.email,
      department: profile?.department,
      capacityHoursPerWeek: weeklyCapacity,
      summary: {
        avgEngagement,
        peakEngagement: workDays.reduce((m, r) => Math.max(m, r.engagementPct), 0),
        overbookedDays: workDays.filter((r) => r.level === 'over').length,
        busyDays: workDays.filter((r) => r.level === 'busy' || r.level === 'over').length,
        freeDays: workDays.filter((r) => r.level === 'free').length,
        leaveDays: dayRows.filter((r) => r.kind === 'leave').length + dayRows.filter((r) => r.kind === 'half_leave').length / 2,
        availableHours: round1(availableHours),
        openTasks: tasks.length,
        remainingHours: round1(tasks.reduce((s, t) => s + t.remainingHours, 0)),
        noEstimateTasks: tasks.filter((t) => t.hoursSource === 'none').length,
        overEstimateTasks: tasks.filter((t) => t.overEstimate).length,
        overdueTasks: overdue.length,
        overdueHours: round1(overdue.reduce((s, t) => s + t.remainingHours, 0)),
        unplacedHours,
        unscheduledTasks: unscheduled.length,
        unscheduledHours: round1(unscheduled.reduce((s, t) => s + t.remainingHours, 0)),
        nextAvailable,
        freeFrom,
        busyThroughRangeEnd,
        tasksClearOn,
        commitmentsEnd,
        openEndedAllocation,
      },
      allocations: myAllocations,
      tasks,
      days: dayRows,
    };
  });

  const filteredPeople = query.projectId
    ? people.filter((p) => p.allocations.length > 0 || p.tasks.length > 0)
    : people;

  const team = days.map((d, i) => {
    const key = dayKey(d);
    const rows = filteredPeople.map((p) => p.days[i]).filter((r) => r.level !== 'off');
    return {
      date: key,
      working: isWorkingDay(d),
      holiday: holidayByDay.get(key),
      avgEngagement: rows.length === 0 ? 0 : Math.round(rows.reduce((s, r) => s + r.engagementPct, 0) / rows.length),
      available: rows.filter((r) => r.level === 'free').length,
      overbooked: rows.filter((r) => r.level === 'over').length,
      onLeave: filteredPeople.filter((p) => p.days[i].kind === 'leave').length,
    };
  });

  const allTasks = filteredPeople.flatMap((p) => p.tasks);
  return {
    from: dayKey(from),
    to: dayKey(to),
    today: dayKey(today),
    threshold,
    busyPct: BUSY_PCT,
    weekendDays: [...weekendDays],
    settings,
    summary: {
      people: filteredPeople.length,
      avgEngagement:
        filteredPeople.length === 0
          ? 0
          : Math.round(filteredPeople.reduce((s, p) => s + p.summary.avgEngagement, 0) / filteredPeople.length),
      overbookedPeople: filteredPeople.filter((p) => p.summary.overbookedDays > 0).length,
      availableHours: round1(filteredPeople.reduce((s, p) => s + p.summary.availableHours, 0)),
      openTasks: allTasks.length,
      overdueTasks: allTasks.filter((t) => t.schedule === 'overdue').length,
      unscheduledTasks: allTasks.filter((t) => t.schedule === 'unscheduled').length,
      noEstimateTasks: allTasks.filter((t) => t.hoursSource === 'none').length,
      hoursSources: (['stage', 'estimate', 'points', 'default', 'none'] as const).map((source) => ({
        source,
        tasks: allTasks.filter((t) => t.hoursSource === source).length,
      })),
    },
    team,
    people: filteredPeople,
  };
}
