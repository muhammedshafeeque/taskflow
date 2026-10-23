import crypto from 'crypto';
import { Request } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import { Organization } from '../organizations/organization.model';

export function timingSafeSecretEqual(provided: string, configured: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function assertPaIngestSecret(req: Request): void {
  const configured = String(process.env.PA_INGEST_SECRET ?? '').trim();
  if (!configured) {
    throw new ApiError(503, 'PA ingest is not configured (PA_INGEST_SECRET)');
  }
  const provided = String(req.headers['x-pa-ingest-secret'] ?? '').trim();
  if (!provided || !timingSafeSecretEqual(provided, configured)) {
    throw new ApiError(401, 'Invalid ingest secret');
  }
}

export async function resolvePaOrganizationId(
  req: Request,
  body?: Record<string, unknown>
): Promise<string> {
  const organizationId = String(
    body?.organizationId ??
      req.headers['x-organization-id'] ??
      process.env.PA_DEFAULT_ORG_ID ??
      ''
  ).trim();
  if (!organizationId) {
    throw new ApiError(400, 'organizationId is required');
  }
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    throw new ApiError(400, 'Invalid organizationId');
  }
  const exists = await Organization.exists({ _id: organizationId, status: { $ne: 'archived' } });
  if (!exists) {
    throw new ApiError(404, 'Organization not found');
  }
  return organizationId;
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
