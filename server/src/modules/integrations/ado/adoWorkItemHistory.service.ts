import mongoose from 'mongoose';
import { Issue } from '../../issues/issue.model';
import { IssueHistory } from '../../issues/issueHistory.model';
import { Project } from '../../projects/project.model';
import { User } from '../../auth/user.model';
import { ProjectAdoIntegration } from './projectAdoIntegration.model';
import { decryptSecret } from '../../../utils/secretCrypto';
import { resolveOrCreateAssigneeFromAdo } from './adoUserResolver.service';
import {
  type AdoConnection,
  getWorkItemUpdates,
  parseIdentityDisplayName,
  parseIdentityEmail,
} from './adoClient.service';

const ADO_FIELD_TO_TF: Record<string, string> = {
  'System.Title': 'title',
  'System.Description': 'description',
  'System.State': 'status',
  'System.AssignedTo': 'assignee',
  'System.CreatedBy': 'reporter',
  'System.Tags': 'labels',
  'System.Priority': 'priority',
  'System.WorkItemType': 'type',
  'System.IterationPath': 'sprint',
  'Microsoft.VSTS.Scheduling.StoryPoints': 'storyPoints',
  'Microsoft.VSTS.Scheduling.OriginalEstimate': 'timeEstimateMinutes',
};

const SKIP_FIELDS = new Set([
  'System.ChangedBy',
  'System.ChangedDate',
  'System.Rev',
  'System.AuthorizedDate',
  'System.AuthorizedAs',
  'System.Watermark',
  'System.History',
  'System.CommentCount',
  'System.BoardColumn',
  'System.BoardColumnDone',
  'System.BoardLane',
  'System.AreaPath',
  'System.Reason',
  'System.Parent',
]);

export interface AdoWorkItemHistoryItem {
  _id: string;
  source: 'azure_devops';
  rev: number;
  action: 'created' | 'field_change';
  author: { name: string; email?: string };
  createdAt: string;
  field?: string;
  fromValue?: string;
  toValue?: string;
  adoWorkItemId: number;
}

function formatAdoValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'None';
  const displayName = parseIdentityDisplayName(val);
  if (displayName) return displayName;
  if (typeof val === 'string') return val.trim() || 'None';
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (Array.isArray(val)) return val.map((v) => formatAdoValue(v)).join(', ') || 'None';
  return String(val);
}

function externalKey(adoWorkItemId: number, rev: number, suffix: string): string {
  return `ado:${adoWorkItemId}:rev:${rev}:${suffix}`;
}

async function resolveConnection(projectId: string): Promise<AdoConnection | null> {
  const integration = await ProjectAdoIntegration.findOne({ projectId }).lean();
  if (!integration?.patEncrypted || !integration.org || !integration.adoProject) {
    return null;
  }
  return {
    org: integration.org,
    adoProject: integration.adoProject,
    pat: decryptSecret(integration.patEncrypted),
  };
}

async function resolveFallbackAuthorId(projectId: string): Promise<string> {
  const project = await Project.findById(projectId).select('lead').lean();
  if (project?.lead) return String(project.lead);
  const admin = await User.findOne({ role: 'admin' }).select('_id').lean();
  if (admin?._id) return String(admin._id);
  throw new Error('No fallback author for ADO history import');
}

async function resolveAuthorId(
  revisedBy: unknown,
  projectId: string,
  fallbackUserId: string
): Promise<string> {
  const email = parseIdentityEmail(revisedBy);
  if (email) {
    const existing = await User.findOne({ email }).select('_id enabled').lean();
    if (existing?._id && existing.enabled !== false) return String(existing._id);
  }
  const created = await resolveOrCreateAssigneeFromAdo(revisedBy, projectId);
  return created ?? fallbackUserId;
}

