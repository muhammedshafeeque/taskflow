/**
 * Customer 360 against an in-memory Mongo: sections from every module, SLA and
 * overdue health flags, payments from the ledger, monitor status, and sections
 * hidden by permission or project membership.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { SlaPolicy } from '../service-desk/models/slaPolicy.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { JournalEntry } from '../ledger/ledger.models';
import { MonitorProject, MonitorUptimeCheck, MonitorUptimeSample } from '../monitor/monitor.models';
import { GraphAccess } from '../links/links.service';
import { getCustomer360, ticketSlaState } from './customer360.service';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALL = [
  'taskflow.customer_portal.org.view',
  'taskflow.crm.deal.read',
  'taskflow.crm.contract.read',
  'taskflow.service.ticket.read',
  'taskflow.billing.invoice.list',
  'taskflow.monitor.project.read',
];

const as = (user: string, perms: string[]) =>
  new GraphAccess(new mongoose.Types.ObjectId(ids.org), { userId: ids[user], permissions: perms });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [ana, ben] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: ana._id });
  const [portal, internal] = await Project.create([
    { name: 'Portal', key: 'POR', lead: ana._id, taskflowOrganizationId: org._id },
    { name: 'Internal', key: 'INT', lead: ana._id, taskflowOrganizationId: org._id },
  ]);
  await ProjectMember.create([{ project: portal._id, user: ana._id }]);

  const acme = await CustomerOrg.create({
    name: 'Acme',
    slug: 'acme',
    contactEmail: 'ops@acme.test',
    createdBy: ana._id,
    taskflowOrganizationId: org._id,
  });
  const account = await CrmAccount.create({ taskflowOrganizationId: org._id, name: 'Acme Ltd', customerOrgId: acme._id });
  await CustomerProjectMapping.create({ customerOrgId: acme._id, projectId: portal._id, mappedBy: ana._id });
  // A second project reaches Acme through the account; Ana is not a member of it.
  await CrmAccount.updateOne({ _id: account._id }, { $set: { projectIds: [internal._id] } });

  const now = Date.now();
  await Issue.create([
    { title: 'Late fix', key: 'POR-1', project: portal._id, reporter: ana._id, dueDate: new Date(now - DAY) },
    { title: 'Shipped', key: 'POR-2', project: portal._id, reporter: ana._id, status: 'Done' },
    { title: 'Internal only', key: 'INT-1', project: internal._id, reporter: ana._id },
  ]);
  await CrmDeal.create({
    taskflowOrganizationId: org._id,
    accountId: account._id,
    title: 'Phase 2',
    value: 20000,
    pipelineId: new mongoose.Types.ObjectId(),
    stageId: new mongoose.Types.ObjectId(),
  });
  const sla = await SlaPolicy.create({
    taskflowOrganizationId: org._id,
    name: 'Gold',
    targets: [{ priority: 'high', firstResponseMinutes: 60, resolutionMinutes: 480 }],
  });
  await CrmContract.create({
    taskflowOrganizationId: org._id,
    customerOrgId: acme._id,
    title: 'Support MSA',
    status: 'active',
    value: 12000,
    startDate: new Date(now - 300 * DAY),
    renewalDate: new Date(now + 10 * DAY),
    slaPolicyId: sla._id,
  });
  await ServiceTicket.create([
    { taskflowOrganizationId: org._id, customerOrgId: acme._id, subject: 'Login down', resolutionDueAt: new Date(now - HOUR) },
    { taskflowOrganizationId: org._id, customerOrgId: acme._id, subject: 'Slow page', resolutionDueAt: new Date(now + HOUR) },
    { taskflowOrganizationId: org._id, customerOrgId: acme._id, subject: 'Old', status: 'closed', csatScore: 4 },
  ]);
  const [overdue, paid] = await BillingInvoice.create([
    {
      taskflowOrganizationId: org._id,
      accountId: account._id,
      number: 'INV-1',
      status: 'sent',
      total: 1000,
      amountPaid: 200,
      issueDate: new Date(now - 40 * DAY),
      dueDate: new Date(now - 10 * DAY),
    },
    { taskflowOrganizationId: org._id, accountId: account._id, number: 'INV-2', status: 'paid', total: 500, amountPaid: 500, issueDate: new Date(now - 5 * DAY) },
  ]);
  const ledgerAcct = new mongoose.Types.ObjectId();
  await JournalEntry.create({
    taskflowOrganizationId: org._id,
    number: 'JE-1',
    date: new Date(now - 2 * DAY),
    memo: 'Payment for invoice INV-2',
    sourceType: 'payment',
    sourceId: `${paid._id}:1`,
    lines: [
      { accountId: ledgerAcct, debit: 500 },
      { accountId: ledgerAcct, credit: 500 },
    ],
  });
  const mon = await MonitorProject.create({ taskflowOrganizationId: org._id, name: 'Portal web', key: 'PORW', sourceProjectId: portal._id });
  const check = await MonitorUptimeCheck.create({ taskflowOrganizationId: org._id, projectId: mon._id, name: 'Home', url: 'https://acme.test' });
  await MonitorUptimeSample.create([
    { taskflowOrganizationId: org._id, projectId: mon._id, checkId: check._id, ok: true, timestamp: new Date(now - 10 * 60_000) },
    { taskflowOrganizationId: org._id, projectId: mon._id, checkId: check._id, ok: false, timestamp: new Date(now - 60_000) },
  ]);

  Object.assign(ids, { org: String(org._id), ana: String(ana._id), ben: String(ben._id), acme: String(acme._id), overdue: String(overdue._id) });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('customer 360', () => {
  it('pulls every module into one view with health flags', async () => {
    const c = await getCustomer360(as('ana', ALL), ids.acme);
    expect(c.customer).toMatchObject({ name: 'Acme', accounts: [expect.objectContaining({ name: 'Acme Ltd' })] });
    expect(c.projects.map((p) => p.key)).toEqual(['POR']);
    expect(c.hiddenProjects).toBe(1);

    expect(c.deals?.summary).toEqual({ open: 1, pipeline: 20000, won: 0 });
    expect(c.contracts?.items[0]).toMatchObject({ title: 'Support MSA', slaPolicy: 'Gold', renewsInDays: 10 });
    expect(c.contracts?.slaPolicies[0].targets[0]).toMatchObject({ priority: 'high', resolutionMinutes: 480 });

    expect(c.issues.summary).toEqual({ open: 1, overdue: 1 });
    expect(c.issues.items.map((i) => i.key)).toEqual(['POR-1']);

    expect(c.tickets?.sla).toEqual({ breached: 1, atRisk: 1, onTrack: 0 });
    expect(c.tickets?.csat).toEqual({ average: 4, responses: 1 });

    expect(c.invoices?.summary).toMatchObject({ invoiced: 1500, collected: 700, outstanding: 800, overdue: 800, overdueCount: 1 });
    expect(c.invoices?.items.find((i) => i.id === ids.overdue)?.status).toBe('overdue');
    expect(c.invoices?.payments).toEqual([expect.objectContaining({ invoiceNumber: 'INV-2', amount: 500 })]);

    expect(c.monitor?.projects[0]).toMatchObject({ name: 'Portal web', uptime: 'down', downChecks: ['Home'] });

    const flags = c.health.map((h) => `${h.level}:${h.area}`);
    expect(flags).toEqual(
      expect.arrayContaining(['red:tickets', 'amber:tickets', 'red:invoices', 'red:monitor', 'amber:issues', 'amber:contracts'])
    );
  });

  it('leaves out sections the viewer has no permission for', async () => {
    const c = await getCustomer360(as('ana', ['taskflow.customer_portal.org.view']), ids.acme);
    expect(c.deals).toBeNull();
    expect(c.invoices).toBeNull();
    expect(c.tickets).toBeNull();
    expect(c.monitor).toBeNull();
    expect(c.health.map((h) => h.area)).toEqual(['issues']);
  });

  it('shows no projects or issues to someone outside them', async () => {
    const c = await getCustomer360(as('ben', ALL), ids.acme);
    expect(c.projects).toEqual([]);
    expect(c.hiddenProjects).toBe(2);
    expect(c.issues.summary).toEqual({ open: 0, overdue: 0 });
    expect(c.monitor?.projects).toEqual([]);
  });

  it('needs customer access', async () => {
    await expect(getCustomer360(as('ana', ['taskflow.crm.deal.read']), ids.acme)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('ticket SLA state', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it('is breached when a due time passed unmet, at risk when close', () => {
    expect(ticketSlaState({ status: 'open', resolutionDueAt: new Date(now - 1) }, now)).toBe('breached');
    expect(ticketSlaState({ status: 'open', firstResponseDueAt: new Date(now - 1) }, now)).toBe('breached');
    expect(ticketSlaState({ status: 'open', firstResponseDueAt: new Date(now - 1), firstRespondedAt: new Date(now - 2) }, now)).toBe('ok');
    expect(ticketSlaState({ status: 'open', resolutionDueAt: new Date(now + HOUR) }, now)).toBe('at_risk');
    expect(ticketSlaState({ status: 'open', resolutionDueAt: new Date(now + DAY) }, now)).toBe('ok');
    expect(ticketSlaState({ status: 'resolved', resolutionDueAt: new Date(now - 1) }, now)).toBe('none');
  });
});
