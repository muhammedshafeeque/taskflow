import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../../../config/env';
import { decryptSecret, encryptSecret } from '../../../utils/secretCrypto';
import { Project } from '../../projects/project.model';
import { User } from '../../auth/user.model';
import { Issue } from '../../issues/issue.model';
import * as issuesService from '../../issues/issues.service';
import { ProjectAdoIntegration } from './projectAdoIntegration.model';
import {
  type AdoConnection,
  buildAdoWorkItemUrl,
  createWorkItem,
  getWorkItem,
  testConnection,
  updateWorkItem,
} from './adoClient.service';
import {
  adoWorkItemToCreateBody,
  adoWorkItemToUpdateBody,
  issueToAdoCreatePatches,
  issueToAdoPatches,
} from './adoFieldMapper';
import { syncAdoHistoryToIssue } from './adoWorkItemHistory.service';
import { syncAdoAttachmentsToIssue } from './adoAttachments.service';

export type IssueSyncOptions = {
  syncOrigin?: 'ado' | 'taskflow';
};

const syncLocks = new Map<string, number>();
const SYNC_LOCK_TTL_MS = 3000;

function acquireSyncLock(issueId: string): boolean {
  const now = Date.now();
  const existing = syncLocks.get(issueId);
  if (existing && now - existing < SYNC_LOCK_TTL_MS) return false;
  syncLocks.set(issueId, now);
  return true;
}

function releaseSyncLock(issueId: string): void {
  syncLocks.delete(issueId);
}

export function buildWebhookUrl(projectId: string, webhookSecret: string): string {
  const base = env.appUrl.replace(/\/$/, '');
  const apiBase = base.includes('localhost:517') ? 'http://localhost:5000' : base;
  return `${apiBase}/api/webhooks/azure-devops/${projectId}?secret=${encodeURIComponent(webhookSecret)}`;
}

export async function getIntegrationForProject(projectId: string) {
  return ProjectAdoIntegration.findOne({ projectId }).lean();
}

function toConnection(integration: {
  org: string;
  adoProject: string;
  patEncrypted: string;
}): AdoConnection {
  return {
    org: integration.org,
    adoProject: integration.adoProject,
    pat: decryptSecret(integration.patEncrypted),
  };
}

function toMapping(integration: {
  statusMap?: Record<string, string>;
  typeMap?: Record<string, string>;
  defaultWorkItemType?: string;
}) {
  return {
    statusMap: (integration.statusMap ?? {}) as Record<string, string>,
    typeMap: (integration.typeMap ?? {}) as Record<string, string>,
    defaultWorkItemType: integration.defaultWorkItemType ?? 'Task',
  };
}

export async function saveIntegration(
  projectId: string,
  input: {
    enabled: boolean;
    org: string;
    adoProject: string;
    pat?: string;
    statusMap?: Record<string, string>;
    typeMap?: Record<string, string>;
    defaultWorkItemType?: string;
    autoSyncEnabled?: boolean;
    autoSyncIntervalMinutes?: number;
  }
) {
  let doc = await ProjectAdoIntegration.findOne({ projectId });
  if (!doc) {
    doc = new ProjectAdoIntegration({
      projectId: new mongoose.Types.ObjectId(projectId),
      webhookSecret: crypto.randomBytes(24).toString('hex'),
    });
  }

  doc.enabled = input.enabled;
  doc.org = input.org.trim();
  doc.adoProject = input.adoProject.trim();
  if (input.pat?.trim()) {
    doc.patEncrypted = encryptSecret(input.pat.trim());
  }
  if (input.statusMap) doc.statusMap = input.statusMap;
  if (input.typeMap) doc.typeMap = input.typeMap;
  if (input.defaultWorkItemType) doc.defaultWorkItemType = input.defaultWorkItemType;
  if (input.autoSyncEnabled !== undefined) doc.autoSyncEnabled = input.autoSyncEnabled;
  if (input.autoSyncIntervalMinutes !== undefined) {
    doc.autoSyncIntervalMinutes = Math.max(5, input.autoSyncIntervalMinutes);
  }

  if (!doc.patEncrypted) {
    throw new Error('PAT is required');
  }

  await doc.save();
  return doc;
}

