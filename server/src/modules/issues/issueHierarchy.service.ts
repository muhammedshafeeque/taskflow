import mongoose from 'mongoose';
import { Issue } from './issue.model';
import { IssueHistory } from './issueHistory.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import { getClosedStatusNamesForProject } from '../projects/statusClassification';
import { withIssueKey } from './issues.service';

const MAX_DEPTH = 20;

export type HierarchyIssueRow = {
  _id: mongoose.Types.ObjectId;
  parent?: mongoose.Types.ObjectId | null;
  storyPoints?: number | null;
  status: string;
  createdAt?: Date;
  key?: string;
};

/** Collect all descendant issue ids under root (BFS). */
export async function getDescendantIds(projectId: string, rootIssueId: string): Promise<string[]> {
  const projectOid = new mongoose.Types.ObjectId(projectId);
  const rootOid = new mongoose.Types.ObjectId(rootIssueId);
  const all = await Issue.find({ project: projectOid }).select('_id parent').lean();
  const byParent = new Map<string, string[]>();
  for (const row of all) {
    const pid = row.parent ? String(row.parent) : '';
    if (!pid) continue;
    const list = byParent.get(pid) ?? [];
    list.push(String(row._id));
    byParent.set(pid, list);
  }
  const out: string[] = [];
  const queue = [rootIssueId];
  const seen = new Set<string>([rootIssueId]);
  let depth = 0;
  while (queue.length > 0 && depth < MAX_DEPTH) {
    const levelSize = queue.length;
    for (let i = 0; i < levelSize; i++) {
      const id = queue.shift()!;
      const children = byParent.get(id) ?? [];
      for (const c of children) {
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
        queue.push(c);
      }
    }
    depth++;
  }
  return out;
}

/** Issue ids that have no children within the given set. */
export function getLeafIdsInSet(issueIds: Set<string>, rows: HierarchyIssueRow[]): string[] {
  const hasChild = new Set<string>();
  for (const row of rows) {
    if (row.parent && issueIds.has(String(row.parent))) {
      hasChild.add(String(row.parent));
    }
  }
  return [...issueIds].filter((id) => !hasChild.has(id));
}

/** Sum story points counting only leaf nodes in subtree (parent SP excluded when children exist). */
export function sumLeafStoryPoints(
  rows: HierarchyIssueRow[],
  closedStatuses: string[]
): { totalSp: number; completedSp: number; leafCount: number } {
  const idSet = new Set(rows.map((r) => String(r._id)));
  const leafIds = new Set(getLeafIdsInSet(idSet, rows));
  let totalSp = 0;
  let completedSp = 0;
  for (const row of rows) {
    const id = String(row._id);
    if (!leafIds.has(id)) continue;
    const sp = row.storyPoints ?? 0;
    totalSp += sp;
    if (closedStatuses.includes(row.status)) completedSp += sp;
  }
  return { totalSp, completedSp, leafCount: leafIds.size };
}

/** Sum leaf SP only for issues in subsetIds (uses full project rows for parent/child detection). */
export function sumLeafStoryPointsForSubset(
  projectRows: HierarchyIssueRow[],
  subsetIds: Set<string>,
  closedStatuses: string[]
): { totalSp: number; completedSp: number } {
  const projectIdSet = new Set(projectRows.map((r) => String(r._id)));
  const leafIds = new Set(getLeafIdsInSet(projectIdSet, projectRows));
  let totalSp = 0;
  let completedSp = 0;
  for (const row of projectRows) {
    const id = String(row._id);
    if (!leafIds.has(id) || !subsetIds.has(id)) continue;
    const sp = row.storyPoints ?? 0;
    totalSp += sp;
    if (closedStatuses.includes(row.status)) completedSp += sp;
  }
  return { totalSp, completedSp };
}

/** Effective SP for a single issue in a project-wide row set (0 if has children). */
export function effectiveStoryPointsForIssue(
  issueId: string,
  rows: HierarchyIssueRow[]
): number {
  const idSet = new Set(rows.map((r) => String(r._id)));
  const hasChild = rows.some((r) => r.parent && String(r.parent) === issueId);
  if (hasChild) return 0;
  const row = rows.find((r) => String(r._id) === issueId);
  return row?.storyPoints ?? 0;
}

export type RollupBurndownPoint = {
  date: string;
  remainingStoryPoints: number;
  ideal?: number;
};

