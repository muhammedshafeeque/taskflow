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
import { discountLimitFor, getDiscountPolicy, saveDiscountPolicy } from './quotes/discountLimits';
import { Role } from '../roles/role.model';
import { HrmsSettings } from '../hrms/models/hrmsPolicy.model';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import {
  assertDealInReach,
  assertLeadInReach,
  assignableOwner,
  crmReachFor,
  dealScopeFilter,
  leadScopeFilter,
  redactLeadDuplicates,
} from './crmScope';

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
    scope: leadScopeFilter(await crmReachFor(req)),
  });
  res.json({ success: true, data });
}

export async function getLeadStats(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await leadsService.getLeadStats(ws(req), leadScopeFilter(await crmReachFor(req)));
  res.json({ success: true, data });
}

export async function getLead(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  await assertLeadInReach(ws(req), await crmReachFor(req), req.params.id);
  const data = await leadsService.getLead(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function createLead(req: Request & { user?: AuthPayload }, res: Response) {
  const userId = uid(req);
  const reach = await crmReachFor(req);
  const body = { ...((req.body ?? {}) as Record<string, unknown>) };
  const assignee = assignableOwner(reach, body.assigneeId, userId, { creating: true, what: 'lead' });
  if (assignee !== undefined) body.assigneeId = assignee;
  try {
    const data = await leadsService.createLead(ws(req), body, userId, { checkDuplicates: true });
    res.status(201).json({ success: true, data });
  } catch (err) {
    throw redactDuplicateError(err, reach);
  }
}

/** A 409 duplicate warning lists matches; hide the details of those outside the viewer's reach. */
function redactDuplicateError(err: unknown, reach: Awaited<ReturnType<typeof crmReachFor>>): unknown {
  if (reach === null || !(err instanceof ApiError) || err.statusCode !== 409) return err;
  const d = err.details as { code?: string; leads?: Parameters<typeof redactLeadDuplicates>[1] } | undefined;
  if (d?.code !== 'duplicate_lead' || !Array.isArray(d.leads)) return err;
  return new ApiError(409, err.message, { ...d, leads: redactLeadDuplicates(reach, d.leads) });
}

export async function checkLeadDuplicates(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await leadsService.checkLeadDuplicates(ws(req), (req.body ?? {}) as Record<string, unknown>);
  res.json({ success: true, data: { ...data, leads: redactLeadDuplicates(await crmReachFor(req), data.leads) } });
}

export async function getLeadDuplicates(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const reach = await crmReachFor(req);
  await assertLeadInReach(ws(req), reach, req.params.id);
  const data = await leadsService.getLeadDuplicates(req.params.id, ws(req));
  res.json({ success: true, data: { ...data, leads: redactLeadDuplicates(reach, data.leads) } });
}

export async function mergeLead(req: Request & { user?: AuthPayload }, res: Response) {
  const body = (req.body ?? {}) as { sourceId?: string };
  const reach = await crmReachFor(req);
  // Both leads must be within reach: merging moves the other lead's history into the kept one.
  await assertLeadInReach(ws(req), reach, req.params.id);
  if (body.sourceId) await assertLeadInReach(ws(req), reach, String(body.sourceId));
  const data = await leadsService.mergeLeads(req.params.id, String(body.sourceId ?? ''), ws(req), uid(req));
  res.json({ success: true, data });
}

/**
 * PA / WhatsApp bot lead capture — internal key (requirePaInternalService), no user JWT.
 * Workspace: x-organization-id, else the PA workspace.
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
 * PA bot updates an existing CRM lead with new WhatsApp details (internal key).
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
 * PA Control Center — list workspace projects via the internal key (no JWT).
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
  const userId = uid(req);
  const reach = await crmReachFor(req);
  await assertLeadInReach(ws(req), reach, req.params.id);
  const body = { ...((req.body ?? {}) as Record<string, unknown>) };
  if ('assigneeId' in body) body.assigneeId = assignableOwner(reach, body.assigneeId, userId, { creating: false, what: 'lead' }) ?? body.assigneeId;
  const data = await leadsService.updateLead(req.params.id, ws(req), body, userId);
  res.json({ success: true, data });
}

export async function deleteLead(req: Request & { user?: AuthPayload }, res: Response) {
  await assertLeadInReach(ws(req), await crmReachFor(req), req.params.id);
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
    projectLeadId?: string;
    projectName?: string;
    projectKey?: string;
    createPortalOrg?: boolean;
    portalOrg?: {
      name?: string;
      contactEmail?: string;
      contactPhone?: string;
      description?: string;
      adminName?: string;
      adminEmail?: string;
    };
    ignoreDuplicates?: boolean;
  };
  await assertLeadInReach(ws(req), await crmReachFor(req), req.params.id);
  // Converting needs lead update; also creating a project needs project create (AUT-30).
  if (body.createProject === true) assertCanCreateProject(req);
  const data = await leadsService.convertLead(req.params.id, ws(req), uid(req), {
    ...body,
    checkDuplicates: true,
    ignoreDuplicates: body.ignoreDuplicates === true,
  });
  res.json({ success: true, data });
}

export async function listDeals(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const q = req.query as { status?: string; stageId?: string; unlinked?: string; ownerId?: string; search?: string; pipelineId?: string };
  const unlinked = q.unlinked === '1' || q.unlinked === 'true';
  const data = await dealsService.listDeals(ws(req), {
    status: q.status,
    stageId: q.stageId,
    ownerId: q.ownerId,
    search: q.search,
    pipelineId: q.pipelineId,
    unlinked: unlinked || undefined,
    scope: dealScopeFilter(await crmReachFor(req)),
  });
  res.json({ success: true, data });
}

export async function createDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const body = { ...((req.body ?? {}) as Record<string, unknown>) };
  const owner = assignableOwner(await crmReachFor(req), body.ownerId, uid(req), { creating: true, what: 'deal' });
  if (owner !== undefined) body.ownerId = owner;
  const data = await dealsService.createDeal(ws(req), body);
  res.status(201).json({ success: true, data });
}

export async function getDeal(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  await assertDealInReach(ws(req), await crmReachFor(req), req.params.id);
  const data = await dealsService.getDeal(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function deleteDeal(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  await assertDealInReach(ws(req), await crmReachFor(req), req.params.id);
  const data = await dealsService.deleteDeal(req.params.id, ws(req));
  res.json({ success: true, data });
}

export async function updateDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const userId = uid(req);
  const reach = await crmReachFor(req);
  await assertDealInReach(ws(req), reach, req.params.id);
  const body = { ...((req.body ?? {}) as Record<string, unknown>) };
  if ('ownerId' in body) body.ownerId = assignableOwner(reach, body.ownerId, userId, { creating: false, what: 'deal' }) ?? body.ownerId;
  const data = await dealsService.updateDeal(req.params.id, ws(req), body);
  res.json({ success: true, data });
}

export async function moveDealStage(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { stageId?: string };
  await assertDealInReach(ws(req), await crmReachFor(req), req.params.id);
  const data = await dealsService.moveDealStage(req.params.id, ws(req), String(body.stageId));
  res.json({ success: true, data });
}

/** Creating a delivery project from CRM needs the same permission as creating one in Projects. */
function assertCanCreateProject(req: Request & { user?: AuthPayload }) {
  if (!userHasPermission(req.user?.permissions ?? [], TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE)) {
    throw new ApiError(403, 'Creating a project needs the project create permission. Convert without a project, or ask someone who can create projects.');
  }
}

export async function createProjectFromDeal(req: Request & { user?: AuthPayload }, res: Response) {
  const body = req.body as { name?: string; key?: string; templateId?: string; leadId?: string };
  await assertDealInReach(ws(req), await crmReachFor(req), req.params.id);
  const data = await dealsService.createProjectFromDeal(req.params.id, ws(req), uid(req), {
    name: String(body.name ?? ''),
    key: String(body.key ?? ''),
    templateId: body.templateId,
    leadId: body.leadId,
  });
  res.status(201).json({ success: true, data });
}

/** Quotation discount limits, plus the viewer's own limit (null = not limited). */
export async function getDiscountPolicyHandler(req: Request & { user?: AuthPayload }, res: Response) {
  const userId = uid(req);
  const orgId = ws(req);
  if (!orgId) throw new ApiError(400, 'Choose a workspace');
  const [policy, myLimit] = await Promise.all([getDiscountPolicy(orgId), discountLimitFor(orgId, userId)]);
  // People who manage the limits also get the roles and levels they can set limits for.
  let options: { roles: Array<{ _id: string; name: string }>; levels: string[] } | undefined;
  if (userHasPermission(req.user?.permissions ?? [], TASK_FLOW_PERMISSIONS.TASKFLOW.CRM.SETTINGS.MANAGE)) {
    const [roles, hr] = await Promise.all([
      Role.find().select('name').sort({ name: 1 }).lean(),
      HrmsSettings.findOne({ taskflowOrganizationId: new mongoose.Types.ObjectId(orgId) }).select('levels').lean(),
    ]);
    options = {
      roles: roles.map((r) => ({ _id: String(r._id), name: r.name })),
      levels: ((hr as { levels?: string[] } | null)?.levels ?? ['Intern', 'Junior', 'Senior', 'Lead', 'Manager']).filter(Boolean),
    };
  }
  res.json({ success: true, data: { ...policy, myLimit, options } });
}

export async function updateDiscountPolicyHandler(req: Request & { user?: AuthPayload }, res: Response) {
  const data = await saveDiscountPolicy(ws(req), (req.body ?? {}) as Record<string, unknown>, uid(req));
  res.json({ success: true, data });
}

export async function getForecast(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await dealsService.getForecast(ws(req), dealScopeFilter(await crmReachFor(req)));
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

export async function deletePipeline(req: Request & { user?: AuthPayload }, res: Response) {
  uid(req);
  const data = await pipelinesService.deletePipeline(req.params.id, ws(req));
  res.json({ success: true, data });
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
