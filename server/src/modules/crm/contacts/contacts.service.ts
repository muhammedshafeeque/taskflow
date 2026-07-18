import { CrmContact } from '../models/crmContact.model';
import { CrmAccount } from '../models/crmAccount.model';
import { ApiError } from '../../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';

export async function listContacts(
  workspaceId: string | null | undefined,
  opts: { accountId?: string; search?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (opts.accountId) filter.accountId = opts.accountId;
  if (opts.search?.trim()) {
    filter.$or = [
      { name: { $regex: opts.search.trim(), $options: 'i' } },
      { email: { $regex: opts.search.trim(), $options: 'i' } },
    ];
  }
  return CrmContact.find(filter).sort({ name: 1 }).lean();
}

export async function createContact(workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const accountId = String(input.accountId ?? '');
  const account = await CrmAccount.findOne({ _id: accountId, taskflowOrganizationId: toOrgOid(orgId) });
  if (!account) throw new ApiError(404, 'Account not found');
  if (input.isPrimary) {
    await CrmContact.updateMany({ accountId }, { $set: { isPrimary: false } });
  }
  const doc = await CrmContact.create({
    taskflowOrganizationId: toOrgOid(orgId),
    accountId,
    name: String(input.name ?? '').trim(),
    email: input.email,
    phone: input.phone,
    title: input.title,
    department: input.department,
    isPrimary: Boolean(input.isPrimary),
    linkedIn: input.linkedIn,
    marketingConsent: Boolean(input.marketingConsent),
  });
  return doc.toObject();
}

export async function updateContact(
  id: string,
  workspaceId: string | null | undefined,
  input: Record<string, unknown>
) {
  const orgId = requireWorkspaceId(workspaceId);
  if (input.isPrimary && input.accountId) {
    await CrmContact.updateMany({ accountId: input.accountId }, { $set: { isPrimary: false } });
  }
  const updated = await CrmContact.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
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
