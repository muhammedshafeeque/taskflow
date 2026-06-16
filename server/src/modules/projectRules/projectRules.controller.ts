import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { z } from 'zod';
import * as projectRulesService from './projectRules.service';
import { evaluateForIssueAction } from './projectRules.service';
import type { RuleActionType } from './projectRules.evaluator';
import { getProjectPermissionsForUser } from '../../middleware/requireProjectPermission';

type AuthReq = Request & { user?: { id: string; permissions?: string[] }; activeOrganizationId?: string };

const dryRunSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    issue: z.record(z.unknown()),
    action: z.string().min(1),
    payload: z.record(z.unknown()).optional(),
    oldIssue: z.record(z.unknown()).optional(),
  }),
});

export async function dryRunProjectRules(req: AuthReq, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const activeOrg = req.activeOrganizationId;
  if (!activeOrg) throw new ApiError(400, 'Active workspace is required');

  const body = req.body as {
    issue: Record<string, unknown>;
    action: string;
    payload?: Record<string, unknown>;
    oldIssue?: Record<string, unknown>;
  };
  const perms = await getProjectPermissionsForUser(
    req.params.id,
    userId,
    req.user?.permissions,
    activeOrg
  );
  const result = await evaluateForIssueAction(req.params.id, {
    issue: body.issue,
    oldIssue: body.oldIssue,
    action: body.action as RuleActionType,
    userId,
    memberPermissions: perms,
    payload: body.payload,
    dryRun: true,
  });
  res.status(200).json({ success: true, data: result });
}

export const dryRunHandler = [
  validate(dryRunSchema.shape.params, 'params'),
  validate(dryRunSchema.shape.body, 'body'),
  asyncHandler(dryRunProjectRules),
];

export async function enableEstimateApproval(req: AuthReq, res: Response): Promise<void> {
  const activeOrg = req.activeOrganizationId;
  if (!activeOrg) throw new ApiError(400, 'Active workspace is required');
  const data = await projectRulesService.enableEstimateApprovalPack(req.params.id, activeOrg);
  res.status(200).json({ success: true, data });
}
