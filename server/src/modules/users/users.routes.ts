import { Router, type Request, type Response } from 'express';
import { listAccountRequests, cancelAccountRequest } from '../hrms/accountLink';
import { requireWorkspaceId } from '../crm/crmWorkspace';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import {
  getUsers,
  getUserById,
  updateUserHandler,
  updatePermissionOverridesHandler,
  inviteUserHandler,
  resetTwoFactor,
  userIdParamHandler,
} from './users.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router();

router.use(authMiddleware);
router.use(requireTaskflowUser);

router.get('/', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.LIST), asyncHandler(getUsers));
// New hires waiting for an account (AUT-35): hiring asked, someone who adds users creates it.
router.get(
  '/account-requests',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE),
  asyncHandler(async (req: Request & { activeOrganizationId?: string }, res: Response) => {
    res.json({ success: true, data: await listAccountRequests(requireWorkspaceId(req.activeOrganizationId)) });
  })
);
router.post(
  '/account-requests/:employeeId/cancel',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE),
  asyncHandler(async (req: Request & { activeOrganizationId?: string; user?: { id: string } }, res: Response) => {
    res.json({ success: true, data: await cancelAccountRequest(requireWorkspaceId(req.activeOrganizationId), req.params.employeeId, req.user!.id) });
  })
);
router.get('/:id', ...userIdParamHandler, requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.READ), asyncHandler(getUserById));
router.post('/invite', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.CREATE), ...inviteUserHandler);
router.patch('/:id', requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE), updateUserHandler);
router.post(
  '/:id/reset-two-factor',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE),
  asyncHandler(resetTwoFactor)
);
router.patch(
  '/:id/permissions',
  requirePermission(TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE),
  ...updatePermissionOverridesHandler
);

export const usersRoutes = router;
