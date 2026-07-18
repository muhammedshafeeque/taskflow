import { userHasPermission } from './permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';

/** Subset of session user used to gate the workspace settings route and nav. */
export type TaskflowWorkspaceSettingsAccessUser = {
  role?: string;
  permissions?: string[];
  activeOrganizationId?: string;
  organizations?: { id: string; role?: string }[];
} | null;

/**
 * Whether the user may open Atrium workspace settings. Workspace org admins
 * (creators and promoted admins) have access even without global org.* permissions;
 * other users need org scope permissions or platform admin.
 */
export function canAccessTaskflowWorkspaceSettings(user: TaskflowWorkspaceSettingsAccessUser): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const activeId = user.activeOrganizationId;
  if (activeId && user.organizations?.some((o) => o.id === activeId && o.role === 'org_admin')) {
    return true;
  }
  const perms = user.permissions ?? [];
  return (
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG.READ) ||
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG.UPDATE) ||
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG_MEMBER.LIST) ||
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG_MEMBER.UPDATE) ||
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG_MEMBER.CREATE) ||
    userHasPermission(perms, TASK_FLOW_PERMISSIONS.ORG.ORG_MEMBER.DELETE)
  );
}
