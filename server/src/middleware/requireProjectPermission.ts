import { Request, Response, NextFunction } from 'express';
import { resolveProjectRef } from '../modules/issues/issueKey';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { Project } from '../modules/projects/project.model';
import { ProjectMember } from '../modules/projects/projectMember.model';
import { ProjectDesignation } from '../modules/projects/projectDesignation.model';
import { Role } from '../modules/roles/role.model';
import { ALL_PROJECT_PERMISSIONS, TASK_FLOW_PERMISSIONS } from '../shared/constants/permissions';
import {
  LEGACY_COLON_TO_DOT,
  LEGACY_CUSTOMER_COLON_TO_DOT,
  mapLegacyProjectOrGlobalPermissions,
  userHasPermission,
} from '../shared/constants/legacyPermissionMap';

export type ProjectIdSource = { param?: string; query?: string; body?: string };

const DEFAULT_PROJECT_ID_SOURCES = [
  { param: 'projectId' },
  { param: 'id' },
  { query: 'project' },
  { body: 'project' },
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

const VIEW_PROJECT_PERMISSIONS: string[] = ALL_PROJECT_PERMISSIONS.filter((p) => /\.(read|list|view)$/.test(p));

/** "See all projects": reads any project of the workspace without being a member. Never edits. */
export function seesAllProjects(userPerms: string[]): boolean {
  return hasProjectFullAccess(userPerms) || userHasPermission(userPerms, TASK_FLOW_PERMISSIONS.TASKFLOW.PROJECT.LIST_ALL);
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

    let projectId: string | undefined;
    let from: ProjectIdSource | undefined;
    for (const src of sources) {
      if (src.param && req.params[src.param]) {
        projectId = req.params[src.param];
        from = src;
        break;
      }
      if (src.query && req.query[src.query]) {
        projectId = String(req.query[src.query]);
        from = src;
        break;
      }
      if (src.body && req.body && typeof req.body === 'object' && (req.body as Record<string, unknown>)[src.body]) {
        projectId = String((req.body as Record<string, unknown>)[src.body]);
        from = src;
        break;
      }
    }

    if (!projectId) {
      next(new ApiError(400, 'Project context required'));
      return;
    }

    // A project key (e.g. "PC") is accepted too, looked up in the active workspace only (AUT-66). The
    // resolved id is written back so the handler works with the id, never a key cast to an ObjectId.
    if (!/^[a-f0-9]{24}$/i.test(projectId)) {
      const activeWs = (req as Request & { activeOrganizationId?: string }).activeOrganizationId;
      const resolved = await resolveProjectRef(projectId, activeWs);
      if (!resolved) {
        next(new ApiError(404, 'Project not found'));
        return;
      }
      projectId = resolved;
      if (from?.param) req.params[from.param] = resolved;
      else if (from?.query) (req.query as Record<string, unknown>)[from.query] = resolved;
      else if (from?.body) (req.body as Record<string, unknown>)[from.body] = resolved;
    }

    const proj = await Project.findById(projectId).select('taskflowOrganizationId').lean();
    if (!proj) {
      next(new ApiError(404, 'Project not found'));
      return;
    }
    const projectTfOrg = (proj as { taskflowOrganizationId?: unknown }).taskflowOrganizationId;
    const projectOrgStr = projectTfOrg ? String(projectTfOrg) : '';
    const activeOrg = (req as Request & { activeOrganizationId?: string }).activeOrganizationId;
    if (!projectOrgStr) {
      next(new ApiError(403, 'Project is not linked to a workspace'));
      return;
    }
    if (!activeOrg || projectOrgStr !== activeOrg) {
      next(new ApiError(403, 'Project is not in the active workspace'));
      return;
    }

    if (hasProjectFullAccess(userPerms)) {
      next();
      return;
    }

    if (seesAllProjects(userPerms) && VIEW_PROJECT_PERMISSIONS.includes(required)) {
      next();
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

    if (!userHasPermission(permissions, required)) {
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
  activeOrganizationId?: string
): Promise<string[]> {
  const proj = await Project.findById(projectId).select('taskflowOrganizationId').lean();
  if (!proj) return [];
  const pOrg = (proj as { taskflowOrganizationId?: unknown }).taskflowOrganizationId;
  const projectOrgStr = pOrg ? String(pOrg) : '';
  if (!projectOrgStr || (activeOrganizationId && projectOrgStr !== activeOrganizationId)) {
    return [];
  }

  // Global override: full project CRUD or wildcard permission grants all project-scoped permissions
  if (userPermissions && hasProjectFullAccess(userPermissions)) {
    return [...ALL_PROJECT_PERMISSIONS] as string[];
  }

  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const member = await ProjectMember.findOne({ project: projectId, user: userObjectId }).lean();
  const viewAll = userPermissions && seesAllProjects(userPermissions) ? VIEW_PROJECT_PERMISSIONS : [];
  if (!member) return [...viewAll];



  let permissions: string[] = Array.isArray(member.permissions) ? [...member.permissions] : [];
  if (permissions.length === 0 && member.role) {
    const role = await Role.findById(member.role).select('permissions').lean();
    permissions = mapLegacyProjectOrGlobalPermissions(role?.permissions ?? []);
  } else {
    permissions = mapLegacyProjectOrGlobalPermissions(permissions);
  }
  return [...new Set([...permissions, ...viewAll])];
}

/**
 * Project-scoped permission check for records that belong to a project (sprints, boards…): `resolveProjectId`
 * finds the record's project (null when the record doesn't exist → 404). Pass several permissions to accept any.
 */
export function requireProjectPermissionVia(
  permission: string | string[],
  resolveProjectId: (req: Request) => Promise<string | null | undefined>,
  notFoundMessage = 'Not found'
) {
  const required = (Array.isArray(permission) ? permission : [permission]).map(normalizePermission);
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        next(new ApiError(401, 'Authentication required'));
        return;
      }
      const projectId = await resolveProjectId(req);
      if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
        next(new ApiError(404, notFoundMessage));
        return;
      }
      const authUser = req.user as { id: string; permissions?: string[] };
      const perms = await getProjectPermissionsForUser(projectId, authUser.id, authUser.permissions, req.activeOrganizationId);
      if (!perms.length) {
        next(new ApiError(403, 'You are not a member of this project'));
        return;
      }
      if (!required.some((p) => userHasPermission(perms, p))) {
        next(new ApiError(403, 'Insufficient permissions for this project'));
        return;
      }
      (req as Request & { projectPermissions?: string[]; resolvedProjectId?: string }).projectPermissions = perms;
      (req as Request & { resolvedProjectId?: string }).resolvedProjectId = projectId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Reads the project of a record by id (from a route param), for requireProjectPermissionVia. */
export function projectOfRecord(model: { findById: (id: string) => { select: (f: string) => { lean: () => Promise<unknown> } } }, param = 'id') {
  return async (req: Request): Promise<string | null> => {
    const id = req.params[param];
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = (await model.findById(id).select('project').lean()) as { project?: unknown } | null;
    return doc?.project ? String(doc.project) : null;
  };
}
