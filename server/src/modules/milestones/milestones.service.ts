import { Milestone } from './milestone.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';

export async function listByProject(projectId: string, userId: string): Promise<unknown[]> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const list = await Milestone.find({ project: projectId }).sort({ dueDate: 1, name: 1 }).lean();
  return list;
}

export async function create(projectId: string, input: { name: string; dueDate?: string; status?: string; description?: string }, userId: string): Promise<unknown> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const doc = await Milestone.create({
    project: projectId,
    name: input.name,
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    status: input.status ?? 'open',
    description: input.description ?? '',
  });
  return doc.toObject();
}

export async function update(
  milestoneId: string,
  projectId: string,
  input: {
    name?: string;
    dueDate?: string | null;
    baselineStartDate?: string | null;
    baselineDueDate?: string | null;
    status?: string;
    description?: string;
  },
  userId: string
): Promise<unknown | null> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (input.name !== undefined) $set.name = input.name;
  if (input.dueDate !== undefined) {
    if (input.dueDate) $set.dueDate = new Date(input.dueDate);
    else $unset.dueDate = 1;
  }
  if (input.baselineStartDate !== undefined) {
    if (input.baselineStartDate) $set.baselineStartDate = new Date(input.baselineStartDate);
    else $unset.baselineStartDate = 1;
  }
  if (input.baselineDueDate !== undefined) {
    if (input.baselineDueDate) $set.baselineDueDate = new Date(input.baselineDueDate);
    else $unset.baselineDueDate = 1;
  }
  if (input.status !== undefined) $set.status = input.status;
  if (input.description !== undefined) $set.description = input.description;
  const doc = await Milestone.findOneAndUpdate(
    { _id: milestoneId, project: projectId },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: true }
  ).lean();
  return doc;
}

export async function remove(milestoneId: string, projectId: string, userId: string): Promise<boolean> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const result = await Milestone.deleteOne({ _id: milestoneId, project: projectId });
  return result.deletedCount > 0;
}
