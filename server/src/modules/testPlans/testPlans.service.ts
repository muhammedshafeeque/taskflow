import { notifyIssuePeople, notifyProjectMembers } from '../notifications/domainNotify';
import { claimReminder } from '../reminders/reminderLog.model';
import mongoose from 'mongoose';
import { TestPlan } from './testPlan.model';
import { TestCycle } from './testCycle.model';
import { TestRun } from './testRun.model';
import { TestCase } from '../testCases/testCase.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';

export type TestCycleStatus = 'draft' | 'in_progress' | 'completed';
export type TestRunStatus = 'pending' | 'pass' | 'fail' | 'blocked' | 'skip';

async function ensureProjectAccess(projectId: string, userId: string): Promise<void> {
  const isMember = await ProjectMember.exists({ user: userId, project: projectId });
  if (!isMember) throw new ApiError(403, 'Access denied');
}

export async function listTestPlans(projectId: string, userId: string): Promise<unknown[]> {
  await ensureProjectAccess(projectId, userId);
  const plans = await TestPlan.find({ project: projectId })
    .sort({ createdAt: -1 })
    .lean();
  return plans;
}

export async function createTestPlan(
  projectId: string,
  input: { name: string; description?: string; testCaseIds?: string[] },
  userId: string
): Promise<unknown> {
  await ensureProjectAccess(projectId, userId);
  const doc = await TestPlan.create({
    project: projectId,
    name: input.name,
    description: input.description ?? '',
    testCaseIds: (input.testCaseIds ?? []).map((id) => new mongoose.Types.ObjectId(id)),
  });
  return doc.toObject();
}

export async function updateTestPlan(
  projectId: string,
  planId: string,
  input: Partial<{ name: string; description: string; testCaseIds: string[] }>,
  userId: string
): Promise<unknown | null> {
  await ensureProjectAccess(projectId, userId);
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.testCaseIds !== undefined) {
    updateData.testCaseIds = input.testCaseIds.map((id) => new mongoose.Types.ObjectId(id));
  }
  const doc = await TestPlan.findOneAndUpdate(
    { _id: planId, project: projectId },
    { $set: updateData },
    { new: true }
  ).lean();
  return doc;
}

export async function deleteTestPlan(projectId: string, planId: string, userId: string): Promise<boolean> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) return false;
  const cycles = await TestCycle.find({ testPlan: planId }).select('_id').lean();
  const cycleIds = cycles.map((c) => (c as { _id: mongoose.Types.ObjectId })._id);
  if (cycleIds.length > 0) {
    await TestRun.deleteMany({ testCycle: { $in: cycleIds } });
  }
  await TestCycle.deleteMany({ testPlan: planId });
  const result = await TestPlan.deleteOne({ _id: planId, project: projectId });
  return result.deletedCount > 0;
}

export async function listTestCycles(
  projectId: string,
  planId: string,
  userId: string
): Promise<unknown[]> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const cycles = await TestCycle.find({ testPlan: planId })
    .sort({ createdAt: -1 })
    .lean();
  return cycles;
}

export async function createTestCycle(
  projectId: string,
  planId: string,
  input: { name: string; startDate?: Date; endDate?: Date; status?: TestCycleStatus },
  userId: string
): Promise<unknown> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const doc = await TestCycle.create({
    testPlan: planId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    status: input.status ?? 'draft',
  });
  return doc.toObject();
}

export async function updateTestCycle(
  projectId: string,
  planId: string,
  cycleId: string,
  input: Partial<{ name: string; startDate: Date; endDate: Date; status: TestCycleStatus }>,
  userId: string
): Promise<unknown | null> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const doc = await TestCycle.findOneAndUpdate(
    { _id: cycleId, testPlan: planId },
    { $set: input },
    { new: true }
  ).lean();
  return doc;
}

export async function deleteTestCycle(
  projectId: string,
  planId: string,
  cycleId: string,
  userId: string
): Promise<boolean> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  await TestRun.deleteMany({ testCycle: cycleId });
  const result = await TestCycle.deleteOne({ _id: cycleId, testPlan: planId });
  return result.deletedCount > 0;
}

