import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { handleAdoWebhook } from '../modules/integrations/ado/adoSync.service';

export async function azureDevOpsWebhook(req: Request, res: Response): Promise<void> {
  const projectId = req.params.projectId;
  const secret = String(req.query.secret ?? '');
  const payload = (req.body ?? {}) as Record<string, unknown>;

  const result = await handleAdoWebhook(projectId, secret, payload);
  res.status(200).json({ success: true, data: result });
}

export const azureDevOpsWebhookHandler = asyncHandler(azureDevOpsWebhook);
