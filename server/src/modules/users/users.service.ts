import crypto from 'crypto';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';
import { mergeTaskflowPermissionFloor } from '../auth/permissionMerge';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import type { UpdateUserBody, InviteUserBody } from './users.validation';
import { sendInviteEmail } from '../../services/email.service';
import * as inboxService from '../inbox/inbox.service';

import dotenv from 'dotenv';
dotenv.config();

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
    updateData.roleId = input.roleId || null;
    const newRole = input.roleId ? await Role.findById(input.roleId).lean() : null;
    const rolePermsDot = mapLegacyProjectOrGlobalPermissions(
      Array.isArray(newRole?.permissions) ? (newRole.permissions as string[]) : []
    );
    updateData.permissions = mergeTaskflowPermissionFloor(rolePermsDot);
    updateData.permissionOverrides = { granted: [], revoked: [] };
  }
  if (input.enabled !== undefined) updateData.enabled = input.enabled;

  const user = await User.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
    .select('-password')
    .populate('roleId', 'name')
    .lean();

  return user ?? null;
}

export async function updatePermissionOverrides(
  id: string,
  overrides: { granted: string[]; revoked: string[] }
): Promise<unknown | null> {
  const user = await User.findByIdAndUpdate(
    id,
    { $set: { permissionOverrides: { granted: overrides.granted, revoked: overrides.revoked } } },
    { new: true, runValidators: true }
  )
    .select('-password')
    .populate('roleId', 'name permissions')
    .lean();
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

  const rolePermsDot = mapLegacyProjectOrGlobalPermissions(
    Array.isArray(role.permissions) ? role.permissions : []
  );
  const user = await User.create({
    email: input.email.toLowerCase().trim(),
    // User model hashes password in pre-save hook.
    password: plainPassword,
    name: input.name.trim(),
    role: 'user',
    roleId: input.roleId,
    mustChangePassword: true,
    permissions: mergeTaskflowPermissionFloor(rolePermsDot),
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

  const doc = await User.findById(user._id).select('-password').populate('roleId', 'name').lean();
  return doc ?? user.toObject();
}
