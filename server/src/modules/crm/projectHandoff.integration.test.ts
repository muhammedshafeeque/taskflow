import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { crmRoutes } from './crm.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { Project } from '../projects/project.model';
import { ResourceAllocation } from '../resources/models/resourceAllocation.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import * as customerOrgService from '../customer-portal/customer-org/customerOrg.service';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { CrmLead } from './models/crmLead.model';
import { CrmDeal } from './models/crmDeal.model';
import { CrmQuote } from './models/crmQuote.model';
import { CrmContract } from './models/crmContract.model';
import { ensureDefaultPipeline } from './pipelines/pipelines.service';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CRM;
const SALES = [C.LEAD.LIST, C.LEAD.READ, C.LEAD.CREATE, C.LEAD.UPDATE, C.DEAL.LIST, C.DEAL.READ, C.DEAL.UPDATE, C.QUOTE.CREATE, C.QUOTE.UPDATE, C.QUOTE.READ, C.SCOPE.ALL];

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/crm${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await flushAuditLogs();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

/** sales: CRM only. closer: CRM plus project create. pm: the delivery manager. outsider: not in the workspace. */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  const [salesRole, closerRole] = await Role.create([
    { name: 'Sales', permissions: SALES },
    { name: 'Sales closer', permissions: [...SALES, TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE] },
  ]);
  const owner = await User.create({ email: 'owner@example.com', name: 'owner', password: 'Passw0rd!x', mustChangePassword: false });
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: owner._id });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ sales: salesRole, closer: closerRole, pm: salesRole, outsider: salesRole })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    ids[name] = String(u._id);
    if (name !== 'outsider') {
      await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
      tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
    }
  }
  await ensureDefaultPipeline(orgId);
});

const newLead = () =>
  CrmLead.create({ taskflowOrganizationId: orgOid, title: 'Northwind portal', companyName: 'Northwind', contactName: 'Omar', contactEmail: 'omar@northwind.test', source: 'website', status: 'qualified', assigneeId: ids.sales });

describe('project handoff from CRM (AUT-30)', () => {
  it('converting a lead creates no project unless asked', async () => {
    const lead = await newLead();
    const res = await call('sales', 'POST', `/leads/${lead._id}/convert`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.handoff.projectId).toBeUndefined();
    expect(await Project.countDocuments()).toBe(0);
    expect((await CrmLead.findById(lead._id).lean())!.status).toBe('converted');
  });

  it('a project at conversion needs the project create permission and a chosen project manager', async () => {
    const lead = await newLead();
    const denied = await call('sales', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.pm });
    expect(denied.status).toBe(403);

    const noPm = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true });
    expect(noPm.status).toBe(400);
    expect(noPm.body.message).toMatch(/project manager/i);

    const notMember = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.outsider });
    expect(notMember.status).toBe(400);

    // Nothing was saved by the refused attempts.
    expect((await CrmLead.findById(lead._id).lean())!.status).toBe('qualified');
    expect(await CrmDeal.countDocuments()).toBe(0);

    const ok = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.pm });
    expect(ok.status).toBe(200);
    const project = await Project.findById(ok.body.data.handoff.projectId).lean();
    expect(String(project!.lead)).toBe(ids.pm);
  });

  it('nobody is booked on the new project, least of all the salesperson', async () => {
    const lead = await newLead();
    const ok = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.pm });
    expect(ok.status).toBe(200);
    expect(await ResourceAllocation.countDocuments({ projectId: ok.body.data.handoff.projectId })).toBe(0);
  });

  it('a failed conversion leaves the lead open and can be retried without duplicates', async () => {
    const lead = await newLead();
    const spy = jest.spyOn(customerOrgService, 'createOrg').mockRejectedValueOnce(new Error('portal is down'));
    const failed = await call('sales', 'POST', `/leads/${lead._id}/convert`, {});
    expect(failed.status).toBe(500);
    spy.mockRestore();

    const after = (await CrmLead.findById(lead._id).lean())!;
    expect(after.status).toBe('qualified');
    expect(after.dealId).toBeUndefined();
    expect(await CrmDeal.countDocuments()).toBe(0);

    const retry = await call('sales', 'POST', `/leads/${lead._id}/convert`, {});
    expect(retry.status).toBe(200);
    expect((await CrmLead.findById(lead._id).lean())!.status).toBe('converted');
    expect(await CrmDeal.countDocuments()).toBe(1);
    expect(await CustomerOrg.countDocuments()).toBe(1);
  });

  it('a project that fails to create also leaves the lead open', async () => {
    const lead = await newLead();
    await Project.create({ name: 'Taken', key: 'TAKEN', lead: ids.pm, taskflowOrganizationId: orgOid });
    const failed = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.pm, projectKey: 'TAKEN' });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect((await CrmLead.findById(lead._id).lean())!.status).toBe('qualified');
    expect(await CrmDeal.countDocuments()).toBe(0);

    // The organisation made on the first try is reused, not duplicated.
    const retry = await call('closer', 'POST', `/leads/${lead._id}/convert`, { createProject: true, projectLeadId: ids.pm, projectKey: 'NWP' });
    expect(retry.status).toBe(200);
    expect(await CustomerOrg.countDocuments()).toBe(1);
  });

  it('accepting a quote no longer creates a project; the won deal gets one with a chosen manager', async () => {
    const lead = await newLead();
    const conv = await call('sales', 'POST', `/leads/${lead._id}/convert`, {});
    const dealId = conv.body.data.deal._id;
    const quote = await CrmQuote.create({
      taskflowOrganizationId: orgOid, dealId, customerOrgId: conv.body.data.customerOrg._id, title: 'Build', status: 'sent', issueDate: new Date('2026-11-01'),
      currency: 'USD', lineItems: [{ description: 'Build', quantity: 1, unitPrice: 1000, amount: 1000 }], subtotal: 1000, total: 1000, createdBy: ids.sales,
    });
    const accepted = await call('sales', 'PATCH', `/quotes/${quote._id}`, { status: 'accepted' });
    expect(accepted.status).toBe(200);
    expect(await Project.countDocuments()).toBe(0);
    const contract = await CrmContract.findOne({ dealId }).lean();
    expect(contract).toBeTruthy();

    // Creating the project needs project create, and a project manager.
    expect((await call('sales', 'POST', `/deals/${dealId}/create-project`, { name: 'Northwind', key: 'NW', leadId: ids.pm })).status).toBe(403);
    expect((await call('closer', 'POST', `/deals/${dealId}/create-project`, { name: 'Northwind', key: 'NW' })).status).toBe(400);
    const created = await call('closer', 'POST', `/deals/${dealId}/create-project`, { name: 'Northwind', key: 'NW', leadId: ids.pm });
    expect(created.status).toBe(201);
    const projectId = String(created.body.data.project._id);
    expect(String(created.body.data.project.lead)).toBe(ids.pm);
    expect(created.body.data.deal.status).toBe('won');
    // The accepted quote and its contract join the project.
    expect(String((await CrmQuote.findById(quote._id).lean())!.projectId)).toBe(projectId);
    expect(String((await CrmContract.findById(contract!._id).lean())!.projectId)).toBe(projectId);
    expect(await ResourceAllocation.countDocuments({ projectId })).toBe(0);

    expect((await call('closer', 'POST', `/deals/${dealId}/create-project`, { name: 'Again', key: 'NW2', leadId: ids.pm })).status).toBe(409);
  });
});
