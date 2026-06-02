/** Bulk edit form state and API payload builder (shared by Issues + Global Issues). */

export type BulkFormState = {
  status?: string;
  assignee?: string;
  sprint?: string;
  storyPoints?: string;
  type?: string;
  priority?: string;
  labels?: string;
  fixVersionIds?: string[];
  fixVersionClear?: boolean;
  affectsVersionIds?: string[];
  affectsVersionsClear?: boolean;
  milestone?: string;
  dueDate?: string;
  startDate?: string;
  timeEstimateMinutes?: string;
  parent?: string;
};

export type BulkUpdatePayload = {
  status?: string;
  assignee?: string | null;
  sprint?: string | null;
  storyPoints?: number | null;
  labels?: string[];
  type?: string;
  priority?: string;
  fixVersion?: string[] | null;
  affectsVersions?: string[];
  milestone?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  timeEstimateMinutes?: number | null;
  parent?: string | null;
};

export function buildBulkUpdates(form: BulkFormState): BulkUpdatePayload | null {
  const updates: BulkUpdatePayload = {};
  let hasChange = false;

  if (form.status) {
    updates.status = form.status;
    hasChange = true;
  }
  if (form.assignee !== undefined && form.assignee !== '') {
    updates.assignee = form.assignee === '__unassigned__' ? null : form.assignee;
    hasChange = true;
  }
  if (form.sprint !== undefined && form.sprint !== '') {
    updates.sprint = form.sprint === '__backlog__' ? null : form.sprint;
    hasChange = true;
  }
  if (form.storyPoints !== undefined && form.storyPoints !== '') {
    updates.storyPoints = form.storyPoints === '__clear__' ? null : Number(form.storyPoints);
    hasChange = true;
  }
  if (form.type) {
    updates.type = form.type;
    hasChange = true;
  }
  if (form.priority) {
    updates.priority = form.priority;
    hasChange = true;
  }
  if (form.labels === '__clear__') {
    updates.labels = [];
    hasChange = true;
  } else if (form.labels?.trim()) {
    updates.labels = form.labels
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    hasChange = true;
  }
  if (form.fixVersionClear) {
    updates.fixVersion = null;
    hasChange = true;
  } else if (form.fixVersionIds && form.fixVersionIds.length > 0) {
    updates.fixVersion = form.fixVersionIds;
    hasChange = true;
  }
  if (form.affectsVersionsClear) {
    updates.affectsVersions = [];
    hasChange = true;
  } else if (form.affectsVersionIds && form.affectsVersionIds.length > 0) {
    updates.affectsVersions = form.affectsVersionIds;
    hasChange = true;
  }
  if (form.milestone !== undefined && form.milestone !== '') {
    updates.milestone = form.milestone === '__clear__' ? null : form.milestone;
    hasChange = true;
  }
  if (form.dueDate !== undefined && form.dueDate !== '') {
    updates.dueDate = form.dueDate === '__clear__' ? null : form.dueDate;
    hasChange = true;
  }
  if (form.startDate !== undefined && form.startDate !== '') {
    updates.startDate = form.startDate === '__clear__' ? null : form.startDate;
    hasChange = true;
  }
  if (form.timeEstimateMinutes !== undefined && form.timeEstimateMinutes !== '') {
    updates.timeEstimateMinutes =
      form.timeEstimateMinutes === '__clear__' ? null : Number(form.timeEstimateMinutes);
    hasChange = true;
  }
  if (form.parent !== undefined && form.parent !== '') {
    updates.parent = form.parent === '__clear__' ? null : form.parent;
    hasChange = true;
  }

  return hasChange ? updates : null;
}
