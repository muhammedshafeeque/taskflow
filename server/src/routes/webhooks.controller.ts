import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { handleAdoWebhook } from '../modules/integrations/ado/adoSync.service';

export async function azureDevOpsWebhook(req: Request, res: Response): Promise<void> {
  const projectId = req.params.projectId;
  const headerSecret = String(req.headers['x-ado-webhook-secret'] ?? '').trim();
  // Prefer header; query fallback only for legacy ADO hooks that cannot set headers.
  const querySecret = headerSecret
    ? ''
    : String(req.query.secret ?? '').trim();
  const secret = headerSecret || querySecret;
  const payload = (req.body ?? {}) as Record<string, unknown>;

  const result = await handleAdoWebhook(projectId, secret, payload);
  res.status(200).json({ success: true, data: result });
}

export const azureDevOpsWebhookHandler = asyncHandler(azureDevOpsWebhook);
