import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { IssueHistory } from '../issues/issueHistory.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { User } from '../auth/user.model';
import { WorkLog } from '../workLogs/workLog.model';
import { ApiError } from '../../utils/ApiError';
import type { ReportFilters } from '../reports/reportFilters';
import { buildIssueMatch } from '../reports/reportFilters';
import { getClosedStatusNamesForProject, getClosedStatusNamesFromStatuses } from '../projects/statusClassification';

export interface WorkloadEntry {
  userId: string;
  userName: string;
  totalCount: number;
  openCount: number;
  doneCount: number;
  storyPoints: number;
}

export interface WorkloadStats {
  entries: WorkloadEntry[];
}

export async function getWorkloadStats(userId: string, projectId?: string, filters?: ReportFilters): Promise<WorkloadStats> {
  const match = await buildIssueMatch(userId, projectId, filters ?? {});
  if (!match) return { entries: [] };
  const issues = await Issue.find(match).select('assignee status storyPoints project').lean();
  const projectIds = [...new Set(issues.map((i) => String(i.project)).filter(Boolean))];
  const projectDocs = projectIds.length
    ? await Project.find({ _id: { $in: projectIds } }).select('statuses').lean()
    : [];
  const closedByProject = new Map(
    projectDocs.map((p) => [String(p._id), new Set(getClosedStatusNamesFromStatuses((p as { statuses?: Array<{ name?: string; isClosed?: boolean }> }).statuses))])
  );

  const aggMap = new Map<string, { _id: mongoose.Types.ObjectId | null; totalCount: number; openCount: number; doneCount: number; storyPoints: number }>();
  for (const issue of issues) {
    const assigneeId = (issue.assignee as mongoose.Types.ObjectId | null) ?? null;
    const key = assigneeId ? String(assigneeId) : '__unassigned__';
    const row = aggMap.get(key) ?? { _id: assigneeId, totalCount: 0, openCount: 0, doneCount: 0, storyPoints: 0 };
    row.totalCount += 1;
    row.storyPoints += (issue.storyPoints ?? 0);
    const closedSet = closedByProject.get(String(issue.project)) ?? new Set(['Done', 'Closed', 'Resolved']);
    if (closedSet.has(String(issue.status ?? ''))) row.doneCount += 1;
    else row.openCount += 1;
    aggMap.set(key, row);
  }
  const agg = Array.from(aggMap.values());

  const assigneeIds = agg.map((r) => r._id).filter(Boolean) as mongoose.Types.ObjectId[];
  const users = assigneeIds.length > 0
    ? await User.find({ _id: { $in: assigneeIds } }).select('name').lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), (u as { name: string }).name]));

  const entries: WorkloadEntry[] = agg.map((row) => ({
    userId: row._id ? String(row._id) : '',
    userName: row._id ? (userMap.get(String(row._id)) ?? 'Unassigned') : 'Unassigned',
    totalCount: row.totalCount,
    openCount: row.openCount,
    doneCount: row.doneCount,
    storyPoints: row.storyPoints,
  }));

  return { entries };
}

export interface EstimatesByProject {
  projectId: string;
  projectName: string;
  totalMinutes: number;
}

export interface EstimatesByAssignee {
  userId: string;
  userName: string;
  totalMinutes: number;
}

/** Pipeline stage: add hasChildren (true if any issue has parent = this._id). Use only leaf issues for estimate sums so epics/stories use children sum. */
const leafOnlyLookup = [
  {
    $lookup: {
      from: 'issues',
      let: { parentId: '$_id' },
      pipeline: [{ $match: { $expr: { $eq: ['$parent', '$$parentId'] } } }, { $limit: 1 }],
      as: '_children',
    },
  },
  { $addFields: { _hasChildren: { $gt: [{ $size: '$_children' }, 0] } } },
  { $match: { _hasChildren: false } },
];

export interface ProjectDeliveryEstimate {
  remainingEstimateMinutes: number;
  loggedMinutesOnDone: number;
  burnRatePerDay: number;
  expectedDeliveryDate: string | null;
  /** True when delivery date was computed using default 8h/day (no time logged on done issues yet) */
  usedDefaultBurnRate?: boolean;
}

export interface EstimatesStats {
  totalMinutes: number;
  byProject: EstimatesByProject[];
  byAssignee: EstimatesByAssignee[];
  remainingEstimateMinutes?: number;
  loggedMinutesOnDone?: number;
  burnRatePerDay?: number;
  expectedDeliveryDate?: string | null;
  usedDefaultBurnRate?: boolean;
  unestimatedIssuesCount?: number;
}

