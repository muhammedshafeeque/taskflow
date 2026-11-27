import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { approvalsRoutes } from './approvals.routes';
import { accountsRoutes } from '../accounts/accounts.routes';
import { procurementRoutes } from '../procurement/procurement.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import * as hrms from '../hrms/hrms.service';
import * as billing from '../billing/billing.service';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.setTimeout(120_000);

const T = TASK_FLOW_PERMISSIONS.TASKFLOW;
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let headRoleId = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const emp: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
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
  app.use('/api/approvals', approvalsRoutes);
  app.use('/api/accounts', accountsRoutes);
  app.use('/api/procurement', procurementRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

/**
 * Org chart: staff → lead → head (role "Department head") → ceo. deputy stands in for lead.
 * finance holds the admin rights for chains. Nobody but finance has expense.approve.
 */
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const staffPerms = [T.ACCOUNTS.EXPENSE.LIST, T.ACCOUNTS.EXPENSE.CREATE, T.PROCUREMENT.PO.LIST, T.PROCUREMENT.PO.CREATE];
  const [staffRole, headRole, financeRole] = await Role.create([
    { name: 'Staff', permissions: staffPerms },
    { name: 'Department head', permissions: staffPerms },
    {
      name: 'Finance admin',
      permissions: [...staffPerms, T.ACCOUNTS.EXPENSE.UPDATE, T.ACCOUNTS.EXPENSE.APPROVE, T.APPROVALS.POLICY.MANAGE, T.APPROVALS.REQUEST.LIST_ALL, T.APPROVALS.DELEGATION.MANAGE],
    },
  ]);
  headRoleId = String(headRole._id);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  orgId = String(org._id);
  const roleOf: Record<string, mongoose.Types.ObjectId> = { staff: staffRole._id, lead: staffRole._id, deputy: staffRole._id, head: headRole._id, ceo: staffRole._id, finance: financeRole._id };
  for (const [name, roleId] of Object.entries(roleOf)) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  let managerId: mongoose.Types.ObjectId | undefined;
  for (const name of ['ceo', 'head', 'lead', 'staff']) {
    const e = await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: name.toUpperCase(), name, joinedDate: new Date('2024-01-01'), userId: ids[name], managerId });
    emp[name] = String(e._id);
    managerId = e._id as mongoose.Types.ObjectId;
  }
});

const soon = new Date(Date.now() + 30 * 86400_000).toISOString();
const chain = (who = 'finance') =>
  call(who, 'PUT', '/approvals/policies/expense', {
    enabled: true,
    steps: [
      { name: 'Team lead', kind: 'manager', level: 1 },
      { name: 'Department head', kind: 'role', roleId: headRoleId, aboveAmount: 1000 },
      { name: 'CEO', kind: 'users', userIds: [ids.ceo], aboveAmount: 10000 },
    ],
  });
const claim = (who: string, amount: number) => call(who, 'POST', '/accounts/expenses', { description: 'Trip', category: 'travel', amount });
const queueOf = async (who: string) => (await call(who, 'GET', '/approvals/queue')).body.data as Array<{ _id: string; recordType: string; onBehalfOf: string | null }>;
const decide = (who: string, reqId: string, decision: 'approve' | 'reject', note?: string) =>
  call(who, 'POST', `/approvals/requests/${reqId}/decision`, { decision, note });
const expenseStatus = async (id: string) => (await call('finance', 'GET', '/accounts/expenses')).body.data.find((x: { _id: string }) => x._id === id).status;

