import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import * as accountsService from './accounts/accounts.service';
import * as contactsService from './contacts/contacts.service';
import * as activitiesService from './activities/activities.service';
import * as leadsService from './leads/leads.service';
import * as dealsService from './deals/deals.service';
import * as pipelinesService from './pipelines/pipelines.service';
import * as quotesService from './quotes/quotes.service';
import * as contractsService from './contracts/contracts.service';
import * as dashboardService from './dashboard/dashboard.service';
import * as ecosystemService from './ecosystem/ecosystem.service';

function ws(req: Request & { user?: AuthPayload; activeOrganizationId?: string }) {
  return req.activeOrganizationId;
}

function uid(req: Request & { user?: AuthPayload }) {
  const id = req.user?.id;
  if (!id) throw new ApiError(401, 'Unauthorized');
  return id;
}

export async function getDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await dashboardService.getCrmDashboard(ws(req));
  res.json({ success: true, data });
}

export async function getExecutiveMetrics(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await dashboardService.getExecutiveCrmMetrics(ws(req));
  res.json({ success: true, data });
}

export async function listAccounts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { type?: string; search?: string; page?: string; limit?: string };
  const data = await accountsService.listAccounts(ws(req), {
    type: q.type,
    search: q.search,
    page: q.page ? parseInt(q.page, 10) : undefined,
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
  });
  res.json({ success: true, data });
}

export async function getAccount(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await accountsService.getAccountById(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function getAccount360(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await accountsService.getAccount360(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function createAccount(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await accountsService.createAccount(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function updateAccount(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await accountsService.updateAccount(req.params.id, ws(req), req.body, uid(req));
  res.json({ success: true, data });
}

export async function deleteAccount(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await accountsService.deleteAccount(req.params.id, ws(req), uid(req));
  res.json({ success: true, data });
}

export async function linkProject(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const body = req.body as { projectId?: string };
  const data = await accountsService.linkProject(req.params.id, String(body.projectId), ws(req));
  res.json({ success: true, data });
}

export async function listContacts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { accountId?: string; search?: string };
  const data = await contactsService.listContacts(ws(req), q);
  res.json({ success: true, data });
}

export async function createContact(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contactsService.createContact(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateContact(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contactsService.updateContact(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function deleteContact(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contactsService.deleteContact(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listActivities(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { relatedType?: string; relatedId?: string };
  const data = await activitiesService.listActivities(ws(req), q);
  res.json({ success: true, data });
}

export async function createActivity(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await activitiesService.createActivity(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function completeActivity(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await activitiesService.completeActivity(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function deleteActivity(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await activitiesService.deleteActivity(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listLeads(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string };
  const data = await leadsService.listLeads(ws(req), q.status);
  res.json({ success: true, data });
}

export async function createLead(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await leadsService.createLead(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateLead(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await leadsService.updateLead(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function convertLead(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { pipelineId?: string };
  const data = await leadsService.convertLead(req.params.id, ws(req), uid(req), body.pipelineId);
  res.json({ success: true, data });
}

export async function listDeals(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; stageId?: string };
  const data = await dealsService.listDeals(ws(req), q);
  res.json({ success: true, data });
}

export async function createDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await dealsService.createDeal(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await dealsService.updateDeal(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function moveDealStage(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { stageId?: string };
  const data = await dealsService.moveDealStage(req.params.id, ws(req), String(body.stageId));
  res.json({ success: true, data });
}

export async function createProjectFromDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { name?: string; key?: string; templateId?: string };
  const data = await dealsService.createProjectFromDeal(req.params.id, ws(req), uid(req), {
    name: String(body.name ?? ''),
    key: String(body.key ?? ''),
    templateId: body.templateId,
  });
  res.status(201).json({ success: true, data });
}

export async function getForecast(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await dealsService.getForecast(ws(req));
  res.json({ success: true, data });
}

export async function listPipelines(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  await pipelinesService.ensureDefaultPipeline(ws(req));
  const data = await pipelinesService.listPipelines(ws(req));
  res.json({ success: true, data });
}

export async function createPipeline(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await pipelinesService.createPipeline(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updatePipeline(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await pipelinesService.updatePipeline(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function listQuotes(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { dealId?: string; accountId?: string };
  const data = await quotesService.listQuotes(ws(req), { dealId: q.dealId, accountId: q.accountId });
  res.json({ success: true, data });
}

export async function createQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.createQuote(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function sendQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { toEmail?: string };
  const data = await quotesService.sendQuote(req.params.id, ws(req), String(body.toEmail));
  res.json({ success: true, data });
}

export async function updateQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.updateQuote(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function deleteQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.deleteQuote(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listContracts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { accountId?: string; kind?: string; status?: string; renewingWithinDays?: string };
  const data = await contractsService.listContracts(ws(req), {
    accountId: q.accountId,
    kind: q.kind,
    status: q.status,
    renewingWithinDays: q.renewingWithinDays ? Number(q.renewingWithinDays) : undefined,
  });
  res.json({ success: true, data });
}

export async function createContract(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.createContract(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function updateContract(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.updateContract(req.params.id, ws(req), req.body);
  res.json({ success: true, data });
}

export async function getContractBurnDown(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contractsService.getContractBurnDown(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function deleteContract(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await contractsService.deleteContract(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function getContractsHubDashboard(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contractsService.getContractsHubDashboard(ws(req));
  res.json({ success: true, data });
}

export async function listWebhooks(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await ecosystemService.listWebhooks(ws(req));
  res.json({ success: true, data });
}

export async function createWebhook(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ecosystemService.createWebhook(ws(req), req.body);
  res.status(201).json({ success: true, data });
}

export async function deleteWebhook(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await ecosystemService.deleteWebhook(req.params.id, ws(req));
  res.json({ success: true, data });
}
