import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import * as stageEstimateService from './stageEstimate.service';
import { stageEstimatesValidation } from './stageEstimate.validation';

type AuthReq = Request & { user?: { id: string; permissions?: string[] }; activeOrganizationId?: string };

export async function listStageEstimates(req: AuthReq, res: Response): Promise<void> {
  const data = await stageEstimateService.listForIssue(req.params.id);
  res.status(200).json({ success: true, data });
}

export async function getEstimateSummary(req: AuthReq, res: Response): Promise<void> {
  const data = await stageEstimateService.getEstimateSummary(req.params.id);
  res.status(200).json({ success: true, data });
}

export async function submitStageEstimates(req: AuthReq, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const body = req.body as { estimates: Array<{ laneId: string; minutes: number; statusId?: string; assigneeId?: string }> };
  const data = await stageEstimateService.submitStageEstimates(
    req.params.id,
    userId,
    body.estimates,
    req.user?.permissions,
    req.activeOrganizationId
  );
  res.status(200).json({ success: true, data });
}

export async function approveEstimate(req: AuthReq, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const body = (req.body ?? {}) as { note?: string; force?: boolean };
  const data = await stageEstimateService.approveStageEstimate(
    req.params.estimateId,
    req.params.id,
    userId,
    body.note,
    body.force,
    req.user?.permissions,
    req.activeOrganizationId
  );
  res.status(200).json({ success: true, data });
}

export async function rejectEstimate(req: AuthReq, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const body = req.body as { rejectNote: string };
  const data = await stageEstimateService.rejectStageEstimate(
    req.params.estimateId,
    req.params.id,
    userId,
    body.rejectNote,
    req.user?.permissions,
    req.activeOrganizationId
  );
  res.status(200).json({ success: true, data });
}

export const submitStageEstimatesHandler = [
  validate(stageEstimatesValidation.submit.shape.params, 'params'),
  validate(stageEstimatesValidation.submit.shape.body, 'body'),
  asyncHandler(submitStageEstimates),
];

export const approveEstimateHandler = [
  validate(stageEstimatesValidation.approve.shape.params, 'params'),
  validate(stageEstimatesValidation.approve.shape.body, 'body'),
  asyncHandler(approveEstimate),
];

export const rejectEstimateHandler = [
  validate(stageEstimatesValidation.reject.shape.params, 'params'),
  validate(stageEstimatesValidation.reject.shape.body, 'body'),
  asyncHandler(rejectEstimate),
];
