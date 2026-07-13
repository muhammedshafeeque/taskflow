import mongoose from 'mongoose';
import { Issue } from './issue.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import * as issueHistoryService from './issueHistory.service';
import type { CreateIssueBody, UpdateIssueBody, ListIssuesQuery } from './issue.validation';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import { parseJql } from './jqlParser';
import { notifyProjectRefresh } from '../../websocket';
import * as watchersService from '../watchers/watchers.service';
import { getClosedStatusNamesForProject, getClosedStatusNamesFromStatuses } from '../projects/statusClassification';
import * as issueNotification from './issueNotification.service';
import {
  normalizeFixVersionsInput,
  withNormalizedFixVersion,
} from './issueVersionFields';
import type { IProjectCustomField } from '../projects/project.model';

const DEFAULT_STATUS = 'Backlog';

async function stripFormulaKeysFromCustomFieldValues(
  projectId: string,
  values: Record<string, unknown> | undefined
): Promise<Record<string, unknown>> {
  if (!values || Object.keys(values).length === 0) return values ?? {};
  const project = await Project.findById(projectId).select('customFields').lean();
  const formulaKeys = new Set(
    ((project as { customFields?: IProjectCustomField[] } | null)?.customFields ?? [])
      .filter((f) => f.fieldType === 'formula')
      .map((f) => f.key)
  );
  if (formulaKeys.size === 0) return values;
  const out = { ...values };
  for (const k of formulaKeys) delete out[k];
  return out;
}

async function enrichIssueRecord(issue: Record<string, unknown>): Promise<Record<string, unknown> & { key: string }> {
  const projectRef = issue.project as { _id?: unknown } | string | undefined;
  const projectId = projectRef
    ? typeof projectRef === 'object' && projectRef && '_id' in projectRef
      ? String(projectRef._id)
      : String(projectRef)
    : '';
  if (!projectId) return mapIssue(issue);
  const project = await Project.findById(projectId).select('customFields').lean();
  const fields = (project as { customFields?: IProjectCustomField[] } | null)?.customFields ?? [];
  if (!fields.some((f) => f.fieldType === 'formula')) return mapIssue(issue);
  const { enrichCalculatedCustomFields } = await import('../projects/customFieldFormula.service');
  const enriched = enrichCalculatedCustomFields(fields, issue);
  return mapIssue({ ...issue, customFieldValues: enriched });
}

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
  reporterId: string,
  syncOptions?: { syncOrigin?: 'ado' | 'taskflow' }
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

  const effectiveReporter = input.reporter ?? reporterId;

  const doc = await Issue.create({
    title: input.title,
    description: input.description ?? '',
    type: input.type ?? 'Task',
    priority: input.priority ?? 'Medium',
    status: input.status ?? DEFAULT_STATUS,
    assignee: input.assignee ?? undefined,
    reporter: effectiveReporter,
    project: projectId,
    key: issueKey,
    sprint:
      input.sprint !== undefined && input.sprint !== null && input.sprint !== ''
        ? input.sprint
        : undefined,
    boardColumn: input.boardColumn ?? DEFAULT_STATUS,
    labels: input.labels ?? [],
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    storyPoints: input.storyPoints ?? undefined,
    timeEstimateMinutes: input.timeEstimateMinutes,
    checklist: input.checklist ?? [],
    customFieldValues: await stripFormulaKeysFromCustomFieldValues(
      projectId,
      (input.customFieldValues ?? {}) as Record<string, unknown>
    ),
    fixVersion: (() => {
      const ids = normalizeFixVersionsInput(input.fixVersion);
      return ids?.length ? ids : undefined;
    })(),
    affectsVersions: input.affectsVersions ?? undefined,
    parent: input.parent ?? undefined,
    milestone: input.milestone ?? undefined,
  });
  await issueHistoryService.recordCreated(String(doc._id), effectiveReporter);
  if (projectId) notifyProjectRefresh(String(projectId));

  if (syncOptions?.syncOrigin !== 'ado' && input.assignee) {
    const assigneeId = String(input.assignee);
    if (assigneeId !== effectiveReporter) {
      issueNotification
        .notifyIssueAssigned({
          issue: {
            _id: String(doc._id),
            key: issueKey,
            title: input.title,
            type: input.type ?? 'Task',
            status: input.status ?? DEFAULT_STATUS,
            project: projectId,
          },
          assigneeUserId: assigneeId,
          actorUserId: effectiveReporter,
        })
        .catch((err) => console.error('[issue] assign notify on create failed:', err));
    }
  }

  if (syncOptions?.syncOrigin !== 'ado') {
    import('../integrations/ado/adoSync.service')
      .then((m) => m.syncIssueToAdo(String(doc._id), { syncOrigin: 'taskflow' }))
      .catch((err) => console.error('[ado] outbound sync on create failed:', err));
  }

  return enrichIssueRecord(withNormalizedFixVersion(doc.toObject() as unknown as Record<string, unknown>));
}

