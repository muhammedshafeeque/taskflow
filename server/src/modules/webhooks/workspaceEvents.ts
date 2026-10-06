import { dispatchWebhook } from '../crm/ecosystem/ecosystem.service';
import { Project } from '../projects/project.model';

/**
 * Events a workspace webhook can subscribe to. Payloads are signed with the
 * webhook's secret (HMAC-SHA256 hex in `X-TaskFlow-Signature`).
 */
export const WORKSPACE_WEBHOOK_EVENTS = [
  'lead.converted',
  'deal.won',
  'quote.sent',
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'ticket.created',
  'ticket.updated',
  'ticket.resolved',
  'ticket.commented',
  'invoice.sent',
  'invoice.paid',
  'invoice.overdue',
  'invoice.void',
  'invoice.payment_recorded',
] as const;

export type WorkspaceWebhookEvent = (typeof WORKSPACE_WEBHOOK_EVENTS)[number];

/** Fire-and-forget: webhook delivery must never slow down or fail the request that caused it. */
export function emitWorkspaceEvent(
  workspaceId: string | null | undefined,
  event: WorkspaceWebhookEvent,
  payload: Record<string, unknown>
): void {
  if (!workspaceId) return;
  dispatchWebhook(String(workspaceId), event, payload).catch((err) =>
    console.error(`[webhooks] ${event} dispatch failed:`, err)
  );
}

/** Issues belong to projects; resolve the workspace from the project. */
export function emitIssueEvent(projectId: string, event: WorkspaceWebhookEvent, payload: Record<string, unknown>): void {
  Project.findById(projectId)
    .select('taskflowOrganizationId key')
    .lean()
    .then((p) => {
      if (p?.taskflowOrganizationId) {
        emitWorkspaceEvent(String(p.taskflowOrganizationId), event, { projectId, projectKey: p.key, ...payload });
      }
    })
    .catch(() => undefined);
}
