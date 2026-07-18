import { Router } from 'express';
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

export const documentsRoutes = router;
