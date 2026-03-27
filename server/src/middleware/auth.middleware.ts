import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { User } from '../modules/auth/user.model';
import type { AuthPayload } from '../types/express';
import { resolveEffectiveGlobalPermissions } from '../modules/auth/effectivePermissions';

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) {
    next(new ApiError(401, 'Authentication required'));
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { sub: string };
    const user = await User.findById(decoded.sub).populate('roleId', 'permissions').lean();
    if (!user) {
      next(new ApiError(401, 'User not found'));
      return;
    }
    const u = user as { enabled?: boolean };
    if (u.enabled === false) {
      next(new ApiError(401, 'Account is disabled'));
      return;
    }
    const role = user.roleId as { _id?: { toString(): string }; permissions?: string[] } | null | undefined;
    const permissions = resolveEffectiveGlobalPermissions({
      rolePermissions: role?.permissions,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
    });
    const roleIdStr =
      user.roleId && typeof user.roleId === 'object' && '_id' in user.roleId
        ? (user.roleId as { _id: { toString(): string } })._id.toString()
        : user.roleId
          ? String(user.roleId)
          : undefined;
    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      roleId: roleIdStr,
      permissions,
      mustChangePassword: user.mustChangePassword ?? false,
    };
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}
