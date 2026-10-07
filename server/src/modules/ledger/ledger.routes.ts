import { Router, type Request, type Response } from 'express';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ledger from './ledger.service';
import * as payables from './payables.service';

const A = TASK_FLOW_PERMISSIONS.TASKFLOW.ACCOUNTS;
type R = Request & { activeOrganizationId?: string; user?: { id: string } };
const ws = (req: R) => req.activeOrganizationId;
const ok = (res: Response, data: unknown) => res.json({ success: true, data });

/** Bookkeeping: chart, journals, reports, payables, credit notes, banking. Mounted at /accounts/books. */
export const ledgerRouter = Router();
const r = ledgerRouter;

r.get('/settings', requireAnyPermission([A.CHART.MANAGE, A.JOURNAL.READ, A.EXPENSE.LIST, A.EXPENSE.CREATE, TASK_FLOW_PERMISSIONS.TASKFLOW.SELF.EXPENSE.CLAIM]), asyncHandler(async (req: R, res) => ok(res, await ledger.getAccountsSettings(ws(req)))));
r.put('/settings', requireAnyPermission([A.CHART.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.updateAccountsSettings(ws(req), req.body ?? {}))));

r.get('/chart', requireAnyPermission([A.CHART.MANAGE, A.JOURNAL.READ, A.JOURNAL.MANAGE, A.BILL.MANAGE, A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.listAccounts(ws(req)))));
r.post('/chart', requireAnyPermission([A.CHART.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.saveAccount(ws(req), req.body ?? {}))));
r.patch('/chart/:id', requireAnyPermission([A.CHART.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.saveAccount(ws(req), req.body ?? {}, req.params.id))));
r.post('/chart/starter', requireAnyPermission([A.CHART.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.applyStarterChart(ws(req)))));

r.get('/journals', requireAnyPermission([A.JOURNAL.READ, A.JOURNAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.listJournals(ws(req), req.query as Record<string, string>))));
r.post('/journals', requireAnyPermission([A.JOURNAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.createJournal(ws(req), req.body ?? { lines: [] }, req.user?.id))));
r.post('/journals/:id/void', requireAnyPermission([A.JOURNAL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await ledger.voidJournal(ws(req), req.params.id))));

const reportRead = [A.REPORT.READ, A.JOURNAL.READ];
r.get('/reports/trial-balance', requireAnyPermission(reportRead), asyncHandler(async (req: R, res) => ok(res, await ledger.trialBalance(ws(req), req.query.to as string | undefined))));
r.get('/reports/profit-loss', requireAnyPermission(reportRead), asyncHandler(async (req: R, res) => ok(res, await ledger.profitAndLoss(ws(req), req.query.from as string | undefined, req.query.to as string | undefined))));
r.get('/reports/balance-sheet', requireAnyPermission(reportRead), asyncHandler(async (req: R, res) => ok(res, await ledger.balanceSheet(ws(req), req.query.to as string | undefined))));
r.get(
  '/reports/tax',
  requireAnyPermission([A.TAX_REPORT.READ, A.REPORT.READ]),
  asyncHandler(async (req: R, res) => {
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const from = (req.query.from as string) || new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    ok(res, await ledger.taxSummary(ws(req), from, `${to}T23:59:59Z`));
  })
);

r.get('/bills', requireAnyPermission([A.BILL.LIST, A.BILL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.listBills(ws(req), req.query as Record<string, string>))));
r.post('/bills', requireAnyPermission([A.BILL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.createBill(ws(req), req.body ?? {}, req.user!.id))));
r.patch('/bills/:id', requireAnyPermission([A.BILL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.updateBill(ws(req), req.params.id, req.body ?? {}, req.user!.id))));
r.post('/bills/:id/pay', requireAnyPermission([A.BILL.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.payBill(ws(req), req.params.id, req.body ?? {}))));

r.get('/credit-notes', requireAnyPermission([A.CREDIT_NOTE.MANAGE, A.INVOICE.LIST]), asyncHandler(async (req: R, res) => ok(res, await payables.listCreditNotes(ws(req), req.query.invoiceId as string | undefined))));
r.post('/credit-notes', requireAnyPermission([A.CREDIT_NOTE.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.createCreditNote(ws(req), req.body ?? {}, req.user!.id))));

const bankRead = [A.BANK.READ, A.BANK.MANAGE];
r.get('/banks', requireAnyPermission(bankRead), asyncHandler(async (req: R, res) => ok(res, await payables.listBankAccounts(ws(req)))));
r.post('/banks', requireAnyPermission([A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.saveBankAccount(ws(req), req.body ?? {}))));
r.patch('/banks/:id', requireAnyPermission([A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.saveBankAccount(ws(req), req.body ?? {}, req.params.id))));
r.post('/banks/:id/import', requireAnyPermission([A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.importStatement(ws(req), req.params.id, String(req.body?.csv ?? '')))));
r.get('/banks/:id/reconcile', requireAnyPermission(bankRead), asyncHandler(async (req: R, res) => ok(res, await payables.reconciliation(ws(req), req.params.id))));
r.post('/bank-transactions/:id/match', requireAnyPermission([A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.matchTransaction(ws(req), req.params.id, req.body?.entryId ?? null, req.user!.id))));
r.post('/bank-transactions/:id/book', requireAnyPermission([A.BANK.MANAGE]), asyncHandler(async (req: R, res) => ok(res, await payables.bookTransaction(ws(req), req.params.id, String(req.body?.accountId ?? ''), req.user!.id))));
