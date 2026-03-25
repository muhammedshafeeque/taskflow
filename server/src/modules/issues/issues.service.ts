import mongoose from 'mongoose';
import { Issue } from './issue.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import * as issueHistoryService from './issueHistory.service';
import type { CreateIssueBody, UpdateIssueBody, ListIssuesQuery } from './issue.validation';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import { parseJql } from './jqlParser';
import { sendPushToUser } from '../../services/push.service';
import { notifyPush, notifyProjectRefresh } from '../../websocket';
import { env } from '../../config/env';
import * as notificationsService from '../notifications/notifications.service';
import * as watchersService from '../watchers/watchers.service';

const DEFAULT_STATUS = 'Backlog';
const DEFAULT_DONE_STATUSES = ['Done', 'Closed', 'Resolved'];

async function validateParent(
  parentId: string | null | undefined,
  projectId: string,
  childId?: string
): Promise<void> {
  if (!parentId) return;
  const parent = await Issue.findById(parentId).select('project type').lean();
  if (!parent) throw new ApiError(404, 'Parent issue not found');
  if (String(parent.project) !== String(projectId)) {
    throw new ApiError(400, 'Parent must be in the same project');
  }
  if (childId && String(parentId) === String(childId)) {
    throw new ApiError(400, 'Issue cannot be its own parent');
  }
  // Prevent circular: parent cannot be a descendant of child
  if (childId) {
    let current = await Issue.findById(parentId).select('parent').lean();
    while (current) {
      if (String(current._id) === String(childId)) {
        throw new ApiError(400, 'Circular parent reference');
      }
      if (!current.parent) break;
      current = await Issue.findById(current.parent).select('parent').lean();
    }
  }
}

export async function create(
  input: CreateIssueBody,
  reporterId: string
): Promise<unknown> {
  const projectId = input.project;
  await validateParent(input.parent ?? undefined, projectId);

  const project = await Project.findByIdAndUpdate(
    projectId,
    { $inc: { nextIssueNumber: 1 } },
    { new: true }
  )
    .select('key nextIssueNumber')
    .lean();

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const nextNum = project.nextIssueNumber ?? 1;
  const issueKey = `${project.key}-${nextNum}`;

  const doc = await Issue.create({
    title: input.title,
    description: input.description ?? '',
    type: input.type ?? 'Task',
    priority: input.priority ?? 'Medium',
    status: input.status ?? DEFAULT_STATUS,
    assignee: input.assignee ?? undefined,
    reporter: reporterId,
    project: projectId,
    key: issueKey,
    sprint: input.sprint ?? undefined,
    boardColumn: input.boardColumn ?? DEFAULT_STATUS,
    labels: input.labels ?? [],
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    storyPoints: input.storyPoints,
    timeEstimateMinutes: input.timeEstimateMinutes,
    checklist: input.checklist ?? [],
    customFieldValues: input.customFieldValues ?? {},
    fixVersion: input.fixVersion ?? undefined,
    affectsVersions: input.affectsVersions ?? undefined,
    parent: input.parent ?? undefined,
    milestone: input.milestone ?? undefined,
  });
  await issueHistoryService.recordCreated(String(doc._id), reporterId);
  if (projectId) notifyProjectRefresh(String(projectId));
  return doc.toObject();
}

export interface ListIssuesFilters {
  project?: string | string[];
  status?: string | string[];
  assignee?: string | string[];
  reporter?: string | string[];
  sprint?: string;
  type?: string | string[];
  priority?: string | string[];
  labels?: string | string[];
  storyPoints?: string | string[];
  hasStoryPoints?: boolean;
  hasEstimate?: boolean;
  fixVersion?: string;
}

