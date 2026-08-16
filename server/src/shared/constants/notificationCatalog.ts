export const NOTIFICATION_METHODS = [
  'in_app',
  'push',
  'email',
  'sms',
  'whatsapp',
  'discord',
  'slack',
  'teams',
  'telegram',
] as const;
export type NotificationMethod = (typeof NOTIFICATION_METHODS)[number];

export const NOTIFICATION_EVENTS = [
  // Tasks
  'task_assigned',
  'task_unassigned',
  'task_updated',
  'task_commented',
  'task_mentioned',
  'task_status_changed',
  'task_priority_changed',
  'task_due_soon',
  'task_overdue',
  'task_due_date_changed',
  'task_attachment_added',
  'task_linked',
  'task_moved_sprint',
  'task_estimate_changed',
  // Project
  'project_added',
  'project_removed',
  'project_role_changed',
  'project_invitation',
  'project_invitation_accepted',
  'project_settings_changed',
  // Sprint & release
  'sprint_started',
  'sprint_completed',
  'release_ready',
  'release_deployed',
  // Milestone
  'milestone_due_soon',
  'milestone_completed',
  // Approvals
  'approval_requested',
  'approval_decided',
  // Watchers
  'watch_comment',
  'watch_status',
  'watch_field',
  // QA
  'qa_test_failed',
  'qa_cycle_completed',
  // Time
  'timesheet_reminder',
  'timesheet_approved',
  'timesheet_rejected',
  // CRM
  'crm_quote_sent',
  'crm_quote_accepted',
  'crm_deal_won',
  'crm_deal_lost',
  // Documents
  'document_shared',
  // Workspace
  'workspace_member_added',
  'workspace_member_role_changed',
  'workspace_announcement',
  // System
  'system_alert',
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

export type NotificationMethodState = Record<NotificationMethod, boolean>;

export type NotificationEventDescriptor = {
  key: NotificationEventKey;
  label: string;
  description: string;
};

export const NOTIFICATION_EVENT_DESCRIPTORS: NotificationEventDescriptor[] = [
  { key: 'task_assigned', label: 'Task assigned', description: 'You are assigned to a task.' },
  { key: 'task_unassigned', label: 'Task unassigned', description: 'A task is unassigned from you.' },
  { key: 'task_updated', label: 'Task updated', description: 'Task details are updated.' },
  { key: 'task_commented', label: 'Task commented', description: 'New comment on a task.' },
  { key: 'task_mentioned', label: 'Mentioned in task', description: 'You are mentioned in a comment.' },
  { key: 'task_status_changed', label: 'Task status changed', description: 'Task status changes.' },
  { key: 'task_priority_changed', label: 'Task priority changed', description: 'Task priority changes.' },
  { key: 'task_due_soon', label: 'Task due soon', description: 'Task due date is approaching.' },
  { key: 'task_overdue', label: 'Task overdue', description: 'Task is overdue.' },
  { key: 'task_due_date_changed', label: 'Due date changed', description: 'A task due date is changed.' },
  { key: 'task_attachment_added', label: 'Attachment added', description: 'A file is attached to a task.' },
  { key: 'task_linked', label: 'Task linked', description: 'A related task link is added.' },
  { key: 'task_moved_sprint', label: 'Moved to sprint', description: 'A task is moved into or between sprints.' },
  { key: 'task_estimate_changed', label: 'Estimate changed', description: 'Task estimate or remaining work changes.' },
  { key: 'project_added', label: 'Added to project', description: 'You are added to a project.' },
  { key: 'project_removed', label: 'Removed from project', description: 'You are removed from a project.' },
  { key: 'project_role_changed', label: 'Project role changed', description: 'Your project role is updated.' },
  { key: 'project_invitation', label: 'Project invitation', description: 'Invitation to join a project.' },
  { key: 'project_invitation_accepted', label: 'Invitation accepted', description: 'Your invite gets accepted.' },
  {
    key: 'project_settings_changed',
    label: 'Project settings changed',
    description: 'Important project settings are updated.',
  },
  { key: 'sprint_started', label: 'Sprint started', description: 'A sprint starts.' },
  { key: 'sprint_completed', label: 'Sprint completed', description: 'A sprint completes.' },
  { key: 'release_ready', label: 'Release ready', description: 'A release is ready.' },
  { key: 'release_deployed', label: 'Release deployed', description: 'A release is deployed.' },
  { key: 'milestone_due_soon', label: 'Milestone due soon', description: 'A milestone due date is approaching.' },
  { key: 'milestone_completed', label: 'Milestone completed', description: 'A milestone is marked complete.' },
  { key: 'approval_requested', label: 'Approval requested', description: 'Approval action needed.' },
  { key: 'approval_decided', label: 'Approval decided', description: 'Approval accepted/rejected.' },
  { key: 'watch_comment', label: 'Watcher: comment', description: 'Watched issue has a new comment.' },
  { key: 'watch_status', label: 'Watcher: status', description: 'Watched issue status changes.' },
  { key: 'watch_field', label: 'Watcher: fields', description: 'Watched issue fields change.' },
  { key: 'qa_test_failed', label: 'QA test failed', description: 'A test case fails during a cycle.' },
  { key: 'qa_cycle_completed', label: 'QA cycle completed', description: 'A test cycle is completed.' },
  { key: 'timesheet_reminder', label: 'Timesheet reminder', description: 'Reminder to submit your timesheet.' },
  { key: 'timesheet_approved', label: 'Timesheet approved', description: 'Your timesheet was approved.' },
  { key: 'timesheet_rejected', label: 'Timesheet rejected', description: 'Your timesheet was rejected.' },
  { key: 'crm_quote_sent', label: 'Quote sent', description: 'A CRM quotation is sent to a customer.' },
  { key: 'crm_quote_accepted', label: 'Quote accepted', description: 'A CRM quotation is accepted.' },
  { key: 'crm_deal_won', label: 'Deal won', description: 'A CRM deal is marked won.' },
  { key: 'crm_deal_lost', label: 'Deal lost', description: 'A CRM deal is marked lost.' },
  { key: 'document_shared', label: 'Document shared', description: 'A document is shared with you.' },
  { key: 'workspace_member_added', label: 'Workspace member added', description: 'Workspace membership changes.' },
  { key: 'workspace_member_role_changed', label: 'Workspace role changed', description: 'Workspace role changes.' },
  { key: 'workspace_announcement', label: 'Workspace announcement', description: 'Workspace announcements.' },
  { key: 'system_alert', label: 'System alert', description: 'System-level alerts.' },
];

export function isNotificationEventKey(v: string): v is NotificationEventKey {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(v);
}
