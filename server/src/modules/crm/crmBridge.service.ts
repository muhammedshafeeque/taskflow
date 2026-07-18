import mongoose from 'mongoose';
import { CrmAccount } from './models/crmAccount.model';
import { CrmContact } from './models/crmContact.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { toOrgOid } from './crmWorkspace';

/** Provision or sync a CRM account from a CustomerOrg record. */
export async function syncCrmAccountFromCustomerOrg(
  customerOrgId: string,
  taskflowOrganizationId: string,
  ownerId?: string
): Promise<string> {
  const org = await CustomerOrg.findById(customerOrgId).lean();
  if (!org) return '';

  const orgOid = toOrgOid(taskflowOrganizationId);
  let accountId = (org as { crmAccountId?: mongoose.Types.ObjectId }).crmAccountId;

  if (accountId) {
    await CrmAccount.findByIdAndUpdate(accountId, {
      $set: {
        name: org.name,
        type: 'client',
        website: undefined,
        notes: org.description,
      },
    });
  } else {
    const account = await CrmAccount.create({
      taskflowOrganizationId: orgOid,
      name: org.name,
      type: 'client',
      customerOrgId: org._id,
      ownerId: ownerId && mongoose.Types.ObjectId.isValid(ownerId) ? ownerId : undefined,
      notes: org.description,
      tags: ['customer-portal'],
    });
    accountId = account._id as mongoose.Types.ObjectId;
    await CustomerOrg.findByIdAndUpdate(customerOrgId, { $set: { crmAccountId: accountId } });
  }

  const existingContact = await CrmContact.findOne({
    accountId,
    email: org.contactEmail,
  }).lean();

  if (!existingContact && org.contactEmail) {
    await CrmContact.create({
      taskflowOrganizationId: orgOid,
      accountId,
      name: org.name,
      email: org.contactEmail,
      phone: org.contactPhone,
      isPrimary: true,
    });
  }

  return String(accountId);
}

export async function linkProjectToAccount(
  projectId: string,
  accountId: string,
  taskflowOrganizationId: string
): Promise<void> {
  const account = await CrmAccount.findOne({
    _id: accountId,
    taskflowOrganizationId: toOrgOid(taskflowOrganizationId),
  });
  if (!account) return;
  const pid = new mongoose.Types.ObjectId(projectId);
  if (!account.projectIds.some((id: mongoose.Types.ObjectId) => String(id) === projectId)) {
    account.projectIds.push(pid);
    await account.save();
  }
}
