import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { CustomerUser } from './customerUser.model';
import { CustomerRole } from '../customer-role/customerRole.model';
import { CustomerOrg } from '../customer-org/customerOrg.model';
import { ApiError } from '../../../utils/ApiError';
import { upsertContactByEmail } from '../../crm/contacts/contacts.service';
import { env } from '../../../config/env';
import {
  sendCustomerEmail,
  renderCustomerMemberInviteEmail,
} from '../../../services/email.service';
import type {
  InviteMemberInput,
  UpdateMemberInput,
  UpdateMeInput,
} from './customerUser.validation';

const SALT_ROUNDS = 10;

export async function listMembers(orgId: string): Promise<unknown[]> {
  return CustomerUser.find({ customerOrgId: orgId })
    .populate('roleId', 'name permissions isSystemRole')
    .populate('invitedBy', 'name email')
    .select('-password -passwordResetToken -passwordResetExpires')
    .sort({ createdAt: -1 })
    .lean();
}

export async function inviteMember(
  orgId: string,
  input: InviteMemberInput,
  invitedBy: string
): Promise<unknown> {
  // Check role belongs to org
  const role = await CustomerRole.findOne({ _id: input.roleId, customerOrgId: orgId }).lean();
  if (!role) throw new ApiError(404, 'Role not found');

  // Check email not already in org
  const existing = await CustomerUser.findOne({ customerOrgId: orgId, email: input.email }).lean();
  if (existing) throw new ApiError(409, 'A user with this email already exists in the organisation');

  const tempPassword = crypto.randomBytes(32).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const org = await CustomerOrg.findById(orgId).select('name').lean();

  const user = await CustomerUser.create({
    customerOrgId: orgId,
    name: input.name,
    email: input.email,
    password: hashedPassword,
    roleId: input.roleId,
    isOrgAdmin: false,
    status: 'active',
    mustChangePassword: true,
    invitedBy,
    passwordResetToken: resetHash,
    passwordResetExpires: resetExpires,
  });

  const appBase = env.appUrl.replace(/\/$/, '');
  const resetLink = `${appBase}/reset-password?token=${encodeURIComponent(resetToken)}`;
  sendCustomerEmail(
    input.email,
    `You've been invited to ${org?.name ?? 'Customer Portal'}`,
    renderCustomerMemberInviteEmail(
      input.name,
      input.email,
      org?.name ?? 'Customer Portal',
      appBase,
      resetLink
    )
  ).catch((err) => console.error('Failed to send member invite email:', err));

  const orgFull = await CustomerOrg.findById(orgId).select('taskflowOrganizationId').lean();
  if (orgFull?.taskflowOrganizationId) {
    await upsertContactByEmail(String(orgFull.taskflowOrganizationId), {
      email: input.email,
      name: input.name,
      origin: 'portal',
      customerOrgId: orgId,
      customerUserId: String(user._id),
    }).catch((err) => console.error('Failed to upsert contact from portal invite:', err));
  }

  const populated = await CustomerUser.findById(user._id)
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  return populated;
}

export async function getMember(orgId: string, userId: string): Promise<unknown> {
  const user = await CustomerUser.findOne({ _id: userId, customerOrgId: orgId })
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  if (!user) throw new ApiError(404, 'Member not found');
  return user;
}

export async function updateMember(
  orgId: string,
  userId: string,
  input: UpdateMemberInput
): Promise<unknown> {
  const user = await CustomerUser.findOne({ _id: userId, customerOrgId: orgId }).lean();
  if (!user) throw new ApiError(404, 'Member not found');

  if (user.isOrgAdmin && input.roleId) {
    throw new ApiError(400, 'Cannot change the role of the org admin');
  }

  const update: Record<string, unknown> = {};

  if (input.roleId !== undefined) {
    const role = await CustomerRole.findOne({ _id: input.roleId, customerOrgId: orgId }).lean();
    if (!role) throw new ApiError(404, 'Role not found');
    update.roleId = input.roleId;
  }

  if (input.status !== undefined) update.status = input.status;

  const updated = await CustomerUser.findByIdAndUpdate(userId, { $set: update }, { new: true })
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  if (!updated) throw new ApiError(404, 'Member not found');
  return updated;
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const user = await CustomerUser.findOne({ _id: userId, customerOrgId: orgId }).lean();
  if (!user) throw new ApiError(404, 'Member not found');
  if (user.isOrgAdmin) throw new ApiError(400, 'Cannot remove the org admin');

  await CustomerUser.findByIdAndUpdate(userId, { $set: { status: 'inactive' } });
}

export async function getMe(customerUserId: string): Promise<unknown> {
  const user = await CustomerUser.findById(customerUserId)
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  if (!user) throw new ApiError(401, 'User not found');
  return user;
}

export async function updateMe(customerUserId: string, input: UpdateMeInput): Promise<unknown> {
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.avatarUrl !== undefined) update.avatarUrl = input.avatarUrl === '' ? null : input.avatarUrl;

  if (Object.keys(update).length === 0) {
    return getMe(customerUserId);
  }

  const updated = await CustomerUser.findByIdAndUpdate(customerUserId, { $set: update }, { new: true })
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  if (!updated) throw new ApiError(401, 'User not found');
  return updated;
}

export async function changePassword(
  customerUserId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await CustomerUser.findById(customerUserId).select('+password').lean();
  if (!user) throw new ApiError(401, 'User not found');

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) throw new ApiError(401, 'Current password is incorrect');

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await CustomerUser.findByIdAndUpdate(customerUserId, {
    $set: { password: hashed, mustChangePassword: false },
    $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
  });
}