export async function findAll(
  filters: ListIssuesFilters = {},
  pagination: PaginationOptions = { page: 1, limit: 20 },
  userId?: string
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  const toArr = (v: string | string[] | undefined): string[] => {
    if (v === undefined || v === '') return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  };
  const projectArr = toArr(filters.project);
  if (projectArr.length > 0) {
    filter.project = projectArr.length === 1 ? projectArr[0] : { $in: projectArr };
  } else if (userId) {
    const projectIds = await ProjectMember.find({ user: userId }).distinct('project');
    if (projectIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
    filter.project = projectIds.length === 1 ? projectIds[0] : { $in: projectIds };
  }
  const statusArr = toArr(filters.status);
  if (statusArr.length) filter.status = statusArr.length === 1 ? statusArr[0] : { $in: statusArr };
  const assigneeArr = toArr(filters.assignee);
  if (assigneeArr.length) filter.assignee = assigneeArr.length === 1 ? assigneeArr[0] : { $in: assigneeArr };
  if (filters.sprint !== undefined) {
    filter.sprint = filters.sprint === '' || filters.sprint === 'null' || filters.sprint === 'backlog' ? null : filters.sprint;
  }
  const typeArr = toArr(filters.type);
  if (typeArr.length) filter.type = typeArr.length === 1 ? typeArr[0] : { $in: typeArr };
  const priorityArr = toArr(filters.priority);
  if (priorityArr.length) filter.priority = priorityArr.length === 1 ? priorityArr[0] : { $in: priorityArr };
  const reporterArr = toArr(filters.reporter);
  if (reporterArr.length) filter.reporter = reporterArr.length === 1 ? reporterArr[0] : { $in: reporterArr };
  const labelsArr = toArr(filters.labels);
  if (labelsArr.length) filter.labels = { $in: labelsArr };
  const storyPointsArr = toArr(filters.storyPoints).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
  if (storyPointsArr.length) filter.storyPoints = storyPointsArr.length === 1 ? storyPointsArr[0] : { $in: storyPointsArr };
  if (filters.hasStoryPoints === false) {
    const noStoryPoints = { $or: [{ storyPoints: null }, { storyPoints: { $exists: false } }] };
    const rest = { ...filter };
    Object.keys(filter).forEach((k) => delete (filter as Record<string, unknown>)[k]);
    (filter as Record<string, unknown>).$and = [rest, noStoryPoints];
  }
  if (filters.hasEstimate === false) {
    const noEstimate = {
      $or: [
        { timeEstimateMinutes: { $exists: false } },
        { timeEstimateMinutes: null },
        { timeEstimateMinutes: { $lte: 0 } },
      ],
    };
    const current = { ...filter };
    const existingAnd = (filter as Record<string, unknown>).$and as unknown[] | undefined;
    const andClauses = existingAnd ? [...existingAnd] : [current];
    andClauses.push(noEstimate);
    Object.keys(filter).forEach((k) => delete (filter as Record<string, unknown>)[k]);
    (filter as Record<string, unknown>).$and = andClauses;
  }
  if (filters.hasEstimate === true) {
    const hasEstimate = {
      timeEstimateMinutes: { $exists: true, $ne: null, $gt: 0 },
    };
    const current = { ...filter };
    const existingAnd = (filter as Record<string, unknown>).$and as unknown[] | undefined;
    const andClauses = existingAnd ? [...existingAnd] : [current];
    andClauses.push(hasEstimate);
    Object.keys(filter).forEach((k) => delete (filter as Record<string, unknown>)[k]);
    (filter as Record<string, unknown>).$and = andClauses;
  }
  if (filters.fixVersion !== undefined && filters.fixVersion !== '') {
    filter.fixVersion = filters.fixVersion;
  }

  const isBacklog = filters.sprint === '' || filters.sprint === 'null' || filters.sprint === 'backlog';
  const sort: Record<string, 1 | -1> = isBacklog ? { backlogOrder: 1, createdAt: 1 } : {};
  const [data, total] = await Promise.all([
    Issue.find(filter)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('sprint', 'name status')
      .populate('parent', 'key title _id')
      .populate('milestone', 'name dueDate status')
      .sort(Object.keys(sort).length ? sort : { createdAt: -1 })
      .lean()
      .skip(skip)
      .limit(limit),
    Issue.countDocuments(filter),
  ]);

  return {
    data: (
      data as Array<{ _id: unknown; key?: string; project?: { key?: string } | unknown }>
    ).map(withIssueKey),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

function withIssueKey(
  issue: { _id: unknown; key?: string; project?: { key?: string } | unknown }
): typeof issue & { key: string } {
  const key =
    issue.key ||
    (issue.project && typeof issue.project === 'object' && issue.project && 'key' in issue.project
      ? `${(issue.project as { key: string }).key}-${String(issue._id).slice(-6)}`
      : String(issue._id).slice(-8));
  return { ...issue, key };
}

export async function findById(id: string): Promise<unknown | null> {
  const issue = await Issue.findById(id)
    .populate('reporter', 'name email')
    .populate('assignee', 'name email')
    .populate('project', 'name key')
    .populate('sprint', 'name status')
    .populate('parent', 'key title _id')
    .populate('milestone', 'name dueDate status')
    .lean();
  return issue ? withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } }) : null;
}

