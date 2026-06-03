import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireProjectPermission } from '../../middleware/requireProjectPermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { startImport, getImportJob } from './imports.controller';
import { startImportSchema, importJobParamsSchema } from './imports.validation';

const router = Router({ mergeParams: true });

router.post(
  '/',
  requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE),
  validate(startImportSchema.shape.body, 'body'),
  asyncHandler(startImport)
);

router.get(
  '/:jobId',
  requireProjectPermission(PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE),
  validate(importJobParamsSchema.shape.params, 'params'),
  asyncHandler(getImportJob)
);

export const importsRoutes = router;
