import { Sprint } from './sprint.model';
import { Issue } from '../issues/issue.model';
import { ProjectMember } from '../projects/projectMember.model';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { getClosedStatusNamesForProject } from '../projects/statusClassification';

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  ideal: number;
  actual: number;
}

export async function getSprintBurndown(sprintId: string, projectId: string, userId: string): Promise<BurndownPoint[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const member = await ProjectMember.findOne({ project: projectId, user: userObjectId });
  if (!member) throw new ApiError(403, 'Access denied');

  const sprint = await Sprint.findById(sprintId).lean();
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  if (String(sprint.project) !== String(projectId)) throw new ApiError(404, 'Sprint not found');

  const start = sprint.startDate ? new Date(sprint.startDate) : new Date(sprint.createdAt);
  const end = sprint.endDate ? new Date(sprint.endDate) : new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));

  const closedStatuses = await getClosedStatusNamesForProject(projectId);
  const isDone = (status: string): boolean => closedStatuses.includes(status);

  const issues = await Issue.find({ sprint: sprintId, project: projectId })
    .select('storyPoints status')
    .lean();

  const totalSP = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const remainingIssues = issues.filter((i) => !isDone(i.status));
  const currentRemainingSP = remainingIssues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);

  const points: BurndownPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.max(0, Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));

  for (let d = 0; d <= totalDays; d++) {
    const date = new Date(start);
    date.setDate(date.getDate() + d);
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().slice(0, 10);

    const ideal = Math.max(0, totalSP - (totalSP * d) / totalDays);
    let actual: number;
    if (d === 0) {
      actual = totalSP;
    } else if (d <= daysElapsed && daysElapsed > 0) {
      const progress = d / daysElapsed;
      actual = totalSP - (totalSP - currentRemainingSP) * progress;
    } else {
      actual = currentRemainingSP;
    }
    points.push({ date: dateStr, ideal: Math.round(ideal * 10) / 10, actual: Math.round(actual * 10) / 10 });
  }

  return points;
}

export async function getSprintVelocity(projectId: string, limit: number, userId: string): Promise<{ sprintName: string; completedSP: number }[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const member = await ProjectMember.findOne({ project: projectId, user: userObjectId });
  if (!member) throw new ApiError(403, 'Access denied');

  const closedStatuses = await getClosedStatusNamesForProject(projectId);

  const completedSprints = await Sprint.find({ project: projectId, status: 'completed' })
    .sort({ endDate: -1 })
    .limit(limit)
    .lean();

  const result: { sprintName: string; completedSP: number }[] = [];
  for (const s of completedSprints) {
    const done = await Issue.aggregate([
      { $match: { sprint: s._id, project: new mongoose.Types.ObjectId(projectId), status: { $in: closedStatuses } } },
      { $group: { _id: null, sum: { $sum: { $ifNull: ['$storyPoints', 0] } } } },
    ]);
    result.push({
      sprintName: s.name,
      completedSP: done[0]?.sum ?? 0,
    });
  }
  return result;
}

export interface SprintSummary {
  totalIssues: number;
  completedIssues: number;
  remainingIssues: number;
  storyPointsCommitted: number;
  storyPointsCompleted: number;
  storyPointsRemaining: number;
}

export async function getSprintSummary(sprintId: string, projectId: string, userId: string): Promise<SprintSummary> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const member = await ProjectMember.findOne({ project: projectId, user: userObjectId });
  if (!member) throw new ApiError(403, 'Access denied');

  const sprint = await Sprint.findById(sprintId).lean();
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  if (String(sprint.project) !== String(projectId)) throw new ApiError(404, 'Sprint not found');

  const closedStatuses = await getClosedStatusNamesForProject(projectId);
  const isDone = (status: string): boolean => closedStatuses.includes(status);

  const issues = await Issue.find({ sprint: sprintId, project: projectId })
    .select('storyPoints status')
    .lean();

  const totalIssues = issues.length;
  const completedIssues = issues.filter((i) => isDone(i.status)).length;
  const remainingIssues = totalIssues - completedIssues;
  const storyPointsCommitted = issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const storyPointsCompleted = issues
    .filter((i) => isDone(i.status))
    .reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const storyPointsRemaining = storyPointsCommitted - storyPointsCompleted;

  return {
    totalIssues,
    completedIssues,
    remainingIssues,
    storyPointsCommitted,
    storyPointsCompleted,
    storyPointsRemaining,
  };
}
