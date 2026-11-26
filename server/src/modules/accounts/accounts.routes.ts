import { ledgerRouter } from '../ledger/ledger.routes';
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './accounts.controller';

const A = TASK_FLOW_PERMISSIONS.TASKFLOW.ACCOUNTS;

const readAny = [
  A.DASHBOARD.READ,
  A.LEDGER.READ,
  A.INVOICE.LIST,
  A.EXPENSE.LIST,
  A.REPORT.READ,
];
const ledgerRead = [A.LEDGER.READ, A.LEDGER.MANAGE, A.DASHBOARD.READ, A.REPORT.READ];
const invoiceList = [A.INVOICE.LIST, A.INVOICE.READ, A.DASHBOARD.READ, A.LEDGER.READ];
const invoiceManage = [A.INVOICE.UPDATE, A.LEDGER.MANAGE];
const expenseList = [A.EXPENSE.LIST, A.EXPENSE.READ, A.EXPENSE.APPROVE, A.DASHBOARD.READ];
const expenseCreate = [A.EXPENSE.CREATE, A.EXPENSE.UPDATE];
const expenseManage = [A.EXPENSE.UPDATE];
/** Who may call the status endpoint; the service then checks each move (approve needs EXPENSE.APPROVE). */
const expenseTransition = [A.EXPENSE.CREATE, A.EXPENSE.UPDATE, A.EXPENSE.APPROVE];
/** Approval limits are an accounts-admin setting, like the rest of Accounts settings. */
const expenseSettingsManage = [A.CHART.MANAGE];

const router = Router();
router.use(authMiddleware);
router.use('/books', ledgerRouter);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));
router.get('/ledger', requireAnyPermission(ledgerRead), asyncHandler(ctrl.getLedger));

router.get('/invoices', requireAnyPermission(invoiceList), asyncHandler(ctrl.listInvoices));
router.patch('/invoices/:id/post', requireAnyPermission(invoiceManage), asyncHandler(ctrl.postInvoice));

router.get('/expenses/approval-settings', requireAnyPermission([...expenseList, ...expenseCreate]), asyncHandler(ctrl.getExpenseApprovalSettings));
router.put('/expenses/approval-settings', requireAnyPermission(expenseSettingsManage), asyncHandler(ctrl.updateExpenseApprovalSettings));
router.get('/expenses/approvers', requireAnyPermission(expenseSettingsManage), asyncHandler(ctrl.listExpenseApprovers));
router.get('/expenses', requireAnyPermission(expenseList), asyncHandler(ctrl.listExpenses));
router.post('/expenses', requireAnyPermission(expenseCreate), asyncHandler(ctrl.createExpense));
router.patch('/expenses/:id', requireAnyPermission(expenseManage), asyncHandler(ctrl.updateExpense));
router.patch('/expenses/:id/status', requireAnyPermission(expenseTransition), asyncHandler(ctrl.transitionExpense));
router.delete('/expenses/:id', requireAnyPermission(expenseManage), asyncHandler(ctrl.deleteExpense));

export const accountsRoutes = router;
