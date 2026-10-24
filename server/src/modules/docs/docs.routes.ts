import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './docs.controller';

/**
 * Knowledge spaces and pages. Access is decided per space (audience + member roles) in docs.access.ts;
 * the only global permissions are creating spaces and docs admin.
 */
const router = Router();

router.use(authMiddleware);

router.get('/me', asyncHandler(ctrl.getMe));
router.get('/overview', asyncHandler(ctrl.overview));
router.get('/search', asyncHandler(ctrl.search));
router.get('/links', asyncHandler(ctrl.links));
router.get('/options', asyncHandler(ctrl.options));
router.get('/lookup/issues', asyncHandler(ctrl.lookupIssues));

router.get('/spaces', asyncHandler(ctrl.listSpaces));
router.post('/spaces', asyncHandler(ctrl.createSpace));
router.get('/spaces/:key', asyncHandler(ctrl.getSpace));
router.patch('/spaces/:key', asyncHandler(ctrl.updateSpace));
router.delete('/spaces/:key', asyncHandler(ctrl.deleteSpace));
router.post('/spaces/:key/star', asyncHandler(ctrl.starSpace));
router.get('/spaces/:key/tree', asyncHandler(ctrl.spaceTree));
router.get('/spaces/:key/trash', asyncHandler(ctrl.spaceTrash));

router.post('/pages', asyncHandler(ctrl.createPage));
router.get('/pages/:id', asyncHandler(ctrl.getPage));
router.patch('/pages/:id', asyncHandler(ctrl.updatePage));
router.delete('/pages/:id', asyncHandler(ctrl.deletePage));
router.post('/pages/:id/restore', asyncHandler(ctrl.restorePage));
router.post('/pages/:id/move', asyncHandler(ctrl.movePage));
router.post('/pages/:id/star', asyncHandler(ctrl.starPage));
router.get('/pages/:id/versions', asyncHandler(ctrl.listVersions));
router.get('/pages/:id/versions/:version', asyncHandler(ctrl.getVersion));
router.post('/pages/:id/versions/:version/restore', asyncHandler(ctrl.restoreVersion));
router.get('/pages/:id/comments', asyncHandler(ctrl.listComments));
router.post('/pages/:id/comments', asyncHandler(ctrl.addComment));
router.patch('/pages/:id/comments/:commentId', asyncHandler(ctrl.updateComment));
router.delete('/pages/:id/comments/:commentId', asyncHandler(ctrl.deleteComment));

export const docsRoutes = router;
