import mongoose from 'mongoose';
import { Board, type IBoardColumn } from './board.model';
import { Sprint } from '../sprints/sprint.model';
import { Project } from '../projects/project.model';
import { ApiError } from '../../utils/ApiError';
import type { CreateBoardBody, UpdateBoardBody } from './boards.validation';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';

/** Statuses a project falls back to when it hasn't configured its own (same as the project API). */
const DEFAULT_STATUS_NAMES = ['Backlog', 'Todo', 'In Progress', 'Done'];

/** One column per project status, in the project's order — the starting layout for a new board. */
export async function defaultColumnsForProject(projectId: string): Promise<IBoardColumn[]> {
  const project = await Project.findById(projectId).select('statuses').lean();
  const statuses = [...((project as { statuses?: Array<{ name: string; order?: number }> } | null)?.statuses ?? [])]
    .filter((s) => s?.name)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => s.name);
  return (statuses.length ? statuses : DEFAULT_STATUS_NAMES).map((name, order) => ({ name, statusId: name, visibleStatuses: [name], order }));
}

export async function create(input: CreateBoardBody): Promise<unknown> {
  const doc = await Board.create({
    name: input.name,
    type: input.type,
    project: input.project,
    columns: input.columns?.length ? input.columns : await defaultColumnsForProject(input.project),
  });
  return doc.toObject();
}

/**
 * The Scrum board a sprint belongs on. A given board must be a Scrum board of the same project; without one,
 * the project's first Scrum board is used, and one is created (with the project's status columns) if it has none.
 */
export async function scrumBoardForSprint(
  projectId: string,
  boardId?: string | null
): Promise<{ board: { _id: mongoose.Types.ObjectId; name: string; type: string }; created: boolean }> {
  if (boardId) {
    const board = mongoose.Types.ObjectId.isValid(boardId) ? await Board.findById(boardId).select('name type project').lean() : null;
    if (!board || String(board.project) !== String(projectId)) throw new ApiError(400, 'That board is not part of this project');
    if (board.type !== 'Scrum') throw new ApiError(400, `Sprints run on Scrum boards; "${board.name}" is a Kanban board`);
    return { board: { _id: board._id as mongoose.Types.ObjectId, name: board.name, type: board.type }, created: false };
  }
  const existing = await Board.findOne({ project: projectId, type: 'Scrum' }).sort({ createdAt: 1 }).select('name type').lean();
  if (existing) return { board: { _id: existing._id as mongoose.Types.ObjectId, name: existing.name, type: existing.type }, created: false };

  const project = await Project.findById(projectId).select('key name').lean();
  if (!project) throw new ApiError(404, 'Project not found');
  const created = await Board.create({
    name: `${(project as { key?: string }).key ?? (project as { name?: string }).name ?? 'Project'} Scrum`,
    type: 'Scrum',
    project: projectId,
    columns: await defaultColumnsForProject(projectId),
  });
  return { board: { _id: created._id as mongoose.Types.ObjectId, name: created.name, type: created.type }, created: true };
}

export async function findAll(
  filter: { projectId?: string; projectIds?: mongoose.Types.ObjectId[] } = {},
  pagination: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;
  const query = filter.projectId ? { project: filter.projectId } : { project: { $in: filter.projectIds ?? [] } };

  const [data, total] = await Promise.all([
    Board.find(query).populate('project', 'name key').sort({ createdAt: 1 }).lean().skip(skip).limit(limit),
    Board.countDocuments(query),
  ]);

  // How many sprints each board holds, and which one is running — so the UI can show the link.
  const ids = data.map((b) => b._id);
  const [counts, active] = await Promise.all([
    Sprint.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([{ $match: { board: { $in: ids } } }, { $group: { _id: '$board', n: { $sum: 1 } } }]),
    Sprint.find({ board: { $in: ids }, status: 'active' }).select('name board').lean(),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  const activeOf = new Map(active.map((s) => [String(s.board), { _id: s._id, name: s.name }]));

  return {
    data: data.map((b) => ({ ...b, sprintCount: countOf.get(String(b._id)) ?? 0, activeSprint: activeOf.get(String(b._id)) ?? null })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function findById(id: string): Promise<unknown | null> {
  const board = await Board.findById(id).populate('project', 'name key').lean();
  return board ?? null;
}

export async function update(id: string, input: UpdateBoardBody): Promise<unknown | null> {
  const existing = await Board.findById(id).select('type').lean();
  if (!existing) return null;
  if (input.type !== undefined && input.type !== existing.type && existing.type === 'Scrum') {
    const sprints = await Sprint.countDocuments({ board: id });
    if (sprints) throw new ApiError(400, `This board has ${sprints} sprint(s). Move or delete them before making it a Kanban board.`);
  }
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.columns !== undefined) updateData.columns = input.columns;

  const board = await Board.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
    .populate('project', 'name key')
    .lean();

  return board ?? null;
}

/**
 * Deletes a board. Its sprints are not orphaned: they move to the project's next Scrum board, and a board that
 * holds sprints can't be deleted when there is no other Scrum board to take them.
 */
export async function remove(id: string): Promise<{ deleted: boolean; movedSprints?: number; movedTo?: { _id: string; name: string } }> {
  const board = await Board.findById(id).select('project name').lean();
  if (!board) return { deleted: false };
  const sprints = await Sprint.countDocuments({ board: id });
  let moved: { _id: string; name: string } | undefined;
  if (sprints) {
    const other = await Board.findOne({ project: board.project, type: 'Scrum', _id: { $ne: id } }).sort({ createdAt: 1 }).select('name').lean();
    if (!other) {
      throw new ApiError(400, `"${board.name}" holds ${sprints} sprint(s) and is the project's only Scrum board. Delete its sprints or add another Scrum board first.`);
    }
    if (await Sprint.exists({ board: id, status: 'active' }) && await Sprint.exists({ board: other._id, status: 'active' })) {
      throw new ApiError(400, `Both "${board.name}" and "${other.name}" have an active sprint. Complete one of them first.`);
    }
    await Sprint.updateMany({ board: id }, { $set: { board: other._id } });
    moved = { _id: String(other._id), name: other.name };
  }
  await Board.findByIdAndDelete(id);
  return { deleted: true, movedSprints: sprints || undefined, movedTo: moved };
}
