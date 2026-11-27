import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { usersValidation } from './users.validation';

import * as usersService from './users.service';
import { ApiError } from '../../utils/ApiError';
import { grantActorOf } from '../auth/grantGuard';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

export async function getUsers(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const result = await usersService.findAll({ page, limit }, req.activeOrganizationId);
  res.status(200).json({ success: true, data: result });
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await usersService.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  res.status(200).json({ success: true, data: user });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const actor = grantActorOf(req);
  const hasEditPermission = userHasPermission(actor.permissions, TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE);
  const user = await usersService.update(req.params.id, req.body, actor, hasEditPermission);
  if (!user) throw new ApiError(404, 'User not found');
  res.status(200).json({ success: true, data: user });
}

export async function inviteUser(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const result = await usersService.invite(req.body, req.activeOrganizationId, grantActorOf(req));
  res.status(result.status).json({ success: true, inviteKind: result.inviteKind, data: result.user, role: result.role, employee: result.employee });
}

export async function updatePermissionOverrides(req: Request, res: Response): Promise<void> {
  const { granted, revoked } = req.body as { granted: string[]; revoked: string[] };
  const user = await usersService.updatePermissionOverrides(req.params.id, { granted, revoked }, grantActorOf(req));
  if (!user) throw new ApiError(404, 'User not found');
  res.status(200).json({ success: true, data: user });
}

export async function resetTwoFactor(req: Request, res: Response): Promise<void> {
  await usersService.resetTwoFactor(req.params.id, grantActorOf(req));
  res.json({ success: true, data: { reset: true } });
}

export const updatePermissionOverridesHandler = [
  validate(usersValidation.updatePermissionOverrides.shape.params, 'params'),
  validate(usersValidation.updatePermissionOverrides.shape.body, 'body'),
  asyncHandler(updatePermissionOverrides),
];

export const updateUserHandler = [
  validate(usersValidation.updateUser.shape.params, 'params'),
  validate(usersValidation.updateUser.shape.body, 'body'),
  asyncHandler(updateUser),
];

export const inviteUserHandler = [
  validate(usersValidation.inviteUser.shape.body, 'body'),
  asyncHandler(inviteUser),
];

export const userIdParamHandler = [
  validate(usersValidation.userIdParam.shape.params, 'params'),
];
