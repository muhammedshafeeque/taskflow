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
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  microsoftSsoSchema,
  microsoftSsoAuthorizeUrlQuerySchema,
} from './auth.validation';
import * as authService from './auth.service';

export async function register(_req: import('express').Request, _res: Response): Promise<void> {
  throw new ApiError(403, 'Registration is disabled. Contact an administrator to get an account.');
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress;
  logAudit({
    userId: result.user.id,
    action: 'login',
    resourceType: 'auth',
    meta: { email: req.body.email },
    ip,
  });
  analyticsService.logEvent(result.user.id, 'login', 'auth').catch(() => {});
  res.status(200).json({ success: true, data: result });
}

export async function refresh(req: import('express').Request, res: Response): Promise<void> {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json({ success: true, data: result });
}

export async function changePassword(req: import('express').Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { currentPassword, newPassword } = req.body;
  const user = await authService.changePassword(userId, currentPassword, newPassword);
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
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress;
  logAudit({
    userId: result.user.id,
    action: 'login_sso_microsoft',
    resourceType: 'auth',
    meta: { email: result.user.email },
    ip,
  });
  analyticsService.logEvent(result.user.id, 'login_sso_microsoft', 'auth').catch(() => {});
  res.status(200).json({ success: true, data: result });
}

export async function microsoftSsoAuthorizeUrl(req: Request, res: Response): Promise<void> {
  const redirectUri = (req.query as { redirectUri?: string }).redirectUri;
  const result = await authService.microsoftSsoAuthorizeUrl({ redirectUri });
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

export const changePasswordHandler = [
  authMiddleware,
  validate(changePasswordSchema.shape.body, 'body'),
  asyncHandler(changePassword),
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