export async function findChildren(parentId: string): Promise<unknown[]> {
  const children = await Issue.find({ parent: parentId })
    .populate('reporter', 'name email')
    .populate('assignee', 'name email')
    .populate('project', 'name key')
    .populate('sprint', 'name status')
    .sort({ key: 1 })
    .lean();
  return (children as Array<{ _id: unknown; key?: string; project?: { key?: string } | unknown }>).map(withIssueKey);
}

function toComparable(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val.toISOString();
  if (val && typeof val === 'object' && '_id' in val) return String((val as { _id: unknown })._id);
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return val;
}

function arraysEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => toComparable(x) === toComparable(b[i]));
}

export async function update(
  id: string,
  input: UpdateIssueBody,
  authorId?: string
): Promise<unknown | null> {
  const oldDoc = await Issue.findById(id).lean();
  if (!oldDoc) return null;

  const updateData: Record<string, unknown> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.assignee !== undefined && input.assignee !== '' && input.assignee !== null) {
    updateData.assignee = input.assignee;
  }
  if (input.sprint !== undefined) updateData.sprint = input.sprint || undefined;
  if (input.boardColumn !== undefined) updateData.boardColumn = input.boardColumn;
  if (input.labels !== undefined) updateData.labels = input.labels;
  if (input.dueDate !== undefined) {
    if (input.dueDate) updateData.dueDate = new Date(input.dueDate);
  }
  if (input.startDate !== undefined) {
    if (input.startDate) updateData.startDate = new Date(input.startDate);
  }
  if (input.storyPoints !== undefined) updateData.storyPoints = input.storyPoints;
  if (input.timeEstimateMinutes !== undefined) updateData.timeEstimateMinutes = input.timeEstimateMinutes;
  if (input.checklist !== undefined) updateData.checklist = input.checklist;
  if (input.customFieldValues !== undefined) updateData.customFieldValues = input.customFieldValues;

  const unset: Record<string, 1> = {};
  if (input.assignee !== undefined && (input.assignee === '' || input.assignee === null)) unset.assignee = 1;
  if (input.dueDate === null || input.dueDate === '') unset.dueDate = 1;
  if (input.startDate === null || input.startDate === '') unset.startDate = 1;
  if (input.storyPoints === null) unset.storyPoints = 1;
  if (input.timeEstimateMinutes === null) unset.timeEstimateMinutes = 1;
  if (input.fixVersion === null || input.fixVersion === '') unset.fixVersion = 1;
  if (input.fixVersion !== undefined && input.fixVersion !== null && input.fixVersion !== '') updateData.fixVersion = input.fixVersion;
  if (input.affectsVersions !== undefined) updateData.affectsVersions = input.affectsVersions;
  if (input.parent !== undefined) {
    await validateParent(input.parent, String(oldDoc.project), id);
    if (input.parent === null || input.parent === '') {
      unset.parent = 1;
    } else {
      updateData.parent = input.parent;
    }
  }
  if (input.milestone !== undefined) {
    if (input.milestone === null || input.milestone === '') {
      unset.milestone = 1;
    } else {
      updateData.milestone = input.milestone;
    }
  }

  const changes: Array<{ field: string; fromValue: unknown; toValue: unknown }> = [];
  const oldRaw = oldDoc as Record<string, unknown>;

  const addChange = (field: string, fromVal: unknown, toVal: unknown) => {
    if (toComparable(fromVal) !== toComparable(toVal)) {
      changes.push({ field, fromValue: fromVal, toValue: toVal });
    }
  };

  if (input.title !== undefined) addChange('title', oldRaw.title, input.title);
  if (input.description !== undefined) addChange('description', oldRaw.description, input.description);
  if (input.type !== undefined) addChange('type', oldRaw.type, input.type);
  if (input.priority !== undefined) addChange('priority', oldRaw.priority, input.priority);
  if (input.status !== undefined) addChange('status', oldRaw.status, input.status);
  if (input.assignee !== undefined) addChange('assignee', oldRaw.assignee, input.assignee || undefined);
  if (input.sprint !== undefined) addChange('sprint', oldRaw.sprint, input.sprint || undefined);
  if (input.boardColumn !== undefined) addChange('boardColumn', oldRaw.boardColumn, input.boardColumn);
  if (input.labels !== undefined) addChange('labels', oldRaw.labels, input.labels);
  if (input.dueDate !== undefined) {
    const oldDate = oldRaw.dueDate ? (oldRaw.dueDate as Date).toISOString?.()?.slice(0, 10) : null;
    const newDate = input.dueDate ? new Date(input.dueDate).toISOString().slice(0, 10) : null;
    addChange('dueDate', oldDate, newDate);
  }
  if (input.startDate !== undefined) {
    const oldDate = oldRaw.startDate ? (oldRaw.startDate as Date).toISOString?.()?.slice(0, 10) : null;
    const newDate = input.startDate ? new Date(input.startDate).toISOString().slice(0, 10) : null;
    addChange('startDate', oldDate, newDate);
  }
  if (input.storyPoints !== undefined) addChange('storyPoints', oldRaw.storyPoints, input.storyPoints ?? undefined);
  if (input.timeEstimateMinutes !== undefined) addChange('timeEstimateMinutes', oldRaw.timeEstimateMinutes, input.timeEstimateMinutes ?? undefined);
  if (input.checklist !== undefined && !arraysEqual(oldRaw.checklist as unknown[] | undefined, input.checklist)) {
    addChange('checklist', oldRaw.checklist, input.checklist);
  }
  if (input.fixVersion !== undefined) addChange('fixVersion', oldRaw.fixVersion, input.fixVersion || undefined);
  if (input.affectsVersions !== undefined && !arraysEqual(oldRaw.affectsVersions as unknown[] | undefined, input.affectsVersions)) {
    addChange('affectsVersions', oldRaw.affectsVersions, input.affectsVersions);
  }
  if (input.parent !== undefined) addChange('parent', oldRaw.parent, input.parent || undefined);
  if (input.milestone !== undefined) addChange('milestone', oldRaw.milestone, input.milestone || undefined);

  if (authorId && changes.length > 0) {
    await issueHistoryService.recordFieldChanges(id, authorId, changes);
  }

  const updateOp = Object.keys(unset).length
    ? { $set: updateData, $unset: unset }
    : { $set: updateData };

  const issue = await Issue.findByIdAndUpdate(
    id,
    updateOp,
    { new: true, runValidators: true }
  )
    .populate('reporter', 'name email')
    .populate('assignee', 'name email')
    .populate('project', 'name key')
    .populate('sprint', 'name status')
    .populate('parent', 'key title _id')
    .populate('milestone', 'name dueDate status')
    .lean();

  if (issue && authorId) {
    const issueWithKey = withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } });
    const projectId = (issue.project as { _id?: unknown })?._id
      ? String((issue.project as { _id: unknown })._id)
      : String(issue.project);
    notifyProjectRefresh(projectId);
    const issueKey = issueWithKey.key ?? '?';
    const issueUrl = `${env.appUrl}/projects/${projectId}/issues/${encodeURIComponent(issueKey)}`;

    const assigneeChange = changes.find((c) => c.field === 'assignee');
    if (assigneeChange?.toValue) {
      const newAssigneeId = String(assigneeChange.toValue);
      if (newAssigneeId !== authorId) {
        const payload = {
          title: 'Issue assigned to you',
          body: `${issueKey}: ${(issue.title as string) ?? ''}`,
          url: issueUrl,
          data: { type: 'issue_assigned', issueId: id, issueKey, projectId },
        };
        notificationsService.createNotification({
          toUser: newAssigneeId,
          type: 'issue_assigned',
          title: payload.title,
          body: payload.body,
          url: issueUrl,
          meta: payload.data,
        }).catch(() => {});
        sendPushToUser(newAssigneeId, payload).catch((err) => console.error('Push failed:', err));
        notifyPush(newAssigneeId, payload);
      }
    }

    // Unassignment: notify old assignee (if any) when cleared.
    if (assigneeChange && !assigneeChange.toValue && assigneeChange.fromValue) {
      const oldAssigneeId = String(assigneeChange.fromValue);
      if (oldAssigneeId && oldAssigneeId !== authorId) {
        const payload = {
          title: 'Issue unassigned from you',
          body: `${issueKey}: ${(issue.title as string) ?? ''}`,
          url: issueUrl,
          data: { type: 'issue_unassigned', issueId: id, issueKey, projectId },
        };
        notificationsService.createNotification({
          toUser: oldAssigneeId,
          type: 'issue_unassigned',
          title: payload.title,
          body: payload.body,
          url: issueUrl,
          meta: payload.data,
        }).catch(() => {});
        sendPushToUser(oldAssigneeId, payload).catch((err) => console.error('Push failed:', err));
        notifyPush(oldAssigneeId, payload);
      }
    }

    // Notify watchers for status/field changes (in-app, not inbox)
    const statusChange2 = changes.find((c) => c.field === 'status');
    if (statusChange2?.toValue && String(statusChange2.toValue) !== String(statusChange2.fromValue)) {
      watchersService.notifyWatchers(id, authorId, {
        type: 'status_changed',
        title: `Status changed: ${issueKey}`,
        body: `${String(statusChange2.fromValue ?? '—')} → ${String(statusChange2.toValue)}`,
        meta: { issueId: id, issueKey, projectId },
      }).catch(() => {});
    }
    const otherFieldChanges = changes.filter((c) => c.field !== 'status');
    if (otherFieldChanges.length > 0) {
      const summary = otherFieldChanges
        .slice(0, 4)
        .map((c) => `${c.field}`)
        .join(', ');
      watchersService.notifyWatchers(id, authorId, {
        type: 'field_changed',
        title: `Updated: ${issueKey}`,
        body: summary,
        meta: { issueId: id, issueKey, projectId },
      }).catch(() => {});
    }

    const statusChange = changes.find((c) => c.field === 'status');
    if (statusChange?.toValue && DEFAULT_DONE_STATUSES.includes(String(statusChange.toValue))) {
      const assignee = issue.assignee as { _id?: unknown } | null;
      const reporter = issue.reporter as { _id?: unknown } | null;
      const assigneeId = assignee?._id ? String(assignee._id) : null;
      const reporterId = reporter?._id ? String(reporter._id) : null;
      const payload = {
        title: 'Issue closed',
        body: `${issueKey} was marked as done.`,
        url: issueUrl,
        data: { type: 'issue_closed', issueId: id, issueKey, projectId },
      };
      const notifyClosed = (userId: string) => {
        if (userId !== authorId) {
          sendPushToUser(userId, payload).catch((err) => console.error('Push failed:', err));
          notifyPush(userId, payload);
        }
      };
      if (assigneeId) notifyClosed(assigneeId);
      if (reporterId && reporterId !== assigneeId) notifyClosed(reporterId);
    }
  }

  return issue ? withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } }) : null;
}

