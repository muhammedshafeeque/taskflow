import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { authMiddleware } from '../../middleware/auth.middleware';
import { logAudit } from '../auditLogs/logAudit';
import * as analyticsService from '../analytics/analytics.service';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  setPasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  microsoftSsoSchema,
  microsoftSsoAuthorizeUrlQuerySchema,
  ideAuthStartSchema,
  ideAuthApproveSchema,
  ideAuthExchangeSchema,
} from './auth.validation';
import * as authService from './auth.service';
import { resolveEffectiveGlobalPermissions } from './effectivePermissions';
import { Role } from '../roles/role.model';
import { User } from './user.model';

export async function register(_req: import('express').Request, _res: Response): Promise<void> {
  if (!authService.isEmailPasswordAuthEnabled()) {
    throw new ApiError(403, 'Email/password authentication is disabled. Use single sign-on.');
  }
  if (!authService.isPublicSignupEnabled()) {
    throw new ApiError(403, 'Registration is disabled. Contact an administrator to get an account.');
  }
  const result = await authService.register(_req.body);
  _res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response): Promise<void> {
  if (!authService.isEmailPasswordAuthEnabled()) {
    throw new ApiError(403, 'Email/password authentication is disabled. Use single sign-on.');
  }
  const result = await authService.login(req.body);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress;
  const userId = (result.user as { id?: string }).id ?? '';
  logAudit({
    userId,
    action: 'login',
    resourceType: 'auth',
    meta: { email: req.body.email },
    ip,
  });
  analyticsService.logEvent(userId, 'login', 'auth').catch(() => {});
  res.status(200).json({ success: true, data: result });
}

export async function refresh(req: import('express').Request, res: Response): Promise<void> {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data: result });
}

export async function me(req: import('express').Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (req.customerUser) {
    const data = await authService.customerMe(userId);
    res.status(200).json({ success: true, data: { user: { ...data, userType: 'customer' } } });
    return;
  }
  const user = await authService.me(userId);
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const session = await authService.attachTaskflowOrganizations(userId, accessToken);
  res.status(200).json({
    success: true,
    data: { user: { ...user, userType: 'taskflow', ...session } },
  });
}

export async function debugPermissions(req: import('express').Request, res: Response): Promise<void> {
  const requester = req.user;
  if (!requester) throw new ApiError(401, 'Unauthorized');
  if (requester.role !== 'admin') {
    throw new ApiError(403, 'Only admin can debug permissions');
  }

  const targetUserId = req.params.id;
  if (!targetUserId) throw new ApiError(400, 'User ID is required');

  const target = await User.findById(targetUserId).lean();
  if (!target) throw new ApiError(404, 'User not found');

  let rolePermissions: string[] | null = null;
  let roleName: string | undefined;
  if (target.roleId) {
    const role = await Role.findById(target.roleId).select('permissions name').lean();
    rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
    roleName = role?.name;
  }

  const effectivePermissions = resolveEffectiveGlobalPermissions({
    rolePermissions,
    role: target.role,
    mustChangePassword: target.mustChangePassword ?? false,
  });

  res.status(200).json({
    success: true,
    data: {
      userId: target._id.toString(),
      role: target.role,
      roleId: target.roleId ? String(target.roleId) : null,
      roleName: roleName ?? null,
      mustChangePassword: target.mustChangePassword ?? false,
      effectivePermissions,
      rolePermissions,
    },
  });
}

export async function changePassword(req: import('express').Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { currentPassword, newPassword } = req.body;
  const user = await authService.changePassword(userId, currentPassword, newPassword);
  res.status(200).json({ success: true, data: { user } });
}

export async function setPassword(req: import('express').Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { newPassword } = req.body;
  const user = await authService.setPassword(userId, newPassword);
  res.status(200).json({ success: true, data: { user } });
}

export async function updateProfile(req: import('express').Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { name, avatarUrl } = req.body;
  const user = await authService.updateProfile(userId, { name, avatarUrl });
  res.status(200).json({ success: true, data: { user } });
}

export async function forgotPassword(req: import('express').Request, res: Response): Promise<void> {
  await authService.forgotPassword(req.body.email);
  res.status(200).json({ success: true, data: { message: 'If an account exists, you will receive an email.' } });
}