export async function getIntegrationResponse(projectId: string) {
  const integration = await getIntegrationForProject(projectId);
  if (!integration) {
    return {
      enabled: false,
      org: '',
      adoProject: '',
      hasPat: false,
      statusMap: {},
      typeMap: {},
      defaultWorkItemType: 'Task',
      webhookUrl: '',
      webhookSecret: '',
      autoSyncEnabled: false,
      autoSyncIntervalMinutes: 15,
    };
  }

  return {
    enabled: integration.enabled,
    org: integration.org,
    adoProject: integration.adoProject,
    hasPat: !!integration.patEncrypted,
    statusMap: integration.statusMap ?? {},
    typeMap: integration.typeMap ?? {},
    defaultWorkItemType: integration.defaultWorkItemType ?? 'Task',
    webhookUrl: buildWebhookUrl(projectId, integration.webhookSecret),
    webhookSecret: integration.webhookSecret,
    lastSyncedAt: integration.lastSyncedAt,
    lastWebhookAt: integration.lastWebhookAt,
    lastAutoSyncAt: integration.lastAutoSyncAt,
    autoSyncEnabled: integration.autoSyncEnabled ?? false,
    autoSyncIntervalMinutes: integration.autoSyncIntervalMinutes ?? 15,
  };
}

export async function testAdoConnection(input: {
  org: string;
  adoProject: string;
  pat: string;
}) {
  return testConnection({ org: input.org.trim(), adoProject: input.adoProject.trim(), pat: input.pat.trim() });
}

async function resolveReporterId(projectId: string): Promise<string> {
  const project = await Project.findById(projectId).select('lead').lean();
  if (project?.lead) return String(project.lead);
  const adminRole = await User.findOne({ role: 'admin' }).select('_id').lean();
  if (adminRole?._id) return String(adminRole._id);
  throw new Error('No reporter user available for ADO sync');
}

export async function handleAdoWebhook(
  projectId: string,
  secret: string,
  payload: Record<string, unknown>
): Promise<{ handled: boolean; action?: string }> {
  const integration = await ProjectAdoIntegration.findOne({ projectId });
  if (!integration || !integration.enabled) {
    return { handled: false };
  }
  if (integration.webhookSecret !== secret) {
    throw new Error('Invalid webhook secret');
  }

  integration.lastWebhookAt = new Date();
  await integration.save();

  const eventType = String(payload.eventType ?? '');
  const resource = payload.resource as Record<string, unknown> | undefined;
  const workItemId =
    typeof resource?.id === 'number'
      ? resource.id
      : typeof resource?.workItemId === 'number'
        ? resource.workItemId
        : extractWorkItemIdFromUrl(String(resource?.url ?? ''));

  if (!workItemId) {
    return { handled: false };
  }

  const conn = toConnection(integration);
  const mapping = toMapping(integration);
  const workItem = await getWorkItem(conn, workItemId);
  const adoRev = workItem.fields?.['System.Rev'];
  const adoUrl = buildAdoWorkItemUrl(conn.org, conn.adoProject, workItemId);

  const existing = await Issue.findOne({
    project: projectId,
    'customFieldValues.adoWorkItemId': workItemId,
  }).lean();

  if (existing) {
    const storedRev = (existing.customFieldValues as Record<string, unknown>)?.adoExternalRev;
    if (typeof adoRev === 'number' && storedRev === adoRev) {
      return { handled: true, action: 'skipped_rev_match' };
    }

    if (!acquireSyncLock(String(existing._id))) {
      return { handled: true, action: 'skipped_lock' };
    }

    try {
      const updateBody = await adoWorkItemToUpdateBody(workItem, mapping, projectId);
      const mergedCustom = {
        ...((existing.customFieldValues as Record<string, unknown>) ?? {}),
        ...((updateBody.customFieldValues as Record<string, unknown>) ?? {}),
        adoWorkItemId: workItemId,
        adoUrl,
      };
      delete updateBody.customFieldValues;

      await issuesService.update(
        String(existing._id),
        { ...updateBody, customFieldValues: mergedCustom },
        undefined,
        { syncOrigin: 'ado' }
      );
      const issueId = String(existing._id);
      const uploaderId =
        typeof updateBody.reporter === 'string'
          ? updateBody.reporter
          : await resolveReporterId(projectId);
      await syncAdoHistoryToIssue(issueId).catch(() => {});
      await syncAdoAttachmentsToIssue(issueId, workItem, conn, uploaderId).catch(() => {});
      return { handled: true, action: 'updated' };
    } finally {
      releaseSyncLock(String(existing._id));
    }
  }

  if (!eventType.toLowerCase().includes('created')) {
    return { handled: false, action: 'not_found' };
  }

  const reporterId = await resolveReporterId(projectId);
  const createBody = await adoWorkItemToCreateBody(workItem, projectId, mapping, adoUrl);
  const created = await issuesService.create(createBody, reporterId, { syncOrigin: 'ado' });
  const createdId = String((created as { _id?: unknown })._id);
  const uploaderId = createBody.reporter ?? reporterId;
  await syncAdoHistoryToIssue(createdId).catch(() => {});
  await syncAdoAttachmentsToIssue(createdId, workItem, conn, uploaderId).catch(() => {});
  return { handled: true, action: 'created' };
}

