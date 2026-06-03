import mongoose from 'mongoose';
import { Project } from '../projects/project.model';
import { User } from '../auth/user.model';
import { Issue } from '../issues/issue.model';
import { IssueLink } from '../issues/issueLink.model';
import * as issuesService from '../issues/issues.service';
import type { CreateIssueBody } from '../issues/issue.validation';

const API_VERSION = '7.1';
const WORKITEMS_CHUNK = 200;

export type AzureDevOpsImportOptions = {
  org?: string;
  adoProject?: string;
  pat?: string;
  reporterEmail: string;
  dryRun?: boolean;
  skipExisting?: boolean;
  wiql?: string;
};

export type AzureDevOpsImportResult = {
  created: number;
  skippedExisting: number;
  errors: number;
  parentsSet: number;
  linksCreated: number;
  dryRun: boolean;
};

interface AdoWorkItem {
  id: number;
  fields?: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string }>;
}

function adoAuthHeader(pat: string): Record<string, string> {
  const token = Buffer.from(`:${pat}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' };
}

function escapeWiqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function extractIdFromWorkItemUrl(url: string): number | null {
  const m = /\/workitems\/(\d+)/i.exec(url);
  return m ? parseInt(m[1], 10) : null;
}

function parseIdentityEmail(field: unknown): string | undefined {
  if (field == null) return undefined;
  if (typeof field === 'string') {
    const t = field.trim();
    if (t.includes('@')) return t.toLowerCase();
    return undefined;
  }
  if (typeof field === 'object' && 'uniqueName' in (field as object)) {
    const u = field as { uniqueName?: string };
    const name = (u.uniqueName || '').trim();
    if (name.includes('@')) return name.toLowerCase();
  }
  return undefined;
}

function mapPriority(p: unknown): string {
  if (typeof p === 'number' && Number.isFinite(p)) {
    if (p === 1) return 'Highest';
    if (p === 2) return 'High';
    if (p === 3) return 'Medium';
    if (p === 4) return 'Low';
  }
  if (typeof p === 'string' && p.trim()) return p.trim();
  return 'Medium';
}

function parseTags(tags: unknown): string[] {
  if (typeof tags !== 'string' || !tags.trim()) return [];
  return tags
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildAdoWorkItemUrl(org: string, adoProject: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(adoProject)}/_workitems/edit/${id}`;
}

function getParentAdoId(item: AdoWorkItem): number | undefined {
  const rels = item.relations;
  if (!rels?.length) return undefined;
  for (const r of rels) {
    if (r.rel === 'System.LinkTypes.Hierarchy-Reverse') {
      const pid = extractIdFromWorkItemUrl(r.url);
      if (pid != null) return pid;
    }
  }
  return undefined;
}

async function wiqlQuery(
  baseUrl: string,
  org: string,
  adoProject: string,
  pat: string,
  query: string
): Promise<number[]> {
  const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(adoProject)}/_apis/wit/wiql?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: adoAuthHeader(pat),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`WIQL failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { workItems?: Array<{ id: number }> };
  return (data.workItems || []).map((w) => w.id);
}

async function getWorkItemsByIds(
  baseUrl: string,
  org: string,
  adoProject: string,
  pat: string,
  ids: number[]
): Promise<AdoWorkItem[]> {
  if (ids.length === 0) return [];
  const idParam = ids.join(',');
  const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(adoProject)}/_apis/wit/workitems?ids=${idParam}&$expand=all&api-version=${API_VERSION}`;
  const res = await fetch(url, { headers: adoAuthHeader(pat) });
  if (!res.ok) throw new Error(`Get work items failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { value?: AdoWorkItem[] };
  return data.value || [];
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
  const org = options.org?.trim() || process.env.AZURE_DEVOPS_ORG?.trim();
  const adoProject = options.adoProject?.trim() || process.env.AZURE_DEVOPS_PROJECT?.trim();
  const pat = options.pat?.trim() || process.env.AZURE_DEVOPS_PAT?.trim();
  if (!org || !adoProject || !pat) {
    throw new Error('Azure DevOps org, project, and PAT are required');
  }
  if (!options.reporterEmail?.trim()) {
    throw new Error('Reporter email is required');
  }

  const tfProject = await resolveTaskflowProject(projectIdOrKey);
  const reporter = await User.findOne({ email: options.reporterEmail.toLowerCase() })
    .select('_id enabled')
    .lean();
  if (!reporter?._id) throw new Error(`Reporter user not found: ${options.reporterEmail}`);
  if (reporter.enabled === false) throw new Error(`Reporter user is disabled: ${options.reporterEmail}`);
  const reporterId = String(reporter._id);

  const baseUrl = 'https://dev.azure.com';
  const wiql =
    options.wiql?.trim() ||
    process.env.DEFAULT_WIQL?.trim() ||
    `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escapeWiqlString(adoProject)}'`;

  const allIds = await wiqlQuery(baseUrl, org, adoProject, pat, wiql);
  const items: AdoWorkItem[] = [];
  for (const idChunk of chunk(allIds, WORKITEMS_CHUNK)) {
    const batch = (await getWorkItemsByIds(baseUrl, org, adoProject, pat, idChunk)).filter(
      (w): w is AdoWorkItem => w != null && typeof w.id === 'number'
    );
    items.push(...batch);
  }

  const dryRun = !!options.dryRun;
  const skipExisting = !!options.skipExisting;
  const adoIdToMongoId = new Map<number, string>();
  const skipped = { existing: 0, errors: 0 };
  let created = 0;

  for (const item of items) {
    const adoId = item.id;
    const fields = item.fields || {};
    const title = String(fields['System.Title'] ?? '(no title)').trim() || '(no title)';

    if (skipExisting && !dryRun) {
      const exists = await Issue.findOne({
        project: tfProject._id,
        'customFieldValues.adoWorkItemId': adoId,
      })
        .select('_id')
        .lean();
      if (exists) {
        adoIdToMongoId.set(adoId, String(exists._id));
        skipped.existing++;
        continue;
      }
    }

    const description =
      typeof fields['System.Description'] === 'string' ? (fields['System.Description'] as string) : '';
    const status = String(fields['System.State'] ?? 'Backlog');
    const type = String(fields['System.WorkItemType'] ?? 'Task');
    const priority = mapPriority(fields['Microsoft.VSTS.Common.Priority']);

    let assigneeId: string | undefined;
    const assigneeEmail = parseIdentityEmail(fields['System.AssignedTo']);
    if (assigneeEmail) {
      const u = await User.findOne({ email: assigneeEmail }).select('_id enabled').lean();
      if (u?._id && u.enabled !== false) assigneeId = String(u._id);
    }

    const labels = parseTags(fields['System.Tags']);
    let storyPoints: number | undefined;
    const sp = fields['Microsoft.VSTS.Scheduling.StoryPoints'];
    if (typeof sp === 'number' && Number.isFinite(sp)) storyPoints = sp;

    let timeEstimateMinutes: number | undefined;
    const rem = fields['Microsoft.VSTS.Scheduling.RemainingWork'];
    if (typeof rem === 'number' && Number.isFinite(rem) && rem > 0) {
      timeEstimateMinutes = Math.round(rem * 60);
    }

    const body: CreateIssueBody = {
      title,
      description,
      type,
      priority,
      status,
      assignee: assigneeId,
      project: String(tfProject._id),
      boardColumn: status,
      labels,
      storyPoints,
      timeEstimateMinutes,
      customFieldValues: {
        adoWorkItemId: adoId,
        adoUrl: buildAdoWorkItemUrl(org, adoProject, adoId),
      },
    };

    if (dryRun) {
      adoIdToMongoId.set(adoId, `dry-${adoId}`);
      created++;
      continue;
    }

    try {
      const doc = await issuesService.create(body, reporterId);
      const mid = String((doc as { _id?: unknown })._id);
      adoIdToMongoId.set(adoId, mid);
      created++;
    } catch {
      skipped.errors++;
    }
  }

  if (dryRun) {
    return {
      created,
      skippedExisting: skipped.existing,
      errors: skipped.errors,
      parentsSet: 0,
      linksCreated: 0,
      dryRun: true,
    };
  }

  let parentsSet = 0;
  for (const item of items) {
    const childMongo = adoIdToMongoId.get(item.id);
    const parentAdo = getParentAdoId(item);
    if (!childMongo || parentAdo == null) continue;
    const parentMongo = adoIdToMongoId.get(parentAdo);
    if (!parentMongo) continue;
    try {
      await issuesService.update(childMongo, { parent: parentMongo }, reporterId);
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

  return {
    created,
    skippedExisting: skipped.existing,
    errors: skipped.errors,
    parentsSet,
    linksCreated,
    dryRun: false,
  };
}
