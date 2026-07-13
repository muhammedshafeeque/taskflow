import {
  type AdoJsonPatchOp,
  type AdoWorkItem,
  formatTags,
  mapPriorityFromAdo,
  mapPriorityToAdo,
  parseIdentityEmail,
  parseTags,
} from './adoClient.service';
import type { CreateIssueBody } from '../../issues/issue.validation';
import { resolveOrCreateAssigneeFromAdo } from './adoUserResolver.service';

export interface AdoIntegrationMapping {
  statusMap: Record<string, string>;
  typeMap: Record<string, string>;
  defaultWorkItemType: string;
}

function mapAdoStateToTaskflow(
  adoState: string,
  statusMap: Record<string, string>
): string {
  for (const [tfStatus, adoStatus] of Object.entries(statusMap)) {
    if (adoStatus === adoState) return tfStatus;
  }
  return adoState;
}

function mapTaskflowStatusToAdo(
  tfStatus: string,
  statusMap: Record<string, string>
): string {
  return statusMap[tfStatus] ?? tfStatus;
}

function mapAdoTypeToTaskflow(adoType: string, typeMap: Record<string, string>): string {
  for (const [tfType, adoTypeVal] of Object.entries(typeMap)) {
    if (adoTypeVal === adoType) return tfType;
  }
  return adoType;
}

function mapTaskflowTypeToAdo(tfType: string, typeMap: Record<string, string>, defaultType: string): string {
  return typeMap[tfType] ?? defaultType;
}

export async function adoWorkItemToCreateBody(
  item: AdoWorkItem,
  projectId: string,
  mapping: AdoIntegrationMapping,
  adoUrl: string
): Promise<CreateIssueBody> {
  const fields = item.fields || {};
  const adoState = String(fields['System.State'] ?? 'Backlog');
  const adoType = String(fields['System.WorkItemType'] ?? 'Task');
  const status = mapAdoStateToTaskflow(adoState, mapping.statusMap);
  const type = mapAdoTypeToTaskflow(adoType, mapping.typeMap);

  let assigneeId: string | undefined;
  const assigneeEmail = parseIdentityEmail(fields['System.AssignedTo']);
  if (assigneeEmail) {
    assigneeId = await resolveOrCreateAssigneeFromAdo(fields['System.AssignedTo'], projectId);
  }

  let reporterId: string | undefined;
  const createdBy = fields['System.CreatedBy'];
  if (createdBy) {
    reporterId = await resolveOrCreateAssigneeFromAdo(createdBy, projectId);
  }

  let storyPoints: number | undefined;
  const sp = fields['Microsoft.VSTS.Scheduling.StoryPoints'];
  if (typeof sp === 'number' && Number.isFinite(sp)) storyPoints = sp;

  let timeEstimateMinutes: number | undefined;
  const rem = fields['Microsoft.VSTS.Scheduling.RemainingWork'];
  if (typeof rem === 'number' && Number.isFinite(rem) && rem > 0) {
    timeEstimateMinutes = Math.round(rem * 60);
  }

  const rev = fields['System.Rev'];

  return {
    title: String(fields['System.Title'] ?? '(no title)').trim() || '(no title)',
    description: typeof fields['System.Description'] === 'string' ? fields['System.Description'] : '',
    type,
    priority: mapPriorityFromAdo(fields['Microsoft.VSTS.Common.Priority']),
    status,
    assignee: assigneeId,
    reporter: reporterId,
    project: projectId,
    boardColumn: status,
    labels: parseTags(fields['System.Tags']),
    storyPoints,
    timeEstimateMinutes,
    customFieldValues: {
      adoWorkItemId: item.id,
      adoUrl,
      adoExternalRev: typeof rev === 'number' ? rev : undefined,
    },
  };
}