export async function remove(id: string): Promise<boolean> {
  const issue = await Issue.findById(id).select('project').lean();
  const result = await Issue.findByIdAndDelete(id);
  if (result != null && issue?.project) {
    notifyProjectRefresh(String(issue.project));
  }
  return result != null;
}

export async function updateBacklogOrder(issueIds: string[], userId: string): Promise<{ updated: number; errors: string[] }> {
  if (issueIds.length === 0) return { updated: 0, errors: [] };
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) return { updated: 0, errors: ['Access denied'] };

  const issues = await Issue.find({ _id: { $in: issueIds }, project: { $in: projectIds } })
    .select('_id project')
    .lean();
  const accessibleIds = new Set(issues.map((i) => String(i._id)));
  const inaccessible = issueIds.filter((id) => !accessibleIds.has(id));
  if (inaccessible.length > 0) {
    return { updated: 0, errors: [`Access denied to ${inaccessible.length} issue(s)`] };
  }

  const bulkOps = issueIds.map((id, index) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { backlogOrder: index } },
    },
  }));
  const result = await Issue.bulkWrite(bulkOps);
  const affectedProjectIds = [...new Set(issues.map((i) => String(i.project)))];
  for (const pid of affectedProjectIds) notifyProjectRefresh(pid);
  return { updated: result.modifiedCount + result.upsertedCount, errors: [] };
}