export type IssueRollupResult = {
  issueId: string;
  issueKey: string;
  totalStoryPoints: number;
  completedStoryPoints: number;
  percentDone: number;
  childCount: number;
  directChildCount: number;
  statusBreakdown: Array<{ status: string; count: number; storyPoints: number }>;
  burndown: RollupBurndownPoint[];
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buildBurndownFromHistory(
  leafRows: HierarchyIssueRow[],
  closedStatuses: string[],
  startDate: Date,
  endDate: Date
): Promise<RollupBurndownPoint[]> {
  const leafIds = leafRows.map((r) => String(r._id));
  if (leafIds.length === 0) return [];

  const totalSp = leafRows.reduce((s, r) => s + (r.storyPoints ?? 0), 0);
  const history = leafIds.length
    ? await IssueHistory.find({
        issue: { $in: leafIds },
        action: 'field_change',
        field: 'status',
      })
      .sort({ createdAt: 1 })
      .select('issue createdAt toValue')
      .lean()
    : [];

  const statusByIssue = new Map<string, string>();
  for (const row of leafRows) {
    statusByIssue.set(String(row._id), row.status);
  }

  const changesByDay = new Map<string, Array<{ issueId: string; status: string }>>();
  for (const h of history) {
    const issueId = String(h.issue);
    const status = String(h.toValue ?? '');
    const dk = dayKey(h.createdAt as Date);
    const list = changesByDay.get(dk) ?? [];
    list.push({ issueId, status });
    changesByDay.set(dk, list);
  }

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const totalDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  );

  const points: RollupBurndownPoint[] = [];
  const currentStatus = new Map(statusByIssue);

  for (let d = 0; d <= totalDays; d++) {
    const date = new Date(start);
    date.setDate(date.getDate() + d);
    const dk = dayKey(date);
    const dayChanges = changesByDay.get(dk);
    if (dayChanges) {
      for (const ch of dayChanges) {
        currentStatus.set(ch.issueId, ch.status);
      }
    }
    let remaining = 0;
    for (const row of leafRows) {
      const st = currentStatus.get(String(row._id)) ?? row.status;
      if (!closedStatuses.includes(st)) {
        remaining += row.storyPoints ?? 0;
      }
    }
    const ideal = Math.max(0, totalSp - (totalSp * d) / totalDays);
    points.push({
      date: dk,
      remainingStoryPoints: Math.round(remaining * 10) / 10,
      ideal: Math.round(ideal * 10) / 10,
    });
  }

  if (points.length === 0 && totalSp > 0) {
    const today = dayKey(new Date());
    let remaining = 0;
    for (const row of leafRows) {
      if (!closedStatuses.includes(row.status)) remaining += row.storyPoints ?? 0;
    }
    points.push({ date: today, remainingStoryPoints: remaining, ideal: totalSp });
  }

  return points;
}

export async function getIssueRollup(issueId: string, userId: string): Promise<IssueRollupResult> {
  const root = await Issue.findById(issueId).select('_id key project createdAt type parent').lean();
  if (!root) throw new ApiError(404, 'Issue not found');
  const projectId = String(root.project);
  const member = await ProjectMember.exists({
    project: projectId,
    user: new mongoose.Types.ObjectId(userId),
  });
  if (!member) throw new ApiError(403, 'Access denied');

  const descendantIds = await getDescendantIds(projectId, issueId);
  const directChildCount = await Issue.countDocuments({
    project: projectId,
    parent: root._id,
  });

  if (descendantIds.length === 0) {
    const keyed = withIssueKey(root as { _id: unknown; key?: string; project?: { key?: string } });
    return {
      issueId,
      issueKey: keyed.key ?? issueId,
      totalStoryPoints: 0,
      completedStoryPoints: 0,
      percentDone: 0,
      childCount: 0,
      directChildCount,
      statusBreakdown: [],
      burndown: [],
    };
  }

  const rows = await Issue.find({ _id: { $in: descendantIds } })
    .select('_id parent storyPoints status createdAt key project')
    .lean();

  const hierarchyRows: HierarchyIssueRow[] = rows.map((r) => ({
    _id: r._id as mongoose.Types.ObjectId,
    parent: r.parent as mongoose.Types.ObjectId | null | undefined,
    storyPoints: r.storyPoints as number | null | undefined,
    status: String(r.status ?? ''),
    createdAt: r.createdAt as Date | undefined,
    key: (r as { key?: string }).key,
  }));

  const closedStatuses = await getClosedStatusNamesForProject(projectId);
  const { totalSp, completedSp } = sumLeafStoryPoints(hierarchyRows, closedStatuses);
  const percentDone = totalSp > 0 ? Math.round((completedSp / totalSp) * 1000) / 10 : 0;

  const statusMap = new Map<string, { count: number; storyPoints: number }>();
  const leafIdSet = new Set(getLeafIdsInSet(new Set(descendantIds), hierarchyRows));
  for (const row of hierarchyRows) {
    if (!leafIdSet.has(String(row._id))) continue;
    const st = row.status;
    const cur = statusMap.get(st) ?? { count: 0, storyPoints: 0 };
    cur.count += 1;
    cur.storyPoints += row.storyPoints ?? 0;
    statusMap.set(st, cur);
  }
  const statusBreakdown = [...statusMap.entries()].map(([status, v]) => ({
    status,
    count: v.count,
    storyPoints: v.storyPoints,
  }));

  const earliestChild = hierarchyRows.reduce((min, r) => {
    const t = r.createdAt?.getTime() ?? Infinity;
    return t < min ? t : min;
  }, Infinity);
  const startDate = new Date(
    Math.min(root.createdAt?.getTime() ?? Date.now(), earliestChild === Infinity ? Date.now() : earliestChild)
  );
  const leafRows = hierarchyRows.filter((r) => leafIdSet.has(String(r._id)));
  const burndown = await buildBurndownFromHistory(leafRows, closedStatuses, startDate, new Date());

  const keyedRoot = withIssueKey(root as { _id: unknown; key?: string; project?: { key?: string } });

  return {
    issueId,
    issueKey: keyedRoot.key ?? issueId,
    totalStoryPoints: totalSp,
    completedStoryPoints: completedSp,
    percentDone,
    childCount: descendantIds.length,
    directChildCount,
    statusBreakdown,
    burndown,
  };
}
