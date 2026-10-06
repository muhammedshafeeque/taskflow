export const ACTION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'assign', label: 'Assign to' },
  { value: 'set_status', label: 'Set status' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'add_label', label: 'Add label' },
  { value: 'notify_users', label: 'Notify' },
  { value: 'webhook', label: 'Call webhook' },
];

export const NOTIFY_TARGETS = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'reporter', label: 'Reporter' },
  { value: 'lead', label: 'Project lead' },
];
