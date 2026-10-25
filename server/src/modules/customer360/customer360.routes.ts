import { Router, Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { GraphAccess } from '../links/links.service';
import { getCustomer360 } from './customer360.service';

/**
 * /api/customer-360/:id — one page of everything about a portal customer.
 * Needs customer-org view access; each section also checks its own record type.
 */
async function get(req: Request, res: Response) {
  if (!req.user?.id) throw new ApiError(401, 'Unauthorized');
  const access = GraphAccess.for(req.activeOrganizationId, { userId: req.user.id, permissions: req.user.permissions ?? [] });
  res.json({ success: true, data: await getCustomer360(access, req.params.id) });
}

const router = Router();
router.use(authMiddleware, requireTaskflowUser);
router.get('/:id', asyncHandler(get));

export const customer360Routes = router;
