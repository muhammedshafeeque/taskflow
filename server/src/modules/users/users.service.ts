import crypto from 'crypto';
import mongoose from 'mongoose';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Role } from '../roles/role.model';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';
import { mergeTaskflowPermissionFloor } from '../auth/permissionMerge';
import { ProjectMember } from '../projects/projectMember.model';
import { resolveEffectiveGlobalPermissions } from '../auth/effectivePermissions';
import { ApiError } from '../../utils/ApiError';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import type { UpdateUserBody, InviteUserBody } from './users.validation';
import { sendInviteEmail, sendWorkspaceJoinInviteEmail } from '../../services/email.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { shouldSend } from '../notifications/notificationPreference.service';
import * as inboxService from '../inbox/inbox.service';
import { Project } from '../projects/project.model';
import * as projectInvitationsService from '../projects/projectInvitations.service';
import { hasProjectFullAccess } from '../../middleware/requireProjectPermission';
import { roleTreePermissions } from '../auth/accessProfile';
import { assertCanAssignRole, assertCanGrant, assertCanManageAdmin, assertNotSelf, type GrantActor } from '../auth/grantGuard';
import { adminReset as adminResetTwoFactor } from '../auth/twoFactor.service';
import { logAudit } from '../auditLogs/logAudit';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

import dotenv from 'dotenv';
dotenv.config();

async function ensureGlobalProjectMembership(user: any) {
  if (!user) return;
  let perms = user.permissions;
  if (!perms || perms.length === 0) {
    const rolePerms = await roleTreePermissions([user.roleId?._id ?? user.roleId]);
    perms = mergeTaskflowPermissionFloor(
      resolveEffectiveGlobalPermissions({
        rolePermissions: rolePerms,
        role: user.role,
        mustChangePassword: false,
        permissionOverrides: user.permissionOverrides,
      })
    );
    // Cache only — session (/me) always re-resolves from role + overrides
    await User.findByIdAndUpdate(user._id, { $set: { permissions: perms } });
  }

  if (hasProjectFullAccess(perms)) {
    const projects = await Project.find().select('_id').lean();
    for (const p of projects) {
      await projectInvitationsService.ensureUserIsDefaultProjectMember(String(p._id), String(user._id));
    }
  }
}