export async function getProjectDeliveryEstimate(
  projectId: string,
  userId: string
): Promise<ProjectDeliveryEstimate> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
  if (!isMember) {
    return {
      remainingEstimateMinutes: 0,
      loggedMinutesOnDone: 0,
      burnRatePerDay: 0,
      expectedDeliveryDate: null,
    };
  }
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const closedStatuses = await getClosedStatusNamesForProject(projectId);

  const [remainingResult, loggedResult] = await Promise.all([
    Issue.aggregate<{ total: number }>([
      {
        $match: {
          project: projectObjectId,
          status: { $nin: closedStatuses },
          timeEstimateMinutes: { $exists: true, $gt: 0 },
        },
      },
      ...leafOnlyLookup,
      { $group: { _id: null, total: { $sum: '$timeEstimateMinutes' } } },
    ]),
    WorkLog.aggregate<{ totalMinutes: number; minDate: Date; maxDate: Date }>([
      { $lookup: { from: 'issues', localField: 'issue', foreignField: '_id', as: 'issueDoc' } },
      { $unwind: '$issueDoc' },
      {
        $match: {
          'issueDoc.project': projectObjectId,
          'issueDoc.status': { $in: closedStatuses },
        },
      },
      {
        $group: {
          _id: null,
          totalMinutes: { $sum: '$minutesSpent' },
          minDate: { $min: '$date' },
          maxDate: { $max: '$date' },
        },
      },
    ]),
  ]);

  const remainingEstimateMinutes = remainingResult[0]?.total ?? 0;
  const loggedRow = loggedResult[0];
  const loggedMinutesOnDone = loggedRow?.totalMinutes ?? 0;
  const minDate = loggedRow?.minDate ? new Date(loggedRow.minDate) : null;
  const maxDate = loggedRow?.maxDate ? new Date(loggedRow.maxDate) : null;

  let burnRatePerDay = 0;
  if (loggedMinutesOnDone > 0 && minDate && maxDate) {
    const daysDiff = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / (24 * 60 * 60 * 1000)));
    burnRatePerDay = loggedMinutesOnDone / daysDiff;
  }

  /** When no time logged on done issues, use 8h/day so we can still show an expected delivery date */
  const DEFAULT_BURN_RATE_MINUTES_PER_DAY = 8 * 60;
  let usedDefaultBurnRate = false;
  let expectedDeliveryDate: string | null = null;
  if (remainingEstimateMinutes > 0) {
    const rateToUse = burnRatePerDay > 0 ? burnRatePerDay : DEFAULT_BURN_RATE_MINUTES_PER_DAY;
    if (burnRatePerDay <= 0) usedDefaultBurnRate = true;
    const daysToAdd = Math.ceil(remainingEstimateMinutes / rateToUse);
    const delivery = new Date();
    delivery.setDate(delivery.getDate() + daysToAdd);
    expectedDeliveryDate = delivery.toISOString().slice(0, 10);
  }

  return {
    remainingEstimateMinutes,
    loggedMinutesOnDone,
    burnRatePerDay,
    expectedDeliveryDate,
    usedDefaultBurnRate: usedDefaultBurnRate || undefined,
  };
}