export async function getCycleRuns(
  projectId: string,
  planId: string,
  cycleId: string,
  userId: string
): Promise<unknown[]> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const cycle = await TestCycle.findOne({ _id: cycleId, testPlan: planId });
  if (!cycle) throw new ApiError(404, 'Test cycle not found');

  const testCaseIds = (plan as { testCaseIds: mongoose.Types.ObjectId[] }).testCaseIds;
  const testCases = await TestCase.find({ _id: { $in: testCaseIds } })
    .populate('linkedIssueId', 'key title')
    .lean();

  const runs = await TestRun.find({ testCycle: cycleId })
    .populate('assignee', 'name email')
    .lean();

  const runMap = new Map<string, { status: string; result?: string; executedAt?: Date; assignee?: { name: string; email: string } }>();
  for (const r of runs as Array<{
    testCase: mongoose.Types.ObjectId;
    status: string;
    result?: string;
    executedAt?: Date;
    assignee?: { name: string; email: string };
  }>) {
    runMap.set(String(r.testCase), {
      status: r.status,
      result: r.result,
      executedAt: r.executedAt,
      assignee: r.assignee,
    });
  }

  return testCases.map((tc) => {
    const tcId = String((tc as { _id: mongoose.Types.ObjectId })._id);
    const run = runMap.get(tcId);
    return {
      testCase: tc,
      run: run ?? { status: 'pending', result: undefined, executedAt: undefined, assignee: undefined },
    };
  });
}

export async function updateRunStatus(
  projectId: string,
  planId: string,
  cycleId: string,
  testCaseId: string,
  input: { status: TestRunStatus; result?: string; assignee?: string },
  userId: string
): Promise<unknown> {
  await ensureProjectAccess(projectId, userId);
  const plan = await TestPlan.findOne({ _id: planId, project: projectId });
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const cycle = await TestCycle.findOne({ _id: cycleId, testPlan: planId });
  if (!cycle) throw new ApiError(404, 'Test cycle not found');

  const testCaseIds = (plan as { testCaseIds: mongoose.Types.ObjectId[] }).testCaseIds;
  const valid = testCaseIds.some((id) => String(id) === testCaseId);
  if (!valid) throw new ApiError(400, 'Test case not in plan');

  const updateData: Record<string, unknown> = {
    status: input.status,
    result: input.result,
    assignee: input.assignee ? new mongoose.Types.ObjectId(input.assignee) : undefined,
  };
  if (input.status !== 'pending') {
    updateData.executedAt = new Date();
  }

  const doc = await TestRun.findOneAndUpdate(
    { testCycle: cycleId, testCase: testCaseId },
    { $set: updateData },
    { new: true, upsert: true }
  )
    .populate('assignee', 'name email')
    .populate('testCase', 'title steps expectedResult linkedIssueId')
    .lean();

  void notifyQaOutcome(projectId, plan, cycle, testCaseIds.length, input.status, doc, userId);
  return doc;
}

/** QA notifications: a failed test pings the linked issue (or the plan's project); a finished cycle tells the project once. */
async function notifyQaOutcome(
  projectId: string,
  plan: { _id: unknown; name?: string },
  cycle: { _id: unknown; name?: string },
  totalCases: number,
  status: string,
  run: unknown,
  userId: string
) {
  try {
    const tc = (run as { testCase?: { title?: string; linkedIssueId?: unknown } } | null)?.testCase;
    if (status === 'failed') {
      const payload = { title: `Test failed: ${tc?.title ?? 'test case'}`, body: `${plan.name ?? 'Plan'} · ${cycle.name ?? 'cycle'}`, link: `/projects/${projectId}/test-plans` };
      if (tc?.linkedIssueId) notifyIssuePeople(String(tc.linkedIssueId), 'qa_test_failed', payload, userId);
      else notifyProjectMembers(projectId, 'qa_test_failed', payload, userId);
    }
    const done = await TestRun.countDocuments({ testCycle: cycle._id, status: { $ne: 'pending' } });
    if (totalCases > 0 && done >= totalCases && (await claimReminder('qa_cycle_completed', String(cycle._id)))) {
      const failed = await TestRun.countDocuments({ testCycle: cycle._id, status: 'failed' });
      notifyProjectMembers(projectId, 'qa_cycle_completed', {
        title: `Test cycle complete: ${cycle.name ?? ''}`,
        body: `${totalCases} tests · ${failed} failed`,
        link: `/projects/${projectId}/test-plans`,
      });
    }
  } catch (err) {
    console.error('[qa] notify failed', err);
  }
}
