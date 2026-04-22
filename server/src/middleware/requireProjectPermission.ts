import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { ProjectMember } from '../modules/projects/projectMember.model';
import { ProjectDesignation } from '../modules/projects/projectDesignation.model';
import { Role } from '../modules/roles/role.model';
import { ALL_PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from '../shared/constants/permissions';
import {
  LEGACY_COLON_TO_DOT,
  LEGACY_CUSTOMER_COLON_TO_DOT,
  mapLegacyProjectOrGlobalPermissions,
} from '../shared/constants/legacyPermissionMap';

export type ProjectIdSource = { param?: string; query?: string };

const DEFAULT_PROJECT_ID_SOURCES = [
  { param: 'projectId' },
  { param: 'id' },
  { query: 'project' },
];

const PROJECT_FULL_ACCESS = [
  TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE,
  TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.READ,
  TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.UPDATE,
  TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.DELETE,
];

/** Returns true if the user's global permissions grant full override over all project-scoped checks.
 *  Triggers when:
 *   - user holds a wildcard like "project.*"
 *   - user holds all 4 explicit project CRUD perms (new dot-notation roles)
 *   - user holds project.project.create (legacy roles only mapped projects:create,
 *     never projects:read/update/delete, so the 4-CRUD check would always fail for them) */
export function hasProjectFullAccess(userPerms: string[]): boolean {
  if (userPerms.some((p) => p.endsWith('.*') && 'project.project.create'.startsWith(p.slice(0, -1)))) return true;
  if (PROJECT_FULL_ACCESS.every((p) => userPerms.includes(p))) return true;
  // Legacy role fallback: projects:create → project.project.create is the sole indicator of global project admin
  if (userPerms.includes(TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE)) return true;
  return false;
}

function normalizePermission(p: string): string {
  return LEGACY_COLON_TO_DOT[p] ?? LEGACY_CUSTOMER_COLON_TO_DOT[p] ?? p;
}

export function requireProjectPermission(
  permission: string,
  projectIdSource?: ProjectIdSource
) {
  const sources = projectIdSource ? [projectIdSource] : DEFAULT_PROJECT_ID_SOURCES;
  const required = normalizePermission(permission);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'));
      return;
    }

    const authUser = req.user as any;
    const userPerms = authUser.permissions ?? [];
    if (hasProjectFullAccess(userPerms)) {
      next();
      return;
    }

    let projectId: string | undefined;
    for (const src of sources) {
      if (src.param && req.params[src.param]) {
        projectId = req.params[src.param];
        break;
      }
      if (src.query && req.query[src.query]) {
        projectId = String(req.query[src.query]);
        break;
      }
    }

    if (!projectId) {
      next(new ApiError(400, 'Project context required'));
      return;
    }

    const userObjectId = mongoose.Types.ObjectId.isValid(authUser.id)
      ? new mongoose.Types.ObjectId(authUser.id)
      : authUser.id;
    const member = await ProjectMember.findOne({ project: projectId, user: userObjectId }).lean();

    if (!member) {
      next(new ApiError(403, 'You are not a member of this project'));
      return;
    }



    let permissions: string[] = Array.isArray(member.permissions) ? [...member.permissions] : [];
    if (permissions.length === 0 && member.role) {
      const role = await Role.findById(member.role).select('permissions').lean();
      permissions = mapLegacyProjectOrGlobalPermissions(role?.permissions ?? []);
    } else {
      permissions = mapLegacyProjectOrGlobalPermissions(permissions);
    }

    if (!permissions.includes(required)) {
      next(new ApiError(403, 'Insufficient permissions for this project'));
      return;
    }

    (req as Request & { projectPermissions?: string[] }).projectPermissions = permissions;
    next();
  };
}

export async function getProjectPermissionsForUser(
  projectId: string,
  userId: string,
  userPermissions?: string[],
): Promise<string[]> {
  // Global override: full project CRUD or wildcard permission grants all project-scoped permissions
  if (userPermissions && hasProjectFullAccess(userPermissions)) {
    return [...ALL_PROJECT_PERMISSIONS] as string[];
  }

  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const member = await ProjectMember.findOne({ project: projectId, user: userObjectId }).lean();
  if (!member) return [];



  let permissions: string[] = Array.isArray(member.permissions) ? [...member.permissions] : [];
  if (permissions.length === 0 && member.role) {
    const role = await Role.findById(member.role).select('permissions').lean();
    permissions = mapLegacyProjectOrGlobalPermissions(role?.permissions ?? []);
  } else {
    permissions = mapLegacyProjectOrGlobalPermissions(permissions);
  }
  return permissions;
}