export async function getEstimatesStats(userId: string, projectId?: string): Promise<EstimatesStats> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let projectIds: mongoose.Types.ObjectId[];
  if (projectId) {
    const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
    if (!isMember) return { totalMinutes: 0, byProject: [], byAssignee: [] };
    projectIds = [new mongoose.Types.ObjectId(projectId)];
  } else {
    const ids = await ProjectMember.find({ user: userObjectId }).distinct('project');
    projectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (projectIds.length === 0) return { totalMinutes: 0, byProject: [], byAssignee: [] };

  const [byProjectAgg, byAssigneeAgg] = await Promise.all([
    Issue.aggregate<{ _id: mongoose.Types.ObjectId; totalMinutes: number }>([
      { $match: { project: { $in: projectIds }, timeEstimateMinutes: { $exists: true, $gt: 0 } } },
      ...leafOnlyLookup,
      { $group: { _id: '$project', totalMinutes: { $sum: '$timeEstimateMinutes' } } },
    ]),
    Issue.aggregate<{ _id: mongoose.Types.ObjectId | null; totalMinutes: number }>([
      { $match: { project: { $in: projectIds }, timeEstimateMinutes: { $exists: true, $gt: 0 } } },
      ...leafOnlyLookup,
      { $group: { _id: '$assignee', totalMinutes: { $sum: '$timeEstimateMinutes' } } },
    ]),
  ]);

  const { Project } = await import('../projects/project.model');
  const projects = await Project.find({ _id: { $in: projectIds } }).select('name').lean();
  const projectMap = new Map(projects.map((p) => [String(p._id), (p as { name: string }).name]));

  const assigneeIds = byAssigneeAgg.map((r) => r._id).filter(Boolean) as mongoose.Types.ObjectId[];
  const users = assigneeIds.length > 0
    ? await User.find({ _id: { $in: assigneeIds } }).select('name').lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), (u as { name: string }).name]));

  const byProject: EstimatesByProject[] = byProjectAgg.map((row) => ({
    projectId: String(row._id),
    projectName: projectMap.get(String(row._id)) ?? 'Unknown',
    totalMinutes: row.totalMinutes,
  }));

  const byAssignee: EstimatesByAssignee[] = byAssigneeAgg.map((row) => ({
    userId: row._id ? String(row._id) : '',
    userName: row._id ? (userMap.get(String(row._id)) ?? 'Unassigned') : 'Unassigned',
    totalMinutes: row.totalMinutes,
  }));

  const totalMinutes = byProject.reduce((sum, p) => sum + p.totalMinutes, 0);

  const result: EstimatesStats = { totalMinutes, byProject, byAssignee };

  if (projectId) {
    const [delivery, unestimatedCountResult] = await Promise.all([
      getProjectDeliveryEstimate(projectId, userId),
      Issue.aggregate<{ count: number }>([
        { $match: { project: new mongoose.Types.ObjectId(projectId) } },
        {
          $lookup: {
            from: 'issues',
            localField: '_id',
            foreignField: 'parent',
            as: 'childDocs',
          },
        },
        {
          $addFields: {
            _childSum: { $ifNull: [{ $sum: '$childDocs.timeEstimateMinutes' }, 0] },
            _hasChildren: { $gt: [{ $size: '$childDocs' }, 0] },
          },
        },
        {
          $addFields: {
            _effectiveEstimate: {
              $cond: {
                if: '$_hasChildren',
                then: '$_childSum',
                else: '$timeEstimateMinutes',
              },
            },
          },
        },
        {
          $match: {
            $or: [
              { _effectiveEstimate: { $exists: false } },
              { _effectiveEstimate: null },
              { _effectiveEstimate: { $lte: 0 } },
            ],
          },
        },
        { $count: 'count' },
      ]),
    ]);
    const unestimatedCount = unestimatedCountResult[0]?.count ?? 0;
    result.remainingEstimateMinutes = delivery.remainingEstimateMinutes;
    result.loggedMinutesOnDone = delivery.loggedMinutesOnDone;
    result.burnRatePerDay = delivery.burnRatePerDay;
    result.expectedDeliveryDate = delivery.expectedDeliveryDate;
    result.usedDefaultBurnRate = delivery.usedDefaultBurnRate;
    result.unestimatedIssuesCount = unestimatedCount;
  }

  return result;
}

export interface ProjectMetricsResponse {
  issuesByType: Array<{ name: string; value: number }>;
  typeVsStatus: Array<{ type: string; status: string; count: number }>;
  /** Project status names (from project settings). Only show status-based series for these. */
  projectStatuses: string[];
  /** Distinct count of issues moved to each status by date (from history). No duplicates per date+status. */
  movedToStatusByDate: Array<{ date: string; status: string; count: number }>;
  /** Bugs created by date (type contains 'bug') */
  bugsCreatedByDate: Array<{ date: string; count: number }>;
  /** Logged time by date (sum minutes per day for project). date = YYYY-MM-DD */
  loggedTimeByDate: Array<{ date: string; minutes: number }>;
  /** Total estimated minutes (current) for comparison */
  totalEstimatedMinutes: number;
}

