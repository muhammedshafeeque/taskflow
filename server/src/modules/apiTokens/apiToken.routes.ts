import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { createToken, listTokens, revokeToken } from './apiToken.service';

type AuthedRequest = Request & { user?: { id: string; userType?: string }; activeOrganizationId?: string; viaApiToken?: boolean };

/** Token management needs a real login session — an API token can't mint or revoke tokens. */
function requireInteractiveStaff(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.viaApiToken) return next(new ApiError(403, 'Use a signed-in session to manage API tokens'));
  if (req.user?.userType === 'customer') return next(new ApiError(403, 'Not available for portal users'));
  next();
}

const router = Router();
router.use(authMiddleware, requireInteractiveStaff);

router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ success: true, data: await listTokens(req.user!.id) });
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const data = await createToken(req.user!.id, req.activeOrganizationId, req.body ?? {});
    res.status(201).json({ success: true, data });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    await revokeToken(req.user!.id, req.params.id);
    res.json({ success: true, data: { ok: true } });
  })
);

export const apiTokenRoutes = router;