export interface ListIssuesFilters {
  project?: string | string[];
  status?: string | string[];
  statusExclude?: string | string[];
  assignee?: string | string[];
  reporter?: string | string[];
  sprint?: string | string[];
  milestone?: string | string[];
  type?: string | string[];
  priority?: string | string[];
  labels?: string | string[];
  storyPoints?: string | string[];
  hasStoryPoints?: boolean;
  hasEstimate?: boolean;
  fixVersion?: string | string[];
  affectsVersions?: string | string[];
  hasParent?: boolean;
  hasDueDate?: boolean;
  dueDatePreset?: 'overdue' | 'today' | 'this_week';
  hasStartDate?: boolean;
  unassigned?: boolean;
}

const SPRINT_BACKLOG_TOKENS = new Set(['', 'null', 'backlog', '__backlog__']);

function mergeAndClause(filter: Record<string, unknown>, clause: Record<string, unknown>): void {
  const existingAnd = filter.$and as Record<string, unknown>[] | undefined;
  if (existingAnd) {
    existingAnd.push(clause);
    return;
  }
  const snapshot = { ...filter };
  Object.keys(filter).forEach((k) => delete filter[k]);
  filter.$and = [snapshot, clause];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
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
  let statusExcludeArr = toArr(filters.statusExclude);
  if (!statusArr.length && statusExcludeArr.length && projectArr.length > 0) {
    const projects = await Project.find({ _id: { $in: projectArr } }).select('statuses').lean();
    const fromDb = new Set<string>();
    for (const p of projects) {
      let names = getClosedStatusNamesFromStatuses((p as { statuses?: Array<{ name?: string; isClosed?: boolean }> }).statuses);
      if (names.length === 0) names = ['Done', 'Closed', 'Resolved'];
      names.forEach((n) => fromDb.add(n));
    }
    statusExcludeArr = [...new Set([...statusExcludeArr, ...fromDb])];
  }
  if (statusArr.length) {
    filter.status = statusArr.length === 1 ? statusArr[0] : { $in: statusArr };
  } else if (statusExcludeArr.length) {
    const lowered = [...new Set(statusExcludeArr.map((s) => s.trim().toLowerCase()).filter(Boolean))];
    filter.$expr = {
      $not: {
        $in: [{ $toLower: { $ifNull: ['$status', ''] } }, lowered],
      },
    };
  }
  const assigneeArr = toArr(filters.assignee).filter((id) => id !== '__unassigned__');
  const wantsUnassigned = filters.unassigned === true || toArr(filters.assignee).includes('__unassigned__');
  if (assigneeArr.length > 0 && wantsUnassigned) {
    mergeAndClause(filter, {
      $or: [
        { assignee: assigneeArr.length === 1 ? assigneeArr[0] : { $in: assigneeArr } },
        { assignee: null },
        { assignee: { $exists: false } },
      ],
    });
  } else if (wantsUnassigned) {
    mergeAndClause(filter, { $or: [{ assignee: null }, { assignee: { $exists: false } }] });
  } else if (assigneeArr.length) {
    filter.assignee = assigneeArr.length === 1 ? assigneeArr[0] : { $in: assigneeArr };
  }
  const sprintArr = toArr(filters.sprint);
  if (sprintArr.length > 0) {
    const sprintIds = sprintArr.filter((s) => !SPRINT_BACKLOG_TOKENS.has(s));
    const includeBacklog = sprintArr.some((s) => SPRINT_BACKLOG_TOKENS.has(s));
    if (sprintIds.length > 0 && includeBacklog) {
      mergeAndClause(filter, {
        $or: [
          { sprint: sprintIds.length === 1 ? sprintIds[0] : { $in: sprintIds } },
          { sprint: null },
          { sprint: { $exists: false } },
        ],
      });
    } else if (includeBacklog) {
      mergeAndClause(filter, { $or: [{ sprint: null }, { sprint: { $exists: false } }] });
    } else if (sprintIds.length === 1) {
      filter.sprint = sprintIds[0];
    } else if (sprintIds.length > 1) {
      filter.sprint = { $in: sprintIds };
    }
  }
  const milestoneArr = toArr(filters.milestone);
  if (milestoneArr.length) {
    filter.milestone = milestoneArr.length === 1 ? milestoneArr[0] : { $in: milestoneArr };
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
  const fixVersionArr = toArr(filters.fixVersion);
  if (fixVersionArr.length) {
    filter.fixVersion = fixVersionArr.length === 1 ? fixVersionArr[0] : { $in: fixVersionArr };
  }
  const affectsArr = toArr(filters.affectsVersions);
  if (affectsArr.length) filter.affectsVersions = { $in: affectsArr };
  if (filters.hasParent === true) filter.parent = { $exists: true, $ne: null };
  if (filters.hasParent === false) {
    mergeAndClause(filter, { $or: [{ parent: null }, { parent: { $exists: false } }] });
  }
  if (filters.hasDueDate === false) {
    mergeAndClause(filter, { $or: [{ dueDate: null }, { dueDate: { $exists: false } }] });
  }
  if (filters.hasDueDate === true) {
    mergeAndClause(filter, { dueDate: { $exists: true, $ne: null } });
  }
  if (filters.dueDatePreset === 'overdue') {
    mergeAndClause(filter, { dueDate: { $lt: startOfDay(new Date()), $ne: null } });
  } else if (filters.dueDatePreset === 'today') {
    const start = startOfDay(new Date());
    mergeAndClause(filter, { dueDate: { $gte: start, $lte: endOfDay(new Date()) } });
  } else if (filters.dueDatePreset === 'this_week') {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    mergeAndClause(filter, { dueDate: { $gte: startOfDay(monday), $lte: endOfDay(sunday) } });
  }
  if (filters.hasStartDate === false) {
    mergeAndClause(filter, { $or: [{ startDate: null }, { startDate: { $exists: false } }] });
  }
  if (filters.hasStartDate === true) {
    mergeAndClause(filter, { startDate: { $exists: true, $ne: null } });
  }

  const isBacklog =
    sprintArr.some((s) => SPRINT_BACKLOG_TOKENS.has(s)) &&
    sprintArr.filter((s) => !SPRINT_BACKLOG_TOKENS.has(s)).length === 0;
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
    ).map((row) => mapIssue(row as Record<string, unknown>)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export function withIssueKey(
  issue: { _id: unknown; key?: string; project?: { key?: string } | unknown }
): typeof issue & { key: string } {
  const key =
    issue.key ||
    (issue.project && typeof issue.project === 'object' && issue.project && 'key' in issue.project
      ? `${(issue.project as { key: string }).key}-${String(issue._id).slice(-6)}`
      : String(issue._id).slice(-8));
  return { ...issue, key };
}

function mapIssue(issue: Record<string, unknown>): Record<string, unknown> & { key: string } {
  return withNormalizedFixVersion(
    withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } | unknown })
  ) as Record<string, unknown> & { key: string };
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
  return issue ? enrichIssueRecord(issue as Record<string, unknown>) : null;
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
  authorId?: string,
  syncOptions?: { syncOrigin?: 'ado' | 'taskflow' }
): Promise<unknown | null> {
  const oldDoc = await Issue.findById(id).lean();
  if (!oldDoc) return null;

  const updateData: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.assignee !== undefined && input.assignee !== '' && input.assignee !== null) {
    updateData.assignee = input.assignee;
  }
  if (input.reporter !== undefined && input.reporter !== '' && input.reporter !== null) {
    updateData.reporter = input.reporter;
  }
  if (input.sprint !== undefined && input.sprint !== '' && input.sprint !== null) {
    updateData.sprint = input.sprint;
  }
  if (input.boardColumn !== undefined) updateData.boardColumn = input.boardColumn;
  if (input.labels !== undefined) updateData.labels = input.labels;
  if (input.dueDate !== undefined) {
    if (input.dueDate) updateData.dueDate = new Date(input.dueDate);
  }
  if (input.startDate !== undefined) {
    if (input.startDate) updateData.startDate = new Date(input.startDate);
  }
  if (input.baselineDueDate !== undefined) {
    if (input.baselineDueDate) updateData.baselineDueDate = new Date(input.baselineDueDate);
  }
  if (input.baselineStartDate !== undefined) {
    if (input.baselineStartDate) updateData.baselineStartDate = new Date(input.baselineStartDate);
  }
  if (input.storyPoints !== undefined) {
    if (input.storyPoints === null) unset.storyPoints = 1;
    else updateData.storyPoints = input.storyPoints;
  }
  if (input.timeEstimateMinutes !== undefined) {
    if (input.timeEstimateMinutes === null) unset.timeEstimateMinutes = 1;
    else updateData.timeEstimateMinutes = input.timeEstimateMinutes;
  }
  if (input.checklist !== undefined) updateData.checklist = input.checklist;
  if (input.customFieldValues !== undefined) {
    updateData.customFieldValues = await stripFormulaKeysFromCustomFieldValues(
      String(oldDoc.project),
      input.customFieldValues as Record<string, unknown>
    );
  }

  if (input.assignee !== undefined && (input.assignee === '' || input.assignee === null)) unset.assignee = 1;
  if (input.sprint === null || input.sprint === '') unset.sprint = 1;
  if (input.dueDate === null || input.dueDate === '') unset.dueDate = 1;
  if (input.startDate === null || input.startDate === '') unset.startDate = 1;
  if (input.baselineDueDate === null || input.baselineDueDate === '') unset.baselineDueDate = 1;
  if (input.baselineStartDate === null || input.baselineStartDate === '') unset.baselineStartDate = 1;
  if (input.fixVersion !== undefined) {
    const fixVersions = normalizeFixVersionsInput(input.fixVersion);
    if (!fixVersions?.length) unset.fixVersion = 1;
    else updateData.fixVersion = fixVersions;
  }
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
  if (input.reporter !== undefined) addChange('reporter', oldRaw.reporter, input.reporter || undefined);
  if (input.sprint !== undefined) addChange('sprint', oldRaw.sprint, input.sprint ?? undefined);
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
  if (input.baselineDueDate !== undefined) {
    const oldDate = oldRaw.baselineDueDate ? (oldRaw.baselineDueDate as Date).toISOString?.()?.slice(0, 10) : null;
    const newDate = input.baselineDueDate ? new Date(input.baselineDueDate).toISOString().slice(0, 10) : null;
    addChange('baselineDueDate', oldDate, newDate);
  }
  if (input.baselineStartDate !== undefined) {
    const oldDate = oldRaw.baselineStartDate ? (oldRaw.baselineStartDate as Date).toISOString?.()?.slice(0, 10) : null;
    const newDate = input.baselineStartDate ? new Date(input.baselineStartDate).toISOString().slice(0, 10) : null;
    addChange('baselineStartDate', oldDate, newDate);
  }
  if (input.storyPoints !== undefined) addChange('storyPoints', oldRaw.storyPoints, input.storyPoints ?? undefined);
  if (input.timeEstimateMinutes !== undefined) addChange('timeEstimateMinutes', oldRaw.timeEstimateMinutes, input.timeEstimateMinutes ?? undefined);
  if (input.checklist !== undefined && !arraysEqual(oldRaw.checklist as unknown[] | undefined, input.checklist)) {
    addChange('checklist', oldRaw.checklist, input.checklist);
  }
  if (input.fixVersion !== undefined) {
    const nextFix = normalizeFixVersionsInput(input.fixVersion);
    addChange('fixVersion', oldRaw.fixVersion, nextFix?.length ? nextFix : undefined);
  }
  if (input.affectsVersions !== undefined && !arraysEqual(oldRaw.affectsVersions as unknown[] | undefined, input.affectsVersions)) {
    addChange('affectsVersions', oldRaw.affectsVersions, input.affectsVersions);
  }
  if (input.parent !== undefined) addChange('parent', oldRaw.parent, input.parent || undefined);
  if (input.milestone !== undefined) addChange('milestone', oldRaw.milestone, input.milestone || undefined);

  const mergedIssue = { ...oldRaw, ...updateData };
  if (authorId && (input.status !== undefined || Object.keys(updateData).length > 0)) {
    const { getProjectPermissionsForUser } = await import('../../middleware/requireProjectPermission');
    const { assertIssueUpdateAllowedByRules } = await import('../stageEstimates/stageEstimate.service');
    const perms = await getProjectPermissionsForUser(String(oldDoc.project), authorId);
    await assertIssueUpdateAllowedByRules(
      id,
      String(oldDoc.project),
      oldRaw,
      mergedIssue,
      authorId,
      perms
    );
  }

  if (authorId && changes.length > 0) {
    await issueHistoryService.recordFieldChanges(id, authorId, changes);
  }

  const updateOp = Object.keys(unset).length
    ? { $set: updateData, $unset: unset }
    : { $set: updateData };

  const expectedUpdatedAt = input.expectedUpdatedAt;
  const filter: Record<string, unknown> = { _id: id };
  if (expectedUpdatedAt) {
    filter.updatedAt = new Date(expectedUpdatedAt);
  }

  let issue = await Issue.findOneAndUpdate(filter, updateOp, { new: true, runValidators: true })
    .populate('reporter', 'name email')
    .populate('assignee', 'name email')
    .populate('project', 'name key')
    .populate('sprint', 'name status')
    .populate('parent', 'key title _id')
    .populate('milestone', 'name dueDate status')
    .lean();

  if (!issue && expectedUpdatedAt) {
    const current = await Issue.findById(id)
      .populate('reporter', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name key')
      .populate('sprint', 'name status')
      .populate('parent', 'key title _id')
      .populate('milestone', 'name dueDate status')
      .lean();
    if (!current) return null;
    throw new ApiError(409, 'Issue was modified by someone else', {
      latest: mapIssue(current as Parameters<typeof mapIssue>[0]),
    });
  }

  if (!issue) return null;

  const issueWithKey = withIssueKey(issue as { _id: unknown; key?: string; project?: { key?: string } });
  const projectId = (issue.project as { _id?: unknown })?._id
    ? String((issue.project as { _id: unknown })._id)
    : String(issue.project);
  notifyProjectRefresh(projectId);

  if (authorId && syncOptions?.syncOrigin !== 'ado') {
    const issueKey = issueWithKey.key ?? '?';
    const notifySnapshot: issueNotification.IssueNotifySnapshot = {
      _id: id,
      key: issueKey,
      title: String(issue.title ?? ''),
      type: String(issue.type ?? 'Task'),
      status: String(issue.status ?? ''),
      project: issue.project as issueNotification.IssueNotifySnapshot['project'],
      assignee: issue.assignee as issueNotification.IssueNotifySnapshot['assignee'],
    };

    const assigneeChange = changes.find((c) => c.field === 'assignee');
    if (assigneeChange?.toValue) {
      issueNotification
        .notifyIssueAssigned({
          issue: notifySnapshot,
          assigneeUserId: String(assigneeChange.toValue),
          actorUserId: authorId,
        })
        .catch((err) => console.error('[issue] assign notify failed:', err));
    }

    if (assigneeChange && !assigneeChange.toValue && assigneeChange.fromValue) {
      issueNotification
        .notifyIssueUnassigned({
          issue: notifySnapshot,
          previousAssigneeUserId: String(assigneeChange.fromValue),
          actorUserId: authorId,
        })
        .catch((err) => console.error('[issue] unassign notify failed:', err));
    }

    const statusChange2 = changes.find((c) => c.field === 'status');
    if (statusChange2?.toValue && String(statusChange2.toValue) !== String(statusChange2.fromValue)) {
      const assignee = issue.assignee as { _id?: unknown } | null;
      const assigneeId = assignee?._id ? String(assignee._id) : null;
      issueNotification
        .notifyIssueStatusChanged({
          issue: { ...notifySnapshot, status: String(statusChange2.toValue) },
          fromStatus: String(statusChange2.fromValue ?? '—'),
          toStatus: String(statusChange2.toValue),
          assigneeUserId: assigneeId,
          actorUserId: authorId,
        })
        .catch((err) => console.error('[issue] status notify failed:', err));

      watchersService.notifyWatchers(id, authorId, {
        type: 'status_changed',
        title: `Status changed: ${issueKey}`,
        body: `${String(statusChange2.fromValue ?? '—')} → ${String(statusChange2.toValue)}`,
        meta: {
          issueId: id,
          issueKey,
          projectId,
          issueTitle: String(issue.title ?? ''),
          fromStatus: String(statusChange2.fromValue ?? '—'),
          toStatus: String(statusChange2.toValue),
        },
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
        meta: {
          issueId: id,
          issueKey,
          projectId,
          issueTitle: String(issue.title ?? ''),
          changes: otherFieldChanges.slice(0, 8).map((c) => ({
            field: c.field,
            from: c.fromValue,
            to: c.toValue,
          })),
        },
      }).catch(() => {});
    }
  }

  // Sync customer request status when issue status changes
  if (issue && input.status !== undefined) {
    const project2 = await Project.findById(
      (issue.project as { _id?: unknown })?._id
        ? String((issue.project as { _id: unknown })._id)
        : String(issue.project)
    )
      .select('statuses')
      .lean();
    const statuses = (project2 as { statuses?: Array<{ name: string; isClosed?: boolean }> })?.statuses ?? [];
    const { syncIssueStatus } = await import('../customer-portal/customer-request/customerRequest.service');
    syncIssueStatus(id, statuses, String(issue.status)).catch(() => {});
  }

  if (syncOptions?.syncOrigin !== 'ado') {
    import('../integrations/ado/adoSync.service')
      .then((m) => m.syncIssueToAdo(id, { syncOrigin: 'taskflow' }))
      .catch((err) => console.error('[ado] outbound sync on update failed:', err));
  }

  return issue ? enrichIssueRecord(issue as Record<string, unknown>) : null;
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
  storyPoints?: number | null;
  labels?: string[];
  type?: string;
  priority?: string;
  fixVersion?: string[] | string | null;
  affectsVersions?: string[];
  milestone?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  timeEstimateMinutes?: number | null;
  parent?: string | null;
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

  const issuesBefore = await Issue.find({ _id: { $in: issueIds }, project: { $in: allowedProjectIds } })
    .select('_id key title type status assignee project')
    .populate('project', 'name key')
    .lean();
  const accessibleIds = issuesBefore.map((i) => String(i._id));
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
  if (updates.storyPoints !== undefined) {
    if (updates.storyPoints === null) unset.storyPoints = 1;
    else updateData.storyPoints = updates.storyPoints;
  }
  if (updates.labels !== undefined) updateData.labels = updates.labels;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.fixVersion !== undefined) {
    const fixVersions = normalizeFixVersionsInput(updates.fixVersion);
    if (!fixVersions?.length) unset.fixVersion = 1;
    else updateData.fixVersion = fixVersions;
  }
  if (updates.affectsVersions !== undefined) updateData.affectsVersions = updates.affectsVersions;
  if (updates.milestone !== undefined) {
    if (updates.milestone === null || updates.milestone === '') unset.milestone = 1;
    else updateData.milestone = updates.milestone;
  }
  if (updates.dueDate !== undefined) {
    if (updates.dueDate === null || updates.dueDate === '') unset.dueDate = 1;
    else updateData.dueDate = new Date(updates.dueDate);
  }
  if (updates.startDate !== undefined) {
    if (updates.startDate === null || updates.startDate === '') unset.startDate = 1;
    else updateData.startDate = new Date(updates.startDate);
  }
  if (updates.timeEstimateMinutes !== undefined) {
    if (updates.timeEstimateMinutes === null) unset.timeEstimateMinutes = 1;
    else updateData.timeEstimateMinutes = updates.timeEstimateMinutes;
  }
  if (updates.parent !== undefined) {
    if (updates.parent === null || updates.parent === '') unset.parent = 1;
    else updateData.parent = updates.parent;
  }
  if (updates.status !== undefined) updateData.boardColumn = updates.status;

  if (updates.parent !== undefined && updates.parent) {
    for (const before of issuesBefore) {
      const projectId = String(
        (before.project as { _id?: unknown })?._id ?? before.project
      );
      await validateParent(updates.parent, projectId, String(before._id));
    }
  }

  const updateOp = Object.keys(unset).length
    ? { $set: updateData, $unset: unset }
    : { $set: updateData };

  const result = await Issue.updateMany({ _id: { $in: accessibleIds } }, updateOp);
  const updated = result.modifiedCount;

  for (const before of issuesBefore) {
    const issueId = String(before._id);
    const snapshot: issueNotification.IssueNotifySnapshot = {
      _id: issueId,
      key: String(before.key ?? issueId),
      title: String(before.title ?? ''),
      type: String(before.type ?? 'Task'),
      status:
        updates.status !== undefined ? String(updates.status) : String(before.status ?? DEFAULT_STATUS),
      project: before.project as issueNotification.IssueNotifySnapshot['project'],
      assignee: before.assignee as issueNotification.IssueNotifySnapshot['assignee'],
    };

    if (updates.assignee !== undefined) {
      const oldAssigneeId = before.assignee ? String(before.assignee) : null;
      const newAssigneeId =
        updates.assignee === null || updates.assignee === ''
          ? null
          : String(updates.assignee);
      if (newAssigneeId && newAssigneeId !== oldAssigneeId) {
        issueNotification
          .notifyIssueAssigned({
            issue: { ...snapshot, assignee: newAssigneeId },
            assigneeUserId: newAssigneeId,
            actorUserId: userId,
          })
          .catch((err) => console.error('[issue] bulk assign notify failed:', err));
      }
      if (oldAssigneeId && !newAssigneeId) {
        issueNotification
          .notifyIssueUnassigned({
            issue: snapshot,
            previousAssigneeUserId: oldAssigneeId,
            actorUserId: userId,
          })
          .catch((err) => console.error('[issue] bulk unassign notify failed:', err));
      }
    }

    if (updates.status !== undefined && String(before.status) !== String(updates.status)) {
      const assigneeId =
        updates.assignee !== undefined
          ? updates.assignee === null || updates.assignee === ''
            ? null
            : String(updates.assignee)
          : before.assignee
            ? String(before.assignee)
            : null;
      issueNotification
        .notifyIssueStatusChanged({
          issue: snapshot,
          fromStatus: String(before.status ?? '—'),
          toStatus: String(updates.status),
          assigneeUserId: assigneeId,
          actorUserId: userId,
        })
        .catch((err) => console.error('[issue] bulk status notify failed:', err));
    }
  }

  for (const id of issueIds) {
    const changes: Array<{ field: string; fromValue: unknown; toValue: unknown }> = [];
    if (updates.status !== undefined) changes.push({ field: 'status', fromValue: null, toValue: updates.status });
    if (updates.assignee !== undefined) changes.push({ field: 'assignee', fromValue: null, toValue: updates.assignee || undefined });
    if (updates.sprint !== undefined) changes.push({ field: 'sprint', fromValue: null, toValue: updates.sprint || undefined });
    if (updates.storyPoints !== undefined) changes.push({ field: 'storyPoints', fromValue: null, toValue: updates.storyPoints ?? undefined });
    if (updates.labels !== undefined) changes.push({ field: 'labels', fromValue: null, toValue: updates.labels });
    if (updates.type !== undefined) changes.push({ field: 'type', fromValue: null, toValue: updates.type });
    if (updates.priority !== undefined) changes.push({ field: 'priority', fromValue: null, toValue: updates.priority });
    if (updates.fixVersion !== undefined) changes.push({ field: 'fixVersion', fromValue: null, toValue: updates.fixVersion || undefined });
    if (updates.affectsVersions !== undefined) {
      changes.push({ field: 'affectsVersions', fromValue: null, toValue: updates.affectsVersions });
    }
    if (updates.milestone !== undefined) {
      changes.push({ field: 'milestone', fromValue: null, toValue: updates.milestone || undefined });
    }
    if (updates.dueDate !== undefined) {
      changes.push({ field: 'dueDate', fromValue: null, toValue: updates.dueDate || undefined });
    }
    if (updates.startDate !== undefined) {
      changes.push({ field: 'startDate', fromValue: null, toValue: updates.startDate || undefined });
    }
    if (updates.timeEstimateMinutes !== undefined) {
      changes.push({
        field: 'timeEstimateMinutes',
        fromValue: null,
        toValue: updates.timeEstimateMinutes ?? undefined,
      });
    }
    if (updates.parent !== undefined) {
      changes.push({ field: 'parent', fromValue: null, toValue: updates.parent || undefined });
    }
    if (changes.length > 0) {
      await issueHistoryService.recordFieldChanges(id, userId, changes);
    }
  }

  const affectedProjectIds = [...new Set(issuesBefore.map((i) => String(i.project)))];
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
  return issue ? mapIssue(issue as Record<string, unknown>) : null;
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
    ).map((row) => mapIssue(row as Record<string, unknown>)),
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
    ).map((row) => mapIssue(row as Record<string, unknown>)),
    total,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

