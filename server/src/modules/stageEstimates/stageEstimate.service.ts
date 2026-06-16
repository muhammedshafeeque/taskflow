import mongoose from 'mongoose';
import { StageEstimate } from './stageEstimate.model';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { WorkLog } from '../workLogs/workLog.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { getIssueActionContext, assertIssuePermission } from '../../middleware/assertIssueAction';
import { evaluateForIssueAction } from '../projectRules/projectRules.service';
import { buildWorkLaneContext } from '../projectRules/projectRules.evaluator';
import * as issueHistoryService from '../issues/issueHistory.service';
import { rollupStageEstimatesForIssue } from '../issues/issueEstimateRollup.service';

export interface SubmitStageEstimateInput {
  laneId: string;
  minutes: number;
  statusId?: string;
  assigneeId?: string;
}

export async function listForIssue(issueId: string): Promise<unknown[]> {
  return StageEstimate.find({ issue: issueId })
    .sort({ laneId: 1, createdAt: -1 })
    .populate('submittedBy', 'name email')
    .populate('reviewedBy', 'name email')
    .populate('assigneeId', 'name email')
    .lean();
}

export async function submitStageEstimates(
  issueId: string,
  userId: string,
  estimates: SubmitStageEstimateInput[],
  userGlobalPermissions?: string[],
  activeOrganizationId?: string
): Promise<unknown[]> {
  const ctx = await getIssueActionContext(issueId, userId, userGlobalPermissions, activeOrganizationId);
  assertIssuePermission(ctx, PROJECT_PERMISSIONS.ISSUE.ESTIMATE.SUBMIT);

  const issue = await Issue.findById(issueId).lean();
  if (!issue) throw new ApiError(404, 'Issue not found');

  const childCount = await Issue.countDocuments({ parent: issueId });
  if (childCount > 0) {
    throw new ApiError(400, 'Parent issues cannot have stage estimates; add estimates on child issues');
  }

  const project = await Project.findById(ctx.projectId).lean();
  if (!project) throw new ApiError(404, 'Project not found');

  const created: unknown[] = [];
  for (const est of estimates) {
    if (!est.laneId?.trim() || est.minutes < 0) continue;

    await StageEstimate.updateMany(
      { issue: issueId, laneId: est.laneId, state: 'pending' },
      { $set: { state: 'rejected', rejectNote: 'Superseded by new submission' } }
    );

    const doc = await StageEstimate.create({
      issue: issueId,
      project: ctx.projectId,
      laneId: est.laneId.trim(),
      statusId: est.statusId,
      assigneeId: est.assigneeId || issue.assignee,
      minutes: est.minutes,
      state: 'pending',
      submittedBy: userId,
    });
    created.push(doc.toObject());

    const evalResult = await evaluateForIssueAction(ctx.projectId, {
      issue: issue as Record<string, unknown>,
      action: 'estimate.submit',
      userId,
      memberPermissions: ctx.permissions,
      payload: { hasPendingEstimate: true },
    });
    if (!evalResult.allowed) {
      // notifications still sent; approval workflow continues
    }
    await notifyApprovers(ctx.projectId, issueId, String(issue.key ?? issueId), est.laneId);
    await issueHistoryService.recordFieldChanges(issueId, userId, [
      { field: 'stageEstimate', fromValue: null, toValue: `${est.laneId}: ${est.minutes}m (pending)` },
    ]);
  }

  return listForIssue(issueId);
}

async function notifyApprovers(projectId: string, issueId: string, issueKey: string, laneId: string): Promise<void> {
  try {
    const members = await ProjectMember.find({ project: projectId }).select('user permissions').lean();
    const approverIds = members
      .filter((m) => (m.permissions as string[] | undefined)?.includes(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE))
      .map((m) => String(m.user));

    if (approverIds.length === 0) return;

    const { notifyUser, appUrl } = await import('../notifications/notificationDispatch.service');
    for (const toUserId of approverIds) {
      notifyUser({
        userId: toUserId,
        eventKey: 'approval_requested',
        title: `Estimate approval: ${issueKey}`,
        body: `Lane "${laneId}" estimate submitted for approval`,
        link: appUrl(`/issues/${issueId}`),
        metadata: { issueId, projectId, laneId },
      }).catch(() => {});
    }
  } catch {
    /* optional */
  }
}

