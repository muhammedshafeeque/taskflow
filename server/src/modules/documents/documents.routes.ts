import { Router, type Request, type Response } from 'express';
import * as signing from './documentSigning.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './documents.controller';

const D = TASK_FLOW_PERMISSIONS.TASKFLOW.DOCUMENTS;

const readAny = [
  D.DASHBOARD.READ,
  D.PROPOSAL.LIST,
  D.SOW.LIST,
  D.POLICY.LIST,
  D.TEMPLATE.LIST,
];
const anyList = [D.PROPOSAL.LIST, D.SOW.LIST, D.POLICY.LIST, D.TEMPLATE.LIST, D.DASHBOARD.READ];
const anyManage = [D.PROPOSAL.MANAGE, D.SOW.MANAGE, D.POLICY.MANAGE, D.TEMPLATE.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));
router.get('/documents', requireAnyPermission(anyList), asyncHandler(ctrl.listDocuments));
router.post('/documents', requireAnyPermission(anyManage), asyncHandler(ctrl.createDocument));
router.patch('/documents/:id', requireAnyPermission(anyManage), asyncHandler(ctrl.updateDocument));
router.post('/documents/:id/clone', requireAnyPermission(anyManage), asyncHandler(ctrl.cloneTemplate));
router.delete('/documents/:id', requireAnyPermission(anyManage), asyncHandler(ctrl.deleteDocument));

type WsReq = Request & { activeOrganizationId?: string; user?: { id: string; name?: string } };
router.get('/documents/:id/versions', requireAnyPermission(anyList), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await signing.listVersions(req.activeOrganizationId, req.params.id) });
}));
router.post('/documents/:id/versions/:version/restore', requireAnyPermission(anyManage), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await signing.restoreVersion(req.activeOrganizationId, req.params.id, Number(req.params.version), req.user?.id) });
}));
router.get('/documents/:id/signatures', requireAnyPermission(anyList), asyncHandler(async (req: WsReq, res: Response) => {
  res.json({ success: true, data: await signing.listSignatureRequests(req.activeOrganizationId, req.params.id) });
}));
router.post('/documents/:id/signatures', requireAnyPermission(anyManage), asyncHandler(async (req: WsReq, res: Response) => {
  const data = await signing.requestSignatures(req.activeOrganizationId, req.params.id, req.body ?? {}, { id: req.user!.id, name: req.user?.name });
  res.status(201).json({ success: true, data });
}));

export const documentsRoutes = router;
