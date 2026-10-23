import { Request, Response } from 'express';
import mongoose from 'mongoose';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { Project } from '../projects/project.model';
import {
  assertPaIngestSecret,
  resolvePaOrganizationId,
} from '../service-desk/paIngestAuth';
import * as accountsService from './accounts/accounts.service';
import * as contactsService from './contacts/contacts.service';
import * as activitiesService from './activities/activities.service';
import * as leadsService from './leads/leads.service';
import * as dealsService from './deals/deals.service';
import * as pipelinesService from './pipelines/pipelines.service';
import * as quotesService from './quotes/quotes.service';
import * as contractsService from './contracts/contracts.service';
import * as dashboardService from './dashboard/dashboard.service';
import * as campaignsService from './campaigns/campaigns.service';
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
  const q = req.query as { accountId?: string; customerOrgId?: string; search?: string; origin?: string };
  const data = await contactsService.listContacts(ws(req), q);
  res.json({ success: true, data });
}

export async function listCustomerOrgs(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contactsService.listCustomerOrgs(ws(req));
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
  const q = req.query as {
    relatedType?: string;
    relatedId?: string;
    type?: string;
    assigneeId?: string;
    mine?: string;
    overdue?: string;
    completed?: string;
  };
  const data = await activitiesService.listActivities(ws(req), {
    relatedType: q.relatedType,
    relatedId: q.relatedId,
    type: q.type,
    assigneeId: q.assigneeId,
    mine: q.mine === '1' || q.mine === 'true',
    overdue: q.overdue === '1' || q.overdue === 'true',
    completed: q.completed,
    userId: uid(req),
  });
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

export async function updateActivity(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await activitiesService.updateActivity(req.params.id, ws(req), req.body ?? {});
  res.json({ success: true, data });
}

export async function deleteActivity(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await activitiesService.deleteActivity(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listLeads(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as {
    status?: string;
    source?: string;
    assigneeId?: string;
    serviceInterest?: string;
    search?: string;
    page?: string;
    limit?: string;
    mine?: string;
    campaignId?: string;
    unlinked?: string;
  };
  const assigneeId = q.mine === '1' || q.mine === 'true' ? uid(req) : q.assigneeId;
  const unlinked = q.unlinked === '1' || q.unlinked === 'true';
  const data = await leadsService.listLeads(ws(req), {
    status: q.status,
    source: q.source,
    assigneeId,
    serviceInterest: q.serviceInterest,
    search: q.search,
    page: q.page ? parseInt(q.page, 10) : undefined,
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
    campaignId: q.campaignId,
    unlinked: unlinked || undefined,
  });
  res.json({ success: true, data });
}

export async function getLeadStats(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await leadsService.getLeadStats(ws(req));
  res.json({ success: true, data });
}

export async function getLead(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await leadsService.getLead(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function createLead(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await leadsService.createLead(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

/**
 * PA / WhatsApp bot ingest — shared secret, no user JWT.
 * Header: x-pa-ingest-secret
 * Body: lead fields + organizationId (or rely on PA_DEFAULT_ORG_ID)
 */
export async function ingestWhatsappLead(req: Request, res: Response) {
  assertPaIngestSecret(req);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const organizationId = await resolvePaOrganizationId(req, body);

  const { organizationId: _omit, ...leadInput } = body;
  const data = await leadsService.createLead(organizationId, leadInput);
  res.status(201).json({ success: true, data });
}

/**
 * PA bot updates an existing CRM lead with new WhatsApp details (shared secret).
 */
export async function ingestWhatsappLeadUpdate(req: Request, res: Response) {
  assertPaIngestSecret(req);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const organizationId = await resolvePaOrganizationId(req, body);

  const { organizationId: _omit, ...leadInput } = body;
  const data = await leadsService.updateLead(req.params.id, organizationId, leadInput);
  res.json({ success: true, data });
}

/**
 * PA Control Center — list workspace projects via ingest secret (no JWT).
 * Header: x-pa-ingest-secret; optional x-organization-id (else PA_DEFAULT_ORG_ID).
 */
export async function ingestListProjects(req: Request, res: Response) {
  assertPaIngestSecret(req);
  const organizationId = await resolvePaOrganizationId(req);

  const rows = await Project.find({
    taskflowOrganizationId: organizationId,
    archived: { $ne: true },
  })
    .select('_id name key')
    .sort({ name: 1 })
    .limit(200)
    .lean();

  const data = rows.map((p) => ({
    _id: String(p._id),
    id: String(p._id),
    name: p.name,
    key: p.key,
  }));
  res.json({ success: true, data });
}

export async function updateLead(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await leadsService.updateLead(req.params.id, ws(req), req.body, uid(req));
  res.json({ success: true, data });
}

export async function deleteLead(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await leadsService.deleteLead(req.params.id, ws(req), uid(req));
  res.json({ success: true, data });
}

export async function convertLead(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as {
    pipelineId?: string;
    customerOrgId?: string;
    dealValue?: number;
    expectedCloseDate?: string;
    createProject?: boolean;
    createPortalOrg?: boolean;
    portalOrg?: {
      name?: string;
      contactEmail?: string;
      contactPhone?: string;
      description?: string;
      adminName?: string;
      adminEmail?: string;
    };
  };
  const data = await leadsService.convertLead(req.params.id, ws(req), uid(req), body);
  res.json({ success: true, data });
}

export async function listDeals(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; stageId?: string; unlinked?: string };
  const unlinked = q.unlinked === '1' || q.unlinked === 'true';
  const data = await dealsService.listDeals(ws(req), { ...q, unlinked: unlinked || undefined });
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
  const q = req.query as { dealId?: string; leadId?: string; accountId?: string; customerOrgId?: string };
  const data = await quotesService.listQuotes(ws(req), {
    dealId: q.dealId,
    leadId: q.leadId,
    accountId: q.accountId,
    customerOrgId: q.customerOrgId,
  });
  res.json({ success: true, data });
}

export async function getQuote(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await quotesService.getQuote(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function createQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.createQuote(ws(req), req.body, uid(req));
  res.status(201).json({ success: true, data });
}

export async function sendQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as {
    toEmail?: string;
    pdfBase64?: string;
    pdfFilename?: string;
    message?: string;
  };
  const data = await quotesService.sendQuote(req.params.id, ws(req), String(body.toEmail), {
    pdfBase64: body.pdfBase64,
    pdfFilename: body.pdfFilename,
    message: body.message,
    userId: uid(req),
  });
  res.json({ success: true, data });
}

export async function updateQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.updateQuote(req.params.id, ws(req), req.body, uid(req));
  res.json({ success: true, data });
}

export async function deleteQuote(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await quotesService.deleteQuote(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function listContracts(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { accountId?: string; customerOrgId?: string; kind?: string; status?: string; renewingWithinDays?: string };
  const data = await contractsService.listContracts(ws(req), {
    accountId: q.accountId,
    customerOrgId: q.customerOrgId,
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

export async function getContract(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await contractsService.getContractById(req.params.id, ws(req));
  res.json({ success: true, data });
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

export async function listCampaigns(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; search?: string };
  const data = await campaignsService.listCampaigns(ws(req), q);
  res.json({ success: true, data });
}

export async function getCampaign(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await campaignsService.getCampaign(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function createCampaign(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await campaignsService.createCampaign(ws(req), req.body ?? {});
  res.status(201).json({ success: true, data });
}

export async function updateCampaign(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await campaignsService.updateCampaign(req.params.id, ws(req), req.body ?? {});
  res.json({ success: true, data });
}

export async function deleteCampaign(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await campaignsService.deleteCampaign(req.params.id, ws(req));
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
