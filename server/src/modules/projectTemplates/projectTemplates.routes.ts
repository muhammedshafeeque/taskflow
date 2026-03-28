import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import * as projectTemplatesController from './projectTemplates.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { projectsValidation } from '../projects/projects.validation';

const router = Router();

router.use(authMiddleware);
router.get('/', asyncHandler(projectTemplatesController.listTemplates as Parameters<typeof asyncHandler>[0]));
router.delete(
  '/:id',
  requirePermission('projects:create'),
  validate(projectsValidation.idParam.shape.params, 'params'),
  asyncHandler(projectTemplatesController.deleteTemplate as Parameters<typeof asyncHandler>[0])
);
router.patch(
  '/:id',
  requirePermission('projects:create'),
  ...projectTemplatesController.patchTemplateHandler
);
router.get('/:id', asyncHandler(projectTemplatesController.getTemplate as Parameters<typeof asyncHandler>[0]));

export const projectTemplatesRoutes = router;
