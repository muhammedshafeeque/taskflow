import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { grantActorOf } from '../auth/grantGuard';
import * as rules from './accessRules.service';
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
// Team and level rules: before '/:id', which would read "access-rules" as a role id.
router.get('/access-rules', asyncHandler(async (req: Request, res: Response) => res.json({ success: true, data: await rules.listRules(req.activeOrganizationId) })));
router.post('/access-rules', asyncHandler(async (req: Request, res: Response) => res.status(201).json({ success: true, data: await rules.saveRule(req.activeOrganizationId, req.body ?? {}, grantActorOf(req)) })));
router.patch('/access-rules/:id', asyncHandler(async (req: Request, res: Response) => res.json({ success: true, data: await rules.saveRule(req.activeOrganizationId, req.body ?? {}, grantActorOf(req), req.params.id) })));
router.delete('/access-rules/:id', asyncHandler(async (req: Request, res: Response) => res.json({ success: true, data: await rules.deleteRule(req.activeOrganizationId, req.params.id, grantActorOf(req)) })));
router.post('/', createRoleHandler);
router.get('/:id', ...getRoleByIdParamHandler, getRoleByIdHandler);
router.patch('/:id', ...updateRoleHandler);
router.delete('/:id', ...deleteRoleHandler);

export const rolesRoutes = router;
