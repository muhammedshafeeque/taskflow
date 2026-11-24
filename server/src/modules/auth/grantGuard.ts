import type { Request } from 'express';
import { ApiError } from '../../utils/ApiError';
import { mapLegacyProjectOrGlobalPermissions, userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { User } from './user.model';
import { logAudit } from '../auditLogs/logAudit';

/** Whoever is handing out access, with their resolved permissions. */
export interface GrantActor {
  id: string;
  role?: string;
  permissions: string[];
}

export function grantActorOf(req: Request): GrantActor {
  if (!req.user?.id) throw new ApiError(401, 'Unauthorized');
  return { id: req.user.id, role: req.user.role, permissions: req.user.permissions ?? [] };
}

export const isPlatformAdmin = (actor: GrantActor): boolean => actor.role === 'admin';

/** The codes (legacy ones expanded, implied ones included) that `held` does not cover. */
export function permissionsNotHeld(held: string[], wanted: string[]): string[] {
  const covered = mapLegacyProjectOrGlobalPermissions(held);
  return mapLegacyProjectOrGlobalPermissions(wanted).filter((p) => !userHasPermission(covered, p));
}

function deny(actor: GrantActor, message: string, meta: Record<string, unknown>): never {
  logAudit({ userId: actor.id, action: 'access.grant.denied', resourceType: 'access', meta: { reason: message, ...meta } });
  throw new ApiError(403, message);
}

/** Nobody hands out rights they do not hold. Platform admins hold everything. */
export function assertCanGrant(actor: GrantActor, permissions: string[], meta: Record<string, unknown> = {}): void {
  if (isPlatformAdmin(actor)) return;
  const missing = permissionsNotHeld(actor.permissions, permissions);
  if (missing.length === 0) return;
  const shown = missing.slice(0, 5).join(', ');
  const more = missing.length > 5 ? ` and ${missing.length - 5} more` : '';
  deny(actor, `You cannot grant permissions you do not have: ${shown}${more}`, { ...meta, missing });
}

/**
 * May this person give someone this role? Their own rights cover it, or they hold "assign any role": someone who
 * runs accounts without being able to see everything. Those uses are audited and every administrator is told.
 * It never extends to administrators, to your own account, or to what a role contains.
 */
export function assertCanAssignRole(actor: GrantActor, role: { name?: string; permissions?: string[] }, meta: Record<string, unknown> = {}): void {
  const missing = isPlatformAdmin(actor) ? [] : permissionsNotHeld(actor.permissions, role.permissions ?? []);
  if (missing.length === 0) return;
  if (!userHasPermission(actor.permissions, TASK_FLOW_PERMISSIONS.AUTH.ROLE.ASSIGN_ANY)) return assertCanGrant(actor, role.permissions ?? [], meta);
  logAudit({ userId: actor.id, action: 'access.role.assigned_beyond_own', resourceType: 'access', meta: { ...meta, role: role.name, missing } });
  void (async () => {
    const [admins, who] = await Promise.all([User.find({ role: 'admin', enabled: { $ne: false } }).select('_id').lean(), User.findById(actor.id).select('name').lean()]);
    await Promise.all(
      admins.map((a) =>
        notifyUser({ userId: String(a._id), eventKey: 'system_alert', title: `Role "${role.name ?? ''}" was given out`, body: `${who?.name ?? 'Someone'} assigned a role with more rights than their own.`, link: '/audit-logs' }).catch(() => undefined)
      )
    );
  })().catch((err) => console.error('[access] alert failed', err));
}

/** Only platform admins create, change or weaken platform admins. */
export function assertCanManageAdmin(actor: GrantActor, involvesAdmin: boolean, meta: Record<string, unknown> = {}): void {
  if (involvesAdmin && !isPlatformAdmin(actor)) deny(actor, 'Only an administrator can do this to an administrator account', meta);
}

export function assertNotSelf(actor: GrantActor, targetUserId: string): void {
  if (actor.id === targetUserId) deny(actor, 'You cannot change your own permissions', { targetUserId });
}
