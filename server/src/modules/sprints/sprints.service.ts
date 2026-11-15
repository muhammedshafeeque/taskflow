import { notifyProjectMembers } from '../notifications/domainNotify';
import { Sprint } from './sprint.model';
import { Issue } from '../issues/issue.model';
import { ApiError } from '../../utils/ApiError';
import { notifyProjectRefresh } from '../../websocket';
import { getClosedStatusNamesForProject } from '../projects/statusClassification';
import { scrumBoardForSprint } from '../boards/boards.service';
import type mongoose from 'mongoose';

async function getDoneStatuses(projectId: string): Promise<string[]> {
  return getClosedStatusNamesForProject(projectId);
}
import type { CreateSprintBody, UpdateSprintBody } from './sprints.validation';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';

function parseDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Creates a sprint on a Scrum board of its project (the project's Scrum board, created if needed, when none is given). */
export async function create(input: CreateSprintBody): Promise<unknown> {
  const { board, created } = await scrumBoardForSprint(String(input.project), input.board);
  const status = input.status ?? 'planned';
  if (status === 'active' && (await Sprint.exists({ board: board._id, status: 'active' }))) {
    throw new ApiError(400, `"${board.name}" already has an active sprint. Create this one as planned and start it later.`);
  }
  const doc = await Sprint.create({
    name: input.name,
    project: input.project,
    board: board._id,
    startDate: parseDate(input.startDate as string | Date | undefined),
    endDate: parseDate(input.endDate as string | Date | undefined),
    status,
  });
  notifyProjectRefresh(String(input.project));
  const sprint = await Sprint.findById(doc._id).populate('project', 'name key').populate('board', 'name type').lean();
  return { ...(sprint ?? doc.toObject()), boardCreated: created || undefined };
}

export async function findAll(
  filters: { projectId?: string; projectIds?: mongoose.Types.ObjectId[]; boardId?: string; status?: string } = {},
  pagination: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (filters.projectId) filter.project = filters.projectId;
  else filter.project = { $in: filters.projectIds ?? [] };
  if (filters.boardId) filter.board = filters.boardId;
  if (filters.status) filter.status = filters.status;

  const [data, total] = await Promise.all([
    Sprint.find(filter)
      .populate('project', 'name key')
      .populate('board', 'name type')
      .sort({ createdAt: -1 })
      .lean()
      .skip(skip)
      .limit(limit),
    Sprint.countDocuments(filter),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function findById(id: string): Promise<unknown | null> {
  const sprint = await Sprint.findById(id)
    .populate('project', 'name key')
    .populate('board', 'name type')
    .lean();
  return sprint ?? null;
}

export async function update(id: string, input: UpdateSprintBody): Promise<unknown | null> {
  const existing = await Sprint.findById(id).select('project board status').lean();
  if (!existing) return null;
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.board !== undefined && input.board !== String(existing.board)) {
    const { board } = await scrumBoardForSprint(String(existing.project), input.board);
    const willBeActive = (input.status ?? existing.status) === 'active';
    if (willBeActive && (await Sprint.exists({ board: board._id, status: 'active', _id: { $ne: id } }))) {
      throw new ApiError(400, `"${board.name}" already has an active sprint`);
    }
    updateData.board = board._id;
  }
  if (input.status !== undefined && input.status !== existing.status) {
    // Starting and completing have side effects (one active sprint per board, unfinished issues return to the backlog).
    throw new ApiError(400, 'Use start or complete to change a sprint\'s status');
  }
  if (input.startDate !== undefined) updateData.startDate = parseDate(input.startDate as string | Date | undefined);
  if (input.endDate !== undefined) updateData.endDate = parseDate(input.endDate as string | Date | undefined);

  const sprint = await Sprint.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  )
    .populate('project', 'name key')
    .populate('board', 'name type')
    .lean();

  if (sprint) notifyProjectRefresh(String(existing.project));
  return sprint ?? null;
}

export async function start(id: string): Promise<unknown | null> {
  const sprint = await Sprint.findById(id).lean();
  if (!sprint) return null;
  if (sprint.status === 'active') {
    throw new ApiError(400, 'Sprint is already active');
  }

  const boardId = sprint.board;
  const otherActive = await Sprint.findOne({ board: boardId, status: 'active', _id: { $ne: id } }).lean();
  if (otherActive) {
    await complete(String(otherActive._id));
  }

  const updated = await Sprint.findByIdAndUpdate(
    id,
    {
      $set: {
        status: 'active',
        startDate: new Date(),
      },
    },
    { new: true, runValidators: true }
  )
    .populate('project', 'name key')
    .populate('board', 'name type')
    .lean();

  if (updated) notifyProjectRefresh(String(sprint.project));
  if (updated) notifyProjectMembers(String(sprint.project), 'sprint_started', { title: `Sprint started: ${sprint.name}`, link: `/projects/${sprint.project}/sprints` });
  return updated ?? null;
}

export async function complete(id: string): Promise<unknown | null> {
  const sprint = await Sprint.findById(id).lean();
  if (!sprint) return null;
  if (sprint.status !== 'active') {
    throw new ApiError(400, 'Only active sprints can be completed');
  }

  const doneStatuses = await getDoneStatuses(String(sprint.project));
  await Issue.updateMany(
    { sprint: id, status: { $nin: doneStatuses } },
    { $unset: { sprint: 1 } }
  );

  const updated = await Sprint.findByIdAndUpdate(
    id,
    {
      $set: {
        status: 'completed',
        endDate: new Date(),
      },
    },
    { new: true, runValidators: true }
  )
    .populate('project', 'name key')
    .populate('board', 'name type')
    .lean();

  if (updated) notifyProjectRefresh(String(sprint.project));
  if (updated) notifyProjectMembers(String(sprint.project), 'sprint_completed', { title: `Sprint completed: ${sprint.name}`, link: `/projects/${sprint.project}/sprints/${id}/report` });
  return updated ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const sprint = await Sprint.findById(id).select('project').lean();
  if (!sprint) return false;
  await Issue.updateMany({ sprint: id }, { $unset: { sprint: 1 } });
  const result = await Sprint.findByIdAndDelete(id);
  if (result) notifyProjectRefresh(String(sprint.project));
  return result != null;
}

export async function getCompletionPreview(sprintId: string, projectId: string): Promise<{ incompleteCount: number; incompleteIssues: { _id: string; key?: string; title: string }[] }> {
  const sprint = await Sprint.findById(sprintId).lean();
  if (!sprint) throw new ApiError(404, 'Sprint not found');
  if (String(sprint.project) !== String(projectId)) throw new ApiError(404, 'Sprint not found');
  if (sprint.status !== 'active') throw new ApiError(400, 'Only active sprints can be completed');

  const doneStatuses = await getDoneStatuses(projectId);
  const [incomplete, totalCount] = await Promise.all([
    Issue.find({ sprint: sprintId, project: projectId, status: { $nin: doneStatuses } })
      .select('_id key title project')
      .populate('project', 'key')
      .limit(50)
      .lean(),
    Issue.countDocuments({ sprint: sprintId, project: projectId, status: { $nin: doneStatuses } }),
  ]);

  const withKey = incomplete.map((i) => {
    const key = i.key ?? (i.project && typeof i.project === 'object' && 'key' in i.project
      ? `${(i.project as { key: string }).key}-${String(i._id).slice(-6)}`
      : String(i._id).slice(-8));
    return { _id: String(i._id), key, title: i.title };
  });

  return { incompleteCount: totalCount, incompleteIssues: withKey };
}
