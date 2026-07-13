import { Request, Response } from 'express';
import type { AuthPayload } from '../../../types/express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { validate } from '../../../middleware/validate';
import { ApiError } from '../../../utils/ApiError';
import {
  saveAdoIntegrationSchema,
  testAdoIntegrationSchema,
  projectIdParamSchema,
} from './adoIntegration.validation';
import {
  getIntegrationResponse,
  saveIntegration,
  testAdoConnection,
  getIntegrationForProject,
} from './adoSync.service';
import { runAdoPullSyncForProject } from './adoAutoSync.scheduler';
import { decryptSecret } from '../../../utils/secretCrypto';

export async function getAdoIntegration(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const data = await getIntegrationResponse(projectId);
  res.status(200).json({ success: true, data });
}

export async function putAdoIntegration(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const body = req.body as {
    enabled: boolean;
    org: string;
    adoProject: string;
    pat?: string;
    statusMap?: Record<string, string>;
    typeMap?: Record<string, string>;
    defaultWorkItemType?: string;
    autoSyncEnabled?: boolean;
    autoSyncIntervalMinutes?: number;
  };

  await saveIntegration(projectId, body);
  const data = await getIntegrationResponse(projectId);
  res.status(200).json({ success: true, data });
}

export async function postTestAdoIntegration(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const body = req.body as { org: string; adoProject: string; pat?: string };

  let pat = body.pat?.trim();
  if (!pat || pat === 'use-stored') {
    const integration = await getIntegrationForProject(projectId);
    if (!integration?.patEncrypted) throw new ApiError(400, 'PAT is required');
    pat = decryptSecret(integration.patEncrypted);
  }

  const result = await testAdoConnection({ org: body.org, adoProject: body.adoProject, pat });
  res.status(200).json({ success: true, data: result });
}

export async function postRunAdoSync(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const projectId = req.params.id;
  const integration = await getIntegrationForProject(projectId);
  if (!integration?.enabled || !integration.patEncrypted) {
    throw new ApiError(400, 'Azure DevOps sync is not configured for this project');
  }
  const result = await runAdoPullSyncForProject(projectId, { syncAllHistory: true });
  res.status(200).json({ success: true, data: result });
}

export const getAdoIntegrationHandler = [
  validate(projectIdParamSchema.shape.params, 'params'),
  asyncHandler(getAdoIntegration),
];

export const putAdoIntegrationHandler = [
  validate(projectIdParamSchema.shape.params, 'params'),
  validate(saveAdoIntegrationSchema.shape.body, 'body'),
  asyncHandler(putAdoIntegration),
];

export const postTestAdoIntegrationHandler = [
  validate(projectIdParamSchema.shape.params, 'params'),
  validate(testAdoIntegrationSchema.shape.body, 'body'),
  asyncHandler(postTestAdoIntegration),
];

export const postRunAdoSyncHandler = [
  validate(projectIdParamSchema.shape.params, 'params'),
  asyncHandler(postRunAdoSync),
];
