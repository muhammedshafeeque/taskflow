import mongoose from 'mongoose';
import { Organization } from './organization.model';
import { OrganizationMember } from './organizationMember.model';
import { User } from '../auth/user.model';
import { ApiError } from '../../utils/ApiError';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './organizations.validation';

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  status?: string;
};

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return s || 'workspace';
}

export async function listOrganizationsForUser(userId: string): Promise<OrganizationSummary[]> {
  const uid = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const rows = await OrganizationMember.find({ user: uid, status: 'active' })
    .populate('organization', 'name slug status')
    .sort({ createdAt: 1 })
    .lean();
  const out: OrganizationSummary[] = [];
  for (const m of rows) {
    const o = m.organization as { _id?: unknown; name?: string; slug?: string; status?: string } | null;
    if (!o?._id) continue;
    out.push({
      id: String(o._id),
      name: String(o.name ?? ''),
      slug: String(o.slug ?? ''),
      role: m.role,
      status: o.status,
    });
  }
  return out;
}

export async function createOrganization(userId: string, input: CreateOrganizationInput): Promise<unknown> {
  const uid = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  let slug = slugify(input.name);
  let attempt = 0;
  while (await Organization.exists({ slug })) {
    attempt += 1;
    slug = `${slugify(input.name)}-${attempt}`;
  }
  const org = await Organization.create({
    name: input.name.trim(),
    slug,
    description: (input.description ?? '').trim(),
    createdBy: uid,
    status: 'active',
  });
  await OrganizationMember.create({
    organization: org._id,
    user: uid,
    role: 'org_admin',
    status: 'active',
  });
  return org.toObject();
}

export async function assertActiveMember(userId: string, organizationId: string): Promise<void> {
  const ok = await OrganizationMember.exists({
    organization: organizationId,
    user: userId,
    status: 'active',
  });
  if (!ok) throw new ApiError(403, 'Not a member of this workspace');
}

export async function assertOrgAdmin(userId: string, organizationId: string): Promise<void> {
  const m = await OrganizationMember.findOne({
    organization: organizationId,
    user: userId,
    status: 'active',
    role: 'org_admin',
  }).lean();
  if (!m) throw new ApiError(403, 'Workspace admin access required');
}

export async function getOrganizationDetail(userId: string, organizationId: string): Promise<{
  organization: unknown;
  members: unknown[];
}> {
  await assertActiveMember(userId, organizationId);
  const organization = await Organization.findById(organizationId).lean();
  if (!organization) throw new ApiError(404, 'Workspace not found');
  const members = await OrganizationMember.find({ organization: organizationId })
    .populate('user', 'name email')
    .sort({ role: 1, createdAt: 1 })
    .lean();
  return { organization, members };
}

export async function listTfOrgMembers(userId: string, organizationId: string): Promise<unknown[]> {
  await assertActiveMember(userId, organizationId);
  return OrganizationMember.find({ organization: organizationId, status: 'active' })
    .populate('user', 'name email')
    .sort({ role: 1, createdAt: 1 })
    .lean();
}

export async function addMemberByEmail(
  actorUserId: string,
  organizationId: string,
  email: string,
  role: 'org_admin' | 'org_member' = 'org_member'
): Promise<unknown> {
  await assertOrgAdmin(actorUserId, organizationId);
  const norm = email.toLowerCase().trim();
  const target = await User.findOne({ email: norm }).lean();
  if (!target) {
    throw new ApiError(404, 'No Atrium user exists with that email. They must sign in once before being added.');
  }
  if (String(target._id) === actorUserId) {
    throw new ApiError(400, 'You are already a member');
  }
  try {
    const row = await OrganizationMember.create({
      organization: organizationId,
      user: target._id,
      role,
      status: 'active',
    });
    await row.populate('user', 'name email');
    return row.toObject();
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 11000) {
      throw new ApiError(409, 'User is already a member of this workspace');
    }
    throw e;
  }
}

export async function updateMemberRole(
  actorUserId: string,
  organizationId: string,
  targetUserId: string,
  role: 'org_admin' | 'org_member'
): Promise<unknown> {
  await assertOrgAdmin(actorUserId, organizationId);
  const target = await OrganizationMember.findOne({
    organization: organizationId,
    user: targetUserId,
    status: 'active',
  }).lean();
  if (!target) throw new ApiError(404, 'Member not found');
  if (role === 'org_member' && target.role === 'org_admin') {
    const adminCount = await OrganizationMember.countDocuments({
      organization: organizationId,
      status: 'active',
      role: 'org_admin',
    });
    if (adminCount <= 1) {
      throw new ApiError(400, 'Cannot remove the last workspace admin');
    }
  }
  const updated = await OrganizationMember.findOneAndUpdate(
    { organization: organizationId, user: targetUserId },
    { $set: { role } },
    { new: true }
  )
    .populate('user', 'name email')
    .lean();
  return updated;
}

export async function updateOrganization(
  actorUserId: string,
  organizationId: string,
  input: UpdateOrganizationInput
): Promise<unknown> {
  await assertOrgAdmin(actorUserId, organizationId);
  const org = await Organization.findById(organizationId);
  if (!org) throw new ApiError(404, 'Workspace not found');
  if (input.name !== undefined) org.set('name', input.name.trim());
  if (input.description !== undefined) org.set('description', input.description.trim());
  if (input.status !== undefined) org.set('status', input.status);
  await org.save();
  return org.toObject();
}

/** Remove another member (org admin) or leave workspace (self). Last org admin cannot be removed. */
export async function removeOrganizationMember(
  actorUserId: string,
  organizationId: string,
  targetUserId: string
): Promise<void> {
  const isSelf = actorUserId === targetUserId;
  const target = await OrganizationMember.findOne({
    organization: organizationId,
    user: targetUserId,
    status: 'active',
  }).lean();
  if (!target) throw new ApiError(404, 'Member not found');

  if (isSelf) {
    await assertActiveMember(actorUserId, organizationId);
  } else {
    await assertOrgAdmin(actorUserId, organizationId);
  }

  if (target.role === 'org_admin') {
    const adminCount = await OrganizationMember.countDocuments({
      organization: organizationId,
      status: 'active',
      role: 'org_admin',
    });
    if (adminCount <= 1) {
      throw new ApiError(400, 'Cannot remove the last workspace admin');
    }
  }

  await OrganizationMember.deleteOne({ organization: organizationId, user: targetUserId });
}
