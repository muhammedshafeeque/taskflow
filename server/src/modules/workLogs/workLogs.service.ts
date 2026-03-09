import mongoose from 'mongoose';
import { WorkLog, type IWorkLog } from './workLog.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { notifyProjectRefresh } from '../../websocket';

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function create(
  issueId: string,
  authorId: string,
  minutesSpent: number,
  date: Date,
  description?: string
): Promise<unknown> {
  const doc = await WorkLog.create({
    issue: issueId,
    author: authorId,
    minutesSpent,
    date,
    description,
  });
  const populated = await WorkLog.findById(doc._id)
    .populate('author', 'name email')
    .lean();
  const issue = await Issue.findById(issueId).select('project').lean();
  if (issue?.project) notifyProjectRefresh(String(issue.project));
  return populated ?? doc.toObject();
}

export async function findByIssue(
  issueId: string,
  pagination: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const page = pagination.page ?? 1;
  const limit = pagination.limit ?? 20;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    WorkLog.find({ issue: issueId })
      .populate('author', 'name email')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WorkLog.countDocuments({ issue: issueId }),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function update(
  workLogId: string,
  issueId: string,
  authorId: string,
  update: Partial<Pick<IWorkLog, 'minutesSpent' | 'date' | 'description'>>
): Promise<unknown | null> {
  const workLog = await WorkLog.findOneAndUpdate(
    { _id: workLogId, issue: issueId, author: authorId },
    { $set: update },
    { new: true, runValidators: true }
  )
    .populate('author', 'name email')
    .lean();

  if (workLog) {
    const issue = await Issue.findById(issueId).select('project').lean();
    if (issue?.project) notifyProjectRefresh(String(issue.project));
  }
  return workLog ?? null;
}

export async function remove(
  workLogId: string,
  issueId: string,
  authorId: string
): Promise<boolean> {
  const result = await WorkLog.findOneAndDelete({
    _id: workLogId,
    issue: issueId,
    author: authorId,
  });
  if (result != null) {
    const issue = await Issue.findById(issueId).select('project').lean();
    if (issue?.project) notifyProjectRefresh(String(issue.project));
  }
  return result != null;
}

export interface TimesheetUserRow {
  userId: string;
  userName: string;
  byDate: Record<string, number>;
  total: number;
}

export interface TimesheetResult {
  byUser: TimesheetUserRow[];
  byDate: Record<string, number>;
  dateRange: { start: string; end: string };
}

export async function getProjectTimesheet(
  projectId: string,
  start: Date,
  end: Date
): Promise<TimesheetResult> {
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);

  const projectObjectId = new mongoose.Types.ObjectId(projectId);

  const logs = await WorkLog.aggregate([
    {
      $match: {
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
    {
      $match: {
        'issue.project': projectObjectId,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDoc',
      },
    },
    { $unwind: '$authorDoc' },
    {
      $project: {
        minutesSpent: 1,
        author: '$author',
        authorName: '$authorDoc.name',
        dateStr: {
          $dateToString: { format: '%Y-%m-%d', date: '$date' },
        },
      },
    },
  ]);

  const byUserMap = new Map<string, TimesheetUserRow>();
  const byDate: Record<string, number> = {};

  for (const log of logs as {
    minutesSpent: number;
    author: mongoose.Types.ObjectId;
    authorName: string;
    dateStr: string;
  }[]) {
    const userId = String(log.author);
    let row = byUserMap.get(userId);
    if (!row) {
      row = {
        userId,
        userName: log.authorName,
        byDate: {},
        total: 0,
      };
      byUserMap.set(userId, row);
    }
    row.byDate[log.dateStr] = (row.byDate[log.dateStr] ?? 0) + log.minutesSpent;
    row.total += log.minutesSpent;
    byDate[log.dateStr] = (byDate[log.dateStr] ?? 0) + log.minutesSpent;
  }

  return {
    byUser: Array.from(byUserMap.values()),
    byDate,
    dateRange: {
      start: startDay.toISOString(),
      end: endDay.toISOString(),
    },
  };
}

/** Global timesheet: aggregates work logs across all projects the user is a member of. */
export async function getGlobalTimesheet(
  userId: string,
  start: Date,
  end: Date
): Promise<TimesheetResult> {
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) {
    return {
      byUser: [],
      byDate: {},
      dateRange: { start: startDay.toISOString(), end: endDay.toISOString() },
    };
  }

  const logs = await WorkLog.aggregate([
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
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDoc',
      },
    },
    { $unwind: '$authorDoc' },
    {
      $project: {
        minutesSpent: 1,
        author: '$author',
        authorName: '$authorDoc.name',
        dateStr: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
      },
    },
  ]);

  const byUserMap = new Map<string, TimesheetUserRow>();
  const byDate: Record<string, number> = {};

  for (const log of logs as {
    minutesSpent: number;
    author: mongoose.Types.ObjectId;
    authorName: string;
    dateStr: string;
  }[]) {
    const uid = String(log.author);
    let row = byUserMap.get(uid);
    if (!row) {
      row = { userId: uid, userName: log.authorName, byDate: {}, total: 0 };
      byUserMap.set(uid, row);
    }
    row.byDate[log.dateStr] = (row.byDate[log.dateStr] ?? 0) + log.minutesSpent;
    row.total += log.minutesSpent;
    byDate[log.dateStr] = (byDate[log.dateStr] ?? 0) + log.minutesSpent;
  }

  return {
    byUser: Array.from(byUserMap.values()),
    byDate,
    dateRange: { start: startDay.toISOString(), end: endDay.toISOString() },
  };
}