describe('shared approval engine (AUT-27)', () => {
  it('only chain admins can configure chains, and a chain needs steps before it is on', async () => {
    expect((await chain('staff')).status).toBe(403);
    expect((await call('finance', 'PUT', '/approvals/policies/expense', { enabled: true, steps: [] })).status).toBe(400);
    expect((await call('finance', 'PUT', '/approvals/policies/expense', { steps: [{ name: 'x', kind: 'role' }] })).status).toBe(400);
    const res = await chain();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ recordType: 'expense', enabled: true });
    expect(res.body.data.steps).toHaveLength(3);
  });

  it('routes by amount: lead only, lead → head, lead → head → CEO', async () => {
    await chain();
    const small = (await claim('staff', 500)).body.data._id;
    const mid = (await claim('staff', 5000)).body.data._id;
    const big = (await claim('staff', 20000)).body.data._id;

    // Only the lead is asked first, for all three; head and CEO see nothing yet.
    expect((await queueOf('lead')).length).toBe(3);
    expect(await queueOf('head')).toHaveLength(0);
    expect(await queueOf('ceo')).toHaveLength(0);
    const reqOf = async (recordId: string) => (await call('staff', 'GET', `/approvals/requests?scope=mine&recordId=${recordId}`)).body.data[0];

    const rSmall = await reqOf(small);
    expect(rSmall.steps.map((s: { name: string }) => s.name)).toEqual(['Team lead']);
    expect((await decide('lead', rSmall._id, 'approve')).body.data.outcome).toBe('approved');
    expect(await expenseStatus(small)).toBe('approved');

    const rMid = await reqOf(mid);
    expect((await decide('head', rMid._id, 'approve')).status).toBe(403); // not their step yet
    expect((await decide('lead', rMid._id, 'approve')).body.data.outcome).toBe('pending');
    expect(await expenseStatus(mid)).toBe('submitted');
    expect((await decide('head', rMid._id, 'approve')).body.data.outcome).toBe('approved');
    expect(await expenseStatus(mid)).toBe('approved');

    const rBig = await reqOf(big);
    expect(rBig.steps.map((s: { name: string }) => s.name)).toEqual(['Team lead', 'Department head', 'CEO']);
    await decide('lead', rBig._id, 'approve');
    await decide('head', rBig._id, 'approve');
    expect((await queueOf('ceo')).map((q) => q._id)).toEqual([rBig._id]);
    const done = await decide('ceo', rBig._id, 'approve', 'OK for the conference');
    expect(done.body.data.outcome).toBe('approved');

    // Every decision is logged on the request.
    const detail = (await call('staff', 'GET', `/approvals/requests/${rBig._id}`)).body.data;
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(['submitted', 'approved', 'approved', 'approved', 'completed']);
    expect(detail.steps[2].note).toBe('OK for the conference');
  });

  it('nobody approves their own request; a step only the requester could approve uses the fallback', async () => {
    await chain();
    // head's manager is the CEO; head is the only "Department head", so that step falls back.
    await call('finance', 'PUT', '/approvals/policies/expense', { fallbackUserIds: [ids.finance, ids.ceo] });
    const id = (await claim('head', 5000)).body.data._id;
    const req = (await call('head', 'GET', `/approvals/requests?scope=mine&recordId=${id}`)).body.data[0];
    expect((await decide('head', req._id, 'approve')).status).toBe(403);
    // Old module button can't do it either, even for an approver of expenses.
    const own = (await claim('finance', 50)).body.data._id;
    expect((await call('finance', 'PATCH', `/accounts/expenses/${own}/status`, { status: 'approved' })).status).toBe(403);

    expect((await decide('ceo', req._id, 'approve')).body.data.outcome).toBe('pending');
    const detail = (await call('finance', 'GET', `/approvals/requests/${req._id}`)).body.data;
    expect(detail.steps[1].approverIds.map((u: { _id: string }) => u._id)).toEqual([ids.finance]);
    expect((await decide('finance', req._id, 'approve')).body.data.outcome).toBe('approved');
  });

  it('refuses a request nobody can approve, and keeps the claim as a draft', async () => {
    await call('finance', 'PUT', '/approvals/policies/expense', { enabled: true, steps: [{ name: 'Lead', kind: 'manager', level: 1 }] });
    const res = await claim('ceo', 100); // the CEO has no manager and there is no fallback
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Nobody is available/);
  });

  it('approvers on leave can delegate; the delegate decides on their behalf', async () => {
    await chain();
    const id = (await claim('staff', 200)).body.data._id;
    // deputy cannot act yet
    expect(await queueOf('deputy')).toHaveLength(0);
    expect((await call('deputy', 'POST', '/approvals/delegations', { fromUserId: ids.lead, toUserId: ids.deputy, endsAt: soon })).status).toBe(403);
    expect((await call('lead', 'POST', '/approvals/delegations', { toUserId: ids.lead, endsAt: soon })).status).toBe(400);
    const d = await call('lead', 'POST', '/approvals/delegations', { toUserId: ids.deputy, endsAt: soon, note: 'On leave' });
    expect(d.status).toBe(200);

    const q = await queueOf('deputy');
    expect(q).toHaveLength(1);
    expect(q[0].onBehalfOf).toBe(ids.lead);
    expect((await decide('deputy', q[0]._id, 'approve')).body.data.outcome).toBe('approved');
    const detail = (await call('lead', 'GET', `/approvals/requests/${q[0]._id}`)).body.data;
    expect(detail.steps[0].decidedBy._id).toBe(ids.deputy);
    expect(detail.steps[0].onBehalfOf._id).toBe(ids.lead);
    expect(await expenseStatus(id)).toBe('approved');

    // Ending the delegation removes the deputy's access.
    await call('lead', 'DELETE', `/approvals/delegations/${d.body.data._id}`);
    await claim('staff', 300);
    expect(await queueOf('deputy')).toHaveLength(0);
  });

  it('rejecting ends the chain and rejects the record; an amount change restarts it', async () => {
    await chain();
    const id = (await claim('staff', 5000)).body.data._id;
    let req = (await call('staff', 'GET', `/approvals/requests?scope=mine&recordId=${id}`)).body.data[0];
    await decide('lead', req._id, 'approve');
    // Amount changes under review: the chain starts again, and the head is told to look again later.
    await call('finance', 'PATCH', `/accounts/expenses/${id}`, { amount: 6000 });
    const r = await decide('head', req._id, 'approve');
    expect(r.status).toBe(409);
    expect((await queueOf('lead')).map((x) => x._id)).toContain(req._id);
    await decide('lead', req._id, 'approve');
    const rej = await decide('head', req._id, 'reject', 'Too expensive');
    expect(rej.body.data.outcome).toBe('rejected');
    expect(await expenseStatus(id)).toBe('rejected');
    req = (await call('staff', 'GET', `/approvals/requests/${req._id}`)).body.data;
    expect(req.history.map((h: { action: string }) => h.action)).toEqual(['submitted', 'approved', 'restarted', 'approved', 'rejected']);
  });

  it('one queue across record types: leave (decision) and invoices (gate)', async () => {
    await call('finance', 'PUT', '/approvals/policies/leave', { enabled: true, steps: [{ name: 'Manager', kind: 'manager', level: 1 }] });
    await call('finance', 'PUT', '/approvals/policies/invoice', { enabled: true, steps: [{ name: 'Finance', kind: 'users', userIds: [ids.finance] }] });

    const leave = await hrms.createLeave(orgId, { employeeId: emp.staff, startDate: '2030-03-04', endDate: '2030-03-05', days: 2 }, null, ids.staff);
    const account = await CrmAccount.create({ taskflowOrganizationId: orgId, name: 'Client', type: 'client' });
    const inv = await billing.createInvoice(orgId, { accountId: account._id, lines: [{ description: 'Work', quantity: 1, unitPrice: 900 }] }, ids.lead);
    const invId = String((inv as { _id: unknown })._id);

    // Sending needs approval: the first try submits it.
    await expect(billing.updateInvoice(invId, orgId, { status: 'sent' }, ids.lead)).rejects.toMatchObject({ statusCode: 409 });
    await expect(billing.updateInvoice(invId, orgId, { status: 'sent' }, ids.lead)).rejects.toThrow(/Waiting for approval/);

    expect((await queueOf('lead')).map((q) => q.recordType)).toEqual(['leave']);
    expect((await queueOf('finance')).map((q) => q.recordType)).toEqual(['invoice']);

    // Leave via the HR decision path goes through the chain too.
    const leaveId = String((leave as { _id: unknown })._id);
    await expect(hrms.decideLeave(leaveId, orgId, 'approved', ids.finance, false, null, [])).rejects.toMatchObject({ statusCode: 403 });
    await hrms.decideLeave(leaveId, orgId, 'approved', ids.lead, false, null, []);
    expect((await HrmsLeaveRequest.findById(leaveId).lean())!.status).toBe('approved');

    const invReq = (await queueOf('finance'))[0];
    await decide('finance', invReq._id, 'approve');
    const sent = await billing.updateInvoice(invId, orgId, { status: 'sent' }, ids.lead);
    expect((sent as { status: string }).status).toBe('sent');
  });

  it('record pages can read where a record stands in its chain', async () => {
    const account = await CrmAccount.create({ taskflowOrganizationId: orgId, name: 'Client', type: 'client' });
    const inv = await billing.createInvoice(orgId, { accountId: account._id, lines: [{ description: 'Work', quantity: 1, unitPrice: 500 }] }, ids.lead);
    const invId = String((inv as { _id: unknown })._id);
    const status = (who: string) => call(who, 'GET', `/approvals/record/invoice/${invId}`);

    // Chain off, nothing asked yet.
    expect((await status('lead')).body.data).toEqual({ chainEnabled: false, request: null });
    expect((await call('lead', 'GET', `/approvals/record/nonsense/${invId}`)).status).toBe(400);

    await call('finance', 'PUT', '/approvals/policies/invoice', { enabled: true, steps: [{ name: 'Finance', kind: 'users', userIds: [ids.finance] }] });
    await expect(billing.updateInvoice(invId, orgId, { status: 'sent' }, ids.lead)).rejects.toMatchObject({ statusCode: 409 });

    const mine = (await status('lead')).body.data;
    expect(mine.chainEnabled).toBe(true);
    expect(mine.request).toMatchObject({ status: 'pending', amount: 500, requestedBy: 'lead', isMine: true, canDecide: false });
    expect(mine.request.steps).toEqual([expect.objectContaining({ name: 'Finance', status: 'pending', approvers: ['finance'], decidedBy: null })]);
    expect(mine.request).not.toHaveProperty('title');

    const approver = (await status('finance')).body.data.request;
    expect(approver).toMatchObject({ canDecide: true, isMine: false });

    await decide('finance', approver._id, 'approve');
    const done = (await status('lead')).body.data.request;
    expect(done).toMatchObject({ status: 'approved', canDecide: false });
    expect(done.steps[0]).toMatchObject({ status: 'approved', decidedBy: 'finance' });
  });

  it('purchase orders use the chain; chains that are off leave modules as they were', async () => {
    const po = await call('staff', 'POST', '/procurement/vendors', { name: 'V' });
    expect(po.status).toBe(403); // staff can't add vendors; seed one directly
    const vendor = await CrmAccount.create({ taskflowOrganizationId: orgId, name: 'V', type: 'vendor' });
    const mk = () => call('staff', 'POST', '/procurement/pos', { title: 'Desk', vendorAccountId: String(vendor._id), lines: [{ description: 'Desk', quantity: 1, unitPrice: 400 }], status: 'pending_approval' });

    // Chain off: no request is made.
    const a = await mk();
    expect(a.status).toBe(201);
    expect((await call('staff', 'GET', `/approvals/requests?scope=mine&recordId=${a.body.data._id}`)).body.data).toHaveLength(0);

    await call('finance', 'PUT', '/approvals/policies/purchase_order', { enabled: true, steps: [{ name: 'Manager', kind: 'manager', level: 1 }] });
    const b = await mk();
    const req = (await queueOf('lead')).find((q) => q.recordType === 'purchase_order')!;
    expect(req).toBeTruthy();
    await decide('lead', req._id, 'approve');
    const list = (await call('staff', 'GET', '/procurement/pos')).body.data as Array<{ _id: string; status: string }>;
    expect(list.find((p) => p._id === b.body.data._id)!.status).toBe('approved');
  });
});
