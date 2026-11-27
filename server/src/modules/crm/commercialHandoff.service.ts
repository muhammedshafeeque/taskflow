import mongoose from 'mongoose';
import { CrmDeal } from './models/crmDeal.model';
import { CrmQuote } from './models/crmQuote.model';
import { CrmContract } from './models/crmContract.model';
import { CrmLead } from './models/crmLead.model';
import { Project } from '../projects/project.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { ApiError } from '../../utils/ApiError';
import * as projectsService from '../projects/projects.service';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import * as customerOrgService from '../customer-portal/customer-org/customerOrg.service';
import { DocumentRecord } from '../documents/models/documentRecord.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { createNotification } from '../notifications/notifications.service';
import { toOrgOid } from './crmWorkspace';
import { upsertContactByEmail } from './contacts/contacts.service';
import type { CreateOrgInput } from '../customer-portal/customer-org/customerOrg.validation';

export type CommercialHandoffOpts = {
  workspaceId: string;
  userId: string;
  customerOrgId?: string;
  portalOrg?: Partial<CreateOrgInput>;
  dealId?: string;
  quoteId?: string;
  contractId?: string;
  leadId?: string;
  projectTitle?: string;
  /**
   * Create a delivery project, run by this project manager. Only when someone explicitly asks
   * (AUT-30): projects are never created automatically, and the salesperson is not made its lead.
   */
  project?: ProjectSetup;
  createPortalOrg?: boolean;
};

export type ProjectSetup = { leadId: string; name?: string; key?: string; templateId?: string };

export type CommercialHandoffResult = {
  customerOrgId?: string;
  projectId?: string;
  skipped: string[];
  warnings: string[];
};

const SKIP_MESSAGES: Record<string, string> = {
  portal_org_no_email: 'Portal organisation was not created: customer email is missing.',
  portal_org_skipped: 'Portal organisation was not created (opted out).',
  project_skipped: 'No project was created. Create one from the deal once it is won.',
};

function warningsFromSkipped(skipped: string[]): string[] {
  return skipped.map((code) => SKIP_MESSAGES[code] ?? code);
}

export function projectKeyFromTitle(title: string): string {
  const letters = title.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  return letters || 'PRJ';
}

export function hourlyRateFromQuoteLines(
  lines: Array<{ billingType?: string; unitPrice?: number }> | undefined
): number | undefined {
  const hourly = (lines ?? []).find((l) => l.billingType === 'hourly' && Number(l.unitPrice) > 0);
  return hourly ? Number(hourly.unitPrice) : undefined;
}

