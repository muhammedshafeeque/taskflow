/**
 * Import work items from Azure DevOps into a taskfow Project (MongoDB).
 *
 * Usage:
 *   cd server && npm run import-ado -- --taskflow-project PROJ --reporter-email admin@example.com
 *
 * Environment:
 *   MONGODB_URI              — MongoDB connection (same as app)
 *   AZURE_DEVOPS_ORG         — Azure DevOps organization name (dev.azure.com/{org})
 *   AZURE_DEVOPS_PROJECT     — Azure DevOps team project name (source)
 *   AZURE_DEVOPS_PAT         — Personal Access Token (Work Items: Read)
 *   IMPORT_REPORTER_EMAIL    — Optional default for --reporter-email
 *
 * Optional:
 *   DEFAULT_WIQL             — Override default WIQL (single line or use --wiql-file)
 *
 * Flags:
 *   --taskflow-project <idOrKey>  — Required. Destination taskfow project ObjectId or key.
 *   --reporter-email <email>      — User who becomes reporter on every imported issue.
 *   --dry-run                     — Log actions only; no database writes.
 *   --skip-existing               — Skip ADO work items already imported (customFieldValues.adoWorkItemId).
 *   --wiql-file <path>            — File containing WIQL query (overrides DEFAULT_WIQL).
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Project } from '../modules/projects/project.model';
import { User } from '../modules/auth/user.model';
import { Issue } from '../modules/issues/issue.model';
import { IssueLink } from '../modules/issues/issueLink.model';
import * as issuesService from '../modules/issues/issues.service';
import type { CreateIssueBody } from '../modules/issues/issue.validation';

const API_VERSION = '7.1';
const WORKITEMS_CHUNK = 200;

interface CliOptions {
  taskflowProject: string;
  reporterEmail?: string;
  dryRun: boolean;
  skipExisting: boolean;
  wiqlFile?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let taskflowProject = '';
  let reporterEmail: string | undefined;
  let dryRun = false;
  let skipExisting = false;
  let wiqlFile: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--skip-existing') {
      skipExisting = true;
      continue;
    }
    if (a === '--taskflow-project' && argv[i + 1]) {
      taskflowProject = argv[++i];
      continue;
    }
    if (a === '--reporter-email' && argv[i + 1]) {
      reporterEmail = argv[++i];
      continue;
    }
    if (a === '--wiql-file' && argv[i + 1]) {
      wiqlFile = argv[++i];
      continue;
    }
    if (a === '--help' || a === '-h') {
      console.log(`
Usage: npm run import-ado -- --taskflow-project <idOrKey> [options]

Options:
  --taskflow-project <idOrKey>  Destination taskfow project (MongoDB id or project key)
  --reporter-email <email>      Reporter user (or IMPORT_REPORTER_EMAIL)
  --dry-run                     No writes
  --skip-existing               Skip items already imported (adoWorkItemId)
  --wiql-file <path>            Custom WIQL query file
`);
      process.exit(0);
    }
  }

  reporterEmail = reporterEmail || process.env.IMPORT_REPORTER_EMAIL?.trim();

  return { taskflowProject, reporterEmail, dryRun, skipExisting, wiqlFile };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
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
  if (!m) return null;
  return parseInt(m[1], 10);
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

interface AdoWorkItem {
  id: number;
  rev?: number;
  fields?: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WIQL failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    workItems?: Array<{ id: number }>;
  };
  const ids = (data.workItems || []).map((w) => w.id);
  return ids;
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get work items failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { value?: AdoWorkItem[] };
  return data.value || [];
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

async function resolveTaskflowProject(idOrKey: string): Promise<{ _id: mongoose.Types.ObjectId; key: string }> {
  const isOid = mongoose.Types.ObjectId.isValid(idOrKey) && String(new mongoose.Types.ObjectId(idOrKey)) === idOrKey;
  const q = isOid ? { _id: new mongoose.Types.ObjectId(idOrKey) } : { key: idOrKey.toUpperCase() };
  const p = await Project.findOne(q).select('_id key').lean();
  if (!p || !p._id) throw new Error(`taskfow project not found: ${idOrKey}`);
  return { _id: p._id as mongoose.Types.ObjectId, key: String(p.key) };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts.taskflowProject) {
    console.error('Error: --taskflow-project is required.');
    process.exit(1);
  }
  if (!opts.reporterEmail) {
    console.error('Error: --reporter-email or IMPORT_REPORTER_EMAIL is required.');
    process.exit(1);
  }

  const org = requireEnv('AZURE_DEVOPS_ORG');
  const adoProject = requireEnv('AZURE_DEVOPS_PROJECT');
  const pat = requireEnv('AZURE_DEVOPS_PAT');
  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/pm-tool';

  const baseUrl = 'https://dev.azure.com';

  let wiql: string;
  if (opts.wiqlFile) {
    wiql = fs.readFileSync(path.resolve(opts.wiqlFile), 'utf8').trim();
  } else if (process.env.DEFAULT_WIQL?.trim()) {
    wiql = process.env.DEFAULT_WIQL.trim();
  } else {
    const esc = escapeWiqlString(adoProject);
    wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${esc}'`;
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const tfProject = await resolveTaskflowProject(opts.taskflowProject);
  const reporter = await User.findOne({ email: opts.reporterEmail.toLowerCase() }).select('_id enabled').lean();
  if (!reporter || !reporter._id) {
    throw new Error(`Reporter user not found: ${opts.reporterEmail}`);
  }
  if (reporter.enabled === false) {
    throw new Error(`Reporter user is disabled: ${opts.reporterEmail}`);
  }
  const reporterId = String(reporter._id);

  console.log(`Destination project: ${tfProject.key} (${tfProject._id})`);
  console.log(`Reporter: ${opts.reporterEmail}`);
  console.log(opts.dryRun ? 'DRY RUN — no writes' : 'Writing to database');

  console.log('Fetching work item IDs from Azure DevOps (WIQL)...');
  const allIds = await wiqlQuery(baseUrl, org, adoProject, pat, wiql);
  console.log(`Found ${allIds.length} work item(s).`);

  const items: AdoWorkItem[] = [];
  for (const idChunk of chunk(allIds, WORKITEMS_CHUNK)) {
    const batch = (await getWorkItemsByIds(baseUrl, org, adoProject, pat, idChunk)).filter(
      (w): w is AdoWorkItem => w != null && typeof w.id === 'number'
    );
    items.push(...batch);
  }
  if (items.length !== allIds.length) {
    console.warn(
      `Warning: fetched ${items.length} work item(s) but WIQL returned ${allIds.length} id(s) (removed or inaccessible items).`
    );
  }

  const adoIdToMongoId = new Map<number, string>();
  const skipped = { existing: 0, errors: 0 };
  let created = 0;

  for (const item of items) {
    const adoId = item.id;
    const fields = item.fields || {};
    const title = String(fields['System.Title'] ?? '(no title)').trim() || '(no title)';

    if (opts.skipExisting && !opts.dryRun) {
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
      typeof fields['System.Description'] === 'string'
        ? (fields['System.Description'] as string)
        : typeof fields['System.Description'] === 'number'
          ? String(fields['System.Description'])
          : '';

    const status = String(fields['System.State'] ?? 'Backlog');
    const type = String(fields['System.WorkItemType'] ?? 'Task');
    const priority = mapPriority(fields['Microsoft.VSTS.Common.Priority']);

    let assigneeId: string | undefined;
    const assigneeEmail = parseIdentityEmail(fields['System.AssignedTo']);
    if (assigneeEmail) {
      const u = await User.findOne({ email: assigneeEmail }).select('_id enabled').lean();
      if (u && u._id && u.enabled !== false) {
        assigneeId = String(u._id);
      } else {
        console.warn(`  [${adoId}] Assignee not found or disabled: ${assigneeEmail}`);
      }
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

    const adoUrl = buildAdoWorkItemUrl(org, adoProject, adoId);
    const customFieldValues: Record<string, unknown> = {
      adoWorkItemId: adoId,
      adoUrl,
    };

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
      customFieldValues,
    };

    if (opts.dryRun) {
      console.log(`  [dry-run] would create: ADO #${adoId} → ${title.slice(0, 60)}${title.length > 60 ? '…' : ''}`);
      adoIdToMongoId.set(adoId, `dry-${adoId}`);
      created++;
      continue;
    }

    try {
      const doc = await issuesService.create(body, reporterId);
      const obj = doc as { _id?: unknown };
      const mid = String(obj._id);
      adoIdToMongoId.set(adoId, mid);
      created++;
      console.log(`  Created ${(obj as { key?: string }).key ?? mid} ← ADO #${adoId}`);
    } catch (e) {
      skipped.errors++;
      console.error(`  Failed ADO #${adoId}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nPhase 1 done: created ${created}, skipped existing ${skipped.existing}, errors ${skipped.errors}`);

  if (opts.dryRun) {
    console.log('Dry run: skipping parent links and issue links.');
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  console.log('\nPhase 2: parent links...');
  let parentsSet = 0;
  for (const item of items) {
    const adoId = item.id;
    const childMongo = adoIdToMongoId.get(adoId);
    const parentAdo = getParentAdoId(item);
    if (!childMongo || parentAdo == null) continue;
    const parentMongo = adoIdToMongoId.get(parentAdo);
    if (!parentMongo) {
      console.warn(`  [${adoId}] Parent ADO #${parentAdo} not in import set; skip parent`);
      continue;
    }
    try {
      await issuesService.update(
        childMongo,
        { parent: parentMongo },
        reporterId
      );
      parentsSet++;
    } catch (e) {
      console.error(`  Parent link failed ADO #${adoId}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`Parent links set: ${parentsSet}`);

  console.log('\nPhase 3: non-hierarchy links (System.LinkTypes.Related → relates_to)...');
  let linksCreated = 0;
  for (const item of items) {
    const sourceAdo = item.id;
    const sourceMongo = adoIdToMongoId.get(sourceAdo);
    if (!sourceMongo) continue;
    const rels = item.relations;
    if (!rels?.length) continue;

    for (const r of rels) {
      if (r.rel === 'System.LinkTypes.Hierarchy-Reverse' || r.rel === 'System.LinkTypes.Hierarchy-Forward') {
        continue;
      }
      if (r.rel !== 'System.LinkTypes.Related') continue;

      const targetAdo = extractIdFromWorkItemUrl(r.url);
      if (targetAdo == null || targetAdo === sourceAdo) continue;
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
        const code = (e as { code?: number })?.code;
        if (code === 11000) continue;
        const msg = e instanceof Error ? e.message : String(e);
        if (/E11000|duplicate key/i.test(msg)) continue;
        console.warn(`  Link skip ADO ${sourceAdo} → ${targetAdo}: ${msg}`);
      }
    }
  }
  console.log(`Issue links created: ${linksCreated}`);

  await mongoose.disconnect();
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
