import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { IssueHistory } from '../issues/issueHistory.model';
import { Project } from '../projects/project.model';
import { Sprint } from '../sprints/sprint.model';
import { Milestone } from '../milestones/milestone.model';
import { WorkLog } from '../workLogs/workLog.model';
import { User } from '../auth/user.model';
import { getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import { getProjectObjectIdsInWorkspace } from '../projects/workspaceProjectAccess';

/**
 * Project-management overview for the PM dashboard, scoped to the projects the user is a member of
 * in the active workspace (optionally one project).
 *
 * Completion dates come from status changes in issue history (the last move into a closed status);
 * issues closed without history fall back to their last update.
 * Project health is a signal, not a policy: off track when over 25% of open dated work is overdue or a
 * milestone is past due, at risk when anything is overdue or nothing was completed in 14 days while work
 * is open, otherwise on track.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOSED = ['Done', 'Closed', 'Resolved'];
/** Age of open work, by days since the issue was created. */
const AGE_BUCKETS = [
  { label: '0–7 days', min: 0, max: 7 },
  { label: '8–30 days', min: 8, max: 30 },
  { label: '31–90 days', min: 31, max: 90 },
  { label: 'Over 90 days', min: 91, max: Infinity },
];

type StatusDef = { name?: string; isClosed?: boolean; order?: number; color?: string };

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday of the week containing `d` (UTC). */
function weekStart(d: Date): Date {
  const day = startOfUtcDay(d);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

const key = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

export type ProjectHealth = 'on_track' | 'at_risk' | 'off_track' | 'idle';

export async function getOverview(
  userId: string,
  taskflowOrganizationId: string | null | undefined,
  query: { projectId?: string; weeks?: number } = {}
) {
  const now = new Date();
  const today = startOfUtcDay(now);
  const weeks = Math.min(26, Math.max(4, Math.round(query.weeks ?? 8)));
  const thisWeek = weekStart(now);
  const trendStart = new Date(thisWeek.getTime() - (weeks - 1) * 7 * DAY_MS);
  const lastWeek = new Date(thisWeek.getTime() - 7 * DAY_MS);
  const weekEnd = new Date(thisWeek.getTime() + 7 * DAY_MS);
  const soon = new Date(today.getTime() + 7 * DAY_MS);
  const ago14 = new Date(today.getTime() - 14 * DAY_MS);

  let projectIds = await getProjectObjectIdsInWorkspace(userId, taskflowOrganizationId);
  if (query.projectId) projectIds = projectIds.filter((p) => String(p) === query.projectId);

  const projects = projectIds.length
    ? await Project.find({ _id: { $in: projectIds } }).select('name key statuses archived lead').lean()
    : [];
  const live = projects.filter((p) => !(p as { archived?: boolean }).archived);
  const liveIds = live.map((p) => p._id as mongoose.Types.ObjectId);
  const statusesOf = (p: (typeof projects)[number]) => ((p as { statuses?: StatusDef[] }).statuses ?? []) as StatusDef[];
  const closedByProject = new Map(
    live.map((p) => {
      const closed = getClosedStatusNamesFromStatuses(statusesOf(p));
      return [String(p._id), new Set(closed.length ? closed : DEFAULT_CLOSED)];
    })
  );
  const isClosed = (projectId: string, status: string) => closedByProject.get(projectId)?.has(status) ?? DEFAULT_CLOSED.includes(status);

  const [issues, sprints, milestones] = await Promise.all([
    liveIds.length
      ? Issue.find({ project: { $in: liveIds } })
          .select('key title type priority status assignee project sprint milestone dueDate createdAt updatedAt storyPoints parent')
          .lean()
      : [],
    liveIds.length ? Sprint.find({ project: { $in: liveIds }, status: { $in: ['active', 'planned'] } }).select('name project status startDate endDate').lean() : [],
    liveIds.length ? Milestone.find({ project: { $in: liveIds } }).select('name project status dueDate').lean() : [],
  ]);

  const issueIds = issues.map((i) => i._id);
  const [statusMoves, logs, recentHistory] = await Promise.all([
    issueIds.length
      ? IssueHistory.find({ issue: { $in: issueIds }, action: 'field_change', field: 'status' })
          .select('issue toValue createdAt activityAt')
          .lean()
      : [],
    issueIds.length
      ? WorkLog.aggregate<{ _id: { day: string; author: mongoose.Types.ObjectId }; minutes: number }>([
          { $match: { issue: { $in: issueIds }, date: { $gte: trendStart, $lt: weekEnd } } },
          { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, author: '$author' }, minutes: { $sum: '$minutesSpent' } } },
        ]).then((rows) => rows.map((r) => ({ week: key(weekStart(new Date(`${r._id.day}T00:00:00Z`))), author: String(r._id.author), minutes: r.minutes })))
      : [],
    issueIds.length
      ? IssueHistory.find({ issue: { $in: issueIds } })
          .sort({ createdAt: -1 })
          .limit(15)
          .select('issue author action field fromValue toValue createdAt')
          .lean()
      : [],
  ]);

  const projectById = new Map(live.map((p) => [String(p._id), p]));
  const issueById = new Map(issues.map((i) => [String(i._id), i]));

  // Completion date per closed issue: the last move into a closed status.
  const completedAt = new Map<string, Date>();
  for (const h of statusMoves) {
    const issue = issueById.get(String(h.issue));
    if (!issue || !isClosed(String(issue.project), String(h.toValue ?? ''))) continue;
    const at = (h.activityAt as Date | undefined) ?? (h.createdAt as Date);
    const prev = completedAt.get(String(h.issue));
    if (!prev || at > prev) completedAt.set(String(h.issue), at);
  }

  const userIds = new Set<string>([userId]);
  issues.forEach((i) => i.assignee && userIds.add(String(i.assignee)));
  recentHistory.forEach((h) => userIds.add(String(h.author)));
  logs.forEach((l) => userIds.add(l.author));
  const users = await User.find({ _id: { $in: [...userIds] } }).select('name email').lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.name ?? u.email]));

  type Row = (typeof issues)[number] & { closed: boolean; doneAt?: Date; overdue: boolean };
  const parentIds = new Set(issues.filter((i) => i.parent).map((i) => String(i.parent)));
  const rows: Row[] = issues.map((i) => {
    const closed = isClosed(String(i.project), String(i.status ?? ''));
    const doneAt = closed ? (completedAt.get(String(i._id)) ?? (i.updatedAt as Date)) : undefined;
    return { ...i, closed, doneAt, overdue: !closed && !!i.dueDate && (i.dueDate as Date) < today };
  });
  // Parents roll up their children; count leaves for workload numbers.
  const leaves = rows.filter((r) => !parentIds.has(String(r._id)));
  const open = leaves.filter((r) => !r.closed);

  const inRange = (d: Date | undefined, a: Date, b: Date) => !!d && d >= a && d < b;
  const completedThisWeek = leaves.filter((r) => inRange(r.doneAt, thisWeek, weekEnd)).length;
  const completedLastWeek = leaves.filter((r) => inRange(r.doneAt, lastWeek, thisWeek)).length;
  const createdThisWeek = leaves.filter((r) => inRange(r.createdAt as Date, thisWeek, weekEnd)).length;
  const createdLastWeek = leaves.filter((r) => inRange(r.createdAt as Date, lastWeek, thisWeek)).length;

  const cycleDays = leaves
    .filter((r) => r.doneAt && r.doneAt >= trendStart)
    .map((r) => (r.doneAt!.getTime() - (r.createdAt as Date).getTime()) / DAY_MS)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const medianCycle = cycleDays.length ? round1(cycleDays[Math.floor(cycleDays.length / 2)]) : null;

  const trend = Array.from({ length: weeks }, (_, i) => {
    const s = new Date(trendStart.getTime() + i * 7 * DAY_MS);
    const e = new Date(s.getTime() + 7 * DAY_MS);
    const minutes = logs.filter((l) => l.week === key(s)).reduce((sum, l) => sum + l.minutes, 0);
    return {
      weekStart: key(s),
      created: leaves.filter((r) => inRange(r.createdAt as Date, s, e)).length,
      completed: leaves.filter((r) => inRange(r.doneAt, s, e)).length,
      loggedHours: round1(minutes / 60),
    };
  });
  const loggedThisWeek = trend[trend.length - 1]?.loggedHours ?? 0;
  const loggedLastWeek = trend[trend.length - 2]?.loggedHours ?? 0;

  const countBy = (list: Row[], f: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of list) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };

  // Status distribution keeps each project's status colour and order (first project wins on clashes).
  const statusMeta = new Map<string, { color?: string; order: number; closed: boolean }>();
  for (const p of live) {
    for (const s of statusesOf(p)) {
      if (s.name && !statusMeta.has(s.name)) statusMeta.set(s.name, { color: s.color, order: s.order ?? 99, closed: isClosed(String(p._id), s.name) });
    }
  }
  const byStatus = countBy(leaves, (r) => String(r.status ?? 'Unknown'))
    .map((s) => ({ ...s, color: statusMeta.get(s.name)?.color, closed: statusMeta.get(s.name)?.closed ?? DEFAULT_CLOSED.includes(s.name), order: statusMeta.get(s.name)?.order ?? 99 }))
    .sort((a, b) => Number(a.closed) - Number(b.closed) || a.order - b.order);

  const sprintRows = sprints
    .map((s) => {
      const items = leaves.filter((r) => String(r.sprint ?? '') === String(s._id));
      const done = items.filter((r) => r.closed);
      const pts = (list: Row[]) => list.reduce((sum, r) => sum + (Number(r.storyPoints) || 0), 0);
      const p = projectById.get(String(s.project));
      const start = s.startDate as Date | undefined;
      const end = s.endDate as Date | undefined;
      const elapsedPct =
        start && end && end > start ? Math.min(100, Math.max(0, Math.round(((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))) : null;
      return {
        id: String(s._id),
        name: s.name,
        status: s.status,
        project: { id: String(s.project), name: p?.name, key: p?.key },
        startDate: start ? key(start) : null,
        endDate: end ? key(end) : null,
        daysLeft: end ? Math.ceil((startOfUtcDay(end).getTime() - today.getTime()) / DAY_MS) : null,
        total: items.length,
        done: done.length,
        points: pts(items),
        donePoints: pts(done),
        progressPct: items.length ? Math.round((done.length / items.length) * 100) : 0,
        elapsedPct,
      };
    })
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || (a.endDate ?? '~').localeCompare(b.endDate ?? '~'));

  const milestoneRows = milestones
    // Same rule the milestones service uses to treat a milestone as finished.
    .filter((m) => !/complete|done|closed/i.test(String(m.status ?? '')))
    .map((m) => {
      const items = leaves.filter((r) => String(r.milestone ?? '') === String(m._id));
      const done = items.filter((r) => r.closed).length;
      const p = projectById.get(String(m.project));
      const due = m.dueDate as Date | undefined;
      return {
        id: String(m._id),
        name: m.name,
        project: { id: String(m.project), name: p?.name, key: p?.key },
        dueDate: due ? key(due) : null,
        daysLeft: due ? Math.ceil((startOfUtcDay(due).getTime() - today.getTime()) / DAY_MS) : null,
        total: items.length,
        done,
        progressPct: items.length ? Math.round((done / items.length) * 100) : 0,
      };
    })
    .sort((a, b) => (a.dueDate ?? '~').localeCompare(b.dueDate ?? '~'));

  const projectRows = live
    .map((p) => {
      const pid = String(p._id);
      const mine = leaves.filter((r) => String(r.project) === pid);
      const openP = mine.filter((r) => !r.closed);
      const overdue = openP.filter((r) => r.overdue).length;
      const dated = openP.filter((r) => r.dueDate).length;
      const completed14 = mine.filter((r) => r.doneAt && r.doneAt >= ago14).length;
      const created14 = mine.filter((r) => (r.createdAt as Date) >= ago14).length;
      const lateMilestones = milestoneRows.filter((m) => m.project.id === pid && m.daysLeft != null && m.daysLeft < 0).length;
      const lastActivity = mine.reduce<Date | null>((m, r) => (!m || (r.updatedAt as Date) > m ? (r.updatedAt as Date) : m), null);
      const health: ProjectHealth =
        mine.length === 0 || openP.length === 0
          ? 'idle'
          : (dated > 0 && overdue / dated > 0.25) || lateMilestones > 0
            ? 'off_track'
            : overdue > 0 || completed14 === 0
              ? 'at_risk'
              : 'on_track';
      const sprint = sprintRows.find((s) => s.project.id === pid && s.status === 'active');
      const milestone = milestoneRows.find((m) => m.project.id === pid && (m.daysLeft ?? 0) >= 0);
      return {
        id: pid,
        name: p.name,
        key: p.key,
        total: mine.length,
        open: openP.length,
        done: mine.length - openP.length,
        progressPct: mine.length ? Math.round(((mine.length - openP.length) / mine.length) * 100) : 0,
        overdue,
        dueSoon: openP.filter((r) => r.dueDate && (r.dueDate as Date) >= today && (r.dueDate as Date) < soon).length,
        unassigned: openP.filter((r) => !r.assignee).length,
        completed14,
        created14,
        lateMilestones,
        health,
        lastActivity: lastActivity ? lastActivity.toISOString() : null,
        activeSprint: sprint ? { id: sprint.id, name: sprint.name, endDate: sprint.endDate, progressPct: sprint.progressPct } : null,
        nextMilestone: milestone ? { id: milestone.id, name: milestone.name, dueDate: milestone.dueDate } : null,
      };
    })
    .sort((a, b) => {
      const rank: Record<ProjectHealth, number> = { off_track: 0, at_risk: 1, on_track: 2, idle: 3 };
      return rank[a.health] - rank[b.health] || b.open - a.open;
    });

  const issueRef = (r: Row) => {
    const p = projectById.get(String(r.project));
    return {
      id: String(r._id),
      key: r.key,
      title: r.title,
      status: r.status,
      priority: r.priority,
      type: r.type,
      dueDate: r.dueDate ? key(r.dueDate as Date) : null,
      assignee: r.assignee ? { id: String(r.assignee), name: nameOf.get(String(r.assignee)) } : null,
      project: { id: String(r.project), name: p?.name, key: p?.key },
    };
  };
  const byDue = (a: Row, b: Row) => ((a.dueDate as Date | undefined)?.getTime() ?? Infinity) - ((b.dueDate as Date | undefined)?.getTime() ?? Infinity);

  const myOpen = open.filter((r) => String(r.assignee ?? '') === userId);
  const myLogged = logs.filter((l) => l.author === userId && l.week === key(thisWeek)).reduce((s, l) => s + l.minutes, 0);

  const loadByUser = new Map<string, { open: number; overdue: number; dueSoon: number; points: number }>();
  for (const r of open) {
    if (!r.assignee) continue;
    const id = String(r.assignee);
    const e = loadByUser.get(id) ?? { open: 0, overdue: 0, dueSoon: 0, points: 0 };
    e.open += 1;
    if (r.overdue) e.overdue += 1;
    if (r.dueDate && (r.dueDate as Date) >= today && (r.dueDate as Date) < soon) e.dueSoon += 1;
    e.points += Number(r.storyPoints) || 0;
    loadByUser.set(id, e);
  }
  const completedByUser = new Map<string, number>();
  for (const r of leaves) {
    if (r.assignee && r.doneAt && r.doneAt >= ago14) completedByUser.set(String(r.assignee), (completedByUser.get(String(r.assignee)) ?? 0) + 1);
  }
  const loggedByUser = new Map<string, number>();
  for (const l of logs) {
    if (l.week === key(thisWeek)) loggedByUser.set(l.author, (loggedByUser.get(l.author) ?? 0) + l.minutes);
  }
  const team = [...new Set([...loadByUser.keys(), ...completedByUser.keys()])]
    .map((id) => ({
      id,
      name: nameOf.get(id) ?? 'Unknown',
      ...(loadByUser.get(id) ?? { open: 0, overdue: 0, dueSoon: 0, points: 0 }),
      completed14: completedByUser.get(id) ?? 0,
      loggedHoursThisWeek: round1((loggedByUser.get(id) ?? 0) / 60),
    }))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue);

  return {
    generatedAt: now.toISOString(),
    today: key(today),
    weekStart: key(thisWeek),
    scope: { projects: live.length, archivedProjects: projects.length - live.length },
    kpis: {
      totalIssues: leaves.length,
      openIssues: open.length,
      overdue: open.filter((r) => r.overdue).length,
      dueThisWeek: open.filter((r) => r.dueDate && (r.dueDate as Date) >= today && (r.dueDate as Date) < soon).length,
      unassigned: open.filter((r) => !r.assignee).length,
      completedThisWeek,
      completedLastWeek,
      createdThisWeek,
      createdLastWeek,
      loggedHoursThisWeek: loggedThisWeek,
      loggedHoursLastWeek: loggedLastWeek,
      medianCycleDays: medianCycle,
      completionPct: leaves.length ? Math.round(((leaves.length - open.length) / leaves.length) * 100) : 0,
      activeSprints: sprintRows.filter((s) => s.status === 'active').length,
      lateMilestones: milestoneRows.filter((m) => m.daysLeft != null && m.daysLeft < 0).length,
    },
    trend,
    byStatus,
    aging: AGE_BUCKETS.map((b) => ({
      label: b.label,
      count: open.filter((r) => {
        const age = (today.getTime() - startOfUtcDay(r.createdAt as Date).getTime()) / DAY_MS;
        return age >= b.min && age <= b.max;
      }).length,
    })),
    byType: countBy(open, (r) => String(r.type ?? 'Task')),
    byPriority: countBy(open, (r) => String(r.priority ?? 'None')),
    projects: projectRows,
    sprints: sprintRows,
    milestones: milestoneRows.slice(0, 20),
    myWork: {
      open: myOpen.length,
      overdue: myOpen.filter((r) => r.overdue).length,
      dueThisWeek: myOpen.filter((r) => r.dueDate && (r.dueDate as Date) >= today && (r.dueDate as Date) < soon).length,
      completedThisWeek: leaves.filter((r) => String(r.assignee ?? '') === userId && inRange(r.doneAt, thisWeek, weekEnd)).length,
      loggedHoursThisWeek: round1(myLogged / 60),
      items: [...myOpen].sort(byDue).slice(0, 12).map(issueRef),
    },
    attention: {
      overdue: open.filter((r) => r.overdue).sort(byDue).slice(0, 10).map(issueRef),
      unassignedDueSoon: open
        .filter((r) => !r.assignee && r.dueDate && (r.dueDate as Date) < soon)
        .sort(byDue)
        .slice(0, 10)
        .map(issueRef),
    },
    team: team.slice(0, 15),
    activity: recentHistory
      .map((h) => {
        const issue = issueById.get(String(h.issue));
        if (!issue) return null;
        const p = projectById.get(String(issue.project));
        return {
          id: String(h._id),
          at: (h.createdAt as Date).toISOString(),
          author: nameOf.get(String(h.author)) ?? 'Someone',
          action: h.action,
          field: h.field,
          toValue: typeof h.toValue === 'string' || typeof h.toValue === 'number' ? String(h.toValue) : undefined,
          issue: { id: String(issue._id), key: issue.key, title: issue.title, projectId: String(issue.project), projectKey: p?.key },
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null),
  };
}