async function uniqueProjectKey(orgId: string, base: string): Promise<string> {
  let key = base.slice(0, 10);
  let n = 0;
  while (await Project.exists({ key, taskflowOrganizationId: orgId })) {
    n += 1;
    const suffix = String(n);
    key = `${base.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
  }
  return key;
}

async function ensurePortalOrg(
  workspaceId: string,
  userId: string,
  existingOrgId: string | undefined,
  portalOrg: Partial<CreateOrgInput> | undefined,
  lead?: { contactEmail?: string; contactName?: string; companyName?: string; title?: string } | null
): Promise<{ customerOrgId?: string; skipped?: string }> {
  if (existingOrgId) {
    const found = await CustomerOrg.findById(existingOrgId).lean();
    if (found) return { customerOrgId: String(found._id) };
  }

  const name = (portalOrg?.name || lead?.companyName || lead?.title || 'Customer').trim();
  const contactEmail = (portalOrg?.contactEmail || lead?.contactEmail || '').trim().toLowerCase();
  const adminEmail = (portalOrg?.adminEmail || contactEmail).trim().toLowerCase();
  const adminName = (portalOrg?.adminName || lead?.contactName || name).trim();
  if (!adminEmail || !contactEmail) return { skipped: 'portal_org_no_email' };

  const created = (await customerOrgService.createOrg(
    {
      name,
      contactEmail,
      contactPhone: portalOrg?.contactPhone,
      description: portalOrg?.description,
      adminName,
      adminEmail,
    },
    userId,
    workspaceId
  )) as { org: { _id: unknown }; adminUser?: { id: string; email: string; name?: string } };

  const customerOrgId = String(created.org._id);
  if (created.adminUser?.email) {
    await upsertContactByEmail(workspaceId, {
      email: created.adminUser.email,
      name: created.adminUser.name || adminName,
      origin: 'portal',
      customerOrgId,
      customerUserId: created.adminUser.id,
      isPrimary: true,
    });
  }
  return { customerOrgId };
}

async function bindProject(
  projectId: string,
  customerOrgId: string | undefined,
  workspaceId: string,
  userId: string,
  ids: { dealId?: string; quoteId?: string; contractId?: string }
): Promise<void> {
  await Project.findByIdAndUpdate(projectId, {
    $set: {
      ...(customerOrgId ? { orgId: customerOrgId } : {}),
    },
  });
  // Time to invoice bills a project's CRM account.
  const accountId = customerOrgId ? (await CustomerOrg.findById(customerOrgId).select('crmAccountId').lean())?.crmAccountId : null;
  if (accountId) await Project.updateOne({ _id: projectId, crmAccountId: null }, { $set: { crmAccountId: accountId } });
  if (customerOrgId) {
    const exists = await CustomerProjectMapping.findOne({ customerOrgId, projectId }).lean();
    if (!exists) {
      await CustomerProjectMapping.create({
        customerOrgId,
        projectId,
        mappedBy: userId,
        allowedRequestTypes: ['bug', 'feature', 'suggestion', 'concern', 'other'],
        status: 'active',
      });
    }
  }
  const pid = new mongoose.Types.ObjectId(projectId);
  const orgOid = toOrgOid(workspaceId);
  if (ids.dealId) {
    await CrmDeal.findByIdAndUpdate(ids.dealId, { $set: { projectId: pid } });
    // Quotes and contracts already agreed on the deal (e.g. accepted before the project existed) join it too.
    const dealOid = new mongoose.Types.ObjectId(ids.dealId);
    await CrmQuote.updateMany({ taskflowOrganizationId: orgOid, dealId: dealOid, projectId: null }, { $set: { projectId: pid } });
    const contracts = await CrmContract.find({ taskflowOrganizationId: orgOid, dealId: dealOid, projectId: null }).select('_id').lean();
    if (contracts.length) {
      const contractIds = contracts.map((c) => c._id);
      await CrmContract.updateMany({ _id: { $in: contractIds } }, { $set: { projectId: pid } });
      await BillingInvoice.updateMany({ taskflowOrganizationId: orgOid, contractId: { $in: contractIds }, projectId: null }, { $set: { projectId: pid } });
    }
  }
  if (ids.quoteId) await CrmQuote.findByIdAndUpdate(ids.quoteId, { $set: { projectId: pid } });
  if (ids.contractId) {
    await CrmContract.findByIdAndUpdate(ids.contractId, { $set: { projectId: pid } });
    await BillingInvoice.updateMany(
      { contractId: ids.contractId, taskflowOrganizationId: toOrgOid(workspaceId) },
      { $set: { projectId: pid } }
    );
  }
}

/**
 * The project manager must be an active member of the workspace. Checked before anything is saved,
 * so a bad choice never leaves half a conversion behind.
 */
export async function assertProjectLead(workspaceId: string, leadId: unknown): Promise<string> {
  const id = String(leadId ?? '').trim();
  if (!id) throw new ApiError(400, 'Choose a project manager for the new project');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid project manager');
  const member = await OrganizationMember.exists({ organization: toOrgOid(workspaceId), user: id, status: 'active' });
  if (!member) throw new ApiError(400, 'The project manager must be an active member of this workspace');
  return id;
}

/** Create the delivery project for a deal (or customer), run by the chosen project manager. */
export async function createDeliveryProject(
  workspaceId: string,
  actorUserId: string,
  setup: ProjectSetup,
  defaults: { title: string; description: string; customerOrgId?: string }
): Promise<string> {
  const leadId = await assertProjectLead(workspaceId, setup.leadId);
  const name = (setup.name || defaults.title || 'Project').trim();
  const key = setup.key?.trim()
    ? setup.key.trim().toUpperCase()
    : await uniqueProjectKey(workspaceId, projectKeyFromTitle(name));
  const project = await projectsService.create(
    {
      name,
      key,
      lead: leadId,
      templateId: setup.templateId,
      description: defaults.description,
      orgId: defaults.customerOrgId,
    },
    actorUserId,
    workspaceId
  );
  return String((project as { _id: unknown })._id);
}

async function copyLeadDocuments(leadId: string, dealId: string, workspaceId: string): Promise<void> {
  await DocumentRecord.updateMany(
    {
      taskflowOrganizationId: toOrgOid(workspaceId),
      entityType: 'lead',
      entityId: leadId,
    },
    { $set: { entityType: 'deal', entityId: dealId } }
  );
}

export async function runCommercialHandoff(opts: CommercialHandoffOpts): Promise<CommercialHandoffResult> {
  const createPortalOrg = opts.createPortalOrg !== false;
  const skipped: string[] = [];
  const orgOid = toOrgOid(opts.workspaceId);

  let customerOrgId = opts.customerOrgId;
  if (createPortalOrg && !customerOrgId) {
    const lead = opts.leadId ? await CrmLead.findById(opts.leadId).lean() : null;
    const portal = await ensurePortalOrg(opts.workspaceId, opts.userId, undefined, opts.portalOrg, lead);
    customerOrgId = portal.customerOrgId;
    if (portal.skipped) skipped.push(portal.skipped);
  } else if (!createPortalOrg && !customerOrgId) {
    skipped.push('portal_org_skipped');
  }

  if (customerOrgId) {
    await CrmDeal.updateMany(
      { _id: opts.dealId, taskflowOrganizationId: orgOid },
      { $set: { customerOrgId } }
    );
    if (opts.leadId) {
      await CrmLead.findByIdAndUpdate(opts.leadId, { $set: { customerOrgId } });
    }
  }

  const deal = opts.dealId
    ? await CrmDeal.findOne({ _id: opts.dealId, taskflowOrganizationId: orgOid })
    : null;

  let projectId = deal?.projectId ? String(deal.projectId) : undefined;
  const orgDoc = customerOrgId ? await CustomerOrg.findById(customerOrgId).lean() : null;

  if (opts.project && !projectId) {
    projectId = await createDeliveryProject(opts.workspaceId, opts.userId, opts.project, {
      title: (opts.projectTitle || deal?.title || orgDoc?.name || 'Project').trim(),
      description: `Created from CRM handoff${deal ? `: ${deal.title}` : ''}`,
      customerOrgId,
    });
  } else if (!projectId) {
    skipped.push('project_skipped');
  }

  // Nobody is booked on the project here: the project manager staffs it in Resources.
  if (projectId) {
    await bindProject(projectId, customerOrgId, opts.workspaceId, opts.userId, {
      dealId: opts.dealId,
      quoteId: opts.quoteId,
      contractId: opts.contractId,
    });
  }

  if (opts.leadId && opts.dealId) {
    await copyLeadDocuments(opts.leadId, opts.dealId, opts.workspaceId);
  }

  const ownerId = deal?.ownerId ? String(deal.ownerId) : opts.userId;
  if (ownerId && mongoose.Types.ObjectId.isValid(ownerId)) {
    await createNotification({
      userId: ownerId,
      type: 'system',
      title: 'Customer delivery setup',
      body: [orgDoc?.name, projectId ? 'project created' : null, customerOrgId ? 'portal org linked' : null]
        .filter(Boolean)
        .join(' · '),
      link: projectId
        ? `/projects/${projectId}/dashboard`
        : customerOrgId
          ? `/admin/customer-orgs/${customerOrgId}`
          : '/crm/deals',
      metadata: { projectId, customerOrgId },
    }).catch(() => undefined);
  }

  return { customerOrgId, projectId, skipped, warnings: warningsFromSkipped(skipped) };
}

export async function resolveProjectHourlyRate(
  workspaceId: string,
  projectId: string
): Promise<number> {
  const orgOid = toOrgOid(workspaceId);
  const contract = await CrmContract.findOne({
    taskflowOrganizationId: orgOid,
    projectId,
    status: { $in: ['draft', 'active'] },
    hourlyRate: { $gt: 0 },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (contract?.hourlyRate) return Number(contract.hourlyRate);

  const quote = await CrmQuote.findOne({
    taskflowOrganizationId: orgOid,
    projectId,
    status: 'accepted',
  })
    .sort({ createdAt: -1 })
    .lean();
  const fromQuote = hourlyRateFromQuoteLines(quote?.lineItems);
  if (fromQuote) return fromQuote;
  return 100;
}
