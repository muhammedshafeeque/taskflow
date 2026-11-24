import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import {
  getRolesHandler,
  getRoleTemplatesHandler,
  getRoleByIdHandler,
  createRoleHandler,
  updateRoleHandler,
  deleteRoleHandler,
  getRoleByIdParamHandler,
  getPermissionsHandler,
} from './roles.controller';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.get('/permissions', getPermissionsHandler);

router.use(authMiddleware);
router.use(requireTaskflowUser);
router.use(requirePermission(TASK_FLOW_PERMISSIONS.AUTH.ROLE.MANAGE_ALL));

router.get('/', getRolesHandler);
router.get('/templates', getRoleTemplatesHandler);
router.post('/', createRoleHandler);
router.get('/:id', ...getRoleByIdParamHandler, getRoleByIdHandler);
router.patch('/:id', ...updateRoleHandler);
router.delete('/:id', ...deleteRoleHandler);

export const rolesRoutes = router;
