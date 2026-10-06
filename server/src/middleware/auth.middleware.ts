import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';
import { User } from '../modules/auth/user.model';
import { CustomerUser } from '../modules/customer-portal/customer-user/customerUser.model';
import type { AuthPayload } from '../types/express';
import { resolveEffectiveGlobalPermissions } from '../modules/auth/effectivePermissions';
import { mergeTaskflowPermissionFloor } from '../modules/auth/permissionMerge';
import { mapLegacyCustomerPermissions } from '../shared/constants/legacyPermissionMap';
import { OrganizationMember } from '../modules/organizations/organizationMember.model';
import { API_TOKEN_PREFIX, resolveApiToken } from '../modules/apiTokens/apiToken.service';

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

  if (token.startsWith(API_TOKEN_PREFIX)) {
    try {
      const apiToken = await resolveApiToken(token);
      if (!apiToken) {
        next(new ApiError(401, 'Invalid, expired or revoked API token'));
        return;
      }
      (req as Request & { viaApiToken?: boolean }).viaApiToken = true;
      const err = await authenticateStaffUser(req, String(apiToken.userId), apiToken.organizationId ? String(apiToken.organizationId) : undefined);
      next(err ?? undefined);
    } catch {
      next(new ApiError(401, 'Invalid API token'));
    }
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as {
      sub: string;
      userType?: string;
      activeOrganizationId?: string;
    };

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
        // Never map customer org admins to platform 'admin'
        role: customerUser.isOrgAdmin ? 'customer_org_admin' : 'customer_user',
        userType: 'customer',
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

    const err = await authenticateStaffUser(req, decoded.sub, decoded.activeOrganizationId);
    next(err ?? undefined);
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

/** Load a staff user, resolve permissions and the active workspace onto `req`. Returns an error instead of throwing. */
async function authenticateStaffUser(req: Request, userId: string, tokenOrgId?: string): Promise<ApiError | null> {
    const user = await User.findById(userId).populate('roleId', 'permissions').lean();
    if (!user) {
      return new ApiError(401, 'User not found');
    }
    const u = user as { enabled?: boolean };
    if (u.enabled === false) {
      return new ApiError(401, 'Account is disabled');
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
      userType: 'taskflow',
    } as AuthPayload;

    const userOid = user._id;
    const headerOrg = (req.headers['x-organization-id'] as string | undefined)?.trim();
    let activeOrganizationId: string | undefined;

    if (headerOrg && mongoose.Types.ObjectId.isValid(headerOrg)) {
      const ok = await OrganizationMember.exists({
        organization: headerOrg,
        user: userOid,
        status: 'active',
      });
      if (ok) activeOrganizationId = headerOrg;
    }
    if (!activeOrganizationId && tokenOrgId && mongoose.Types.ObjectId.isValid(tokenOrgId)) {
      const ok = await OrganizationMember.exists({
        organization: tokenOrgId,
        user: userOid,
        status: 'active',
      });
      if (ok) activeOrganizationId = tokenOrgId;
    }
    if (!activeOrganizationId) {
      const m = await OrganizationMember.findOne({ user: userOid, status: 'active' })
        .sort({ createdAt: 1 })
        .select('organization')
        .lean();
      if (m?.organization) activeOrganizationId = String(m.organization);
    }
    req.activeOrganizationId = activeOrganizationId;
    return null;
}