export async function findAll(
  pagination: PaginationOptions = { page: 1, limit: 20 },
  taskflowOrganizationId?: string | null
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 1,
    };
  }

  const orgOid = new mongoose.Types.ObjectId(taskflowOrganizationId);
  const memberUserIds = await OrganizationMember.find({ organization: orgOid, status: 'active' }).distinct('user');
  if (memberUserIds.length === 0) {
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 1,
    };
  }

  const [rawData, total, projectCounts] = await Promise.all([
    User.find({ _id: { $in: memberUserIds }, isServiceAccount: { $ne: true } })
      .select('-password')
      .populate('roleId', 'name permissions')
      .lean()
      .skip(skip)
      .limit(limit),
    User.countDocuments({ _id: { $in: memberUserIds }, isServiceAccount: { $ne: true } }),
    ProjectMember.aggregate<{ _id: unknown; count: number }>([
      { $match: { user: { $in: memberUserIds } } },
      {
        $lookup: {
          from: 'projects',
          localField: 'project',
          foreignField: '_id',
          as: 'proj',
        },
      },
      { $unwind: '$proj' },
      { $match: { 'proj.taskflowOrganizationId': orgOid } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
  ]);

  const countMap = new Map(projectCounts.map((p) => [String(p._id), p.count]));
  const data = rawData.map((u) => ({
    ...u,
    projectCount: countMap.get(String(u._id)) ?? 0,
  }));

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function findById(id: string): Promise<unknown | null> {
  const user = await User.findById(id)
    .select('-password')
    .populate('roleId', 'name permissions')
    .lean();
  return user ?? null;
}

export async function update(
  id: string,
  input: UpdateUserBody,
  actor: GrantActor,
  hasEditPermission: boolean
): Promise<unknown | null> {
  const isSelf = id === actor.id;

  if (isSelf) {
    // Self-update: only name (profile updates like avatar go through auth/me)
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (Object.keys(updateData).length === 0) {
      const user = await User.findById(id).select('-password').populate('roleId', 'name').lean();
      return user ?? null;
    }
    const user = await User.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
      .select('-password')
      .populate('roleId', 'name')
      .lean();
    return user ?? null;
  }

  if (!hasEditPermission) {
    throw new ApiError(403, 'You do not have permission to edit other users');
  }

  const target = await User.findById(id).select('role roleId enabled').lean();
  if (!target) return null;
  const currentRoleId = target.roleId ? String(target.roleId) : null;
  // The edit form always sends the role: only a real change resets the person's overrides.
  const roleChanged = input.roleId !== undefined && (input.roleId || null) !== currentRoleId;

  assertCanManageAdmin(actor, target.role === 'admin' || input.role === 'admin', { targetUserId: id });

  // Admin update: name, roleId, enabled
  const newRole = roleChanged && input.roleId ? await Role.findById(input.roleId).lean() : null;
  if (roleChanged && input.roleId && !newRole) throw new ApiError(400, 'Invalid role');
  const newRolePerms = newRole ? await roleTreePermissions([newRole._id]) : [];
  if (newRole) assertCanAssignRole(actor, { name: newRole.name, permissions: newRolePerms }, { targetUserId: id, roleId: input.roleId });

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.role !== undefined) updateData.role = input.role;
  if (roleChanged) {
    updateData.roleId = input.roleId || null;
    const rolePerms = newRolePerms;
    updateData.permissions = mergeTaskflowPermissionFloor(
      resolveEffectiveGlobalPermissions({
        rolePermissions: rolePerms,
        role: input.role ?? target.role ?? 'user',
        mustChangePassword: false,
        permissionOverrides: { granted: [], revoked: [] }
      })
    );
    updateData.permissionOverrides = { granted: [], revoked: [] };
  }
  if (input.enabled !== undefined) updateData.enabled = input.enabled;

  const user = await User.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
    .select('-password')
    .populate('roleId', 'name')
    .lean();

  // Nobody can change their own account type, so an administrator always remains — unless two demote each other at once.
  const losesOwner = target.role === 'admin' && (input.role === 'user' || input.enabled === false);
  if (losesOwner && !(await User.exists({ role: 'admin', enabled: { $ne: false }, isServiceAccount: { $ne: true } }))) {
    await User.updateOne({ _id: id }, { $set: { role: target.role, enabled: target.enabled, roleId: target.roleId ?? null } });
    throw new ApiError(409, 'At least one administrator must remain');
  }

  if (user) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (roleChanged) changes.roleId = { from: currentRoleId, to: input.roleId || null };
    if (input.role !== undefined && input.role !== target.role) changes.role = { from: target.role, to: input.role };
    if (input.enabled !== undefined && input.enabled !== target.enabled) changes.enabled = { from: target.enabled, to: input.enabled };
    if (Object.keys(changes).length > 0) {
      logAudit({ userId: actor.id, action: 'user.access.update', resourceType: 'user', resourceId: id, meta: changes });
    }
    await ensureGlobalProjectMembership(user);
  }

  return user ?? null;
}

export async function updatePermissionOverrides(
  id: string,
  overrides: { granted: string[]; revoked: string[] },
  actor: GrantActor
): Promise<unknown | null> {
  const existingUser = await User.findById(id).populate('roleId', 'permissions').lean();
  if (!existingUser) return null;
  const existingGranted = existingUser.permissionOverrides?.granted ?? [];

  const role = existingUser.roleId as any;
  const rolePerms: string[] = await roleTreePermissions([role?._id]);
  const existingRevoked = existingUser.permissionOverrides?.revoked ?? [];

  assertNotSelf(actor, id);
  assertCanManageAdmin(actor, existingUser.role === 'admin', { targetUserId: id });
  // Grants someone else made may stay. Lifting a revoke hands the permission back, so it counts as a grant.
  assertCanGrant(
    actor,
    [
      ...overrides.granted.filter((p) => !existingGranted.includes(p)),
      ...existingRevoked.filter((p) => !overrides.revoked.includes(p) && (rolePerms.includes(p) || overrides.granted.includes(p))),
    ],
    { targetUserId: id }
  );

  const mergedPerms = mergeTaskflowPermissionFloor(
    resolveEffectiveGlobalPermissions({
      rolePermissions: rolePerms,
      role: existingUser.role,
      mustChangePassword: false,
      permissionOverrides: overrides,
    })
  );

  const user = await User.findByIdAndUpdate(
    id,
    { 
      $set: { 
        permissionOverrides: { granted: overrides.granted, revoked: overrides.revoked },
        permissions: mergedPerms
      } 
    },
    { new: true, runValidators: true }
  )
    .select('-password')
    .populate('roleId', 'name permissions')
    .lean();

  if (user) {
    await ensureGlobalProjectMembership(user);

    logAudit({
      userId: actor.id,
      action: 'user.permissions.update',
      resourceType: 'user',
      resourceId: id,
      meta: {
        granted: overrides.granted,
        revoked: overrides.revoked,
        previous: { granted: existingGranted, revoked: existingRevoked },
      },
    });
    const newlyGranted = overrides.granted.filter((perm) => !existingGranted.includes(perm));
    if (newlyGranted.length > 0) {
      await inboxService
        .createMessage({
          toUser: String(user._id),
          type: 'permission_granted',
          title: 'Permissions granted',
          body: `You have been granted ${newlyGranted.length} permission${newlyGranted.length > 1 ? 's' : ''}: ${newlyGranted.join(', ')}`,
          meta: { permissions: newlyGranted },
        })
        .catch((err) => console.error('Failed to create permission granted inbox message:', err));
    }
  }

  return user ?? null;
}

async function resolveOrganizationIdForInvite(taskflowOrganizationId?: string | null): Promise<string> {
  if (taskflowOrganizationId && mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    return taskflowOrganizationId;
  }
  const defaultOrg = await Organization.findOne().sort({ createdAt: 1 }).lean();
  if (!defaultOrg?._id) {
    throw new ApiError(400, 'Active workspace is required to invite users');
  }
  return String(defaultOrg._id);
}

async function upsertActiveOrgMember(organizationId: string, userId: mongoose.Types.ObjectId): Promise<void> {
  await OrganizationMember.updateOne(
    { organization: organizationId, user: userId },
    {
      $set: { role: 'org_member', status: 'active' },
      $setOnInsert: {
        organization: organizationId,
        user: userId,
      },
    },
    { upsert: true }
  );
}

async function addUserToWorkspaceProjectsIfFullAccess(
  userId: string,
  permissions: string[] | undefined,
  organizationId: string
): Promise<void> {
  if (!hasProjectFullAccess(permissions || [])) return;
  const projects = await Project.find({ taskflowOrganizationId: organizationId }).select('_id').lean();
  for (const p of projects) {
    await projectInvitationsService.ensureUserIsDefaultProjectMember(String(p._id), userId);
  }
}

export type InviteOutcome = {
  inviteKind: 'new_user' | 'workspace_join';
  status: 200 | 201;
  user: unknown;
  /** Whether the chosen role is the one the person now has (AUT-35). */
  role: { applied: boolean; requested: string; current: string; message?: string };
  /** What happened with the HR employee record. */
  employee: import('../hrms/accountLink').EmployeeLinkResult;
};

export async function invite(
  input: InviteUserBody,
  taskflowOrganizationId: string | undefined,
  actor: GrantActor
): Promise<InviteOutcome> {
  const inviterUserId = actor.id;
  const role = await Role.findById(input.roleId).lean();
  if (!role) throw new ApiError(400, 'Invalid role');
  const rolePermsAll = await roleTreePermissions([role._id]);
  assertCanAssignRole(actor, { name: role.name, permissions: rolePermsAll }, { email: input.email, roleId: input.roleId });

  const normalizedEmail = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  const organizationId = await resolveOrganizationIdForInvite(taskflowOrganizationId);

  if (existing) {
    const existingId = existing._id as mongoose.Types.ObjectId;
    const membership = await OrganizationMember.findOne({
      organization: organizationId,
      user: existingId,
    }).lean();
    if (membership?.status === 'active') {
      throw new ApiError(409, 'User is already a member of this workspace');
    }

    // A person has one role, used in every workspace they belong to. Never change it silently (AUT-35):
    // only when the inviter asks for it, and is allowed to change roles; otherwise say so clearly.
    const currentRoleId = existing.roleId ? String(existing.roleId) : null;
    const currentRole = currentRoleId ? await Role.findById(currentRoleId).select('name').lean() : null;
    let roleResult: InviteOutcome['role'];
    if (currentRoleId === String(input.roleId)) {
      roleResult = { applied: true, requested: role.name, current: role.name };
    } else if (input.applyRole) {
      if (!userHasPermission(actor.permissions, TASK_FLOW_PERMISSIONS.AUTH.USER.CHANGE_ROLE) && actor.role !== 'admin') {
        throw new ApiError(403, "Changing an existing person's role needs the change role permission");
      }
      await update(String(existingId), { roleId: String(input.roleId) } as UpdateUserBody, actor, true);
      roleResult = { applied: true, requested: role.name, current: role.name, message: `Role changed from ${currentRole?.name ?? 'none'} to ${role.name}. It applies in every workspace they belong to.` };
    } else {
      roleResult = {
        applied: false,
        requested: role.name,
        current: currentRole?.name ?? 'none',
        message: `${(existing as { name?: string }).name ?? 'This person'} already has an account with the role ${currentRole?.name ?? 'none'}, which applies in every workspace. Their role was not changed to ${role.name}; change it in Users if they should have it.`,
      };
    }

    await upsertActiveOrgMember(organizationId, existingId);

    const org = await Organization.findById(organizationId).select('name').lean();
    const workspaceName = (org as { name?: string } | null)?.name ?? 'Atrium workspace';
    const inviter = await User.findById(inviterUserId).select('name').lean();
    const inviterName = (inviter as { name?: string } | null)?.name ?? 'A teammate';
    const appBase = process.env.FRONTEND_URL ?? '';

    const existingUserId = String(existingId);
    if (await shouldSend(existingUserId, 'workspace_member_added', 'email')) {
      await sendWorkspaceJoinInviteEmail({
        inviteeName: (existing as { name?: string }).name ?? input.name.trim(),
        email: normalizedEmail,
        workspaceName,
        inviterName,
        appUrl: appBase,
      }).catch((err) => console.error('Failed to send workspace join email:', err));
    }

    if (await shouldSend(existingUserId, 'workspace_member_added', 'in_app')) {
      await inboxService
        .createMessage({
          toUser: existingUserId,
          type: 'workspace_join',
          title: `Added to workspace: ${workspaceName}`,
          body: `${inviterName} added you to the workspace "${workspaceName}". Sign in with your existing Atrium account — no new password was sent.`,
          meta: { organizationId, inviterUserId },
        })
        .catch((err) => console.error('Failed to create workspace join inbox message:', err));
    }

    await notifyUser({
      userId: existingUserId,
      eventKey: 'workspace_member_added',
      title: `Added to workspace: ${workspaceName}`,
      body: `${inviterName} added you to this workspace. Sign in with your existing account.`,
      link: `${appBase.replace(/\/$/, '')}/`,
    }).catch((err) => console.error('Failed to dispatch workspace join notifications:', err));

    const fresh = await User.findById(existingId).select('permissions').lean();
    await addUserToWorkspaceProjectsIfFullAccess(
      String(existingId),
      (fresh as { permissions?: string[] } | null)?.permissions,
      organizationId
    );

    logAudit({ userId: actor.id, action: 'user.workspace.add', resourceType: 'user', resourceId: existingUserId, meta: { organizationId, roleApplied: roleResult.applied } });
    const { connectEmployee } = await import('../hrms/accountLink');
    const employee = await connectEmployee(String(organizationId), { id: existingUserId, email: normalizedEmail, name: (existing as { name?: string }).name ?? input.name.trim() }, input.employee, actor);
    const doc = await User.findById(existingId).select('-password').populate('roleId', 'name').lean();
    return { inviteKind: 'workspace_join', status: 200, user: doc ?? existing, role: roleResult, employee };
  }

  if (process.env.MAX_USERS && parseInt(process.env.MAX_USERS) > 0) {
    const count = await User.countDocuments({ isServiceAccount: { $ne: true } });
    if (count >= parseInt(process.env.MAX_USERS)) {
      throw new ApiError(403, 'User limit reached. Cannot invite more users.');
    }
  }

  // Random unguessable password — never emailed; invitee sets via reset link.
  const plainPassword = crypto.randomBytes(32).toString('hex');
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const rolePerms = rolePermsAll;
  const initialPerms = mergeTaskflowPermissionFloor(
    resolveEffectiveGlobalPermissions({
      rolePermissions: rolePerms,
      role: 'user',
      mustChangePassword: false,
      permissionOverrides: null,
    })
  );
  const user = await User.create({
    email: normalizedEmail,
    password: plainPassword,
    name: input.name.trim(),
    role: 'user',
    roleId: input.roleId,
    mustChangePassword: true,
    permissions: initialPerms,
    passwordResetToken: resetHash,
    passwordResetExpires: resetExpires,
  });

  logAudit({ userId: actor.id, action: 'user.invite', resourceType: 'user', resourceId: String(user._id), meta: { roleId: input.roleId, organizationId } });

  const appUrl = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '');
  const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  await sendInviteEmail({
    name: input.name.trim(),
    email: input.email.trim(),
    appUrl,
    resetLink,
  }).catch((err) => console.error('Failed to send invite email:', err));

  await inboxService
    .createMessage({
      toUser: user._id.toString(),
      type: 'welcome',
      title: 'Welcome to Atrium',
      body: 'Your account has been created. Use the set-password link in your invite email to choose a password.',
    })
    .catch((err) => console.error('Failed to create welcome message:', err));

  await upsertActiveOrgMember(organizationId, user._id as mongoose.Types.ObjectId);

  await addUserToWorkspaceProjectsIfFullAccess(String(user._id), user.permissions || [], organizationId);

  const { connectEmployee } = await import('../hrms/accountLink');
  const employee = await connectEmployee(String(organizationId), { id: String(user._id), email: normalizedEmail, name: input.name.trim() }, input.employee, actor);
  const doc = await User.findById(user._id).select('-password').populate('roleId', 'name').lean();
  return { inviteKind: 'new_user', status: 201, user: doc ?? user.toObject(), role: { applied: true, requested: role.name, current: role.name }, employee };
}

/** Turn off someone's 2FA so they can sign in again. Weakening an admin's sign-in is reserved for admins. */
export async function resetTwoFactor(id: string, actor: GrantActor): Promise<void> {
  const target = await User.findById(id).select('role').lean();
  if (!target) throw new ApiError(404, 'User not found');
  assertCanManageAdmin(actor, target.role === 'admin', { targetUserId: id });
  await adminResetTwoFactor(id);
  logAudit({ userId: actor.id, action: 'user.two_factor.reset', resourceType: 'user', resourceId: id });
}
