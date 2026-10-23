import { Request } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';

/**
 * PA ingest endpoints sit behind `requirePaInternalService` (internal key +
 * owner/system actor). This re-check keeps a controller safe even if it is
 * ever mounted without the guard.
 */
export function assertPaIngestSecret(req: Request): void {
  const ctx = req.paContext;
  if (!ctx || (ctx.actor !== 'owner' && ctx.actor !== 'system')) {
    throw new ApiError(401, 'PA internal authentication required');
  }
}

/** Workspace resolved by internal auth (x-organization-id, else the PA workspace). */
export async function resolvePaOrganizationId(req: Request, _body?: Record<string, unknown>): Promise<string> {
  const organizationId = req.paContext?.organizationId;
  if (!organizationId) throw new ApiError(401, 'PA internal authentication required');
  return organizationId;
}

/** PA service account id — the actor recorded on records PA creates. */
export function paActorUserId(req: Request): string {
  const id = req.paContext?.serviceAccountId;
  if (!id) throw new ApiError(401, 'PA internal authentication required');
  return id;
}

/** Ensure a project belongs to the ingest organization (cross-tenant guard). */
export async function assertProjectInOrganization(
  projectId: string,
  organizationId: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, 'Invalid projectId');
  }
  const ok = await Project.exists({
    _id: projectId,
    taskflowOrganizationId: organizationId,
  });
  if (!ok) {
    throw new ApiError(404, 'Project not found');
  }
}
