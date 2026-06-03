import mongoose from 'mongoose';
import { env } from '../../config/env';
import { Project } from '../projects/project.model';
import { User } from '../auth/user.model';
import { Issue } from '../issues/issue.model';
import * as issuesService from '../issues/issues.service';
import type { CreateIssueBody } from '../issues/issue.validation';

export type JiraImportOptions = {
  reporterEmail: string;
  dryRun?: boolean;
  skipExisting?: boolean;
  jql?: string;
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  jiraProjectKey?: string;
};

export type JiraImportResult = {
  created: number;
  skippedExisting: number;
  errors: number;
  dryRun: boolean;
};

type JiraIssue = {
  id: string;
  key: string;
  fields?: Record<string, unknown>;
};

function jiraAuth(email: string, token: string): Record<string, string> {
  const basic = Buffer.from(`${email}:${token}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${basic}`, Accept: 'application/json' };
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

function mapPriority(name: unknown): string {
  if (typeof name === 'string' && name.trim()) return name.trim();
  return 'Medium';
}

export async function runJiraImport(
  projectIdOrKey: string,
  options: JiraImportOptions
): Promise<JiraImportResult> {
  const baseUrl = (options.baseUrl || env.jiraBaseUrl || '').replace(/\/$/, '');
  const email = options.email || env.jiraEmail;
  const apiToken = options.apiToken || env.jiraApiToken;
  const jiraProjectKey = options.jiraProjectKey || env.jiraProjectKey;
  if (!baseUrl || !email || !apiToken || !jiraProjectKey) {
    throw new Error('Jira base URL, email, API token, and project key are required');
  }
  if (!options.reporterEmail?.trim()) throw new Error('Reporter email is required');

  const projectOid = await resolveProject(projectIdOrKey);
  const reporter = await User.findOne({ email: options.reporterEmail.toLowerCase() })
    .select('_id enabled')
    .lean();
  if (!reporter?._id) throw new Error(`Reporter user not found: ${options.reporterEmail}`);
  const reporterId = String(reporter._id);

  const jql =
    options.jql?.trim() ||
    `project = ${jiraProjectKey} ORDER BY created ASC`;

  const issues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 50;
  for (;;) {
    const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=summary,description,status,issuetype,priority,assignee,labels,customfield_10016,parent`;
    const res = await fetch(url, { headers: jiraAuth(email, apiToken) });
    if (!res.ok) throw new Error(`Jira search failed ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { issues?: JiraIssue[]; total?: number };
    const batch = data.issues ?? [];
    issues.push(...batch);
    startAt += batch.length;
    if (batch.length === 0 || startAt >= (data.total ?? 0)) break;
  }

  const dryRun = !!options.dryRun;
  const skipExisting = !!options.skipExisting;
  const jiraKeyToMongo = new Map<string, string>();
  let created = 0;
  let skippedExisting = 0;
  let errors = 0;

  for (const item of issues) {
    const jiraId = item.id;
    const jiraKey = item.key;
    const fields = item.fields ?? {};
    const title = String(fields.summary ?? '(no title)').trim() || '(no title)';

    if (skipExisting && !dryRun) {
      const exists = await Issue.findOne({
        project: projectOid,
        'customFieldValues.jiraIssueId': jiraId,
      })
        .select('_id')
        .lean();
      if (exists) {
        jiraKeyToMongo.set(jiraKey, String(exists._id));
        skippedExisting++;
        continue;
      }
    }

    const statusObj = fields.status as { name?: string } | undefined;
    const typeObj = fields.issuetype as { name?: string } | undefined;
    const priorityObj = fields.priority as { name?: string } | undefined;
    const assigneeObj = fields.assignee as { emailAddress?: string } | undefined;

    let assigneeId: string | undefined;
    const assigneeEmail = assigneeObj?.emailAddress?.toLowerCase();
    if (assigneeEmail) {
      const u = await User.findOne({ email: assigneeEmail }).select('_id enabled').lean();
      if (u?._id && u.enabled !== false) assigneeId = String(u._id);
    }

    const labels = Array.isArray(fields.labels)
      ? (fields.labels as string[]).filter((l) => typeof l === 'string')
      : undefined;

    const sp = fields.customfield_10016;
    const storyPoints = typeof sp === 'number' && Number.isFinite(sp) ? sp : undefined;

    const body: CreateIssueBody = {
      title,
      description:
        typeof fields.description === 'string'
          ? fields.description
          : fields.description != null
            ? JSON.stringify(fields.description)
            : '',
      type: typeObj?.name ?? 'Task',
      priority: mapPriority(priorityObj?.name),
      status: statusObj?.name ?? 'Backlog',
      assignee: assigneeId,
      project: String(projectOid),
      boardColumn: statusObj?.name ?? 'Backlog',
      labels,
      storyPoints,
      customFieldValues: {
        jiraIssueId: jiraId,
        jiraIssueKey: jiraKey,
        jiraUrl: `${baseUrl}/browse/${jiraKey}`,
      },
    };

    if (dryRun) {
      jiraKeyToMongo.set(jiraKey, `dry-${jiraId}`);
      created++;
      continue;
    }

    try {
      const doc = await issuesService.create(body, reporterId);
      jiraKeyToMongo.set(jiraKey, String((doc as { _id?: unknown })._id));
      created++;
    } catch {
      errors++;
    }
  }

  if (!dryRun) {
    for (const item of issues) {
      const parent = item.fields?.parent as { key?: string } | undefined;
      const childMongo = jiraKeyToMongo.get(item.key);
      const parentKey = parent?.key;
      if (!childMongo || !parentKey) continue;
      const parentMongo = jiraKeyToMongo.get(parentKey);
      if (!parentMongo) continue;
      try {
        await issuesService.update(childMongo, { parent: parentMongo }, reporterId);
      } catch {
        /* skip */
      }
    }
  }

  return { created, skippedExisting, errors, dryRun };
}
