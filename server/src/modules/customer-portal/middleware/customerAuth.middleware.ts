import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../../../utils/ApiError';
import { env } from '../../../config/env';
import { CustomerUser } from '../customer-user/customerUser.model';
import { mapLegacyCustomerPermissions } from '../../../shared/constants/legacyPermissionMap';
import { ALL_CUSTOMER_PERMISSIONS } from '../../../shared/constants/permissions';
import {
  assertAccessTokenClaims,
  type JwtAuthClaims,
} from '../../../middleware/assertAccessToken';

export async function customerAuthMiddleware(
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
    const decoded = jwt.verify(token, env.jwtSecret) as JwtAuthClaims;
    try {
      assertAccessTokenClaims(decoded);
    } catch (err) {
      next(err instanceof ApiError ? err : new ApiError(401, 'Invalid token'));
      return;
    }

    if (decoded.userType !== 'customer') {
      next(new ApiError(403, 'Forbidden'));
      return;
    }

    const customerUser = await CustomerUser.findById(decoded.sub)
      .populate('roleId', 'permissions')
      .lean();

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

    let effective: string[];
    if (customerUser.isOrgAdmin) {
      // Org admins always receive the full customer permission set
      effective = [...ALL_CUSTOMER_PERMISSIONS];
    } else {
      const overrides = customerUser.permissionOverrides;
      effective = [...rolePermissions];
      for (const g of overrides?.granted ?? []) {
        if (!effective.includes(g)) effective.push(g);
      }
      effective = effective.filter((p) => !(overrides?.revoked ?? []).includes(p));
    }

    req.customerUser = {
      id: customerUser._id.toString(),
      email: customerUser.email,
      name: customerUser.name,
      orgId: customerUser.customerOrgId.toString(),
      isOrgAdmin: customerUser.isOrgAdmin,
      permissions: effective,
      mustChangePassword: customerUser.mustChangePassword,
    };

    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}
