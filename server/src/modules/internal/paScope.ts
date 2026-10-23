import mongoose from 'mongoose';
import { CrmContact } from '../crm/models/crmContact.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { Project } from '../projects/project.model';
import { usersWithPermission } from '../auth/usersWithPermission';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { PaChatBinding } from './paChatBinding.model';

/** What a client chat may touch. Resolved on the server from Atrium data only. */
export type ClientScope = {
  chatId: string;
  customerOrgId: string | null;
  customerOrgName?: string;
  projectIds: string[];
  source: 'binding' | 'contact' | 'none';
};

export const PA_OWNER_PERMISSION = TASK_FLOW_PERMISSIONS.TASKFLOW.PA.ASSISTANT.OWNER;

export function normalizePhone(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

/**
 * Same number with or without the country code ("9876543210" vs "919876543210").
 * Requires 9+ overlapping digits so short extensions never collide.
 */
export function phonesMatch(a: unknown, b: unknown): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 9 && long.endsWith(short);
}

function isGroupChat(chatId: string): boolean {
  return chatId.endsWith('@g.us');
}

async function mappedProjectIds(organizationId: string, customerOrgId: string): Promise<string[]> {
  const mapped = await CustomerProjectMapping.find({ customerOrgId, status: 'active' }).distinct('projectId');
  if (!mapped.length) return [];
  return inOrgProjectIds(organizationId, mapped.map(String));
}

/** Keep only projects that really belong to this workspace. */
export async function inOrgProjectIds(organizationId: string, ids: string[]): Promise<string[]> {
  const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return [];
  const rows = await Project.find({ _id: { $in: valid }, taskflowOrganizationId: organizationId }).distinct('_id');
  return rows.map(String);
}

async function activeCustomerOrg(organizationId: string, customerOrgId: unknown) {
  if (!customerOrgId || !mongoose.Types.ObjectId.isValid(String(customerOrgId))) return null;
  return CustomerOrg.findOne({
    _id: customerOrgId,
    taskflowOrganizationId: organizationId,
    status: 'active',
  })
    .select('_id name contactPhone')
    .lean();
}

/** DM sender → CRM contact / customer company phone → exactly one client, or none. */
async function customerOrgForPhone(organizationId: string, phone: string): Promise<string | null> {
  if (!normalizePhone(phone)) return null;
  const [contacts, orgs] = await Promise.all([
    CrmContact.find({
      taskflowOrganizationId: organizationId,
      customerOrgId: { $ne: null },
      phone: { $nin: [null, ''] },
    })
      .select('phone customerOrgId')
      .limit(5000)
      .lean(),
    CustomerOrg.find({ taskflowOrganizationId: organizationId, status: 'active', contactPhone: { $nin: [null, ''] } })
      .select('_id contactPhone')
      .lean(),
  ]);
  const matches = new Set<string>();
  for (const c of contacts) if (phonesMatch(c.phone, phone)) matches.add(String(c.customerOrgId));
  for (const o of orgs) if (phonesMatch(o.contactPhone, phone)) matches.add(String(o._id));
  // Two clients share the number → refuse to guess.
  return matches.size === 1 ? [...matches][0] : null;
}

export async function resolveClientScope(
  organizationId: string,
  chatId: string,
  senderPhone?: string
): Promise<ClientScope> {
  const none: ClientScope = { chatId, customerOrgId: null, projectIds: [], source: 'none' };
  if (!chatId) return none;

  const binding = await PaChatBinding.findOne({ taskflowOrganizationId: organizationId, chatId }).lean();
  if (binding) {
    const org = await activeCustomerOrg(organizationId, binding.customerOrgId);
    const explicit = await inOrgProjectIds(organizationId, (binding.projectIds ?? []).map(String));
    const projectIds = explicit.length ? explicit : org ? await mappedProjectIds(organizationId, String(org._id)) : [];
    return {
      chatId,
      customerOrgId: org ? String(org._id) : null,
      customerOrgName: org?.name,
      projectIds,
      source: 'binding',
    };
  }

  // Groups must be bound explicitly; a member's number never unlocks a group.
  if (isGroupChat(chatId) || !senderPhone) return none;
  const customerOrgId = await customerOrgForPhone(organizationId, senderPhone);
  const org = customerOrgId ? await activeCustomerOrg(organizationId, customerOrgId) : null;
  if (!org) return none;
  return {
    chatId,
    customerOrgId: String(org._id),
    customerOrgName: org.name,
    projectIds: await mappedProjectIds(organizationId, String(org._id)),
    source: 'contact',
  };
}

/**
 * Owner on WhatsApp: the sender's number is the HRMS WhatsApp/phone of a staff
 * user who holds the PA owner permission. Returns that user's id.
 */
export async function resolveOwnerByPhone(organizationId: string, senderPhone?: string): Promise<string | null> {
  if (!normalizePhone(senderPhone)) return null;
  const employees = await HrmsEmployee.find({
    taskflowOrganizationId: organizationId,
    userId: { $ne: null },
    status: { $ne: 'terminated' },
    $or: [{ whatsappPhone: { $nin: [null, ''] } }, { phone: { $nin: [null, ''] } }],
  })
    .select('userId whatsappPhone phone')
    .lean();
  const candidates = employees
    .filter((e) => phonesMatch(e.whatsappPhone, senderPhone) || phonesMatch(e.phone, senderPhone))
    .map((e) => String(e.userId));
  if (!candidates.length) return null;
  const owners = new Set(await usersWithPermission(PA_OWNER_PERMISSION, organizationId));
  return candidates.find((id) => owners.has(id)) ?? null;
}
