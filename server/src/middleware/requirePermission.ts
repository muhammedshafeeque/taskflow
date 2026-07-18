import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { userHasPermission } from '../shared/constants/legacyPermissionMap';

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
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
  };
}

export function requireAnyPermission(permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
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
  };
}
