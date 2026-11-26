import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  acknowledgeUpdates,
  acknowledgeUpdatesSchema,
  getUnseenUpdates,
  listAllUpdates,
} from './updates.controller';

const router = Router();

router.use(authMiddleware, requireTaskflowUser);

router.get('/unseen', asyncHandler(getUnseenUpdates));
router.get('/', asyncHandler(listAllUpdates));
router.post('/acknowledge', validate(acknowledgeUpdatesSchema), asyncHandler(acknowledgeUpdates));

export const updatesRoutes = router;
