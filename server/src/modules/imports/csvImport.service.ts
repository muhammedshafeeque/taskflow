import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';
import { Project } from '../projects/project.model';
import { User } from '../auth/user.model';
import { Issue } from '../issues/issue.model';
import * as issuesService from '../issues/issues.service';
import type { CreateIssueBody } from '../issues/issue.validation';

export type CsvImportOptions = {
  csvContent: string;
  reporterEmail: string;
  dryRun?: boolean;
  skipExisting?: boolean;
  /** Column header name for external id (dedupe). Default: externalId */
  externalIdColumn?: string;
};

export type CsvImportResult = {
  created: number;
  skippedExisting: number;
  errors: number;
  dryRun: boolean;
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const n = normHeader(name);
    const key = keys.find((k) => normHeader(k) === n);
    if (key && row[key]?.trim()) return row[key].trim();
  }
  return '';
}

async function resolveProject(idOrKey: string): Promise<mongoose.Types.ObjectId> {
  const isOid =
    mongoose.Types.ObjectId.isValid(idOrKey) &&
    String(new mongoose.Types.ObjectId(idOrKey)) === idOrKey;
  const q = isOid ? { _id: new mongoose.Types.ObjectId(idOrKey) } : { key: idOrKey.toUpperCase() };
  const p = await Project.findOne(q).select('_id').lean();
  if (!p?._id) throw new Error(`Project not found: ${idOrKey}`);
  return p._id as mongoose.Types.ObjectId;
}

export async function runCsvImport(
  projectIdOrKey: string,
  options: CsvImportOptions
): Promise<CsvImportResult> {
  if (!options.csvContent?.trim()) throw new Error('CSV content is required');
  if (!options.reporterEmail?.trim()) throw new Error('Reporter email is required');

  const projectOid = await resolveProject(projectIdOrKey);
  const reporter = await User.findOne({ email: options.reporterEmail.toLowerCase() })
    .select('_id enabled')
    .lean();
  if (!reporter?._id) throw new Error(`Reporter user not found: ${options.reporterEmail}`);
  if (reporter.enabled === false) throw new Error(`Reporter user is disabled`);
  const reporterId = String(reporter._id);

  const records = parse(options.csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const dryRun = !!options.dryRun;
  const skipExisting = !!options.skipExisting;
  const extCol = options.externalIdColumn || 'externalId';
  let created = 0;
  let skippedExisting = 0;
  let errors = 0;
  const keyToId = new Map<string, string>();

  for (const row of records) {
    const title = pick(row, 'title', 'summary', 'name') || '(no title)';
    const externalId = pick(row, extCol, 'externalid', 'id', 'key');
    const issueKey = pick(row, 'key', 'issuekey');

    if (skipExisting && externalId && !dryRun) {
      const exists = await Issue.findOne({
        project: projectOid,
        'customFieldValues.csvExternalId': externalId,
      })
        .select('_id key')
        .lean();
      if (exists) {
        skippedExisting++;
        if (exists.key) keyToId.set(String(exists.key), String(exists._id));
        continue;
      }
    }

    const spRaw = pick(row, 'storypoints', 'story_points', 'points');
    const storyPoints = spRaw ? Number(spRaw) : undefined;

    const body: CreateIssueBody = {
      title,
      description: pick(row, 'description', 'body'),
      type: pick(row, 'type', 'issuetype') || 'Task',
      priority: pick(row, 'priority') || 'Medium',
      status: pick(row, 'status', 'state') || 'Backlog',
      project: String(projectOid),
      boardColumn: pick(row, 'status', 'state') || 'Backlog',
      labels: pick(row, 'labels', 'tags')
        ? pick(row, 'labels', 'tags')
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      storyPoints: Number.isFinite(storyPoints) ? storyPoints : undefined,
      customFieldValues: externalId ? { csvExternalId: externalId } : undefined,
    };

    const assigneeEmail = pick(row, 'assignee', 'assigneeemail');
    if (assigneeEmail) {
      const u = await User.findOne({ email: assigneeEmail.toLowerCase() }).select('_id enabled').lean();
      if (u?._id && u.enabled !== false) body.assignee = String(u._id);
    }

    if (dryRun) {
      created++;
      if (issueKey) keyToId.set(issueKey, `dry-${created}`);
      continue;
    }

    try {
      const doc = await issuesService.create(body, reporterId);
      const docKey = (doc as { key?: string }).key;
      const mid = String((doc as { _id?: unknown })._id);
      if (docKey) keyToId.set(docKey, mid);
      if (issueKey) keyToId.set(issueKey, mid);
      created++;
    } catch {
      errors++;
    }
  }

  if (!dryRun) {
    for (const row of records) {
      const parentKey = pick(row, 'parent', 'parentkey', 'parent_key');
      const childKey = pick(row, 'key', 'issuekey');
      if (!parentKey || !childKey) continue;
      const childId = keyToId.get(childKey);
      const parentId = keyToId.get(parentKey);
      if (!childId || !parentId) continue;
      try {
        await issuesService.update(childId, { parent: parentId }, reporterId);
      } catch {
        /* skip */
      }
    }
  }

  return { created, skippedExisting, errors, dryRun };
}
