import { TestCase } from './testCase.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';

export async function listByProject(projectId: string, userId: string): Promise<unknown[]> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const list = await TestCase.find({ project: projectId })
    .populate('linkedIssueId', 'key title')
    .sort({ createdAt: -1 })
    .lean();
  return list;
}

export async function create(
  projectId: string,
  input: { title: string; steps?: string; expectedResult?: string; status?: string; priority?: string; type?: string; linkedIssueId?: string },
  userId: string
): Promise<unknown> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const doc = await TestCase.create({
    project: projectId,
    title: input.title,
    steps: input.steps ?? '',
    expectedResult: input.expectedResult ?? '',
    status: input.status ?? 'draft',
    priority: input.priority ?? 'medium',
    type: input.type ?? 'functional',
    linkedIssueId: input.linkedIssueId || undefined,
  });
  return doc.toObject();
}

export async function update(
  testCaseId: string,
  projectId: string,
  input: Partial<{ title: string; steps: string; expectedResult: string; status: string; priority: string; type: string; linkedIssueId: string | null }>,
  userId: string
): Promise<unknown | null> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const { pickUpdateFields } = await import('../../utils/pickUpdateFields');
  const updateData = pickUpdateFields(input as Record<string, unknown>, [
    'title',
    'steps',
    'expectedResult',
    'status',
    'priority',
    'type',
    'linkedIssueId',
  ]);
  if (input.linkedIssueId === null) updateData.linkedIssueId = null;
  const doc = await TestCase.findOneAndUpdate(
    { _id: testCaseId, project: projectId },
    { $set: updateData },
    { new: true }
  )
    .populate('linkedIssueId', 'key title')
    .lean();
  return doc;
}

export async function remove(testCaseId: string, projectId: string, userId: string): Promise<boolean> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
  const result = await TestCase.deleteOne({ _id: testCaseId, project: projectId });
  return result.deletedCount > 0;
}
