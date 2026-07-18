import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './billing.controller';

const B = TASK_FLOW_PERMISSIONS.TASKFLOW.BILLING;

const readAny = [
  B.DASHBOARD.READ,
  B.SUBSCRIPTION.LIST,
  B.INVOICE.LIST,
  B.TIME_TO_INVOICE.READ,
  B.TAX.READ,
];

const subManage = [B.SUBSCRIPTION.MANAGE];
const invManage = [B.INVOICE.CREATE, B.INVOICE.MANAGE];
const invList = [B.INVOICE.LIST, B.INVOICE.CREATE, B.INVOICE.MANAGE, B.DASHBOARD.READ];
const ttiRead = [B.TIME_TO_INVOICE.READ, B.TIME_TO_INVOICE.MANAGE, B.DASHBOARD.READ];
const ttiManage = [B.TIME_TO_INVOICE.MANAGE, B.INVOICE.CREATE, B.INVOICE.MANAGE];
const taxRead = [B.TAX.READ, B.TAX.MANAGE, B.DASHBOARD.READ, B.INVOICE.LIST];
const taxManage = [B.TAX.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));

router.get('/subscriptions', requireAnyPermission([B.SUBSCRIPTION.LIST, B.SUBSCRIPTION.MANAGE, B.DASHBOARD.READ]), asyncHandler(ctrl.listSubscriptions));
router.post('/subscriptions', requireAnyPermission(subManage), asyncHandler(ctrl.createSubscription));
router.patch('/subscriptions/:id', requireAnyPermission(subManage), asyncHandler(ctrl.updateSubscription));
router.delete('/subscriptions/:id', requireAnyPermission(subManage), asyncHandler(ctrl.deleteSubscription));
router.post('/subscriptions/:id/invoice', requireAnyPermission([...subManage, ...invManage]), asyncHandler(ctrl.generateSubscriptionInvoice));

router.get('/invoices', requireAnyPermission(invList), asyncHandler(ctrl.listInvoices));
router.post('/invoices', requireAnyPermission(invManage), asyncHandler(ctrl.createInvoice));
router.patch('/invoices/:id', requireAnyPermission([B.INVOICE.MANAGE]), asyncHandler(ctrl.updateInvoice));
router.post('/invoices/:id/pay', requireAnyPermission([B.INVOICE.MANAGE]), asyncHandler(ctrl.recordPayment));
router.delete('/invoices/:id', requireAnyPermission([B.INVOICE.MANAGE]), asyncHandler(ctrl.deleteInvoice));

router.get('/tax', requireAnyPermission(taxRead), asyncHandler(ctrl.listTax));
router.post('/tax', requireAnyPermission(taxManage), asyncHandler(ctrl.createTax));
router.patch('/tax/:id', requireAnyPermission(taxManage), asyncHandler(ctrl.updateTax));
router.delete('/tax/:id', requireAnyPermission(taxManage), asyncHandler(ctrl.deleteTax));

router.get('/time-to-invoice', requireAnyPermission(ttiRead), asyncHandler(ctrl.getTimeToInvoice));
router.post('/time-to-invoice', requireAnyPermission(ttiManage), asyncHandler(ctrl.createFromTime));

export const billingRoutes = router;
