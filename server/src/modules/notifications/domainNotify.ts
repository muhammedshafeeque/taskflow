import mongoose from 'mongoose';
import type { NotificationEventKey } from '../../shared/constants/notificationCatalog';
import { Issue } from '../issues/issue.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { notifyUser } from './notificationDispatch.service';

/**
 * Small helpers that turn domain events into notifications. Recipients come
 * from the data (assignee, reporter, project members, owners) and each user's
 * notification preferences decide the channels — nothing role-specific here.
 */
type Payload = { title: string; body?: string; link?: string; metadata?: Record<string, unknown> };

function ids(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map((v) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : v ? String(v) : ''))
        .filter((v) => mongoose.Types.ObjectId.isValid(v))
    ),
  ];
}

export async function notifyUsers(userIds: unknown[], eventKey: NotificationEventKey, payload: Payload, exceptUserId?: string | null) {
  const targets = ids(userIds).filter((u) => u !== exceptUserId);
  await Promise.all(targets.map((userId) => notifyUser({ userId, eventKey, ...payload }).catch(() => undefined)));
}

/** Assignee + reporter of an issue (minus whoever caused the event). */
export function notifyIssuePeople(issueId: string, eventKey: NotificationEventKey, payload: Omit<Payload, 'link'> & { link?: string }, actorId?: string | null) {
  void (async () => {
    const issue = await Issue.findById(issueId).select('key title assignee reporter project').lean();
    if (!issue) return;
    const link = payload.link ?? `/projects/${issue.project}/issues/${encodeURIComponent(issue.key ?? String(issue._id))}`;
    await notifyUsers([issue.assignee, issue.reporter], eventKey, { ...payload, link, metadata: { issueId, projectId: String(issue.project), ...(payload.metadata ?? {}) } }, actorId);
  })().catch((err) => console.error(`[notify] ${eventKey} failed`, err));
}

/** Everyone on a project (plus the lead). */
export function notifyProjectMembers(projectId: string, eventKey: NotificationEventKey, payload: Payload, actorId?: string | null) {
  void (async () => {
    const [members, project] = await Promise.all([
      ProjectMember.find({ project: projectId }).distinct('user'),
      Project.findById(projectId).select('lead').lean(),
    ]);
    await notifyUsers([...members, project?.lead], eventKey, { ...payload, metadata: { projectId, ...(payload.metadata ?? {}) } }, actorId);
  })().catch((err) => console.error(`[notify] ${eventKey} failed`, err));
}

export function issueLabel(issue: { key?: string | null; title?: string | null }): string {
  return issue.key ? `${issue.key} ${issue.title ?? ''}`.trim() : String(issue.title ?? 'Issue');
}
