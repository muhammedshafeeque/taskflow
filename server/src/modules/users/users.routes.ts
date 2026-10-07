import { adminReset as adminResetTwoFactor } from '../auth/twoFactor.service';
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import {
  getUsers,
  getUserById,
  updateUserHandler,
  updatePermissionOverridesHandler,
  inviteUserHandler,
  userIdParamHandler,
} from './users.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);
router.use(requireTaskflowUser);

router.get('/', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.LIST), asyncHandler(getUsers));
router.get('/:id', ...userIdParamHandler, requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.READ), asyncHandler(getUserById));
router.post('/invite', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE), ...inviteUserHandler);
router.patch('/:id', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE), updateUserHandler);
router.post(
  '/:id/reset-two-factor',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE),
  asyncHandler(async (req, res) => {
    await adminResetTwoFactor(req.params.id);
    res.json({ success: true, data: { reset: true } });
  })
);
router.patch(
  '/:id/permissions',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE),
  ...updatePermissionOverridesHandler
);

export const usersRoutes = router;
