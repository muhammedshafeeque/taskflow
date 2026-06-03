import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as timelineService from './timeline.service';

export async function getProjectTimeline(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await timelineService.getProjectTimeline(req.params.id, userId);
  res.status(200).json({ success: true, data });
}

export async function snapshotProjectBaseline(
  req: Request & { user?: AuthPayload },
  res: Response
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await timelineService.snapshotProjectBaseline(req.params.id, userId);
  res.status(200).json({ success: true, data });
}

export async function getPortfolioTimeline(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const data = await timelineService.getPortfolioTimeline(userId, req.activeOrganizationId);
  res.status(200).json({ success: true, data });
}