export interface TimesheetDetailItem {
  _id: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  projectName: string;
  projectId: string;
  minutesSpent: number;
  date: string;
  description?: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

/** Work logs for a specific user and date, scoped to projects the requesting user can access. */
export async function getTimesheetDetails(
  requestingUserId: string,
  targetUserId: string,
  dateStr: string
): Promise<TimesheetDetailItem[]> {
  const userObjectId = new mongoose.Types.ObjectId(requestingUserId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) return [];

  const targetDate = new Date(dateStr);
  targetDate.setHours(0, 0, 0, 0);
  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setHours(23, 59, 59, 999);

  const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

  const logs = await WorkLog.aggregate([
    {
      $match: {
        author: targetUserObjectId,
        date: { $gte: targetDate, $lte: targetDateEnd },
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
    { $match: { 'issue.project': { $in: projectIds } } },
    {
      $lookup: {
        from: 'projects',
        localField: 'issue.project',
        foreignField: '_id',
        as: 'project',
      },
    },
    { $unwind: '$project' },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDoc',
      },
    },
    { $unwind: '$authorDoc' },
    {
      $project: {
        _id: 1,
        issueId: '$issue._id',
        issueKey: '$issue.key',
        issueTitle: '$issue.title',
        projectName: '$project.name',
        projectId: '$project._id',
        minutesSpent: 1,
        date: 1,
        description: 1,
        authorId: '$author',
        authorName: '$authorDoc.name',
        createdAt: 1,
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  return (logs as {
    _id: mongoose.Types.ObjectId;
    issueId: mongoose.Types.ObjectId;
    issueKey?: string;
    issueTitle?: string;
    projectName?: string;
    projectId?: mongoose.Types.ObjectId;
    minutesSpent: number;
    date: Date;
    description?: string;
    authorId: mongoose.Types.ObjectId;
    authorName: string;
    createdAt: Date;
  }[]).map((l) => ({
    _id: String(l._id),
    issueId: String(l.issueId),
    issueKey: l.issueKey ?? String(l.issueId).slice(-6),
    issueTitle: l.issueTitle ?? '',
    projectName: l.projectName ?? '',
    projectId: String(l.projectId ?? ''),
    minutesSpent: l.minutesSpent,
    date: l.date instanceof Date ? l.date.toISOString().slice(0, 10) : String(l.date).slice(0, 10),
    description: l.description,
    authorId: String(l.authorId),
    authorName: l.authorName,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
  }));
}

function formatMinutesForExport(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const m = minutes % 60;
  let h = Math.floor(minutes / 60);
  const d = Math.floor(h / 8);
  h = h % 8;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ');
}

/** All work log details for date range, for Excel export. */
export async function getTimesheetExportData(
  userId: string,
  start: Date,
  end: Date
): Promise<TimesheetDetailItem[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) return [];

  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);

  const logs = await WorkLog.aggregate([
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
      $lookup: {
        from: 'projects',
        localField: 'issue.project',
        foreignField: '_id',
        as: 'project',
      },
    },
    { $unwind: '$project' },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDoc',
      },
    },
    { $unwind: '$authorDoc' },
    {
      $project: {
        _id: 1,
        issueId: '$issue._id',
        issueKey: '$issue.key',
        issueTitle: '$issue.title',
        projectName: '$project.name',
        projectId: '$project._id',
        minutesSpent: 1,
        date: 1,
        description: 1,
        authorId: '$author',
        authorName: '$authorDoc.name',
        createdAt: 1,
      },
    },
    { $sort: { date: 1, authorName: 1, createdAt: 1 } },
  ]);

  return (logs as {
    _id: mongoose.Types.ObjectId;
    issueId: mongoose.Types.ObjectId;
    issueKey?: string;
    issueTitle?: string;
    projectName?: string;
    projectId?: mongoose.Types.ObjectId;
    minutesSpent: number;
    date: Date;
    description?: string;
    authorId: mongoose.Types.ObjectId;
    authorName: string;
    createdAt: Date;
  }[]).map((l) => ({
    _id: String(l._id),
    issueId: String(l.issueId),
    issueKey: l.issueKey ?? String(l.issueId).slice(-6),
    issueTitle: l.issueTitle ?? '',
    projectName: l.projectName ?? '',
    projectId: String(l.projectId ?? ''),
    minutesSpent: l.minutesSpent,
    date: l.date instanceof Date ? l.date.toISOString().slice(0, 10) : String(l.date).slice(0, 10),
    description: l.description,
    authorId: String(l.authorId),
    authorName: l.authorName,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
  }));
}

export { formatMinutesForExport };