async function resolveFieldValue(
  fieldKey: string,
  val: unknown,
  projectId: string
): Promise<unknown> {
  if (val === undefined) return undefined;
  if (fieldKey === 'System.AssignedTo' || fieldKey === 'System.CreatedBy') {
    if (val === null || val === '') return undefined;
    const userId = await resolveOrCreateAssigneeFromAdo(val, projectId);
    return userId ?? formatAdoValue(val);
  }
  if (fieldKey === 'System.Tags') {
    if (typeof val === 'string') {
      return val
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return val;
  }
  return formatAdoValue(val);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function syncAdoHistoryToIssue(
  issueId: string,
  options: { limit?: number; backfill?: boolean } = {}
): Promise<number> {
  const issue = await Issue.findById(issueId).select('project customFieldValues').lean();
  if (!issue) return 0;

  const custom = (issue.customFieldValues ?? {}) as Record<string, unknown>;
  const adoWorkItemId = custom.adoWorkItemId;
  if (typeof adoWorkItemId !== 'number') return 0;

  const projectId = String(issue.project);
  const conn = await resolveConnection(projectId);
  if (!conn) return 0;

  const backfill = options.backfill ?? false;
  const importStamp = new Date();

  if (backfill) {
    await IssueHistory.updateMany(
      { issue: issueId, source: 'ado' },
      { $set: { activityAt: importStamp } }
    );
  }

  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const updates = await getWorkItemUpdates(conn, adoWorkItemId, { top: limit });
  if (updates.length === 0) {
    if (backfill) {
      const res = await IssueHistory.updateMany(
        { issue: issueId, source: 'ado' },
        { $set: { activityAt: importStamp } }
      );
      return res.modifiedCount;
    }
    return 0;
  }

  const existingKeys = new Set(
    await IssueHistory.distinct('externalKey', {
      issue: issueId,
      source: 'ado',
      externalKey: { $exists: true },
    })
  );

  const fallbackAuthorId = await resolveFallbackAuthorId(projectId);
  const toInsert: Array<Record<string, unknown>> = [];

  for (const update of updates) {
    const authorId = await resolveAuthorId(update.revisedBy, projectId, fallbackAuthorId);
    const revisedAt = new Date(update.revisedDate);
    const activityAt = backfill ? importStamp : revisedAt;
    const fields = update.fields ?? {};
    const fieldKeys = Object.keys(fields).filter((k) => !SKIP_FIELDS.has(k));

    const createdKey = externalKey(adoWorkItemId, update.rev, 'created');
    if (update.rev === 1 && !existingKeys.has(createdKey)) {
      toInsert.push({
        issue: issueId,
        author: authorId,
        action: 'created',
        source: 'ado',
        externalKey: createdKey,
        adoRev: update.rev,
        createdAt: revisedAt,
        activityAt,
      });
      existingKeys.add(createdKey);
    }

    for (const fieldKey of fieldKeys) {
      const change = fields[fieldKey];
      if (!change) continue;

      const tfField = ADO_FIELD_TO_TF[fieldKey];
      if (!tfField) continue;

      const fromValue = await resolveFieldValue(fieldKey, change.oldValue, projectId);
      const toValue = await resolveFieldValue(fieldKey, change.newValue, projectId);
      if (valuesEqual(fromValue, toValue)) continue;

      const key = externalKey(adoWorkItemId, update.rev, tfField);
      if (existingKeys.has(key)) continue;

      toInsert.push({
        issue: issueId,
        author: authorId,
        action: 'field_change',
        field: tfField,
        fromValue,
        toValue,
        source: 'ado',
        externalKey: key,
        adoRev: update.rev,
        createdAt: revisedAt,
        activityAt,
      });
      existingKeys.add(key);
    }
  }

  if (toInsert.length === 0) return 0;

  try {
    await IssueHistory.collection.insertMany(toInsert);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/E11000|duplicate key/i.test(msg)) throw error;
  }

  return toInsert.length;
}

export async function syncAdoHistoryForProject(
  projectId: string,
  issueIds?: string[],
  options: { backfill?: boolean } = {}
): Promise<number> {
  const filter: Record<string, unknown> = {
    project: new mongoose.Types.ObjectId(projectId),
    'customFieldValues.adoWorkItemId': { $exists: true, $ne: null },
  };
  if (issueIds?.length) {
    filter._id = { $in: issueIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  const issues = await Issue.find(filter).select('_id').lean();
  let imported = 0;
  for (const issue of issues) {
    try {
      imported += await syncAdoHistoryToIssue(String(issue._id), {
        backfill: options.backfill ?? false,
      });
    } catch {
      /* skip per-issue failures */
    }
  }
  return imported;
}

function rowToAdoItem(
  row: {
    _id: unknown;
    action: string;
    author: { name?: string; email?: string };
    createdAt?: Date;
    field?: string;
    fromValue?: unknown;
    toValue?: unknown;
    adoRev?: number;
  },
  adoWorkItemId: number
): AdoWorkItemHistoryItem {
  return {
    _id: String(row._id),
    source: 'azure_devops',
    rev: row.adoRev ?? 0,
    action: row.action === 'created' ? 'created' : 'field_change',
    author: { name: row.author.name ?? 'Unknown', email: row.author.email },
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    field: row.field,
    fromValue: row.fromValue != null ? formatAdoValue(row.fromValue) : undefined,
    toValue: row.toValue != null ? formatAdoValue(row.toValue) : undefined,
    adoWorkItemId,
  };
}

export async function getAdoHistoryForIssue(
  issueId: string,
  options: { limit?: number; sync?: boolean } = {}
): Promise<{ items: AdoWorkItemHistoryItem[]; adoWorkItemId?: number; adoUrl?: string; imported?: number }> {
  const issue = await Issue.findById(issueId).select('project customFieldValues').lean();
  if (!issue) return { items: [] };

  const custom = (issue.customFieldValues ?? {}) as Record<string, unknown>;
  const adoWorkItemId = custom.adoWorkItemId;
  if (typeof adoWorkItemId !== 'number') return { items: [] };

  const adoUrl = typeof custom.adoUrl === 'string' ? custom.adoUrl : undefined;
  let imported = 0;
  if (options.sync !== false) {
    imported = await syncAdoHistoryToIssue(issueId, { limit: options.limit, backfill: false });
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const rows = await IssueHistory.find({ issue: issueId, source: 'ado' })
    .populate('author', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const items = rows.map((r) =>
    rowToAdoItem(
      {
        _id: r._id,
        action: r.action,
        author:
          r.author && typeof r.author === 'object' && 'name' in r.author
            ? (r.author as { name: string; email?: string })
            : { name: 'Unknown' },
        createdAt: r.createdAt,
        field: r.field,
        fromValue: r.fromValue,
        toValue: r.toValue,
        adoRev: r.adoRev,
      },
      adoWorkItemId
    )
  );

  return { items, adoWorkItemId, adoUrl, imported };
}
