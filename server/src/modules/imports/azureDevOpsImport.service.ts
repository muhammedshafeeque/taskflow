import mongoose from 'mongoose';
import { Project } from '../projects/project.model';
import { User } from '../auth/user.model';
import { Issue } from '../issues/issue.model';
import { IssueLink } from '../issues/issueLink.model';
import * as issuesService from '../issues/issues.service';
import type { CreateIssueBody } from '../issues/issue.validation';
import {
  type AdoConnection,
  type AdoWorkItem,
  WORKITEMS_CHUNK,
  buildAdoWorkItemUrl,
  chunk,
  escapeWiqlString,
  extractIdFromWorkItemUrl,
  getParentAdoId,
  getWorkItemsByIds,
  wiqlQuery,
} from '../integrations/ado/adoClient.service';
import { adoWorkItemToCreateBody, adoWorkItemToUpdateBody } from '../integrations/ado/adoFieldMapper';
import { syncAdoHistoryToIssue } from '../integrations/ado/adoWorkItemHistory.service';
import { syncAdoAttachmentsToIssue } from '../integrations/ado/adoAttachments.service';
import { ProjectAdoIntegration } from '../integrations/ado/projectAdoIntegration.model';
import { decryptSecret } from '../../utils/secretCrypto';

export type AzureDevOpsImportOptions = {
  org?: string;
  adoProject?: string;
  pat?: string;
  reporterEmail: string;
  dryRun?: boolean;
  skipExisting?: boolean;
  wiql?: string;
  onProgress?: (message: string) => void | Promise<void>;
};

export type AzureDevOpsImportResult = {
  created: number;
  updated: number;
  skippedExisting: number;
  errors: number;
  parentsSet: number;
  linksCreated: number;
  dryRun: boolean;
  touchedIssueIds: string[];
  historyImported: number;
  attachmentsImported: number;
};

export async function resolveAdoCredentialsForProject(
  projectId: string,
  options: { org?: string; adoProject?: string; pat?: string }
): Promise<{ org: string; adoProject: string; pat: string }> {
  const integration = await ProjectAdoIntegration.findOne({ projectId }).lean();

  const org =
    options.org?.trim() ||
    integration?.org?.trim() ||
    process.env.AZURE_DEVOPS_ORG?.trim() ||
    '';
  const adoProject =
    options.adoProject?.trim() ||
    integration?.adoProject?.trim() ||
    process.env.AZURE_DEVOPS_PROJECT?.trim() ||
    '';

  let pat = options.pat?.trim() || process.env.AZURE_DEVOPS_PAT?.trim() || '';
  if (!pat && integration?.patEncrypted) {
    pat = decryptSecret(integration.patEncrypted);
  }

  if (!org || !adoProject || !pat) {
    throw new Error(
      'Azure DevOps org, project, and PAT are required (configure in Azure DevOps sync or enter here)'
    );
  }

  return { org, adoProject, pat };
}

async function reportProgress(
  options: AzureDevOpsImportOptions,
  message: string
): Promise<void> {
  if (options.onProgress) {
    await options.onProgress(message);
  }
}

export async function getAdoMappingForProject(projectId: string) {
  const integration = await ProjectAdoIntegration.findOne({ projectId }).lean();
  return {
    statusMap: (integration?.statusMap ?? {}) as Record<string, string>,
    typeMap: (integration?.typeMap ?? {}) as Record<string, string>,
    defaultWorkItemType: integration?.defaultWorkItemType ?? 'Task',
  };
}

async function resolveTaskflowProject(
  idOrKey: string
): Promise<{ _id: mongoose.Types.ObjectId; key: string }> {
  const isOid =
    mongoose.Types.ObjectId.isValid(idOrKey) &&
    String(new mongoose.Types.ObjectId(idOrKey)) === idOrKey;
  const q = isOid ? { _id: new mongoose.Types.ObjectId(idOrKey) } : { key: idOrKey.toUpperCase() };
  const p = await Project.findOne(q).select('_id key').lean();
  if (!p || !p._id) throw new Error(`Project not found: ${idOrKey}`);
  return { _id: p._id as mongoose.Types.ObjectId, key: String(p.key) };
}