export async function resetPassword(req: import('express').Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body;
  const user = await authService.resetPassword(token, newPassword);
  res.status(200).json({ success: true, data: { user } });
}

export async function microsoftSso(req: Request, res: Response): Promise<void> {
  const result = await authService.microsoftSso(req.body);
  const u = result.user as { id?: string; email?: string };
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress;
  logAudit({
    userId: u.id ?? '',
    action: 'login_sso_microsoft',
    resourceType: 'auth',
    meta: { email: u.email ?? '' },
    ip,
  });
  analyticsService.logEvent(u.id ?? '', 'login_sso_microsoft', 'auth').catch(() => {});
  res.status(200).json({ success: true, data: result });
}

export async function microsoftSsoAuthorizeUrl(req: Request, res: Response): Promise<void> {
  const redirectUri = (req.query as { redirectUri?: string }).redirectUri;
  const result = await authService.microsoftSsoAuthorizeUrl({ redirectUri });
  res.status(200).json({ success: true, data: result });
}

export async function publicConfig(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    success: true,
    data: authService.getPublicAuthConfig(),
  });
}

export async function ideAuthStart(req: Request, res: Response): Promise<void> {
  const result = authService.ideAuthStart(req.body);
  res.status(200).json({ success: true, data: result });
}

export async function ideAuthApprove(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (req.customerUser) {
    throw new ApiError(403, 'IDE login is only available for Atrium workspace users');
  }
  const result = authService.ideAuthApprove(req.body.sid, userId);
  res.status(200).json({ success: true, data: result });
}

export async function ideAuthExchange(req: Request, res: Response): Promise<void> {
  const result = await authService.ideAuthExchange(req.body);
  const u = result.user as { id?: string; email?: string };
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress;
  logAudit({
    userId: u.id ?? '',
    action: 'login_ide',
    resourceType: 'auth',
    meta: { email: u.email ?? '' },
    ip,
  });
  analyticsService.logEvent(u.id ?? '', 'login_ide', 'auth').catch(() => {});
  res.status(200).json({ success: true, data: result });
}

export const registerHandler = [
  validate(registerSchema.shape.body, 'body'),
  asyncHandler(register),
];

export const loginHandler = [
  validate(loginSchema.shape.body, 'body'),
  asyncHandler(login),
];

export const refreshHandler = [
  validate(refreshSchema.shape.body, 'body'),
  asyncHandler(refresh),
];

export const meHandler = [
  authMiddleware,
  asyncHandler(me),
];

export const debugPermissionsHandler = [
  authMiddleware,
  asyncHandler(debugPermissions),
];

export const changePasswordHandler = [
  authMiddleware,
  validate(changePasswordSchema.shape.body, 'body'),
  asyncHandler(changePassword),
];

export const setPasswordHandler = [
  authMiddleware,
  validate(setPasswordSchema.shape.body, 'body'),
  asyncHandler(setPassword),
];

export const updateProfileHandler = [
  authMiddleware,
  validate(updateProfileSchema.shape.body, 'body'),
  asyncHandler(updateProfile),
];

export const forgotPasswordHandler = [
  validate(forgotPasswordSchema.shape.body, 'body'),
  asyncHandler(forgotPassword),
];

export const resetPasswordHandler = [
  validate(resetPasswordSchema.shape.body, 'body'),
  asyncHandler(resetPassword),
];

export const microsoftSsoHandler = [
  validate(microsoftSsoSchema.shape.body, 'body'),
  asyncHandler(microsoftSso),
];

export const microsoftSsoAuthorizeUrlHandler = [
  validate(microsoftSsoAuthorizeUrlQuerySchema.shape.query, 'query'),
  asyncHandler(microsoftSsoAuthorizeUrl),
];

export const publicConfigHandler = [
  asyncHandler(publicConfig),
];

export const ideAuthStartHandler = [
  validate(ideAuthStartSchema.shape.body, 'body'),
  asyncHandler(ideAuthStart),
];

export const ideAuthApproveHandler = [
  authMiddleware,
  validate(ideAuthApproveSchema.shape.body, 'body'),
  asyncHandler(ideAuthApprove),
];

export const ideAuthExchangeHandler = [
  validate(ideAuthExchangeSchema.shape.body, 'body'),
  asyncHandler(ideAuthExchange),
];
