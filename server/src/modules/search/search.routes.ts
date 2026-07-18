import { Router, Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { globalSearch } from './search.service';

async function search(req: Request & { user?: AuthPayload; activeOrganizationId?: string }, res: Response) {
  if (!req.user?.id) throw new ApiError(401, 'Unauthorized');
  const q = String(req.query.q ?? '');
  const data = await globalSearch(req.activeOrganizationId, q);
  res.json({ success: true, data });
}

const router = Router();
router.use(authMiddleware);
router.get('/', asyncHandler(search));

export const searchRoutes = router;
