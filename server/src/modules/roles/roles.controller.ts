import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { rolesValidation } from './roles.validation';
import * as rolesService from './roles.service';
import { grantActorOf } from '../auth/grantGuard';
import { ApiError } from '../../utils/ApiError';
import { ACCESS_ROLE_TEMPLATES } from '../../shared/constants/accessRoleTemplates';
import { ALL_PERMISSIONS } from '../../constants/permissions';

export async function getRoles(_req: Request, res: Response): Promise<void> {
  const data = await rolesService.findAll();
  res.status(200).json({ success: true, data });
}

export async function getRoleById(req: Request, res: Response): Promise<void> {
  const role = await rolesService.findById(req.params.id);
  if (!role) throw new ApiError(404, 'Role not found');
  res.status(200).json({ success: true, data: role });
}

export async function createRole(req: Request, res: Response): Promise<void> {
  const data = await rolesService.create(req.body, grantActorOf(req));
  res.status(201).json({ success: true, data });
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const role = await rolesService.update(req.params.id, req.body, grantActorOf(req));
  if (!role) throw new ApiError(404, 'Role not found');
  res.status(200).json({ success: true, data: role });
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  const deleted = await rolesService.remove(req.params.id, grantActorOf(req));
  if (!deleted) throw new ApiError(404, 'Role not found');
  res.status(200).json({ success: true, data: { deleted: true } });
}

export async function getPermissions(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, data: ALL_PERMISSIONS });
}

export const getRoleTemplatesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: ACCESS_ROLE_TEMPLATES });
});
export const getRolesHandler = asyncHandler(getRoles);
export const getRoleByIdHandler = asyncHandler(getRoleById);
export const createRoleHandler = [
  validate(rolesValidation.createRole.shape.body, 'body'),
  asyncHandler(createRole),
];
export const updateRoleHandler = [
  validate(rolesValidation.updateRole.shape.params, 'params'),
  validate(rolesValidation.updateRole.shape.body, 'body'),
  asyncHandler(updateRole),
];
export const deleteRoleHandler = [
  validate(rolesValidation.roleIdParam.shape.params, 'params'),
  asyncHandler(deleteRole),
];
export const getRoleByIdParamHandler = [validate(rolesValidation.roleIdParam.shape.params, 'params')];
export const getPermissionsHandler = asyncHandler(getPermissions);
