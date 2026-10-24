import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { userHasPermission } from '../shared/constants/legacyPermissionMap';

/** Read by the MCP API catalog to show each user only the endpoints their permissions allow. */
export type PermissionTag = { all?: string[]; any?: string[] };
export const PERMISSION_TAG = Symbol.for('atrium.requiredPermissions');

function tag<T extends object>(fn: T, value: PermissionTag): T {
  Object.defineProperty(fn, PERMISSION_TAG, { value });
  return fn;
}

export function requirePermission(...permissions: string[]) {
  return tag((req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'));
      return;
    }
    const userPerms = req.user.permissions ?? [];
    const ok = permissions.every((p) => userHasPermission(userPerms, p));
    if (!ok) {
      next(new ApiError(403, 'Insufficient permissions'));
      return;
    }
    next();
  }, { all: permissions });
}

export function requireAnyPermission(permissions: string[]) {
  return tag((req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'));
      return;
    }
    const userPerms = req.user.permissions ?? [];
    if (!permissions.some((p) => userHasPermission(userPerms, p))) {
      next(new ApiError(403, 'Insufficient permissions'));
      return;
    }
    next();
  }, { any: permissions });
}