function parseOptionalBool(v: string | undefined): boolean | undefined {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function parseDueDatePreset(v: string | undefined): ListIssuesFilters['dueDatePreset'] {
  if (v === 'overdue' || v === 'today' || v === 'this_week') return v;
  return undefined;
}

export function queryToFilters(query: ListIssuesQuery): ListIssuesFilters {
  return {
    project: query.project,
    status: query.status,
    statusExclude: query.statusExclude,
    assignee: query.assignee,
    reporter: query.reporter,
    sprint: query.sprint,
    milestone: query.milestone,
    type: query.type,
    priority: query.priority,
    labels: query.labels,
    storyPoints: query.storyPoints,
    hasStoryPoints: query.hasStoryPoints === 'true' ? true : query.hasStoryPoints === 'false' ? false : undefined,
    hasEstimate: query.hasEstimate === 'true' ? true : query.hasEstimate === 'false' ? false : undefined,
    fixVersion: query.fixVersion,
    affectsVersions: query.affectsVersions,
    hasParent: parseOptionalBool(query.hasParent),
    hasDueDate: parseOptionalBool(query.hasDueDate),
    dueDatePreset: parseDueDatePreset(query.dueDate),
    hasStartDate: parseOptionalBool(query.hasStartDate),
    unassigned: query.unassigned === 'true' ? true : undefined,
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
    ).map((row) => mapIssue(row as Record<string, unknown>)),
    total,
    page,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export type LabelFacet = { label: string; count: number };

export type QuickFilterCountsResult = {
  my: number;
  open: number;
  all: number;
  myOpenLabels: LabelFacet[];
  openLabels: LabelFacet[];
  allLabels: LabelFacet[];
};

async function aggregateIssueLabelCounts(match: Record<string, unknown>): Promise<LabelFacet[]> {
  const rows = await Issue.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $unwind: '$labels' },
    { $match: { labels: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$labels', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 40 },
  ]);
  return rows.map((r) => ({ label: String(r._id), count: r.count }));
}

async function buildQuickFilterScope(
  userId: string,
  projectId?: string
): Promise<{ projectFilter: Record<string, unknown>; notClosedFilter: Record<string, unknown> } | null> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  let projectFilter: Record<string, unknown> = {};

  if (projectId) {
    projectFilter.project = projectId;
  } else {
    const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
    if (projectIds.length === 0) return null;
    projectFilter.project = { $in: projectIds };
  }

  let closedStatuses: string[] = [];
  if (projectId) {
    closedStatuses = await getClosedStatusNamesForProject(projectId);
  } else {
    const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
    const projects = await Project.find({ _id: { $in: projectIds } }).select('statuses').lean();
    const fromDb = new Set<string>();
    for (const p of projects) {
      let names = getClosedStatusNamesFromStatuses((p as { statuses?: Array<{ name?: string; isClosed?: boolean }> }).statuses);
      if (names.length === 0) names = ['Done', 'Closed', 'Resolved'];
      names.forEach((n) => fromDb.add(n));
    }
    closedStatuses = Array.from(fromDb);
  }
  if (closedStatuses.length === 0) closedStatuses = ['Done', 'Closed', 'Resolved'];
  const loweredClosed = closedStatuses.map((s) => s.trim().toLowerCase()).filter(Boolean);

  const notClosedFilter = {
    $expr: {
      $not: {
        $in: [{ $toLower: { $ifNull: ['$status', ''] } }, loweredClosed],
      },
    },
  };

  return { projectFilter, notClosedFilter };
}

export async function getQuickFilterCounts(userId: string, projectId?: string): Promise<QuickFilterCountsResult> {
  const scope = await buildQuickFilterScope(userId, projectId);
  if (!scope) return { my: 0, open: 0, all: 0, myOpenLabels: [], openLabels: [], allLabels: [] };

  const { projectFilter, notClosedFilter } = scope;

  const openMatch = { ...projectFilter, ...notClosedFilter };
  const myMatch = { ...openMatch, assignee: userId };

  const [all, open, my, myOpenLabels, openLabels, allLabels] = await Promise.all([
    Issue.countDocuments(projectFilter),
    Issue.countDocuments(openMatch),
    Issue.countDocuments(myMatch),
    aggregateIssueLabelCounts(myMatch),
    aggregateIssueLabelCounts(openMatch),
    aggregateIssueLabelCounts(projectFilter),
  ]);

  return { my, open, all, myOpenLabels, openLabels, allLabels };
}
