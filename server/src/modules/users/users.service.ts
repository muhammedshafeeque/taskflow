import crypto from 'crypto';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';
import { mergeTaskflowPermissionFloor } from '../auth/permissionMerge';
import { ProjectMember } from '../projects/projectMember.model';
import { resolveEffectiveGlobalPermissions } from '../auth/effectivePermissions';
import { ApiError } from '../../utils/ApiError';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import type { UpdateUserBody, InviteUserBody } from './users.validation';
import { sendInviteEmail } from '../../services/email.service';
import * as inboxService from '../inbox/inbox.service';
import { Project } from '../projects/project.model';
import * as projectInvitationsService from '../projects/projectInvitations.service';
import { hasProjectFullAccess } from '../../middleware/requireProjectPermission';

import dotenv from 'dotenv';
dotenv.config();

async function ensureGlobalProjectMembership(user: any) {
  if (!user) return;
  let perms = user.permissions;
  if (!perms || perms.length === 0) {
    let rolePerms = [];
    if (user.roleId && user.roleId.permissions) {
      rolePerms = user.roleId.permissions;
    } else if (user.roleId) {
      const role = await Role.findById(user.roleId).lean();
      rolePerms = role?.permissions || [];
    }
    perms = mergeTaskflowPermissionFloor(
      resolveEffectiveGlobalPermissions({
        rolePermissions: rolePerms,
        role: user.role,
        mustChangePassword: false,
        permissionOverrides: user.permissionOverrides,
      })
    );
    // Persist calculated permissions if missing
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
  pagination: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  const [rawData, total, projectCounts] = await Promise.all([
    User.find().select('-password').populate('roleId', 'name permissions').lean().skip(skip).limit(limit),
    User.countDocuments(),
    ProjectMember.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: '$user', count: { $sum: 1 } } }]),
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
  const user = await User.findById(id).select('-password').lean();
  return user ?? null;
}

export async function update(
  id: string,
  input: UpdateUserBody,
  currentUserId: string,
  hasEditPermission: boolean
): Promise<unknown | null> {
  const isSelf = id === currentUserId;

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

  // Admin update: name, roleId, enabled
  if (input.roleId) {
    const role = await Role.findById(input.roleId).lean();
    if (!role) throw new ApiError(400, 'Invalid role');
  }

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.role !== undefined) updateData.role = input.role;
  if (input.roleId !== undefined) {
    const existingUser = await User.findById(id).select('role').lean();
    updateData.roleId = input.roleId || null;
    const newRole = input.roleId ? await Role.findById(input.roleId).lean() : null;
    const rolePerms = Array.isArray(newRole?.permissions) ? (newRole.permissions as string[]) : [];
    updateData.permissions = mergeTaskflowPermissionFloor(
      resolveEffectiveGlobalPermissions({
        rolePermissions: rolePerms,
        role: (input.role ?? existingUser?.role ?? 'user') as any,
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

  if (user) {
    await ensureGlobalProjectMembership(user);
  }

  return user ?? null;
}

export async function updatePermissionOverrides(
  id: string,
  overrides: { granted: string[]; revoked: string[] }
): Promise<unknown | null> {
  const existingUser = await User.findById(id).populate('roleId', 'permissions').lean();
  if (!existingUser) return null;

  const role = existingUser.roleId as any;
  const rolePerms = Array.isArray(role?.permissions) ? role.permissions : [];
  
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
  }

  return user ?? null;
}

export async function invite(input: InviteUserBody): Promise<unknown> {
  if (process.env.MAX_USERS && parseInt(process.env.MAX_USERS) > 0) {
    const count = await User.countDocuments();
    if (count >= parseInt(process.env.MAX_USERS)) {
      throw new ApiError(403, 'User limit reached. Cannot invite more users.');
    }
  }

  const existing = await User.findOne({ email: input.email.toLowerCase().trim() }).lean();
  if (existing) throw new ApiError(409, 'Email already registered');

  const role = await Role.findById(input.roleId).lean();
  if (!role) throw new ApiError(400, 'Invalid role');

  const plainPassword = crypto.randomBytes(10).toString('base64').replace(/[+/=]/g, '').slice(0, 14);

  const rolePerms = Array.isArray(role.permissions) ? role.permissions : [];
  const initialPerms = mergeTaskflowPermissionFloor(
    resolveEffectiveGlobalPermissions({
      rolePermissions: rolePerms,
      role: 'user',
      mustChangePassword: false,
      permissionOverrides: null,
    })
  );
  const user = await User.create({
    email: input.email.toLowerCase().trim(),
    // User model hashes password in pre-save hook.
    password: plainPassword,
    name: input.name.trim(),
    role: 'user',
    roleId: input.roleId,
    mustChangePassword: true,
    permissions: initialPerms,
  });

  await sendInviteEmail({
    name: input.name.trim(),
    email: input.email.trim(),
    password: plainPassword,
    appUrl: process.env.FRONTEND_URL ?? '',
  }).catch((err) => console.error('Failed to send invite email:', err));

  await inboxService
    .createMessage({
      toUser: user._id.toString(),
      type: 'welcome',
      title: 'Welcome to TaskFlow',
      body: 'Your account has been created. Please change your password from your profile or use Forgot password after signing out.',
    })
    .catch((err) => console.error('Failed to create welcome message:', err));

  if (hasProjectFullAccess(user.permissions || [])) {
    const projects = await Project.find().select('_id').lean();
    for (const p of projects) {
      await projectInvitationsService.ensureUserIsDefaultProjectMember(String(p._id), String(user._id));
    }
  }

  const doc = await User.findById(user._id).select('-password').populate('roleId', 'name').lean();
  return doc ?? user.toObject();
}
