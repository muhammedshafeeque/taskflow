import { Router, Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { GraphAccess } from '../links/links.service';
import { getEmployee360 } from './employee360.service';

/**
 * /api/employee-360/:id (or /me) — one person's work, capacity, time, leave and pay.
 * HR employee read, or being that person; each section checks its own permission.
 */
async function get(req: Request, res: Response) {
  if (!req.user?.id) throw new ApiError(401, 'Unauthorized');
  const access = GraphAccess.for(req.activeOrganizationId, { userId: req.user.id, permissions: req.user.permissions ?? [] });
  res.json({ success: true, data: await getEmployee360(access, req.params.id) });
}

const router = Router();
router.use(authMiddleware, requireTaskflowUser);
router.get('/:id', asyncHandler(get));

export const employee360Routes = router;