export async function adoWorkItemToUpdateBody(
  item: AdoWorkItem,
  mapping: AdoIntegrationMapping,
  projectId?: string
): Promise<Record<string, unknown>> {
  const fields = item.fields || {};
  const adoState = String(fields['System.State'] ?? 'Backlog');
  const adoType = String(fields['System.WorkItemType'] ?? 'Task');
  const status = mapAdoStateToTaskflow(adoState, mapping.statusMap);
  const type = mapAdoTypeToTaskflow(adoType, mapping.typeMap);

  let assigneeId: string | undefined;
  const assigneeEmail = parseIdentityEmail(fields['System.AssignedTo']);
  if (assigneeEmail) {
    assigneeId = await resolveOrCreateAssigneeFromAdo(fields['System.AssignedTo'], projectId);
  }

  let reporterId: string | undefined;
  const createdBy = fields['System.CreatedBy'];
  if (createdBy) {
    reporterId = await resolveOrCreateAssigneeFromAdo(createdBy, projectId);
  }

  let storyPoints: number | undefined;
  const sp = fields['Microsoft.VSTS.Scheduling.StoryPoints'];
  if (typeof sp === 'number' && Number.isFinite(sp)) storyPoints = sp;

  let timeEstimateMinutes: number | undefined;
  const rem = fields['Microsoft.VSTS.Scheduling.RemainingWork'];
  if (typeof rem === 'number' && Number.isFinite(rem) && rem > 0) {
    timeEstimateMinutes = Math.round(rem * 60);
  }

  const rev = fields['System.Rev'];

  return {
    title: String(fields['System.Title'] ?? '').trim(),
    description: typeof fields['System.Description'] === 'string' ? fields['System.Description'] : '',
    type,
    priority: mapPriorityFromAdo(fields['Microsoft.VSTS.Common.Priority']),
    status,
    boardColumn: status,
    assignee: assigneeId ?? null,
    reporter: reporterId ?? undefined,
    labels: parseTags(fields['System.Tags']),
    storyPoints,
    timeEstimateMinutes,
    customFieldValues: {
      adoExternalRev: typeof rev === 'number' ? rev : undefined,
    },
  };
}

export function issueToAdoPatches(
  issue: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    status?: string;
    boardColumn?: string;
    labels?: string[];
    storyPoints?: number;
    timeEstimateMinutes?: number;
    assignee?: { email?: string } | null;
  },
  mapping: AdoIntegrationMapping
): AdoJsonPatchOp[] {
  const patches: AdoJsonPatchOp[] = [];

  if (issue.title) {
    patches.push({ op: 'add', path: '/fields/System.Title', value: issue.title });
  }
  if (issue.description !== undefined) {
    patches.push({ op: 'add', path: '/fields/System.Description', value: issue.description ?? '' });
  }

  const status = issue.status ?? issue.boardColumn;
  if (status) {
    const adoState = mapTaskflowStatusToAdo(status, mapping.statusMap);
    patches.push({ op: 'add', path: '/fields/System.State', value: adoState });
  }

  if (issue.priority) {
    patches.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Common.Priority',
      value: mapPriorityToAdo(issue.priority),
    });
  }

  if (issue.labels !== undefined) {
    patches.push({ op: 'add', path: '/fields/System.Tags', value: formatTags(issue.labels ?? []) });
  }

  if (issue.storyPoints !== undefined && issue.storyPoints !== null) {
    patches.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
      value: issue.storyPoints,
    });
  }

  if (issue.timeEstimateMinutes !== undefined && issue.timeEstimateMinutes !== null) {
    patches.push({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
      value: Math.round((issue.timeEstimateMinutes / 60) * 100) / 100,
    });
  }

  const assigneeEmail = issue.assignee?.email;
  if (assigneeEmail) {
    patches.push({
      op: 'add',
      path: '/fields/System.AssignedTo',
      value: assigneeEmail,
    });
  }

  return patches;
}

export function issueToAdoCreatePatches(
  issue: {
    title: string;
    description?: string;
    type?: string;
    priority?: string;
    status?: string;
    boardColumn?: string;
    labels?: string[];
    storyPoints?: number;
    timeEstimateMinutes?: number;
    assignee?: { email?: string } | null;
  },
  mapping: AdoIntegrationMapping
): { workItemType: string; patches: AdoJsonPatchOp[] } {
  const workItemType = mapTaskflowTypeToAdo(
    issue.type ?? mapping.defaultWorkItemType,
    mapping.typeMap,
    mapping.defaultWorkItemType
  );
  return { workItemType, patches: issueToAdoPatches(issue, mapping) };
}
