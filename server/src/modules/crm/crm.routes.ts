import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as crm from './crm.controller';

const P = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const router = Router();

router.use(authMiddleware);

router.get('/dashboard', requirePermission(P.REPORT.READ), asyncHandler(crm.getDashboard));
router.get('/executive-metrics', requirePermission(P.REPORT.READ), asyncHandler(crm.getExecutiveMetrics));

router.get('/accounts', requirePermission(P.ACCOUNT.LIST), asyncHandler(crm.listAccounts));
router.get('/accounts/:id', requirePermission(P.ACCOUNT.READ), asyncHandler(crm.getAccount));
router.get('/accounts/:id/360', requirePermission(P.ACCOUNT.READ), asyncHandler(crm.getAccount360));
router.post('/accounts', requirePermission(P.ACCOUNT.CREATE), asyncHandler(crm.createAccount));
router.patch('/accounts/:id', requirePermission(P.ACCOUNT.UPDATE), asyncHandler(crm.updateAccount));
router.delete('/accounts/:id', requirePermission(P.ACCOUNT.DELETE), asyncHandler(crm.deleteAccount));
router.post('/accounts/:id/link-project', requirePermission(P.ACCOUNT.UPDATE), asyncHandler(crm.linkProject));

router.get('/contacts', requirePermission(P.CONTACT.LIST), asyncHandler(crm.listContacts));
router.post('/contacts', requirePermission(P.CONTACT.CREATE), asyncHandler(crm.createContact));
router.patch('/contacts/:id', requirePermission(P.CONTACT.UPDATE), asyncHandler(crm.updateContact));
router.delete('/contacts/:id', requirePermission(P.CONTACT.DELETE), asyncHandler(crm.deleteContact));

router.get('/activities', requirePermission(P.ACTIVITY.LIST), asyncHandler(crm.listActivities));
router.post('/activities', requirePermission(P.ACTIVITY.CREATE), asyncHandler(crm.createActivity));
router.post('/activities/:id/complete', requirePermission(P.ACTIVITY.UPDATE), asyncHandler(crm.completeActivity));
router.delete('/activities/:id', requirePermission(P.ACTIVITY.DELETE), asyncHandler(crm.deleteActivity));

router.get('/leads', requirePermission(P.LEAD.LIST), asyncHandler(crm.listLeads));
router.post('/leads', requirePermission(P.LEAD.CREATE), asyncHandler(crm.createLead));
router.patch('/leads/:id', requirePermission(P.LEAD.UPDATE), asyncHandler(crm.updateLead));
router.post('/leads/:id/convert', requirePermission(P.LEAD.UPDATE), asyncHandler(crm.convertLead));

router.get('/deals/forecast', requirePermission(P.REPORT.READ), asyncHandler(crm.getForecast));
router.get('/deals', requirePermission(P.DEAL.LIST), asyncHandler(crm.listDeals));
router.post('/deals', requirePermission(P.DEAL.CREATE), asyncHandler(crm.createDeal));
router.patch('/deals/:id', requirePermission(P.DEAL.UPDATE), asyncHandler(crm.updateDeal));
router.post('/deals/:id/move-stage', requirePermission(P.DEAL.UPDATE), asyncHandler(crm.moveDealStage));
router.post('/deals/:id/create-project', requirePermission(P.DEAL.UPDATE), asyncHandler(crm.createProjectFromDeal));

router.get('/pipelines', requirePermission(P.DEAL.LIST), asyncHandler(crm.listPipelines));
router.post('/pipelines', requirePermission(P.SETTINGS.MANAGE), asyncHandler(crm.createPipeline));
router.patch('/pipelines/:id', requirePermission(P.SETTINGS.MANAGE), asyncHandler(crm.updatePipeline));

router.get('/quotes', requirePermission(P.QUOTE.LIST), asyncHandler(crm.listQuotes));
router.post('/quotes', requirePermission(P.QUOTE.CREATE), asyncHandler(crm.createQuote));
router.patch('/quotes/:id', requirePermission(P.QUOTE.UPDATE), asyncHandler(crm.updateQuote));
router.delete('/quotes/:id', requirePermission(P.QUOTE.DELETE), asyncHandler(crm.deleteQuote));
router.post('/quotes/:id/send', requirePermission(P.QUOTE.UPDATE), asyncHandler(crm.sendQuote));

router.get('/contracts', requirePermission(P.CONTRACT.LIST), asyncHandler(crm.listContracts));
router.post('/contracts', requirePermission(P.CONTRACT.CREATE), asyncHandler(crm.createContract));
router.patch('/contracts/:id', requirePermission(P.CONTRACT.UPDATE), asyncHandler(crm.updateContract));
router.delete('/contracts/:id', requirePermission(P.CONTRACT.DELETE), asyncHandler(crm.deleteContract));
router.get('/contracts/:id/burn-down', requirePermission(P.CONTRACT.READ), asyncHandler(crm.getContractBurnDown));
router.get(
  '/contracts-dashboard',
  requirePermission(P.CONTRACT.LIST),
  asyncHandler(crm.getContractsHubDashboard)
);

router.get('/webhooks', requirePermission(P.SETTINGS.MANAGE), asyncHandler(crm.listWebhooks));
router.post('/webhooks', requirePermission(P.SETTINGS.MANAGE), asyncHandler(crm.createWebhook));
router.delete('/webhooks/:id', requirePermission(P.SETTINGS.MANAGE), asyncHandler(crm.deleteWebhook));

export const crmRoutes = router;