export interface BulkUpdateInput {
  status?: string;
  assignee?: string | null;
  sprint?: string | null;
  labels?: string[];
  type?: string;
  priority?: string;
  fixVersion?: string | null;
}

export async function bulkUpdate(
  issueIds: string[],
  updates: BulkUpdateInput,
  userId: string
): Promise<{ updated: number; errors: string[] }> {
  if (issueIds.length === 0) return { updated: 0, errors: [] };
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const allowedProjectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (allowedProjectIds.length === 0) return { updated: 0, errors: ['Access denied'] };

  const issues = await Issue.find({ _id: { $in: issueIds }, project: { $in: allowedProjectIds } })
    .select('_id project')
    .lean();
  const accessibleIds = issues.map((i) => String(i._id));
  const inaccessible = issueIds.filter((id) => !accessibleIds.includes(id));
  if (inaccessible.length > 0) {
    return { updated: 0, errors: [`Access denied to ${inaccessible.length} issue(s)`] };
  }

  const updateData: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.assignee !== undefined) {
    if (updates.assignee === null || updates.assignee === '') unset.assignee = 1;
    else updateData.assignee = updates.assignee;
  }
  if (updates.sprint !== undefined) {
    if (updates.sprint === null || updates.sprint === '') unset.sprint = 1;
    else updateData.sprint = updates.sprint;
  }
  if (updates.labels !== undefined) updateData.labels = updates.labels;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.fixVersion !== undefined) {
    if (updates.fixVersion === null || updates.fixVersion === '') unset.fixVersion = 1;
    else updateData.fixVersion = updates.fixVersion;
  }
  if (updates.status !== undefined) updateData.boardColumn = updates.status;

  const updateOp = Object.keys(unset).length
    ? { $set: updateData, $unset: unset }
    : { $set: updateData };

  const result = await Issue.updateMany({ _id: { $in: issueIds } }, updateOp);
  const updated = result.modifiedCount;

  for (const id of issueIds) {
    const changes: Array<{ field: string; fromValue: unknown; toValue: unknown }> = [];
    if (updates.status !== undefined) changes.push({ field: 'status', fromValue: null, toValue: updates.status });
    if (updates.assignee !== undefined) changes.push({ field: 'assignee', fromValue: null, toValue: updates.assignee || undefined });
    if (updates.sprint !== undefined) changes.push({ field: 'sprint', fromValue: null, toValue: updates.sprint || undefined });
    if (updates.labels !== undefined) changes.push({ field: 'labels', fromValue: null, toValue: updates.labels });
    if (updates.type !== undefined) changes.push({ field: 'type', fromValue: null, toValue: updates.type });
    if (updates.priority !== undefined) changes.push({ field: 'priority', fromValue: null, toValue: updates.priority });
    if (updates.fixVersion !== undefined) changes.push({ field: 'fixVersion', fromValue: null, toValue: updates.fixVersion || undefined });
    if (changes.length > 0) {
      await issueHistoryService.recordFieldChanges(id, userId, changes);
    }
  }

  const affectedProjectIds = [...new Set(issues.map((i) => String(i.project)))];
  for (const pid of affectedProjectIds) notifyProjectRefresh(pid);
  return { updated, errors: [] };
}

