import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import {
  createOrganizationBody,
  organizationIdParam,
  inviteTfOrgMemberBody,
  updateTfOrgMemberBody,
  updateOrganizationBody,
} from './organizations.validation';
import * as controller from './organizations.controller';
import { z } from 'zod';

const router = Router();

router.use(authMiddleware, requireTaskflowUser);

const orgIdParams = validate(organizationIdParam, 'params');
const memberUserIdParams = validate(
  z.object({ id: z.string().min(1), userId: z.string().min(1) }),
  'params'
);

router.get('/', asyncHandler(controller.listOrganizations));
router.post('/', validate(createOrganizationBody, 'body'), asyncHandler(controller.createOrganization));
router.get('/:id', orgIdParams, asyncHandler(controller.getOrganization));
router.patch(
  '/:id',
  orgIdParams,
  validate(updateOrganizationBody, 'body'),
  asyncHandler(controller.patchOrganization)
);
router.post('/:id/switch', orgIdParams, asyncHandler(controller.switchOrganization));
router.get('/:id/members', orgIdParams, asyncHandler(controller.listMembers));
router.post(
  '/:id/members',
  orgIdParams,
  validate(inviteTfOrgMemberBody, 'body'),
  asyncHandler(controller.inviteMember)
);
router.patch(
  '/:id/members/:userId',
  memberUserIdParams,
  validate(updateTfOrgMemberBody, 'body'),
  asyncHandler(controller.patchMember)
);
router.delete('/:id/members/:userId', memberUserIdParams, asyncHandler(controller.deleteMember));

export const organizationsRoutes = router;