export async function getProjectMetrics(projectId: string, userId: string): Promise<ProjectMetricsResponse | null> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
  if (!isMember) return null;
  const projectObjectId = new mongoose.Types.ObjectId(projectId);

  const { Project } = await import('../projects/project.model');
  const projectDoc = await Project.findById(projectId).select('statuses').lean();
  const projectStatuses: string[] =
    projectDoc && (projectDoc as { statuses?: Array<{ name: string }> }).statuses?.length
      ? (projectDoc as { statuses: Array<{ name: string }> }).statuses.map((s) => s.name)
      : [];

  const [issuesByTypeAgg, typeVsStatusAgg, movedToStatusByDateAgg, createdWithStatusByDateAgg, bugsCreatedByDateAgg, loggedTimeByDateAgg, totalEstimateRow] = await Promise.all([
    Issue.aggregate<{ _id: string; count: number }>([
      { $match: { project: projectObjectId } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    Issue.aggregate<{ _id: { type: string; status: string }; count: number }>([
      { $match: { project: projectObjectId } },
      { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
    ]),
    IssueHistory.aggregate<{ _id: { date: string; status: string }; count: number }>([
      { $match: { action: 'field_change', field: 'status' } },
      { $lookup: { from: 'issues', localField: 'issue', foreignField: '_id', as: 'issueDoc' } },
      { $unwind: '$issueDoc' },
      { $match: { 'issueDoc.project': projectObjectId } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            status: { $ifNull: [{ $toString: '$toValue' }, ''] },
          },
          issues: { $addToSet: '$issue' },
        },
      },
      { $project: { _id: 1, count: { $size: '$issues' } } },
      { $sort: { '_id.date': 1 } },
    ]),
    Issue.aggregate<{ _id: { date: string; status: string }; count: number }>([
      { $match: { project: projectObjectId } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            status: { $ifNull: ['$status', ''] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]),
    Issue.aggregate<{ _id: string; count: number }>([
      { $match: { project: projectObjectId, type: { $regex: /bug/i } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    WorkLog.aggregate<{ _id: string; totalMinutes: number }>([
      { $lookup: { from: 'issues', localField: 'issue', foreignField: '_id', as: 'issueDoc' } },
      { $unwind: '$issueDoc' },
      { $match: { 'issueDoc.project': projectObjectId } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalMinutes: { $sum: '$minutesSpent' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Issue.aggregate<{ total: number }>([
      { $match: { project: projectObjectId } },
      ...leafOnlyLookup,
      { $match: { timeEstimateMinutes: { $exists: true, $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$timeEstimateMinutes' } } },
    ]),
  ]);

  const issuesByType = issuesByTypeAgg.map((r) => ({ name: r._id || 'Unknown', value: r.count }));
  const typeVsStatus = typeVsStatusAgg.map((r) => ({
    type: r._id.type,
    status: r._id.status,
    count: r.count,
  }));
  const movedMap = new Map<string, number>();
  for (const r of movedToStatusByDateAgg) {
    const key = `${r._id.date}\t${r._id.status}`;
    movedMap.set(key, r.count);
  }
  for (const r of createdWithStatusByDateAgg) {
    const key = `${r._id.date}\t${r._id.status}`;
    movedMap.set(key, (movedMap.get(key) ?? 0) + r.count);
  }
  const movedToStatusByDate = Array.from(movedMap.entries())
    .map(([key, count]) => {
      const [date, status] = key.split('\t');
      return { date, status, count };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const bugsCreatedByDate = bugsCreatedByDateAgg.map((r) => ({ date: r._id, count: r.count }));
  const loggedTimeByDate = loggedTimeByDateAgg.map((r) => ({ date: r._id, minutes: r.totalMinutes }));
  const totalEstimatedMinutes = totalEstimateRow[0]?.total ?? 0;

  return {
    issuesByType,
    typeVsStatus,
    projectStatuses,
    movedToStatusByDate,
    bugsCreatedByDate,
    loggedTimeByDate,
    totalEstimatedMinutes,
  };
}

export interface DashboardStats {
  totalIssues: number;
  issuesByStatus: Record<string, number>;
  recentIssues: Array<{
    _id: string;
    key?: string;
    title: string;
    status: string;
    project: string;
    projectName?: string;
    updatedAt: string;
  }>;
}

export async function getStatsForUser(userId: string): Promise<DashboardStats> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  const projectObjectIds = projectIds.map((id) => new mongoose.Types.ObjectId(id));

  const [aggregationResult, recentList] = await Promise.all([
    Issue.aggregate<{ _id: string; count: number }>([
      { $match: { project: { $in: projectObjectIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Issue.find({ project: { $in: projectObjectIds } })
      .select('key title status project updatedAt')
      .populate('project', 'name')
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const issuesByStatus: Record<string, number> = {};
  let totalIssues = 0;
  for (const row of aggregationResult) {
    issuesByStatus[row._id] = row.count;
    totalIssues += row.count;
  }

  const recentIssues = recentList.map((doc) => {
    const proj = doc.project as { _id?: mongoose.Types.ObjectId; name?: string } | mongoose.Types.ObjectId;
    const projectId = typeof proj === 'object' && proj && '_id' in proj ? String(proj._id) : String(proj);
    const projectName = typeof proj === 'object' && proj && 'name' in proj ? proj.name : undefined;
    return {
      _id: String(doc._id),
      key: doc.key,
      title: doc.title,
      status: doc.status,
      project: projectId,
      projectName,
      updatedAt: (doc.updatedAt as Date).toISOString(),
    };
  });

  return {
    totalIssues,
    issuesByStatus,
    recentIssues,
  };
}

export interface PortfolioProjectEntry {
  projectId: string;
  projectName: string;
  projectKey: string;
  totalIssues: number;
  doneCount: number;
  openCount: number;
  progressPercent: number;
}

export async function getPortfolioStats(userId: string): Promise<PortfolioProjectEntry[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  const projectObjectIds = projectIds.map((id) => new mongoose.Types.ObjectId(id));
  if (projectObjectIds.length === 0) return [];

  const projectDocs = await Project.find({ _id: { $in: projectObjectIds } }).select('name key statuses').lean();
  const closedByProject = new Map(
    projectDocs.map((p) => [String(p._id), new Set(getClosedStatusNamesFromStatuses((p as { statuses?: Array<{ name?: string; isClosed?: boolean }> }).statuses))])
  );
  const rows = await Issue.find({ project: { $in: projectObjectIds } }).select('project status').lean();
  const aggMap = new Map<string, { _id: mongoose.Types.ObjectId; totalCount: number; doneCount: number; openCount: number }>();
  for (const row of rows) {
    const pid = String(row.project);
    const closedSet = closedByProject.get(pid) ?? new Set(['Done', 'Closed', 'Resolved']);
    const entry = aggMap.get(pid) ?? { _id: new mongoose.Types.ObjectId(pid), totalCount: 0, doneCount: 0, openCount: 0 };
    entry.totalCount += 1;
    if (closedSet.has(String(row.status ?? ''))) entry.doneCount += 1;
    else entry.openCount += 1;
    aggMap.set(pid, entry);
  }
  const agg = Array.from(aggMap.values());

  const projectMap = new Map(projectDocs.map((p) => [String(p._id), p as { name: string; key: string }]));

  return agg.map((row) => {
    const proj = projectMap.get(String(row._id));
    const total = row.totalCount || 1;
    const done = row.doneCount || 0;
    return {
      projectId: String(row._id),
      projectName: proj?.name ?? 'Unknown',
      projectKey: proj?.key ?? '',
      totalIssues: row.totalCount,
      doneCount: row.doneCount,
      openCount: row.openCount,
      progressPercent: Math.round((done / total) * 100),
    };
  });
}

export async function getExecutiveStats(): Promise<{
  totalProjects: number;
  totalIssues: number;
  issuesByStatus: Record<string, number>;
  recentIssues: Array<{ _id: string; key?: string; title: string; status: string; project: string; projectName?: string; updatedAt: string }>;
}> {
  const { Project } = await import('../projects/project.model');
  const totalProjects = await Project.countDocuments();
  const [agg, recentList] = await Promise.all([
    Issue.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Issue.find()
      .select('key title status project updatedAt')
      .populate('project', 'name')
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);
  const issuesByStatus: Record<string, number> = {};
  let totalIssues = 0;
  for (const row of agg) {
    issuesByStatus[row._id] = row.count;
    totalIssues += row.count;
  }
  const recentIssues = recentList.map((doc) => {
    const proj = doc.project as { _id?: mongoose.Types.ObjectId; name?: string } | mongoose.Types.ObjectId;
    const projectId = typeof proj === 'object' && proj && '_id' in proj ? String(proj._id) : String(proj);
    const projectName = typeof proj === 'object' && proj && 'name' in proj ? proj.name : undefined;
    return {
      _id: String(doc._id),
      key: doc.key,
      title: doc.title,
      status: doc.status,
      project: projectId,
      projectName,
      updatedAt: (doc.updatedAt as Date).toISOString(),
    };
  });
  return { totalProjects, totalIssues, issuesByStatus, recentIssues };
}

/** Check if issue type is a bug (Bug or project-specific bug type name) */
function isBugType(typeName: string): boolean {
  if (!typeName) return false;
  const lower = typeName.toLowerCase();
  return lower === 'bug' || lower.includes('bug');
}

export interface DefectMetrics {
  totalBugs: number;
  openBugs: number;
  closedBugs: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  defectDensity?: number;
}

export async function getDefectMetrics(userId: string, projectId?: string, filters?: ReportFilters): Promise<DefectMetrics> {
  const match = await buildIssueMatch(userId, projectId, filters ?? {});
  if (!match) return { totalBugs: 0, openBugs: 0, closedBugs: 0, byStatus: {}, byPriority: {} };

  const allIssues = await Issue.find(match)
    .select('type status priority storyPoints project')
    .lean();
  const closedStatuses = projectId ? await getClosedStatusNamesForProject(projectId) : ['Done', 'Closed', 'Resolved'];
  const closedSet = new Set(closedStatuses);

  const bugs = allIssues.filter((i) => isBugType((i as { type?: string }).type ?? ''));

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let openBugs = 0;
  let closedBugs = 0;

  for (const b of bugs) {
    const status = (b as { status?: string }).status ?? 'Unknown';
    const priority = (b as { priority?: string }).priority ?? 'Unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    if (closedSet.has(status)) {
      closedBugs++;
    } else {
      openBugs++;
    }
  }

  let defectDensity: number | undefined;
  const totalStoryPoints = allIssues.reduce((sum, i) => sum + ((i as { storyPoints?: number }).storyPoints ?? 0), 0);
  if (totalStoryPoints > 0 && bugs.length > 0) {
    defectDensity = Math.round((bugs.length / totalStoryPoints) * 100) / 100;
  }

  return {
    totalBugs: bugs.length,
    openBugs,
    closedBugs,
    byStatus,
    byPriority,
    defectDensity,
  };
}

export interface CostUsageEntry {
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  totalMinutes: number;
  totalHours: number;
}

export interface CostUsageReport {
  entries: CostUsageEntry[];
}

export async function getCostUsageReport(
  userId: string,
  projectId: string | undefined,
  from: Date,
  to: Date
): Promise<CostUsageReport> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let projectIds: mongoose.Types.ObjectId[];
  if (projectId) {
    const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
    if (!isMember) return { entries: [] };
    projectIds = [new mongoose.Types.ObjectId(projectId)];
  } else {
    const ids = await ProjectMember.find({ user: userObjectId }).distinct('project');
    projectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (projectIds.length === 0) return { entries: [] };

  const startDay = new Date(from);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(to);
  endDay.setHours(23, 59, 59, 999);

  const { WorkLog } = await import('../workLogs/workLog.model');
  const { Project } = await import('../projects/project.model');
  const { User } = await import('../auth/user.model');

  const agg = await WorkLog.aggregate<{
    _id: { project: mongoose.Types.ObjectId; author: mongoose.Types.ObjectId };
    totalMinutes: number;
  }>([
    { $match: { date: { $gte: startDay, $lte: endDay } } },
    {
      $lookup: {
        from: 'issues',
        localField: 'issue',
        foreignField: '_id',
        as: 'issue',
      },
    },
    { $unwind: '$issue' },
    { $match: { 'issue.project': { $in: projectIds } } },
    {
      $group: {
        _id: { project: '$issue.project', author: '$author' },
        totalMinutes: { $sum: '$minutesSpent' },
      },
    },
  ]);

  const projIds = [...new Set(agg.map((r) => r._id.project))];
  const userIds = [...new Set(agg.map((r) => r._id.author))];
  const [projects, users] = await Promise.all([
    Project.find({ _id: { $in: projIds } }).select('name').lean(),
    User.find({ _id: { $in: userIds } }).select('name').lean(),
  ]);
  const projectMap = new Map(projects.map((p) => [String(p._id), (p as { name: string }).name]));
  const userMap = new Map(users.map((u) => [String(u._id), (u as { name: string }).name]));

  const entries: CostUsageEntry[] = agg.map((r) => ({
    projectId: String(r._id.project),
    projectName: projectMap.get(String(r._id.project)) ?? 'Unknown',
    userId: String(r._id.author),
    userName: userMap.get(String(r._id.author)) ?? 'Unknown',
    totalMinutes: r.totalMinutes,
    totalHours: Math.round((r.totalMinutes / 60) * 100) / 100,
  }));

  return { entries };
}

export interface PerformanceReportTeammate {
  _id: string;
  name: string;
}

export interface PerformanceReportRow {
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  updates: number;
  timeLoggedMinutes: number;
  estimatedMinutes: number | null;
  status: string;
}

export interface PerformanceReportTotals {
  updates: number;
  timeLoggedMinutes: number;
  estimatedMinutes: number;
}

export interface PerformanceReportChartMember {
  userId: string;
  userName: string;
  totalMinutes: number;
}

export interface PerformanceReportResult {
  rows: PerformanceReportRow[];
  totals: PerformanceReportTotals;
  chartByMember: PerformanceReportChartMember[];
}

function normalizeDayRange(from: Date, to: Date): { startDay: Date; endDay: Date } {
  const startDay = new Date(from);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(to);
  endDay.setHours(23, 59, 59, 999);
  return { startDay, endDay };
}

/** Users who share at least one project with the requester (for picker + validation). */
export async function getPerformanceReportTeammates(requestingUserId: string): Promise<PerformanceReportTeammate[]> {
  const userObjectId = new mongoose.Types.ObjectId(requestingUserId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) return [];

  const memberUserIds = await ProjectMember.distinct('user', { project: { $in: projectIds } });
  if (memberUserIds.length === 0) return [];

  const users = await User.find({ _id: { $in: memberUserIds } })
    .select('name')
    .sort({ name: 1 })
    .lean();
  return (users as { _id: mongoose.Types.ObjectId; name: string }[]).map((u) => ({
    _id: u._id.toString(),
    name: u.name,
  }));
}

export async function getPerformanceReport(
  requestingUserId: string,
  targetUserIds: string[],
  from: Date,
  to: Date,
  filterProjectIds?: string[] | null
): Promise<PerformanceReportResult> {
  const empty: PerformanceReportResult = {
    rows: [],
    totals: { updates: 0, timeLoggedMinutes: 0, estimatedMinutes: 0 },
    chartByMember: [],
  };

  const userObjectId = new mongoose.Types.ObjectId(requestingUserId);
  const memberProjectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (memberProjectIds.length === 0) return empty;

  const allowedProjectIdSet = new Set(memberProjectIds.map((id) => String(id)));
  let projectObjectIds: mongoose.Types.ObjectId[];
  if (filterProjectIds && filterProjectIds.length > 0) {
    for (const pid of filterProjectIds) {
      if (!mongoose.Types.ObjectId.isValid(pid)) {
        throw new ApiError(400, `Invalid project id: ${pid}`);
      }
      if (!allowedProjectIdSet.has(pid)) {
        throw new ApiError(403, 'One or more projects are not accessible');
      }
    }
    projectObjectIds = filterProjectIds.map((id) => new mongoose.Types.ObjectId(id));
  } else {
    projectObjectIds = memberProjectIds.map((id) => new mongoose.Types.ObjectId(id));
  }

  const memberUserIds = await ProjectMember.distinct('user', { project: { $in: memberProjectIds } });
  const allowedUserIds = new Set(memberUserIds.map((id) => String(id)));

  const uniqueTargets = [...new Set(targetUserIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueTargets.length === 0) {
    uniqueTargets.push(requestingUserId);
  }

  for (const id of uniqueTargets) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, `Invalid user id: ${id}`);
    }
    if (!allowedUserIds.has(id)) {
      throw new ApiError(403, 'One or more selected users are not in your projects');
    }
  }

  const targetObjectIds = uniqueTargets.map((id) => new mongoose.Types.ObjectId(id));
  const { startDay, endDay } = normalizeDayRange(from, to);

  type PairKey = string;
  const pairMap = new Map<
    PairKey,
    { authorId: string; issueId: string; timeLoggedMinutes: number; workLogCount: number; historyCount: number }
  >();

  const workAgg = await WorkLog.aggregate<{
    _id: { author: mongoose.Types.ObjectId; issue: mongoose.Types.ObjectId };
    timeLoggedMinutes: number;
    workLogCount: number;
  }>([
    {
      $match: {
        author: { $in: targetObjectIds },
        date: { $gte: startDay, $lte: endDay },
      },
    },
    {
      $lookup: {
        from: 'issues',
        localField: 'issue',
        foreignField: '_id',
        as: 'issue',
      },
    },
    { $unwind: '$issue' },
    { $match: { 'issue.project': { $in: projectObjectIds } } },
    {
      $group: {
        _id: { author: '$author', issue: '$issue._id' },
        timeLoggedMinutes: { $sum: '$minutesSpent' },
        workLogCount: { $sum: 1 },
      },
    },
  ]);

  for (const r of workAgg) {
    const authorId = String(r._id.author);
    const issueId = String(r._id.issue);
    const k = `${authorId}:${issueId}`;
    pairMap.set(k, {
      authorId,
      issueId,
      timeLoggedMinutes: r.timeLoggedMinutes,
      workLogCount: r.workLogCount,
      historyCount: 0,
    });
  }

  const histAgg = await IssueHistory.aggregate<{
    _id: { author: mongoose.Types.ObjectId; issue: mongoose.Types.ObjectId };
    historyCount: number;
  }>([
    {
      $match: {
        author: { $in: targetObjectIds },
        createdAt: { $gte: startDay, $lte: endDay },
      },
    },
    {
      $lookup: {
        from: 'issues',
        localField: 'issue',
        foreignField: '_id',
        as: 'issue',
      },
    },
    { $unwind: '$issue' },
    { $match: { 'issue.project': { $in: projectObjectIds } } },
    {
      $group: {
        _id: { author: '$author', issue: '$issue._id' },
        historyCount: { $sum: 1 },
      },
    },
  ]);

  for (const r of histAgg) {
    const authorId = String(r._id.author);
    const issueId = String(r._id.issue);
    const k = `${authorId}:${issueId}`;
    const existing = pairMap.get(k);
    if (existing) {
      existing.historyCount = r.historyCount;
    } else {
      pairMap.set(k, {
        authorId,
        issueId,
        timeLoggedMinutes: 0,
        workLogCount: 0,
        historyCount: r.historyCount,
      });
    }
  }

  if (pairMap.size === 0) return empty;

  const issueObjectIds = [...new Set([...pairMap.values()].map((p) => p.issueId))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const issues = await Issue.find({ _id: { $in: issueObjectIds } })
    .select('title status timeEstimateMinutes project key')
    .lean();
  const issueById = new Map(
    issues.map((doc) => {
      const d = doc as {
        _id: mongoose.Types.ObjectId;
        title: string;
        status: string;
        timeEstimateMinutes?: number;
        project: mongoose.Types.ObjectId;
        key?: string;
      };
      return [String(d._id), d] as const;
    })
  );

  const projectIdSet = new Set(issues.map((doc) => String((doc as { project: mongoose.Types.ObjectId }).project)));
  const projDocs = await Project.find({ _id: { $in: [...projectIdSet].map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('name')
    .lean();
  const projectMap = new Map(
    (projDocs as { _id: mongoose.Types.ObjectId; name: string }[]).map((p) => [String(p._id), p.name])
  );

  const authorIdSet = new Set([...pairMap.values()].map((p) => p.authorId));
  const authorDocs = await User.find({ _id: { $in: [...authorIdSet].map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('name')
    .lean();
  const authorMap = new Map(
    (authorDocs as { _id: mongoose.Types.ObjectId; name: string }[]).map((u) => [String(u._id), u.name])
  );

  const rows: PerformanceReportRow[] = [];
  for (const p of pairMap.values()) {
    const issueDoc = issueById.get(p.issueId);
    if (!issueDoc) continue;
    const projectId = String(issueDoc.project);
    rows.push({
      userId: p.authorId,
      userName: authorMap.get(p.authorId) ?? 'Unknown',
      projectId,
      projectName: projectMap.get(projectId) ?? 'Unknown',
      issueId: p.issueId,
      issueKey: issueDoc.key ?? p.issueId.slice(-8),
      issueTitle: issueDoc.title,
      updates: p.workLogCount + p.historyCount,
      timeLoggedMinutes: p.timeLoggedMinutes,
      estimatedMinutes:
        issueDoc.timeEstimateMinutes !== undefined && issueDoc.timeEstimateMinutes !== null
          ? issueDoc.timeEstimateMinutes
          : null,
      status: issueDoc.status ?? '',
    });
  }

  rows.sort((a, b) => {
    const c = a.userName.localeCompare(b.userName);
    if (c !== 0) return c;
    const d = a.projectName.localeCompare(b.projectName);
    if (d !== 0) return d;
    return a.issueKey.localeCompare(b.issueKey);
  });

  const totals: PerformanceReportTotals = {
    updates: rows.reduce((s, r) => s + r.updates, 0),
    timeLoggedMinutes: rows.reduce((s, r) => s + r.timeLoggedMinutes, 0),
    estimatedMinutes: rows.reduce((s, r) => s + (r.estimatedMinutes ?? 0), 0),
  };

  const minutesByUser = new Map<string, { userName: string; total: number }>();
  for (const r of rows) {
    const cur = minutesByUser.get(r.userId) ?? { userName: r.userName, total: 0 };
    cur.total += r.timeLoggedMinutes;
    minutesByUser.set(r.userId, cur);
  }
  const chartByMember: PerformanceReportChartMember[] = [...minutesByUser.entries()].map(([userId, v]) => ({
    userId,
    userName: v.userName,
    totalMinutes: v.total,
  }));
  chartByMember.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return { rows, totals, chartByMember };
}
