import { Project } from '../projects/project.model';
import { ApiError } from '../../utils/ApiError';
import type { IProjectRule } from '../projects/project.model';
import { getDefaultEstimateApprovalRules } from './projectRules.defaultPack';
import {
  evaluateProjectRules,
  type RuleActionType,
  type RuleEvaluationContext,
  type RuleEvaluationResult,
} from './projectRules.evaluator';

export function isProjectRulesGloballyEnabled(): boolean {
  return process.env.PROJECT_RULES_ENABLED !== 'false';
}

export async function loadProjectForRules(projectId: string): Promise<Record<string, unknown> | null> {
  const p = await Project.findById(projectId).lean();
  return p as Record<string, unknown> | null;
}

export async function evaluateForIssueAction(
  projectId: string,
  ctx: Omit<RuleEvaluationContext, 'project'>
): Promise<RuleEvaluationResult> {
  if (!isProjectRulesGloballyEnabled()) {
    return { allowed: true, violations: [], logOnly: [], requiredFields: [], notifyEvents: [] };
  }
  const project = await loadProjectForRules(projectId);
  if (!project) throw new ApiError(404, 'Project not found');
  return evaluateProjectRules({ ...ctx, project });
}

export async function dryRunRules(
  projectId: string,
  input: {
    issue: Record<string, unknown>;
    action: RuleActionType;
    userId: string;
    memberPermissions: string[];
    payload?: Record<string, unknown>;
    oldIssue?: Record<string, unknown>;
  }
): Promise<RuleEvaluationResult> {
  return evaluateForIssueAction(projectId, { ...input, dryRun: true });
}

export async function enableEstimateApprovalPack(
  projectId: string,
  activeTaskflowOrganizationId: string
): Promise<unknown> {
  const project = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  });
  if (!project) throw new ApiError(404, 'Project not found');

  const existing = (project.projectRules ?? []) as IProjectRule[];
  const hasPack = existing.some((r) => r.name.includes('estimate') || r.name.includes('Estimate'));
  const rules = hasPack ? existing : [...existing, ...getDefaultEstimateApprovalRules()];

  project.estimateApprovalEnabled = true;
  project.projectRules = rules;
  if (!project.rulesEnforcementMode) project.rulesEnforcementMode = 'enforce';
  await project.save();
  return project.toObject();
}

export async function updateProjectRules(
  projectId: string,
  activeTaskflowOrganizationId: string,
  input: {
    projectRules?: IProjectRule[];
    estimateApprovalEnabled?: boolean;
    rulesEnforcementMode?: 'log' | 'enforce';
  }
): Promise<unknown> {
  const project = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  });
  if (!project) throw new ApiError(404, 'Project not found');

  if (input.projectRules !== undefined) project.projectRules = input.projectRules;
  if (input.estimateApprovalEnabled !== undefined) {
    project.estimateApprovalEnabled = input.estimateApprovalEnabled;
    if (input.estimateApprovalEnabled && (project.projectRules?.length ?? 0) === 0) {
      project.projectRules = getDefaultEstimateApprovalRules();
    }
  }
  if (input.rulesEnforcementMode !== undefined) project.rulesEnforcementMode = input.rulesEnforcementMode;
  await project.save();
  return project.toObject();
}
