import { Router, Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireTaskflowUser } from '../../middleware/requireTaskflowUser';
import { asyncHandler } from '../../utils/asyncHandler';
import { isRecordType } from './recordTypes';
import * as links from './links.service';

/**
 * /api/links — the record graph. No route-level permission: each record is
 * checked against the viewer's own module, permission and project access.
 */
function access(req: Request): links.GraphAccess {
  if (!req.user?.id) throw new ApiError(401, 'Unauthorized');
  return links.GraphAccess.for(req.activeOrganizationId, {
    userId: req.user.id,
    permissions: req.user.permissions ?? [],
  });
}

function typeParam(raw: unknown) {
  if (!isRecordType(raw)) throw new ApiError(400, 'Unknown record type');
  return raw;
}

async function types(req: Request, res: Response) {
  res.json({ success: true, data: { types: await links.visibleTypes(access(req)) } });
}

async function search(req: Request, res: Response) {
  const records = await links.searchRecords(access(req), typeParam(req.query.type), String(req.query.q ?? ''));
  res.json({ success: true, data: { records } });
}

async function graph(req: Request, res: Response) {
  const data = await links.getGraph(access(req), { type: typeParam(req.params.type), id: req.params.id });
  res.json({ success: true, data });
}

async function create(req: Request, res: Response) {
  const edge = await links.createLink(access(req), req.body ?? {});
  res.status(201).json({ success: true, data: { edge } });
}

async function remove(req: Request, res: Response) {
  await links.deleteLink(access(req), req.params.linkId);
  res.json({ success: true });
}

const router = Router();
router.use(authMiddleware, requireTaskflowUser);
router.get('/types', asyncHandler(types));
router.get('/search', asyncHandler(search));
router.post('/', asyncHandler(create));
router.delete('/:linkId', asyncHandler(remove));
router.get('/:type/:id', asyncHandler(graph));

export const linksRoutes = router;