function extractWorkItemIdFromUrl(url: string): number | null {
  const m = /\/workitems\/(\d+)/i.exec(url);
  return m ? parseInt(m[1], 10) : null;
}

export async function syncIssueToAdo(
  issueId: string,
  options: IssueSyncOptions = {}
): Promise<void> {
  if (options.syncOrigin === 'ado') return;

  const issue = await Issue.findById(issueId)
    .populate('assignee', 'email')
    .lean();
  if (!issue) return;

  const projectId = String(issue.project);
  const integration = await ProjectAdoIntegration.findOne({ projectId, enabled: true }).lean();
  if (!integration?.patEncrypted) return;

  if (!acquireSyncLock(issueId)) return;

  try {
    const conn = toConnection(integration);
    const mapping = toMapping(integration);
    const customFields = (issue.customFieldValues ?? {}) as Record<string, unknown>;
    const adoWorkItemId = customFields.adoWorkItemId as number | undefined;

    const issuePayload = {
      title: issue.title,
      description: issue.description,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      boardColumn: issue.boardColumn,
      labels: issue.labels,
      storyPoints: issue.storyPoints,
      timeEstimateMinutes: issue.timeEstimateMinutes,
      assignee: issue.assignee as { email?: string } | null,
    };

    if (!adoWorkItemId) {
      const { workItemType, patches } = issueToAdoCreatePatches(issuePayload, mapping);
      const created = await createWorkItem(conn, workItemType, patches);
      const rev = created.fields?.['System.Rev'];
      const url = buildAdoWorkItemUrl(conn.org, conn.adoProject, created.id);
      await Issue.findByIdAndUpdate(issueId, {
        $set: {
          customFieldValues: {
            ...customFields,
            adoWorkItemId: created.id,
            adoUrl: url,
            adoExternalRev: typeof rev === 'number' ? rev : undefined,
          },
        },
      });
    } else {
      const patches = issueToAdoPatches(issuePayload, mapping).map((p) => ({
        ...p,
        op: 'replace' as const,
      }));
      if (patches.length === 0) return;
      const updated = await updateWorkItem(conn, adoWorkItemId, patches);
      const rev = updated.fields?.['System.Rev'];
      await Issue.findByIdAndUpdate(issueId, {
        $set: {
          'customFieldValues.adoExternalRev': typeof rev === 'number' ? rev : undefined,
        },
      });
    }

    await ProjectAdoIntegration.updateOne({ projectId }, { $set: { lastSyncedAt: new Date() } });
  } finally {
    releaseSyncLock(issueId);
  }
}