export async function approveStageEstimate(
  estimateId: string,
  issueId: string,
  userId: string,
  note?: string,
  force = false,
  userGlobalPermissions?: string[],
  activeOrganizationId?: string
): Promise<unknown> {
  const ctx = await getIssueActionContext(issueId, userId, userGlobalPermissions, activeOrganizationId);
  assertIssuePermission(ctx, PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE);

  const est = await StageEstimate.findOne({ _id: estimateId, issue: issueId });
  if (!est) throw new ApiError(404, 'Estimate not found');
  if (est.state !== 'pending') throw new ApiError(400, 'Estimate is not pending');

  if (!force && String(est.submittedBy) === userId) {
    throw new ApiError(403, 'You cannot approve your own estimate');
  }

  est.state = 'approved';
  est.reviewedBy = new mongoose.Types.ObjectId(userId);
  est.reviewedAt = new Date();
  if (force && note) est.forceApproveNote = note;
  await est.save();

  const issue = await Issue.findById(issueId).select('key').lean();
  await issueHistoryService.recordFieldChanges(issueId, userId, [
    { field: 'stageEstimate', fromValue: 'pending', toValue: `approved:${est.laneId}:${est.minutes}m` },
  ]);

  try {
    const { notifyUser, appUrl } = await import('../notifications/notificationDispatch.service');
    notifyUser({
      userId: String(est.submittedBy),
      eventKey: 'approval_decided',
      title: `Estimate approved: ${issue?.key ?? issueId}`,
      body: `Lane "${est.laneId}" approved (${est.minutes}m)`,
      link: appUrl(`/issues/${issueId}`),
      metadata: { issueId, laneId: est.laneId, decision: 'approved' },
    }).catch(() => {});
  } catch {
    /* optional */
  }

  return est.toObject();
}

export async function rejectStageEstimate(
  estimateId: string,
  issueId: string,
  userId: string,
  rejectNote: string,
  userGlobalPermissions?: string[],
  activeOrganizationId?: string
): Promise<unknown> {
  const ctx = await getIssueActionContext(issueId, userId, userGlobalPermissions, activeOrganizationId);
  assertIssuePermission(ctx, PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE);

  const est = await StageEstimate.findOne({ _id: estimateId, issue: issueId });
  if (!est) throw new ApiError(404, 'Estimate not found');
  if (est.state !== 'pending') throw new ApiError(400, 'Estimate is not pending');
  if (!rejectNote?.trim()) throw new ApiError(400, 'Reject note is required');

  est.state = 'rejected';
  est.reviewedBy = new mongoose.Types.ObjectId(userId);
  est.reviewedAt = new Date();
  est.rejectNote = rejectNote.trim();
  await est.save();

  await issueHistoryService.recordFieldChanges(issueId, userId, [
    { field: 'stageEstimate', fromValue: 'pending', toValue: `rejected:${est.laneId}` },
  ]);

  return est.toObject();
}

export async function getEstimateSummary(issueId: string): Promise<unknown> {
  const issue = await Issue.findById(issueId).select('project parent').lean();
  if (!issue) throw new ApiError(404, 'Issue not found');

  const own = await StageEstimate.find({ issue: issueId }).lean();
  const rollup = await rollupStageEstimatesForIssue(issueId);

  const byLane: Record<string, { pending: number; approved: number; rejected: number; entries: unknown[] }> = {};
  for (const e of own) {
    const lane = e.laneId;
    if (!byLane[lane]) byLane[lane] = { pending: 0, approved: 0, rejected: 0, entries: [] };
    byLane[lane].entries.push(e);
    if (e.state === 'pending') byLane[lane].pending += e.minutes;
    if (e.state === 'approved') byLane[lane].approved += e.minutes;
    if (e.state === 'rejected') byLane[lane].rejected += e.minutes;
  }

  return {
    issueId,
    byLane,
    rollup,
    hasPending: own.some((e) => e.state === 'pending'),
  };
}

