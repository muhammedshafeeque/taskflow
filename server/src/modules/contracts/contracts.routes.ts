import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './contracts.controller';

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CONTRACTS;
const CRM = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.CONTRACT;

const readAny = [
  C.DASHBOARD.READ,
  C.MSA.LIST,
  C.MSA.READ,
  C.RETAINER.LIST,
  C.RENEWAL.READ,
  C.SLA.READ,
  CRM.LIST,
  CRM.READ,
];

const manageAny = [
  C.MSA.MANAGE,
  C.RETAINER.MANAGE,
  C.RENEWAL.MANAGE,
  CRM.CREATE,
  CRM.UPDATE,
];

const deleteAny = [C.MSA.MANAGE, C.RETAINER.MANAGE, CRM.DELETE];

const slaReadAny = [C.SLA.READ, C.SLA.MANAGE, CRM.LIST, CRM.READ];
const slaManageAny = [C.SLA.MANAGE, CRM.UPDATE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));

router.get('/sla/policies', requireAnyPermission(slaReadAny), asyncHandler(ctrl.listSla));
router.post('/sla/policies', requireAnyPermission(slaManageAny), asyncHandler(ctrl.createSla));
router.patch('/sla/policies/:id', requireAnyPermission(slaManageAny), asyncHandler(ctrl.updateSla));

router.get('/', requireAnyPermission(readAny), asyncHandler(ctrl.list));
router.post('/', requireAnyPermission(manageAny), asyncHandler(ctrl.create));
router.get('/:id/burn-down', requireAnyPermission(readAny), asyncHandler(ctrl.burnDown));
router.patch('/:id', requireAnyPermission(manageAny), asyncHandler(ctrl.update));
router.delete('/:id', requireAnyPermission(deleteAny), asyncHandler(ctrl.remove));

export const contractsRoutes = router;
