import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { Project } from '../projects/project.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CrmAccount } from './models/crmAccount.model';
import { CrmContract } from './models/crmContract.model';
import { CrmQuote } from './models/crmQuote.model';
import { ensureDefaultPipeline } from './pipelines/pipelines.service';
import { convertLead, createLead } from './leads/leads.service';
import { createQuote, updateQuote } from './quotes/quotes.service';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let ws = '';
let sara = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await BillingInvoice.syncIndexes();
  const user = await User.create({ email: 'sara@example.com', name: 'Sara', password: 'Passw0rd!x', mustChangePassword: false });
  sara = String(user._id);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: user._id });
  ws = String(org._id);
  await OrganizationMember.create({ organization: org._id, user: user._id, role: 'org_admin', status: 'active' });
  await ensureDefaultPipeline(ws);
});
afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

async function wonCustomer(createProject: boolean) {
  const lead = (await createLead(ws, { title: 'Northwind', companyName: 'Northwind', contactName: 'Omar', contactEmail: 'omar@northwind.test', estimatedBudget: 50000 }, sara)) as { _id: unknown };
  const converted = await convertLead(String(lead._id), ws, sara, { createProject });
  const quote = (await createQuote(
    ws,
    { dealId: String(converted.deal._id), title: 'Northwind build', issueDate: '2026-11-01', lineItems: [{ description: 'Build', quantity: 10, unitPrice: 100, billingType: 'hourly' }] },
    sara
  )) as { _id: unknown };
  const accepted = (await updateQuote(String(quote._id), ws, { status: 'accepted' }, sara)) as { converted?: { contractId?: string; invoiceId?: string; handoff?: { projectId?: string } } };
  return { converted, accepted, quote };
}

describe('lead > deal > accepted quote (AUT-14)', () => {
  it('produces a draft invoice linked to the customer, contract and project', async () => {
    const { converted, accepted, quote } = await wonCustomer(false);
    const org = await CustomerOrg.findById(converted.customerOrg?._id).lean();
    expect(org?.crmAccountId).toBeTruthy();
    expect(accepted.converted?.invoiceId).toBeTruthy();

    const invoice = await BillingInvoice.findById(accepted.converted!.invoiceId).lean();
    const contract = await CrmContract.findById(accepted.converted!.contractId).lean();
    const projectId = accepted.converted!.handoff!.projectId!;
    expect(invoice).toMatchObject({ status: 'draft', total: 1000, accountId: org!.crmAccountId, customerOrgId: org!._id, contractId: contract!._id, projectId: new mongoose.Types.ObjectId(projectId) });
    expect(invoice!.number).toMatch(/^INV-\d{4}-0001$/);
    expect(String(contract!.projectId)).toBe(projectId);
    expect(String((await CrmQuote.findById(quote._id).lean())?.accountId)).toBe(String(org!.crmAccountId));
    expect(await CrmAccount.countDocuments()).toBe(1);
  });

  it('lets Time to invoice bill the new project', async () => {
    const { converted, accepted } = await wonCustomer(false);
    const project = await Project.findById(accepted.converted!.handoff!.projectId).lean();
    expect(String(project?.crmAccountId)).toBe(String((await CustomerOrg.findById(converted.customerOrg?._id).lean())?.crmAccountId));
  });

  it('numbers invoices from several accepted quotes without clashing', async () => {
    await wonCustomer(false);
    await wonCustomer(false);
    const numbers = (await BillingInvoice.find().lean()).map((i) => i.number).sort();
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size).toBe(2);
  });

  it('also works when the project was created at conversion', async () => {
    const { accepted } = await wonCustomer(true);
    const invoice = await BillingInvoice.findById(accepted.converted!.invoiceId).lean();
    expect(String(invoice?.projectId)).toBe(accepted.converted!.handoff!.projectId);
  });
});
