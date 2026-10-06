import crypto from 'crypto';
import { env } from '../../../config/env';
import { ApiError } from '../../../utils/ApiError';
import { Issue } from '../../issues/issue.model';
import { Project } from '../../projects/project.model';
import * as issueHistoryService from '../../issues/issueHistory.service';
import { notifyProjectRefresh } from '../../../websocket';
import { emitIssueEvent } from '../../webhooks/workspaceEvents';

/**
 * GitHub → Atrium. Point a repository webhook (JSON, events: push + pull_request)
 * at /api/webhooks/github with GITHUB_WEBHOOK_SECRET, and set the project's
 * GitHub repo in Project settings. Any commit or PR that mentions an issue key
 * (e.g. APP-42) is linked on that issue; a merged PR can move it to a status.
 */
const KEY_RX = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const MAX_LINKS = 50;

export function extractIssueKeys(text: string, projectKey: string): string[] {
  const keys = new Set<string>();
  for (const m of text.toUpperCase().matchAll(KEY_RX)) {
    if (m[1].startsWith(`${projectKey.toUpperCase()}-`)) keys.add(m[1]);
  }
  return [...keys];
}

export function verifyGithubSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  const got = Buffer.from(header.slice(7), 'hex');
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

type DevLink = NonNullable<import('../../issues/issue.model').IIssue['devLinks']>[number];

async function linkIssues(projectId: string, keys: string[], link: DevLink): Promise<string[]> {
  if (!keys.length) return [];
  const issues = await Issue.find({ project: projectId, key: { $in: keys } }).select('_id devLinks').lean();
  for (const issue of issues) {
    const existing = (issue.devLinks ?? []) as DevLink[];
    const others = existing.filter((l) => !(l.kind === link.kind && l.ref === link.ref));
    const next = [...others, link].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, MAX_LINKS);
    await Issue.updateOne({ _id: issue._id }, { $set: { devLinks: next } });
  }
  return issues.map((i) => String(i._id));
}

export async function handleGithubWebhook(rawBody: Buffer | undefined, event: string | undefined, signature: string | undefined) {
  const secret = env.githubWebhookSecret;
  if (!secret) throw new ApiError(503, 'GITHUB_WEBHOOK_SECRET not set');
  if (!rawBody || !verifyGithubSignature(rawBody, signature, secret)) throw new ApiError(401, 'Invalid signature');
  if (event === 'ping') return { ok: true };

  const body = JSON.parse(rawBody.toString('utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const repo = String(body.repository?.full_name ?? '').toLowerCase();
  if (!repo) return { ok: true };
  const projects = await Project.find({ githubRepo: repo }).select('_id key statuses githubMergedStatus').lean();
  if (!projects.length) return { ok: true, ignored: 'repository not linked to a project' };

  let linked = 0;
  for (const project of projects) {
    const projectId = String(project._id);
    if (event === 'push') {
      for (const c of (body.commits ?? []).slice(0, 100)) {
        const keys = extractIssueKeys(String(c.message ?? ''), project.key);
        linked += (
          await linkIssues(projectId, keys, {
            kind: 'commit',
            ref: String(c.id).slice(0, 12),
            url: String(c.url),
            title: String(c.message ?? '').split('\n')[0].slice(0, 200),
            author: c.author?.username || c.author?.name,
            at: new Date(c.timestamp ?? Date.now()),
          })
        ).length;
      }
    } else if (event === 'pull_request') {
      const pr = body.pull_request ?? {};
      const keys = extractIssueKeys(`${pr.title ?? ''} ${pr.head?.ref ?? ''} ${pr.body ?? ''}`, project.key);
      const merged = Boolean(pr.merged);
      const ids = await linkIssues(projectId, keys, {
        kind: 'pr',
        ref: `#${pr.number}`,
        url: String(pr.html_url),
        title: String(pr.title ?? '').slice(0, 200),
        author: pr.user?.login,
        state: merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
        at: new Date(pr.updated_at ?? Date.now()),
      });
      linked += ids.length;

      const target = project.githubMergedStatus;
      const validTarget = target && ((project.statuses ?? []) as Array<{ name: string }>).some((s) => s.name === target);
      if (body.action === 'closed' && merged && validTarget) {
        const toMove = await Issue.find({ _id: { $in: ids }, status: { $ne: target } }).select('_id key title status priority reporter').lean();
        for (const issue of toMove) {
          await Issue.updateOne({ _id: issue._id }, { $set: { status: target, boardColumn: target } });
          await issueHistoryService
            .recordFieldChanges(String(issue._id), String(issue.reporter), [
              { field: 'status', fromValue: issue.status, toValue: `${target} (PR ${pr.number} merged)` },
            ])
            .catch(() => undefined);
          emitIssueEvent(projectId, 'issue.status_changed', {
            issueId: String(issue._id),
            key: issue.key,
            title: issue.title,
            status: target,
            fromStatus: issue.status,
            via: 'github',
          });
        }
      }
    }
    if (linked) notifyProjectRefresh(projectId);
  }
  return { ok: true, linked };
}
