import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { User } from '../modules/auth/user.model';
import { CustomerUser } from '../modules/customer-portal/customer-user/customerUser.model';
import type { AuthPayload } from '../types/express';
import { resolveEffectiveGlobalPermissions } from '../modules/auth/effectivePermissions';
import { mergeTaskflowPermissionFloor } from '../modules/auth/permissionMerge';
import { mapLegacyCustomerPermissions } from '../shared/constants/legacyPermissionMap';

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
    const decoded = jwt.verify(token, env.jwtSecret) as { sub: string; userType?: string };

    if (decoded.userType === 'customer') {
      const customerUser = await CustomerUser.findById(decoded.sub).populate('roleId', 'permissions').lean();
      if (!customerUser) {
        next(new ApiError(401, 'User not found'));
        return;
      }
      if (customerUser.status !== 'active') {
        next(new ApiError(401, 'Account is not active'));
        return;
      }

      const role = customerUser.roleId as { _id?: unknown; permissions?: string[] } | null | undefined;
      const rolePermissions: string[] = mapLegacyCustomerPermissions(role?.permissions ?? []);
      const overrides = customerUser.permissionOverrides;
      let permissions = [...rolePermissions];
      for (const g of overrides?.granted ?? []) {
        if (!permissions.includes(g)) permissions.push(g);
      }
      permissions = permissions.filter((p) => !(overrides?.revoked ?? []).includes(p));

      // Notification/Inbox permissions are always granted to customer users in this unified middleware
      const defaultInboxPerms = [
        'inbox.inbox.read',
        'inbox.inbox.list',
        'inbox.notification.read',
        'inbox.notification.list',
        'inbox.notification.mark_read',
        'inbox.notification.mark_all_read',
      ];
      for (const p of defaultInboxPerms) {
        if (!permissions.includes(p)) permissions.push(p);
      }

      req.user = {
        id: customerUser._id.toString(),
        email: customerUser.email,
        name: customerUser.name,
        role: customerUser.isOrgAdmin ? 'admin' : 'user', // Mapping customer admin to 'admin' role string for generic checks
        permissions,
        mustChangePassword: customerUser.mustChangePassword,
      } as AuthPayload;

      // Also populate req.customerUser for customer-specific routes if needed
      req.customerUser = {
        id: customerUser._id.toString(),
        email: customerUser.email,
        name: customerUser.name,
        orgId: customerUser.customerOrgId.toString(),
        isOrgAdmin: customerUser.isOrgAdmin,
        permissions,
        mustChangePassword: customerUser.mustChangePassword,
      };

      next();
      return;
    }

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
    const overrides = (user as { permissionOverrides?: { granted?: string[]; revoked?: string[] } })
      .permissionOverrides;
    const permissions = mergeTaskflowPermissionFloor(
      resolveEffectiveGlobalPermissions({
        rolePermissions: role?.permissions,
        role: user.role,
        mustChangePassword: user.mustChangePassword ?? false,
        permissionOverrides: overrides,
      })
    );
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
    } as AuthPayload;
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}
