import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_DESCRIPTORS,
  type NotificationEventKey,
} from '../../shared/constants/notificationCatalog';
import {
  escapeHtml,
  tfCta,
  tfDetailTable,
  tfEmailWrap,
  type EmailAccent,
} from '../../services/email.service';

export type NotificationEmailContext = {
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
};

const DESCRIPTOR_BY_KEY = new Map(
  NOTIFICATION_EVENT_DESCRIPTORS.map((d) => [d.key, d] as const)
);

function metaString(metadata: Record<string, unknown> | undefined, key: string): string {
  const v = metadata?.[key];
  if (v == null || v === '') return '';
  return String(v);
}

function accentFor(eventKey: NotificationEventKey): EmailAccent {
  if (
    eventKey === 'task_overdue' ||
    eventKey === 'system_alert' ||
    eventKey === 'qa_test_failed' ||
    eventKey === 'timesheet_rejected' ||
    eventKey === 'crm_deal_lost' ||
    eventKey.includes('unassigned') ||
    eventKey.includes('removed') ||
    eventKey.includes('rejected')
  ) {
    return 'red';
  }
  if (
    eventKey === 'sprint_completed' ||
    eventKey === 'release_deployed' ||
    eventKey === 'approval_decided' ||
    eventKey === 'project_invitation_accepted' ||
    eventKey === 'milestone_completed' ||
    eventKey === 'crm_deal_won' ||
    eventKey === 'crm_quote_accepted' ||
    eventKey === 'timesheet_approved' ||
    eventKey === 'qa_cycle_completed'
  ) {
    return 'green';
  }
  return 'indigo';
}

function headingFor(eventKey: NotificationEventKey, title: string): string {
  const label = DESCRIPTOR_BY_KEY.get(eventKey)?.label;
  const primary = label || title;
  return `<p style="font-size:16px; font-weight:600; margin:0 0 8px; color:#0f172a;">${escapeHtml(primary)}</p>`;
}

function subtitle(text?: string): string {
  if (!text?.trim()) return '';
  return `<p style="margin:0 0 16px; color:#475569; font-size:14px;">${escapeHtml(text.trim())}</p>`;
}

function detailRowsFromContext(
  eventKey: NotificationEventKey,
  ctx: NotificationEmailContext
): { label: string; value: string }[] {
  const m = ctx.metadata ?? {};
  const rows: { label: string; value: string }[] = [];

  const issueKey = metaString(m, 'issueKey') || metaString(m, 'key');
  const issueTitle = metaString(m, 'issueTitle') || metaString(m, 'title');
  const projectName = metaString(m, 'projectName');
  const sprintName = metaString(m, 'sprintName');
  const releaseName = metaString(m, 'releaseName') || metaString(m, 'versionName');
  const fromStatus = metaString(m, 'fromStatus');
  const toStatus = metaString(m, 'toStatus');
  const priority = metaString(m, 'priority') || metaString(m, 'toPriority');
  const actor =
    metaString(m, 'actorName') || metaString(m, 'changedByName') || metaString(m, 'authorName');
  const role = metaString(m, 'roleName') || metaString(m, 'role');
  const decision = metaString(m, 'decision') || metaString(m, 'status');
  const quoteTitle = metaString(m, 'quoteTitle');
  const dealTitle = metaString(m, 'dealTitle');
  const milestoneName = metaString(m, 'milestoneName');

  if (issueKey) rows.push({ label: 'Issue', value: issueKey });
  if (issueTitle && issueTitle !== ctx.title) rows.push({ label: 'Title', value: issueTitle });
  if (projectName) rows.push({ label: 'Project', value: projectName });
  if (sprintName) rows.push({ label: 'Sprint', value: sprintName });
  if (releaseName) rows.push({ label: 'Release', value: releaseName });
  if (milestoneName) rows.push({ label: 'Milestone', value: milestoneName });
  if (quoteTitle) rows.push({ label: 'Quote', value: quoteTitle });
  if (dealTitle) rows.push({ label: 'Deal', value: dealTitle });
  if (fromStatus || toStatus) {
    rows.push({
      label: 'Status',
      value: fromStatus && toStatus ? `${fromStatus} → ${toStatus}` : toStatus || fromStatus,
    });
  }
  if (priority) rows.push({ label: 'Priority', value: priority });
  if (role) rows.push({ label: 'Role', value: role });
  if (decision && eventKey.startsWith('approval_')) rows.push({ label: 'Decision', value: decision });
  if (actor) rows.push({ label: 'By', value: actor });

  if (rows.length === 0 && ctx.title) {
    rows.push({ label: 'Summary', value: ctx.title });
  }

  return rows;
}

function ctaLabel(eventKey: NotificationEventKey): string {
  if (eventKey.startsWith('task_') || eventKey.startsWith('watch_')) return 'Open issue';
  if (eventKey.startsWith('project_')) return 'Open project';
  if (eventKey.startsWith('sprint_')) return 'Open sprint';
  if (eventKey.startsWith('release_')) return 'Open release';
  if (eventKey.startsWith('milestone_')) return 'Open milestone';
  if (eventKey.startsWith('approval_')) return 'Review approval';
  if (eventKey.startsWith('qa_')) return 'Open QA';
  if (eventKey.startsWith('timesheet_')) return 'Open timesheet';
  if (eventKey.startsWith('crm_')) return 'Open CRM';
  if (eventKey.startsWith('document_')) return 'Open document';
  if (eventKey.startsWith('workspace_')) return 'Open workspace';
  return 'Open in Atrium';
}

/**
 * Branded HTML email for any catalog notification event.
 * Used when callers of notifyUser do not supply a custom `html` body.
 */
export function buildNotificationEmailHtml(
  eventKey: NotificationEventKey,
  ctx: NotificationEmailContext
): string {
  const desc = DESCRIPTOR_BY_KEY.get(eventKey)?.description;
  const bodyText = ctx.body?.trim() || desc || '';
  const rows = detailRowsFromContext(eventKey, ctx);

  const inner = `${headingFor(eventKey, ctx.title)}
${subtitle(bodyText)}
${rows.length ? tfDetailTable(rows) : ''}
${ctx.link ? tfCta(ctx.link, ctaLabel(eventKey)) : ''}`;

  return tfEmailWrap(inner, accentFor(eventKey));
}

export function buildNotificationEmailSubject(
  eventKey: NotificationEventKey,
  title: string
): string {
  const label = DESCRIPTOR_BY_KEY.get(eventKey)?.label;
  if (!label) return title;
  if (!title || title.toLowerCase() === label.toLowerCase()) return label;
  return `${label}: ${title}`;
}

/** Every catalog event is covered by the generic branded builder. */
export const NOTIFICATION_EMAIL_TEMPLATE_KEYS: readonly NotificationEventKey[] = NOTIFICATION_EVENTS;
