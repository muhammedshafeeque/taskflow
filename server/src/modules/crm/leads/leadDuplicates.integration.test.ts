import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../../auth/user.model';
import { Organization } from '../../organizations/organization.model';
import { OrganizationMember } from '../../organizations/organizationMember.model';
import { flushAuditLogs } from '../../auditLogs/logAudit';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { ApiError } from '../../../utils/ApiError';
import { CrmLead } from '../models/crmLead.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmDeal } from '../models/crmDeal.model';
import { RecordLink } from '../../links/recordLink.model';
import { ensureDefaultPipeline } from '../pipelines/pipelines.service';
import {
  checkLeadDuplicates,
  convertLead,
  createLead,
  getLead,
  getLeadDuplicates,
  mergeLeads,
  updateLead,
} from './leads.service';

jest.mock('../../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let ws = '';
let otherWs = '';
let sara = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const user = await User.create({ email: 'sara@example.com', name: 'Sara', password: 'Passw0rd!x', mustChangePassword: false });
  sara = String(user._id);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: user._id });
  const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: user._id });
  ws = String(org._id);
  otherWs = String(other._id);
  await OrganizationMember.create({ organization: org._id, user: user._id, role: 'org_admin', status: 'active' });
  await ensureDefaultPipeline(ws);
});
afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

const id = (doc: unknown) => String((doc as { _id: unknown })._id);

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('expected an error');
}

describe('duplicate leads (AUT-28)', () => {
  it('warns with the match when a person creates a likely duplicate, and saves once confirmed', async () => {
    const first = await createLead(ws, { title: 'Northwind site', companyName: 'Northwind Ltd', contactEmail: 'omar@northwind.test' }, sara, { checkDuplicates: true });
    const err = await caught(
      createLead(ws, { title: 'Northwind app', companyName: 'NORTHWIND', contactPhone: '123' }, sara, { checkDuplicates: true })
    );
    expect(err.statusCode).toBe(409);
    const details = err.details as { code: string; leads: Array<{ _id: string; reasons: string[] }> };
    expect(details.code).toBe('duplicate_lead');
    expect(details.leads[0]).toMatchObject({ _id: id(first), reasons: ['company'] });

    const saved = await createLead(ws, { title: 'Northwind app', companyName: 'NORTHWIND', ignoreDuplicates: true }, sara, { checkDuplicates: true });
    expect(saved).toBeTruthy();
    expect(await CrmLead.countDocuments()).toBe(2);
  });

  it('never blocks automated capture', async () => {
    await createLead(ws, { title: 'A', contactEmail: 'omar@northwind.test' });
    await createLead(ws, { title: 'B', contactEmail: 'omar@northwind.test' });
    expect(await CrmLead.countDocuments()).toBe(2);
  });

  it('matches by phone in another format and by work-email domain, but stays inside the workspace', async () => {
    await createLead(ws, { title: 'Here', contactPhone: '+91 98765 43210', contactEmail: 'a@acme.io' });
    await createLead(otherWs, { title: 'Elsewhere', contactPhone: '+91 98765 43210' });
    const res = await checkLeadDuplicates(ws, { contactPhone: '098765-43210', contactEmail: 'b@acme.io' });
    expect(res.leads).toHaveLength(1);
    expect(res.leads[0]).toMatchObject({ title: 'Here', reasons: ['phone', 'domain'] });
  });

  it('does not report a lead as its own duplicate while editing', async () => {
    const lead = await createLead(ws, { title: 'Solo', contactEmail: 'solo@x.test' });
    expect((await checkLeadDuplicates(ws, { contactEmail: 'solo@x.test', excludeId: id(lead) })).leads).toHaveLength(0);
    expect((await getLeadDuplicates(id(lead), ws)).leads).toHaveLength(0);
  });
});

