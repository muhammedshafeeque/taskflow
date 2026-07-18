import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { CustomerOrg } from './customerOrg.model';
import { syncCrmAccountFromCustomerOrg } from '../../crm/crmBridge.service';
import { CustomerRole } from '../customer-role/customerRole.model';
import { CustomerUser } from '../customer-user/customerUser.model';
import { CustomerRequest } from '../customer-request/customerRequest.model';
import { ApiError } from '../../../utils/ApiError';
import { env } from '../../../config/env';
import {
  ORG_MEMBER_PERMISSION_CODES,
} from '../../../constants/permissions';
import { ALL_CUSTOMER_PERMISSIONS } from '../../../shared/constants/permissions';
import {
  sendCustomerEmail,
  renderCustomerOrgAdminInviteEmail,
} from '../../../services/email.service';
import type { CreateOrgInput, UpdateOrgInput } from './customerOrg.validation';
import mongoose from 'mongoose';

const SALT_ROUNDS = 10;

export async function assertCustomerOrgInTaskflowWorkspace(
  customerOrgId: string,
  taskflowOrganizationId: string
): Promise<void> {
  const ok = await CustomerOrg.exists({
    _id: customerOrgId,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  });
  if (!ok) throw new ApiError(404, 'Organisation not found');
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export async function createOrg(
  input: CreateOrgInput,
  createdBy: string,
  taskflowOrganizationId: string
): Promise<unknown> {
  let slug = input.slug ?? generateSlug(input.name);

  // Ensure slug uniqueness
  let slugCandidate = slug;
  let attempt = 0;
  while (await CustomerOrg.exists({ slug: slugCandidate })) {
    attempt += 1;
    slugCandidate = `${slug}-${attempt}`;
  }
  slug = slugCandidate;

  const org = await CustomerOrg.create({
    name: input.name,
    slug,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
    contactEmail: input.contactEmail,
    description: input.description,
    logo: input.logo,
    contactPhone: input.contactPhone,
    status: 'active',
    createdBy,
  });

  // Create system roles
  const adminRole = await CustomerRole.create({
    customerOrgId: org._id,
    name: 'Org Admin',
    permissions: ALL_CUSTOMER_PERMISSIONS,
    isDefault: false,
    isSystemRole: true,
  });

  const memberRole = await CustomerRole.create({
    customerOrgId: org._id,
    name: 'Member',
    permissions: ORG_MEMBER_PERMISSION_CODES,
    isDefault: true,
    isSystemRole: true,
  });

  // Generate temp password
  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const adminUser = await CustomerUser.create({
    customerOrgId: org._id,
    name: input.adminName,
    email: input.adminEmail,
    password: hashedPassword,
    roleId: adminRole._id,
    isOrgAdmin: true,
    status: 'active',
    mustChangePassword: true,
    invitedBy: createdBy,
  });

  // Send invite email
  sendCustomerEmail(
    input.adminEmail,
    `Welcome to ${input.name} Customer Portal`,
    renderCustomerOrgAdminInviteEmail(
      input.adminName,
      input.adminEmail,
      tempPassword,
      input.name,
      env.appUrl
    )
  ).catch((err) => console.error('Failed to send org admin invite email:', err));

  await syncCrmAccountFromCustomerOrg(String(org._id), taskflowOrganizationId, createdBy).catch((err) =>
    console.error('Failed to sync CRM account from customer org:', err)
  );

  return {
    org: org.toObject(),
    adminRole: adminRole.toObject(),
    memberRole: memberRole.toObject(),
    adminUser: {
      id: adminUser._id.toString(),
      name: adminUser.name,
      email: adminUser.email,
    },
  };
}

export async function listOrgs(
  query: { page?: number; limit?: number; status?: string },
  taskflowOrganizationId: string
): Promise<unknown> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  };
  if (query.status) filter.status = query.status;

  const [data, total] = await Promise.all([
    CustomerOrg.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CustomerOrg.countDocuments(filter),
  ]);

  // Attach member count per org
  const orgIds = (data as Array<{ _id: unknown }>).map((o) => o._id);
  const memberCounts = await CustomerUser.aggregate([
    { $match: { customerOrgId: { $in: orgIds }, status: { $ne: 'inactive' } } },
    { $group: { _id: '$customerOrgId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(memberCounts.map((m) => [String(m._id), m.count]));

  return {
    orgs: (data as Array<{ _id: unknown }>).map((o) => ({
      ...o,
      memberCount: countMap.get(String(o._id)) ?? 0,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getOrg(id: string, taskflowOrganizationId: string): Promise<unknown> {
  const org = await CustomerOrg.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  }).lean();
  if (!org) throw new ApiError(404, 'Organisation not found');

  const memberCount = await CustomerUser.countDocuments({
    customerOrgId: id,
    status: { $ne: 'inactive' },
  });

  return { ...org, memberCount };
}

export async function updateOrg(id: string, input: UpdateOrgInput, taskflowOrganizationId: string): Promise<unknown> {
  const org = await CustomerOrg.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  }).lean();
  if (!org) throw new ApiError(404, 'Organisation not found');

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.contactEmail !== undefined) update.contactEmail = input.contactEmail;
  if (input.description !== undefined) update.description = input.description;
  if (input.logo !== undefined) update.logo = input.logo;
  if (input.contactPhone !== undefined) update.contactPhone = input.contactPhone;
  if (input.status !== undefined) update.status = input.status;

  const updated = await CustomerOrg.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!updated) throw new ApiError(404, 'Organisation not found');
  await syncCrmAccountFromCustomerOrg(id, taskflowOrganizationId).catch((err) =>
    console.error('Failed to sync CRM account from customer org:', err)
  );
  return updated;
}

export async function listOrgRoles(orgId: string, taskflowOrganizationId: string): Promise<unknown[]> {
  await assertCustomerOrgInTaskflowWorkspace(orgId, taskflowOrganizationId);
  return CustomerRole.find({ customerOrgId: orgId }).sort({ isSystemRole: -1, name: 1 }).lean();
}

export async function listOrgMembers(orgId: string, taskflowOrganizationId: string): Promise<unknown[]> {
  await assertCustomerOrgInTaskflowWorkspace(orgId, taskflowOrganizationId);
  return CustomerUser.find({ customerOrgId: orgId })
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .sort({ createdAt: -1 })
    .lean();
}

export async function updateOrgMember(
  orgId: string,
  userId: string,
  input: { roleId?: string; status?: string },
  taskflowOrganizationId: string
): Promise<unknown> {
  await assertCustomerOrgInTaskflowWorkspace(orgId, taskflowOrganizationId);
  const user = await CustomerUser.findOne({ _id: userId, customerOrgId: orgId }).lean();
  if (!user) throw new ApiError(404, 'Member not found');

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

export async function updateOrgMemberPermissions(
  orgId: string,
  userId: string,
  overrides: { granted: string[]; revoked: string[] },
  taskflowOrganizationId: string
): Promise<unknown> {
  await assertCustomerOrgInTaskflowWorkspace(orgId, taskflowOrganizationId);
  const user = await CustomerUser.findOne({ _id: userId, customerOrgId: orgId }).lean();
  if (!user) throw new ApiError(404, 'Member not found');

  const updated = await CustomerUser.findByIdAndUpdate(
    userId,
    { $set: { permissionOverrides: { granted: overrides.granted, revoked: overrides.revoked } } },
    { new: true }
  )
    .populate('roleId', 'name permissions isSystemRole')
    .select('-password -passwordResetToken -passwordResetExpires')
    .lean();

  if (!updated) throw new ApiError(404, 'Member not found');
  return updated;
}

export async function deleteOrg(id: string, taskflowOrganizationId: string): Promise<void> {
  const org = await CustomerOrg.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  }).lean();
  if (!org) throw new ApiError(404, 'Organisation not found');

  // Check for active requests
  const activeRequestCount = await CustomerRequest.countDocuments({
    customerOrgId: id,
    status: {
      $in: [
        'submitted',
        'pending_customer_approval',
        'pending_taskflow_approval',
        'approved',
        'ticket_created',
        'in_progress',
      ],
    },
  });

  if (activeRequestCount > 0) {
    throw new ApiError(
      400,
      `Cannot delete organisation with ${activeRequestCount} active request(s). Please close or reject them first.`
    );
  }

  await CustomerOrg.findByIdAndDelete(id);
}