export async function runAzureDevOpsImport(
  projectIdOrKey: string,
  options: AzureDevOpsImportOptions
): Promise<AzureDevOpsImportResult> {
  const tfProject = await resolveTaskflowProject(projectIdOrKey);
  const { org, adoProject, pat } = await resolveAdoCredentialsForProject(String(tfProject._id), options);
  if (!options.reporterEmail?.trim()) {
    throw new Error('Reporter email is required');
  }

  const reporter = await User.findOne({ email: options.reporterEmail.toLowerCase() })
    .select('_id enabled')
    .lean();
  if (!reporter?._id) throw new Error(`Reporter user not found: ${options.reporterEmail}`);
  if (reporter.enabled === false) throw new Error(`Reporter user is disabled: ${options.reporterEmail}`);
  const reporterId = String(reporter._id);

  const conn: AdoConnection = { org, adoProject, pat };
  await reportProgress(options, `Connecting to Azure DevOps org "${org}", project "${adoProject}"…`);

  const wiql =
    options.wiql?.trim() ||
    process.env.DEFAULT_WIQL?.trim() ||
    `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escapeWiqlString(adoProject)}'`;

  const allIds = await wiqlQuery(conn, wiql);
  await reportProgress(options, `Found ${allIds.length} work item(s) in Azure DevOps.`);

  const items: AdoWorkItem[] = [];
  for (const idChunk of chunk(allIds, WORKITEMS_CHUNK)) {
    const batch = (await getWorkItemsByIds(conn, idChunk)).filter(
      (w): w is AdoWorkItem => w != null && typeof w.id === 'number'
    );
    items.push(...batch);
    if (items.length % 200 === 0 || items.length === allIds.length) {
      await reportProgress(options, `Loaded ${items.length}/${allIds.length} work item details…`);
    }
  }

  const dryRun = !!options.dryRun;
  await reportProgress(
    options,
    dryRun ? 'Dry run — simulating import…' : `Importing ${items.length} work item(s)…`
  );

  const skipExisting = !!options.skipExisting;
  const adoIdToMongoId = new Map<number, string>();
  const skipped = { existing: 0, errors: 0 };
  let created = 0;
  let updated = 0;
  let historyImported = 0;
  let attachmentsImported = 0;
  const touchedIssueIds = new Set<string>();

  const mapping = await getAdoMappingForProject(String(tfProject._id));
  const projectIdStr = String(tfProject._id);

  async function syncAdoIssueExtras(
    issueId: string,
    workItem: AdoWorkItem,
    uploaderId: string
  ): Promise<void> {
    try {
      historyImported += await syncAdoHistoryToIssue(issueId, { backfill: true });
    } catch {
      /* skip history import errors */
    }
    try {
      attachmentsImported += await syncAdoAttachmentsToIssue(issueId, workItem, conn, uploaderId);
    } catch {
      /* skip attachment import errors */
    }
  }

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const adoId = item.id;
    const adoUrl = buildAdoWorkItemUrl(org, adoProject, adoId);
    const itemTitle = String(item.fields?.['System.Title'] ?? adoId).slice(0, 60);
    if (itemIndex === 0 || (itemIndex + 1) % 25 === 0 || itemIndex + 1 === items.length) {
      await reportProgress(options, `Processing ${itemIndex + 1}/${items.length}: #${adoId} ${itemTitle}`);
    }

    const existing = !dryRun
      ? await Issue.findOne({
          project: tfProject._id,
          'customFieldValues.adoWorkItemId': adoId,
        })
          .select('_id customFieldValues')
          .lean()
      : null;

    if (existing) {
      adoIdToMongoId.set(adoId, String(existing._id));

      if (skipExisting) {
        skipped.existing++;
        if (!dryRun) {
          await syncAdoIssueExtras(String(existing._id), item, reporterId);
        }
        continue;
      }

      if (dryRun) {
        updated++;
        continue;
      }

      try {
        const updateBody = await adoWorkItemToUpdateBody(item, mapping, projectIdStr);
        const mergedCustom = {
          ...((existing.customFieldValues as Record<string, unknown>) ?? {}),
          ...((updateBody.customFieldValues as Record<string, unknown>) ?? {}),
          adoWorkItemId: adoId,
          adoUrl,
        };
        delete updateBody.customFieldValues;

        await issuesService.update(
          String(existing._id),
          { ...updateBody, customFieldValues: mergedCustom },
          reporterId,
          { syncOrigin: 'ado' }
        );
        const issueId = String(existing._id);
        touchedIssueIds.add(issueId);
        const uploaderId =
          typeof updateBody.reporter === 'string' ? updateBody.reporter : reporterId;
        await syncAdoIssueExtras(issueId, item, uploaderId);
        updated++;
      } catch {
        skipped.errors++;
      }
      continue;
    }

    const body: CreateIssueBody = await adoWorkItemToCreateBody(
      item,
      projectIdStr,
      mapping,
      adoUrl
    );

    if (dryRun) {
      adoIdToMongoId.set(adoId, `dry-${adoId}`);
      created++;
      continue;
    }

    try {
      const doc = await issuesService.create(body, reporterId, { syncOrigin: 'ado' });
      const mid = String((doc as { _id?: unknown })._id);
      adoIdToMongoId.set(adoId, mid);
      touchedIssueIds.add(mid);
      const uploaderId = body.reporter ?? reporterId;
      await syncAdoIssueExtras(mid, item, uploaderId);
      created++;
    } catch {
      skipped.errors++;
    }
  }

  if (dryRun) {
    const dryResult = {
      created,
      updated,
      skippedExisting: skipped.existing,
      errors: skipped.errors,
      parentsSet: 0,
      linksCreated: 0,
      dryRun: true,
      touchedIssueIds: [] as string[],
      historyImported: 0,
      attachmentsImported: 0,
    };
    await finalizeAdoImportReport(options, dryResult);
    return dryResult;
  }

  let parentsSet = 0;
  for (const item of items) {
    const childMongo = adoIdToMongoId.get(item.id);
    const parentAdo = getParentAdoId(item);
    if (!childMongo || parentAdo == null) continue;
    const parentMongo = adoIdToMongoId.get(parentAdo);
    if (!parentMongo) continue;
    try {
      await issuesService.update(childMongo, { parent: parentMongo }, reporterId, { syncOrigin: 'ado' });
      parentsSet++;
    } catch {
      /* skip */
    }
  }

  let linksCreated = 0;
  for (const item of items) {
    const sourceMongo = adoIdToMongoId.get(item.id);
    if (!sourceMongo || !item.relations?.length) continue;
    for (const r of item.relations) {
      if (
        r.rel === 'System.LinkTypes.Hierarchy-Reverse' ||
        r.rel === 'System.LinkTypes.Hierarchy-Forward'
      ) {
        continue;
      }
      if (r.rel !== 'System.LinkTypes.Related') continue;
      const targetAdo = extractIdFromWorkItemUrl(r.url);
      if (targetAdo == null || targetAdo === item.id) continue;
      const targetMongo = adoIdToMongoId.get(targetAdo);
      if (!targetMongo) continue;
      try {
        await IssueLink.create({
          sourceIssue: sourceMongo,
          targetIssue: targetMongo,
          linkType: 'relates_to',
          createdBy: reporterId,
        });
        linksCreated++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/E11000|duplicate key/i.test(msg)) continue;
      }
    }
  }

  const finalResult = {
    created,
    updated,
    skippedExisting: skipped.existing,
    errors: skipped.errors,
    parentsSet,
    linksCreated,
    dryRun: false,
    touchedIssueIds: [...touchedIssueIds],
    historyImported,
    attachmentsImported,
  };
  await finalizeAdoImportReport(options, finalResult);
  return finalResult;
}

async function finalizeAdoImportReport(
  options: AzureDevOpsImportOptions,
  summary: AzureDevOpsImportResult
): Promise<void> {
  await reportProgress(
    options,
    `Done — created: ${summary.created}, updated: ${summary.updated}, skipped: ${summary.skippedExisting}, ` +
      `history: ${summary.historyImported}, attachments: ${summary.attachmentsImported}, errors: ${summary.errors}`
  );
}