export async function getLaneApprovalState(
  issueId: string,
  laneId: string
): Promise<{ pending: boolean; approved: boolean; approvedMinutes: number }> {
  const approved = await StageEstimate.findOne({ issue: issueId, laneId, state: 'approved' })
    .sort({ reviewedAt: -1 })
    .lean();
  const pending = await StageEstimate.exists({ issue: issueId, laneId, state: 'pending' });
  return {
    pending: !!pending,
    approved: !!approved,
    approvedMinutes: approved?.minutes ?? 0,
  };
}

export async function getIssueRulePayload(
  issueId: string,
  project: Record<string, unknown>,
  laneId?: string
): Promise<Record<string, unknown>> {
  const pendingAny = await StageEstimate.exists({ issue: issueId, state: 'pending' });
  let lanePending = false;
  let laneApproved = true;
  let approvedMinutes = 0;

  if (laneId) {
    const state = await getLaneApprovalState(issueId, laneId);
    lanePending = state.pending && !state.approved;
    laneApproved = state.approved;
    approvedMinutes = state.approvedMinutes;
  } else {
    lanePending = !!pendingAny;
    laneApproved = !(await StageEstimate.exists({ issue: issueId, state: 'pending' }));
  }

  return {
    hasPendingEstimate: !!pendingAny,
    lanePending,
    laneApproved,
    approvedMinutes,
  };
}

export async function getLoggedMinutesForLane(issueId: string, laneId: string): Promise<number> {
  const logs = await WorkLog.find({ issue: issueId, laneId }).select('minutesSpent').lean();
  return logs.reduce((sum, l) => sum + (l.minutesSpent ?? 0), 0);
}

export async function listPendingApprovalsForProject(
  projectId: string,
  userId: string,
  userGlobalPermissions?: string[],
  activeOrganizationId?: string
): Promise<unknown[]> {
  const { getProjectPermissionsForUser, hasProjectFullAccess } = await import(
    '../../middleware/requireProjectPermission'
  );
  const perms = await getProjectPermissionsForUser(
    projectId,
    userId,
    userGlobalPermissions,
    activeOrganizationId
  );
  const canApprove =
    perms.includes(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE) ||
    (userGlobalPermissions && hasProjectFullAccess(userGlobalPermissions));
  if (!canApprove) return [];

  return StageEstimate.find({ project: projectId, state: 'pending' })
    .populate('issue', 'key title status')
    .populate('submittedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
}

export async function assertIssueUpdateAllowedByRules(
  issueId: string,
  projectId: string,
  oldIssue: Record<string, unknown>,
  newIssue: Record<string, unknown>,
  userId: string,
  memberPermissions: string[]
): Promise<void> {
  const project = await Project.findById(projectId).lean();
  if (!project) return;

  const laneCtx = buildWorkLaneContext(project as Record<string, unknown>, newIssue, oldIssue);
  const targetLane = laneCtx.targetLaneId as string | undefined;
  const rulePayload = await getIssueRulePayload(issueId, project as Record<string, unknown>, targetLane);

  const result = await evaluateForIssueAction(projectId, {
    issue: newIssue,
    oldIssue,
    action: laneCtx.enteringWorkLane ? 'issue.enter_work_lane' : 'issue.update',
    userId,
    memberPermissions,
    payload: { ...rulePayload, ...laneCtx },
  });

  if (!result.allowed) {
    throw new ApiError(403, result.violations[0]?.message ?? 'Action blocked by project rules', {
      ruleViolations: result.violations,
    });
  }
}
