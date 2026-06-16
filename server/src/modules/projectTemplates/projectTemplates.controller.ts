import { Request, Response, NextFunction } from 'express';
import * as projectTemplatesService from './projectTemplates.service';
import { ApiError } from '../../utils/ApiError';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectTemplatesValidation } from './projectTemplates.validation';

export async function listTemplates(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const list = await projectTemplatesService.list(req.activeOrganizationId);
  res.status(200).json({ success: true, data: list });
}

export async function listLibraryTemplates(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const list = await projectTemplatesService.listLibrary(req.activeOrganizationId);
  res.status(200).json({ success: true, data: list });
}

export async function listTemplateVersions(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const result = await projectTemplatesService.listVersions(req.params.id, req.activeOrganizationId);
  if (result === 'forbidden') throw new ApiError(400, 'Built-in template has no versions');
  if (result === 'not_found') throw new ApiError(404, 'Template not found');
  res.status(200).json({ success: true, data: result });
}

export async function restoreTemplateVersion(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  const result = await projectTemplatesService.restoreVersion(
    req.params.id,
    req.body.version,
    req.activeOrganizationId,
    userId
  );
  if (result === 'forbidden') throw new ApiError(400, 'Cannot restore built-in template');
  if (result === 'not_found') throw new ApiError(404, 'Template not found');
  if (result === 'version_not_found') throw new ApiError(404, 'Version not found');
  res.status(200).json({ success: true, data: result });
}

export async function getTemplate(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const template = await projectTemplatesService.getById(req.params.id, req.activeOrganizationId);
  if (!template) {
    res.status(404).json({ success: false, message: 'Template not found' });
    return;
  }
  res.status(200).json({ success: true, data: template });
}

export async function deleteTemplate(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const result = await projectTemplatesService.removeById(req.params.id, req.activeOrganizationId);
  if (result === 'forbidden') throw new ApiError(400, 'Cannot delete the built-in default template');
  if (result === 'not_found') throw new ApiError(404, 'Template not found');
  res.status(200).json({ success: true, data: { message: 'Template deleted' } });
}

export async function patchTemplate(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  const result = await projectTemplatesService.updateById(
    req.params.id,
    req.activeOrganizationId,
    req.body,
    userId
  );
  if (result === 'forbidden') throw new ApiError(400, 'Cannot edit the built-in default template');
  if (result === 'not_found') throw new ApiError(404, 'Template not found');
  if (result === 'noop') throw new ApiError(400, 'No changes provided');
  res.status(200).json({ success: true, data: result });
}

export const patchTemplateHandler = [
  validate(projectTemplatesValidation.patch.shape.params, 'params'),
  validate(projectTemplatesValidation.patch.shape.body, 'body'),
  asyncHandler(patchTemplate as Parameters<typeof asyncHandler>[0]),
];

export const restoreTemplateHandler = [
  validate(projectTemplatesValidation.restore.shape.params, 'params'),
  validate(projectTemplatesValidation.restore.shape.body, 'body'),
  asyncHandler(restoreTemplateVersion as Parameters<typeof asyncHandler>[0]),
];