export async function bulkDelete(issueIds: string[], userId: string): Promise<{ deleted: number; errors: string[] }> {
  if (issueIds.length === 0) return { deleted: 0, errors: [] };
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const allowedProjectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (allowedProjectIds.length === 0) return { deleted: 0, errors: ['Access denied'] };

  const issues = await Issue.find({ _id: { $in: issueIds }, project: { $in: allowedProjectIds } })
    .select('_id project')
    .lean();
  const accessibleIds = issues.map((i) => String(i._id));
  const inaccessible = issueIds.filter((id) => !accessibleIds.includes(id));
  if (inaccessible.length > 0) {
    return { deleted: 0, errors: [`Access denied to ${inaccessible.length} issue(s)`] };
  }

  const result = await Issue.deleteMany({ _id: { $in: issueIds } });
  const affectedProjectIds = [...new Set(issues.map((i) => String(i.project)))];
  for (const pid of affectedProjectIds) notifyProjectRefresh(pid);
  return { deleted: result.deletedCount, errors: [] };
}

export async function findByProjectAndKey(projectId: string, key: string): Promise<unknown | null> {
  const issue = await Issue.findOne({ project: projectId, key })
    .populate('reporter', 'name email')
    .populate('assignee', 'name email')
    .populate('project', 'name key')
    .populate('sprint', 'name status')
    .populate('parent', 'key title _id')
    .lean();
  return issue ? withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } }) : null;
}

