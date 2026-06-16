import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import * as projectTemplatesController from './projectTemplates.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectsValidation } from '../projects/projects.validation';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);
router.get('/', asyncHandler(projectTemplatesController.listTemplates as Parameters<typeof asyncHandler>[0]));
router.get(
  '/library',
  asyncHandler(projectTemplatesController.listLibraryTemplates as Parameters<typeof asyncHandler>[0])
);
router.delete(
  '/:id',
  requirePermission(TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE),
  validate(projectsValidation.idParam.shape.params, 'params'),
  asyncHandler(projectTemplatesController.deleteTemplate as Parameters<typeof asyncHandler>[0])
);
router.get(
  '/:id/versions',
  validate(projectsValidation.idParam.shape.params, 'params'),
  asyncHandler(projectTemplatesController.listTemplateVersions as Parameters<typeof asyncHandler>[0])
);
router.post(
  '/:id/restore',
  requirePermission(TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE),
  ...projectTemplatesController.restoreTemplateHandler
);
router.patch(
  '/:id',
  requirePermission(TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE),
  ...projectTemplatesController.patchTemplateHandler
);
router.get('/:id', asyncHandler(projectTemplatesController.getTemplate as Parameters<typeof asyncHandler>[0]));

export const projectTemplatesRoutes = router;
