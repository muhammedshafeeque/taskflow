import mongoose from 'mongoose';
import { Issue } from '../modules/issues/issue.model';
import { ApiError } from '../utils/ApiError';
import {
  getProjectPermissionsForUser,
  hasProjectFullAccess,
} from './requireProjectPermission';

export interface IssueActionContext {
  issueId: string;
  projectId: string;
  permissions: string[];
  userId: string;
}

/** Resolve issue → project and load member permissions for service-layer checks. */
export async function getIssueActionContext(
  issueId: string,
  userId: string,
  userGlobalPermissions?: string[],
  activeOrganizationId?: string
): Promise<IssueActionContext> {
  const issue = await Issue.findById(issueId).select('project').lean();
  if (!issue?.project) throw new ApiError(404, 'Issue not found');
  const projectId = String(issue.project);
  const permissions = await getProjectPermissionsForUser(
    projectId,
    userId,
    userGlobalPermissions,
    activeOrganizationId
  );
  if (permissions.length === 0 && !(userGlobalPermissions && hasProjectFullAccess(userGlobalPermissions))) {
    throw new ApiError(403, 'You are not a member of this project');
  }
  const effective =
    userGlobalPermissions && hasProjectFullAccess(userGlobalPermissions)
      ? permissions.length > 0
        ? permissions
        : await getProjectPermissionsForUser(projectId, userId, userGlobalPermissions, activeOrganizationId)
      : permissions;
  return { issueId, projectId, permissions: effective, userId };
}

export function assertIssuePermission(ctx: IssueActionContext, permission: string, message?: string): void {
  if (ctx.permissions.includes(permission)) return;
  throw new ApiError(403, message ?? 'Insufficient permissions for this action');
}

export function memberHasPermission(ctx: IssueActionContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}
