import { Request, Response, NextFunction } from 'express';
import { Issue } from '../modules/issues/issue.model';
import { ApiError } from '../utils/ApiError';
import { requireProjectPermission, getProjectPermissionsForUser, hasProjectFullAccess } from './requireProjectPermission';
import { LEGACY_COLON_TO_DOT, LEGACY_CUSTOMER_COLON_TO_DOT } from '../shared/constants/legacyPermissionMap';

function normalizePermission(p: string): string {
  return LEGACY_COLON_TO_DOT[p] ?? LEGACY_CUSTOMER_COLON_TO_DOT[p] ?? p;
}

/** Middleware: resolve issueId from params → project → check project-scoped permission. */
export function requireIssuePermission(permission: string, issueIdParam = 'id') {
  const required = normalizePermission(permission);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'));
      return;
    }
    const issueId = req.params[issueIdParam] ?? req.params.issueId;
    if (!issueId) {
      next(new ApiError(400, 'Issue id required'));
      return;
    }
    const issue = await Issue.findById(issueId).select('project').lean();
    if (!issue?.project) {
      next(new ApiError(404, 'Issue not found'));
      return;
    }
    const projectId = String(issue.project);
    req.params.projectId = projectId;
    (req as Request & { issueProjectId?: string }).issueProjectId = projectId;

    const authUser = req.user as { id: string; permissions?: string[] };
    if (authUser.permissions && hasProjectFullAccess(authUser.permissions)) {
      (req as Request & { projectPermissions?: string[] }).projectPermissions =
        await getProjectPermissionsForUser(projectId, authUser.id, authUser.permissions, req.activeOrganizationId);
      next();
      return;
    }

    const perms = await getProjectPermissionsForUser(
      projectId,
      authUser.id,
      authUser.permissions,
      req.activeOrganizationId
    );
    if (!perms.includes(required)) {
      next(new ApiError(403, 'Insufficient permissions for this project'));
      return;
    }
    (req as Request & { projectPermissions?: string[] }).projectPermissions = perms;
    next();
  };
}

/** For create issue — body.project is required. */
export function requireProjectPermissionFromBody(permission: string, bodyField = 'project') {
  return requireProjectPermission(permission, { param: bodyField });
}
