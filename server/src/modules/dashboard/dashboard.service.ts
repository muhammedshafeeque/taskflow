import mongoose from 'mongoose';
import { Issue } from '../issues/issue.model';
import { ProjectMember } from '../projects/projectMember.model';
import { User } from '../auth/user.model';
import { WorkLog } from '../workLogs/workLog.model';

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

export async function getWorkloadStats(userId: string, projectId?: string): Promise<WorkloadStats> {
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

  const agg = await Issue.aggregate<{
    _id: mongoose.Types.ObjectId | null;
    totalCount: number;
    openCount: number;
    doneCount: number;
    storyPoints: number;
  }>([
    { $match: { project: { $in: projectIds } } },
    {
      $group: {
        _id: '$assignee',
        totalCount: { $sum: 1 },
        openCount: { $sum: { $cond: [{ $ne: ['$status', 'Done'] }, 1, 0] } },
        doneCount: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } },
        storyPoints: { $sum: { $ifNull: ['$storyPoints', 0] } },
      },
    },
  ]);

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

const DONE_STATUSES = ['Done', 'Closed', 'Resolved'];

export interface ProjectDeliveryEstimate {
  remainingEstimateMinutes: number;
  loggedMinutesOnDone: number;
  burnRatePerDay: number;
  expectedDeliveryDate: string | null;
}

export interface EstimatesStats {
  totalMinutes: number;
  byProject: EstimatesByProject[];
  byAssignee: EstimatesByAssignee[];
  remainingEstimateMinutes?: number;
  loggedMinutesOnDone?: number;
  burnRatePerDay?: number;
  expectedDeliveryDate?: string | null;
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

  const [remainingResult, loggedResult] = await Promise.all([
    Issue.aggregate<{ total: number }>([
      {
        $match: {
          project: projectObjectId,
          status: { $nin: DONE_STATUSES },
          timeEstimateMinutes: { $exists: true, $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$timeEstimateMinutes' } } },
    ]),
    WorkLog.aggregate<{ totalMinutes: number; minDate: Date; maxDate: Date }>([
      { $lookup: { from: 'issues', localField: 'issue', foreignField: '_id', as: 'issueDoc' } },
      { $unwind: '$issueDoc' },
      {
        $match: {
          'issueDoc.project': projectObjectId,
          'issueDoc.status': { $in: DONE_STATUSES },
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

  let expectedDeliveryDate: string | null = null;
  if (remainingEstimateMinutes > 0 && burnRatePerDay > 0) {
    const daysToAdd = Math.ceil(remainingEstimateMinutes / burnRatePerDay);
    const delivery = new Date();
    delivery.setDate(delivery.getDate() + daysToAdd);
    expectedDeliveryDate = delivery.toISOString().slice(0, 10);
  }

  return {
    remainingEstimateMinutes,
    loggedMinutesOnDone,
    burnRatePerDay,
    expectedDeliveryDate,
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
      { $group: { _id: '$project', totalMinutes: { $sum: '$timeEstimateMinutes' } } },
    ]),
    Issue.aggregate<{ _id: mongoose.Types.ObjectId | null; totalMinutes: number }>([
      { $match: { project: { $in: projectIds }, timeEstimateMinutes: { $exists: true, $gt: 0 } } },
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
    const [delivery, unestimatedCount] = await Promise.all([
      getProjectDeliveryEstimate(projectId, userId),
      Issue.countDocuments({
        project: new mongoose.Types.ObjectId(projectId),
        $or: [
          { timeEstimateMinutes: { $exists: false } },
          { timeEstimateMinutes: null },
          { timeEstimateMinutes: { $lte: 0 } },
        ],
      }),
    ]);
    result.remainingEstimateMinutes = delivery.remainingEstimateMinutes;
    result.loggedMinutesOnDone = delivery.loggedMinutesOnDone;
    result.burnRatePerDay = delivery.burnRatePerDay;
    result.expectedDeliveryDate = delivery.expectedDeliveryDate;
    result.unestimatedIssuesCount = unestimatedCount;
  }

  return result;
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

  const agg = await Issue.aggregate<{
    _id: mongoose.Types.ObjectId;
    totalCount: number;
    doneCount: number;
    openCount: number;
  }>([
    { $match: { project: { $in: projectObjectIds } } },
    {
      $group: {
        _id: '$project',
        totalCount: { $sum: 1 },
        doneCount: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } },
        openCount: { $sum: { $cond: [{ $ne: ['$status', 'Done'] }, 1, 0] } },
      },
    },
  ]);

  const { Project } = await import('../projects/project.model');
  const projects = await Project.find({ _id: { $in: projectObjectIds } }).select('name key').lean();
  const projectMap = new Map(projects.map((p) => [String(p._id), p as { name: string; key: string }]));

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

export async function getDefectMetrics(userId: string, projectId?: string): Promise<DefectMetrics> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let projectIds: mongoose.Types.ObjectId[];
  if (projectId) {
    const isMember = await ProjectMember.exists({ user: userObjectId, project: projectId });
    if (!isMember) return { totalBugs: 0, openBugs: 0, closedBugs: 0, byStatus: {}, byPriority: {} };
    projectIds = [new mongoose.Types.ObjectId(projectId)];
  } else {
    const ids = await ProjectMember.find({ user: userObjectId }).distinct('project');
    projectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  }
  if (projectIds.length === 0) return { totalBugs: 0, openBugs: 0, closedBugs: 0, byStatus: {}, byPriority: {} };

  const allIssues = await Issue.find({ project: { $in: projectIds } })
    .select('type status priority storyPoints')
    .lean();

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
    if (status === 'Done' || status.toLowerCase() === 'closed' || status.toLowerCase() === 'resolved') {
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