describe('conversion offers the existing organisation (AUT-28)', () => {
  async function existingOrg() {
    return CustomerOrg.create({
      name: 'Northwind Pvt Ltd',
      slug: 'northwind',
      taskflowOrganizationId: new mongoose.Types.ObjectId(ws),
      contactEmail: 'it@northwind.test',
      createdBy: new mongoose.Types.ObjectId(sara),
    });
  }

  it('lists the matching organisation for the lead', async () => {
    const org = await existingOrg();
    const lead = await createLead(ws, { title: 'Deal', companyName: 'Northwind', contactEmail: 'omar@northwind.test' });
    const { customerOrgs } = await getLeadDuplicates(id(lead), ws);
    expect(customerOrgs[0]).toMatchObject({ _id: String(org._id), reasons: ['company', 'domain'] });
  });

  it('refuses to create a second organisation until confirmed, and converts into the existing one', async () => {
    const org = await existingOrg();
    const lead = await createLead(ws, { title: 'Deal', companyName: 'Northwind', contactEmail: 'omar@northwind.test' });
    const err = await caught(convertLead(id(lead), ws, sara, { createProject: false, checkDuplicates: true }));
    expect(err.statusCode).toBe(409);
    expect((err.details as { code: string; customerOrgs: Array<{ _id: string }> })).toMatchObject({
      code: 'duplicate_customer_org',
      customerOrgs: [{ _id: String(org._id) }],
    });
    expect(await CrmDeal.countDocuments()).toBe(0);

    const res = await convertLead(id(lead), ws, sara, { createProject: false, checkDuplicates: true, customerOrgId: String(org._id) });
    expect(String(res.deal.customerOrgId)).toBe(String(org._id));
    expect(await CustomerOrg.countDocuments()).toBe(1);
  });
});

describe('merging leads (AUT-28)', () => {
  it('fills blanks, keeps everyone, moves history and resolves the old id', async () => {
    const keep = await createLead(ws, { title: 'Keep', contactName: 'Omar', contactEmail: 'omar@northwind.test', tags: ['web'], notes: 'Met at expo' });
    const dupe = await createLead(ws, {
      title: 'Dupe',
      contactName: 'Omar K',
      contactEmail: 'OMAR@northwind.test',
      contactPhone: '+1 555 0100 222',
      companyName: 'Northwind',
      estimatedBudget: 20000,
      tags: ['mobile', 'web'],
      notes: 'Wants an app',
      additionalContacts: [{ name: 'Lina', email: 'lina@northwind.test' }],
    });
    await CrmActivity.create({ taskflowOrganizationId: ws, type: 'note', subject: 'Call', createdBy: sara, relatedType: 'lead', relatedId: id(dupe) });
    await RecordLink.create({ taskflowOrganizationId: ws, fromType: 'lead', fromId: id(dupe), toType: 'lead', toId: id(keep), relation: 'related', createdBy: sara });

    const merged = (await mergeLeads(id(keep), id(dupe), ws, sara)) as Record<string, unknown>;
    expect(merged).toMatchObject({ companyName: 'Northwind', estimatedBudget: 20000, contactPhone: '+1 555 0100 222', contactName: 'Omar' });
    expect(merged.tags).toEqual(['web', 'mobile']);
    // Same email as the kept primary contact, so Omar is not added twice; Lina is.
    expect((merged.additionalContacts as Array<{ email?: string }>).map((c) => c.email)).toEqual(['lina@northwind.test']);
    expect(String(merged.notes)).toContain('Met at expo');
    expect(String(merged.notes)).toContain('Wants an app');

    expect(await CrmLead.exists({ _id: id(dupe) })).toBeNull();
    expect(await CrmActivity.countDocuments({ relatedId: id(dupe) })).toBe(0);
    expect(await CrmActivity.exists({ relatedId: id(keep), subject: 'Call' })).toBeTruthy();
    expect(await CrmActivity.exists({ relatedId: id(keep), subject: 'Merged lead "Dupe"' })).toBeTruthy();
    expect(await RecordLink.countDocuments()).toBe(0); // would have linked the lead to itself

    expect(id(await getLead(id(dupe), ws))).toBe(id(keep));
    const viaOldId = await updateLead(id(dupe), ws, { industry: 'Retail' });
    expect(id(viaOldId)).toBe(id(keep));
    expect((await CrmLead.findById(id(keep)).lean())?.industry).toBe('Retail');
  });

  it('refuses to merge away a converted lead or a lead from another workspace', async () => {
    const a = await createLead(ws, { title: 'A', contactEmail: 'a@x.test' });
    const b = await createLead(ws, { title: 'B', contactEmail: 'b@x.test' });
    await convertLead(id(b), ws, sara, { createProject: false, createPortalOrg: false });
    expect((await caught(mergeLeads(id(a), id(b), ws, sara))).statusCode).toBe(400);

    const foreign = await createLead(otherWs, { title: 'F' });
    expect((await caught(mergeLeads(id(a), id(foreign), ws, sara))).statusCode).toBe(404);
    expect((await caught(mergeLeads(id(a), id(a), ws, sara))).statusCode).toBe(400);
  });
});
