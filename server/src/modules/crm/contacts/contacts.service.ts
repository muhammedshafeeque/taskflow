import { CrmContact, type CrmContactOrigin } from '../models/crmContact.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { CustomerUser } from '../../customer-portal/customer-user/customerUser.model';
import { ApiError } from '../../../utils/ApiError';
import { escapeRegex } from '../../../utils/safeUrl';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export type UpsertContactInput = {
  email: string;
  name?: string;
  phone?: string;
  title?: string;
  origin?: CrmContactOrigin;
  customerOrgId?: string;
  customerUserId?: string;
  employeeId?: string;
  userId?: string;
  accountId?: string;
  isPrimary?: boolean;
};

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertContactByEmail(
  workspaceId: string | null | undefined,
  input: UpsertContactInput
) {
  const orgId = requireWorkspaceId(workspaceId);
  const email = normEmail(input.email || '');
  if (!email) return null;
  const orgOid = toOrgOid(orgId);
  const existing = await CrmContact.findOne({ taskflowOrganizationId: orgOid, email });
  const $set: Record<string, unknown> = {};
  if (input.name?.trim()) $set.name = input.name.trim();
  if (input.phone) $set.phone = input.phone;
  if (input.title) $set.title = input.title;
  if (input.origin) $set.origin = input.origin;
  if (input.customerOrgId) $set.customerOrgId = input.customerOrgId;
  if (input.customerUserId) $set.customerUserId = input.customerUserId;
  if (input.accountId) $set.accountId = input.accountId;
  if (input.employeeId) $set.employeeId = input.employeeId;
  if (input.userId) $set.userId = input.userId;
  if (input.isPrimary) $set.isPrimary = true;

  if (existing) {
    if (Object.keys($set).length) {
      await CrmContact.updateOne({ _id: existing._id }, { $set });
    }
    return CrmContact.findById(existing._id).lean();
  }

  const doc = await CrmContact.create({
    taskflowOrganizationId: orgOid,
    name: (input.name || email).trim(),
    email,
    phone: input.phone,
    title: input.title,
    origin: input.origin ?? 'crm',
    customerOrgId: input.customerOrgId || undefined,
    customerUserId: input.customerUserId || undefined,
    accountId: input.accountId || undefined,
    employeeId: input.employeeId || undefined,
    userId: input.userId || undefined,
    isPrimary: Boolean(input.isPrimary),
  });
  return doc.toObject();
}

export async function backfillPortalContacts(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgs = await CustomerOrg.find({ taskflowOrganizationId: toOrgOid(orgId) }).select('_id').lean();
  const orgIds = orgs.map((o) => o._id);
  if (!orgIds.length) return;
  const users = await CustomerUser.find({ customerOrgId: { $in: orgIds } })
    .select('name email customerOrgId')
    .lean();
  for (const u of users) {
    if (!u.email) continue;
    await upsertContactByEmail(orgId, {
      email: u.email,
      name: u.name,
      origin: 'portal',
      customerOrgId: String(u.customerOrgId),
      customerUserId: String(u._id),
    });
  }
}

export async function listCustomerOrgs(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  return CustomerOrg.find({ taskflowOrganizationId: toOrgOid(orgId) })
    .select('name contactEmail contactPhone status')
    .sort({ name: 1 })
    .lean();
}

export async function listContacts(
  workspaceId: string | null | undefined,
  opts: { accountId?: string; customerOrgId?: string; search?: string; origin?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  await backfillPortalContacts(orgId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.accountId) filter.accountId = opts.accountId;
  if (opts.customerOrgId) filter.customerOrgId = opts.customerOrgId;
  if (opts.origin && opts.origin !== 'all') filter.origin = opts.origin;
  if (opts.search?.trim()) {
    const q = escapeRegex(opts.search.trim());
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
    ];
  }
  return CrmContact.find(filter).populate('customerOrgId', 'name').sort({ name: 1 }).lean();
}

export async function createContact(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const customerOrgId = input.customerOrgId ? String(input.customerOrgId) : '';
  if (customerOrgId) {
    const org = await CustomerOrg.findOne({ _id: customerOrgId, taskflowOrganizationId: toOrgOid(orgId) });
    if (!org) throw new ApiError(404, 'Customer organisation not found');
  }
  const email = input.email ? String(input.email).trim().toLowerCase() : '';
  if (email) {
    const upserted = await upsertContactByEmail(orgId, {
      email,
      name: String(input.name ?? '').trim() || email,
      phone: input.phone ? String(input.phone) : undefined,
      title: input.title ? String(input.title) : undefined,
      origin: (input.origin as CrmContactOrigin) || 'crm',
      customerOrgId: customerOrgId || undefined,
      isPrimary: Boolean(input.isPrimary),
    });
    if (upserted) return upserted;
  }
  const name = String(input.name ?? '').trim();
  if (!name) throw new ApiError(400, 'Name is required');
  const doc = await CrmContact.create({
    taskflowOrganizationId: toOrgOid(orgId),
    customerOrgId: customerOrgId || undefined,
    name,
    email: email || undefined,
    phone: input.phone,
    title: input.title,
    department: input.department,
    isPrimary: Boolean(input.isPrimary),
    linkedIn: input.linkedIn,
    marketingConsent: Boolean(input.marketingConsent),
    origin: (input.origin as CrmContactOrigin) || 'crm',
  });
  return doc.toObject();
}

export async function updateContact(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  const allowed = [
    'name',
    'email',
    'phone',
    'title',
    'department',
    'isPrimary',
    'linkedIn',
    'marketingConsent',
    'customerOrgId',
    'origin',
  ];
  const $set: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in input) $set[key] = input[key] === '' ? undefined : input[key];
  }
  if ($set.email) $set.email = String($set.email).trim().toLowerCase();
  const updated = await CrmContact.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Contact not found');
  return updated;
}

export async function deleteContact(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CrmContact.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Contact not found');
  return { ok: true };
}