export interface SearchIssuesOptions {
  projectId: string;
  q: string;
  page?: number;
  limit?: number;
}

export async function search(
  opts: SearchIssuesOptions
): Promise<PaginatedResult<unknown>> {
  const { projectId, q, page = 1, limit = 10 } = opts;
  const safeLimit = Math.min(Math.max(1, limit), 20);
  const skip = (page - 1) * safeLimit;

  const filter: Record<string, unknown> = { project: projectId };
  if (q && q.trim()) {
    const trimmed = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(trimmed, 'i');
    filter.$or = [
      { key: regex },
      { title: regex },
    ];
  }

  const [data, total] = await Promise.all([
    Issue.find(filter)
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .sort({ key: 1 })
      .lean()
      .skip(skip)
      .limit(safeLimit),
    Issue.countDocuments(filter),
  ]);

  return {
    data: (
      data as Array<{ _id: unknown; key?: string; project?: { key?: string } | unknown }>
    ).map(withIssueKey),
    total,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export interface SearchGlobalOptions {
  userId: string;
  q: string;
  page?: number;
  limit?: number;
  excludeIssueId?: string;
}

export async function searchGlobal(
  opts: SearchGlobalOptions
): Promise<PaginatedResult<unknown>> {
  const { userId, q, page = 1, limit = 10, excludeIssueId } = opts;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) {
    return { data: [], total: 0, page, limit, totalPages: 0 };
  }

  const safeLimit = Math.min(Math.max(1, limit), 20);
  const skip = (page - 1) * safeLimit;

  const filter: Record<string, unknown> = { project: { $in: projectIds } };
  if (excludeIssueId) filter._id = { $ne: excludeIssueId };
  if (q && q.trim()) {
    const trimmed = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(trimmed, 'i');
    filter.$or = [
      { key: regex },
      { title: regex },
    ];
  }

  const [data, total] = await Promise.all([
    Issue.find(filter)
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .sort({ key: 1 })
      .lean()
      .skip(skip)
      .limit(safeLimit),
    Issue.countDocuments(filter),
  ]);

  return {
    data: (
      data as Array<{ _id: unknown; key?: string; project?: { key?: string } | unknown }>
    ).map(withIssueKey),
    total,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export function queryToFilters(query: ListIssuesQuery): ListIssuesFilters {
  return {
    project: query.project,
    status: query.status,
    assignee: query.assignee,
    reporter: query.reporter,
    sprint: query.sprint,
    type: query.type,
    priority: query.priority,
    labels: query.labels,
    storyPoints: query.storyPoints,
    hasStoryPoints: query.hasStoryPoints === 'false' ? false : undefined,
    hasEstimate: query.hasEstimate === 'true' ? true : query.hasEstimate === 'false' ? false : undefined,
    fixVersion: query.fixVersion,
  };
}

export interface FindByJqlOptions {
  jql: string;
  userId: string;
  page?: number;
  limit?: number;
}

export async function findByJql(opts: FindByJqlOptions): Promise<PaginatedResult<unknown>> {
  const { jql, userId, page = 1, limit = 20 } = opts;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  if (projectIds.length === 0) {
    return { data: [], total: 0, page, limit, totalPages: 0 };
  }

  const { filter: jqlFilter, order } = parseJql(jql, userId);
  const scopeFilter = { project: { $in: projectIds } };
  const filter = Object.keys(jqlFilter).length > 0
    ? { $and: [scopeFilter, jqlFilter] }
    : scopeFilter;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const skip = (page - 1) * safeLimit;
  const sortObj: Record<string, 1 | -1> = order
    ? { [order.field]: order.direction }
    : { createdAt: -1 };

  const [data, total] = await Promise.all([
    Issue.find(filter)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('sprint', 'name status')
      .populate('parent', 'key title _id')
      .sort(sortObj)
      .lean()
      .skip(skip)
      .limit(safeLimit),
    Issue.countDocuments(filter),
  ]);

  return {
    data: (
      data as Array<{ _id: unknown; key?: string; project?: { key?: string } | unknown }>
    ).map(withIssueKey),
    total,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}
