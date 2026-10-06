import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { MonitorErrorGroup, MonitorProject } from './monitor.models';
import { Project } from '../projects/project.model';
import * as issuesService from '../issues/issues.service';
import { getProjectPermissionsForUser, hasProjectFullAccess } from '../../middleware/requireProjectPermission';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { env } from '../../config/env';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One click from a Monitor error group to a tracked bug. The error group keeps
 * a link to the issue so it isn't filed twice.
 */
export async function createIssueFromErrorGroup(params: {
  workspaceId: string | null | undefined;
  monitorProjectId: string;
  groupId: string;
  pmProjectId: string;
  user: { id: string; permissions?: string[] };
}) {
  const orgId = requireWorkspaceId(params.workspaceId);
  if (!mongoose.Types.ObjectId.isValid(params.pmProjectId)) throw new ApiError(400, 'Choose a project for the issue');

  const group = await MonitorErrorGroup.findOne({
    _id: params.groupId,
    projectId: params.monitorProjectId,
    taskflowOrganizationId: toOrgOid(orgId),
  });
  if (!group) throw new ApiError(404, 'Error group not found');
  if (group.linkedIssueId) {
    throw new ApiError(409, `Already linked to ${group.linkedIssueKey ?? 'an issue'}`);
  }

  const pm = await Project.findOne({ _id: params.pmProjectId, taskflowOrganizationId: toOrgOid(orgId) })
    .select('_id key issueTypes priorities lead')
    .lean();
  if (!pm) throw new ApiError(404, 'Project not found in this workspace');
  // The PA bot's service account (trusted via the ingest secret) files issues as the project lead.
  const isService = params.user.id === 'pa-service';
  const reporterId = isService ? String(pm.lead) : params.user.id;
  const perms = params.user.permissions ?? [];
  if (!isService && !hasProjectFullAccess(perms)) {
    const projectPerms = await getProjectPermissionsForUser(String(pm._id), params.user.id, perms, orgId);
    if (!projectPerms.includes(PROJECT_PERMISSIONS.ISSUE.ISSUE.CREATE)) {
      throw new ApiError(403, 'You cannot create issues in that project');
    }
  }

  const monitorProject = await MonitorProject.findById(params.monitorProjectId).select('name').lean();
  const types = ((pm.issueTypes ?? []) as Array<{ name: string }>).map((t) => t.name);
  const bugType = types.find((t) => /bug|defect/i.test(t)) ?? types[0] ?? 'Bug';
  const priorities = ((pm.priorities ?? []) as Array<{ name: string }>).map((p) => p.name);
  const priority = group.count >= 100 ? priorities.find((p) => /high|critical|urgent/i.test(p)) : undefined;
  const monitorUrl = `${env.appUrl.replace(/\/$/, '')}/monitor/${params.monitorProjectId}/errors?group=${group._id}`;

  const description = [
    `<p><strong>From Monitor</strong> (${escapeHtml(monitorProject?.name ?? 'project')}): <a href="${monitorUrl}">open error group</a></p>`,
    `<ul><li>Type: ${escapeHtml(group.type ?? 'Error')}</li><li>Occurrences: ${group.count}</li>`,
    `<li>First seen: ${new Date(group.firstSeen).toUTCString()}</li><li>Last seen: ${new Date(group.lastSeen).toUTCString()}</li></ul>`,
    group.sampleStack ? `<pre><code>${escapeHtml(String(group.sampleStack).slice(0, 6000))}</code></pre>` : '',
  ].join('');

  const issue = (await issuesService.create(
    {
      project: String(pm._id),
      title: `[Error] ${String(group.message).slice(0, 180)}`,
      description,
      type: bugType,
      ...(priority ? { priority } : {}),
      labels: ['monitor'],
    },
    reporterId
  )) as { _id: unknown; key?: string };

  group.linkedIssueId = new mongoose.Types.ObjectId(String(issue._id));
  group.linkedIssueKey = issue.key;
  group.linkedProjectId = pm._id as mongoose.Types.ObjectId;
  if (!group.acknowledgedAt) {
    group.acknowledgedAt = new Date();
    if (mongoose.Types.ObjectId.isValid(params.user.id)) group.acknowledgedBy = new mongoose.Types.ObjectId(params.user.id);
  }
  await group.save();
  return { issueId: String(issue._id), issueKey: issue.key, projectId: String(pm._id) };
}
