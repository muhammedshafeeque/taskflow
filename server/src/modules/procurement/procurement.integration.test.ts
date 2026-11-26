import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { procurementRoutes } from './procurement.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.setTimeout(120_000);

const P = TASK_FLOW_PERMISSIONS.TASKFLOW.PROCUREMENT;

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let vendorId = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

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
  app.use('/api/procurement', procurementRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const [creatorRole, approverRole, managerRole] = await Role.create([
    { name: 'PO Creator', permissions: [P.PO.LIST, P.PO.CREATE, P.VENDOR.LIST] },
    { name: 'PO Approver', permissions: [P.PO.LIST, P.PO.APPROVE, P.VENDOR.LIST] },
    { name: 'PO Manager', permissions: [P.DASHBOARD.READ, P.VENDOR.LIST, P.VENDOR.MANAGE, P.PO.LIST, P.PO.CREATE, P.PO.APPROVE, P.PO.MANAGE, P.SETTINGS.READ, P.SETTINGS.MANAGE] },
  ]);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  const specs = {
    abel: { roleId: creatorRole._id },
    alma: { roleId: managerRole._id },
    farah: { roleId: approverRole._id },
    boss: { role: 'admin' as const },
  };
  for (const [name, extra] of Object.entries(specs)) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, ...extra });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], String(org._id), { name: 't' })).token;
  }
  const vendor = await CrmAccount.create({ taskflowOrganizationId: org._id, name: 'Acme Hardware', type: 'vendor' });
  vendorId = String(vendor._id);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

async function makePo(who: string, unitPrice: number, extra: Record<string, unknown> = {}) {
  return call(who, 'POST', '/procurement/pos', {
    title: 'Laptops',
    vendorAccountId: vendorId,
    category: 'hardware',
    lines: [{ description: 'Laptop', quantity: 1, unitPrice }],
    ...extra,
  });
}

describe('procurement PO workflow, self-approval & amount limits (AUT-25)', () => {
  it('blocks invalid status transitions and skipping approval', async () => {
    expect((await makePo('alma', 500, { status: 'approved' })).status).toBe(400);
    expect((await makePo('alma', 500, { status: 'ordered' })).status).toBe(400);

    const created = await makePo('abel', 500);
    expect(created.status).toBe(201);
    const poId = created.body.data._id;

    // Cannot skip pending_approval
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'approved' })).status).toBe(400);
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'ordered' })).status).toBe(400);
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'received' })).status).toBe(400);

    // Creator submits draft -> pending_approval, but cannot approve or order
    expect((await call('abel', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'pending_approval' })).status).toBe(200);
    expect((await call('abel', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'approved' })).status).toBe(403);

    // Approver approves, manager orders and receives
    expect((await call('farah', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'approved' })).status).toBe(200);
    // Cannot edit once approved or skip ordered -> received
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}`, { title: 'Edited' })).status).toBe(400);
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'received' })).status).toBe(400);
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'ordered' })).status).toBe(200);
    const recv = await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'received' });
    expect(recv.status).toBe(200);
    expect(recv.body.data.provisioned.assetsCreated).toBe(1);
    // Terminal state
    expect((await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'cancelled' })).status).toBe(400);
  });

  it('prevents the creator from approving their own purchase order even with manage/admin rights', async () => {
    const created = await makePo('boss', 500, { status: 'pending_approval' });
    expect(created.status).toBe(201);
    const poId = created.body.data._id;

    const selfApprove = await call('boss', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'approved' });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.message).toMatch(/creator/i);

    const otherApprove = await call('alma', 'PATCH', `/procurement/pos/${poId}/status`, { status: 'approved' });
    expect(otherApprove.status).toBe(200);
    expect(otherApprove.body.data.status).toBe('approved');
  });

  it('enforces configurable amount limits, two-step approval, and maxOrderAmount', async () => {
    const cfg = await call('alma', 'PUT', '/procurement/settings', {
      singleApproverLimit: 1000,
      maxOrderAmount: 10000,
      secondApproverIds: [ids.farah],
      approverLimits: [{ userId: ids.alma, maxAmount: 1000 }],
    });
    expect(cfg.status).toBe(200);
    expect(cfg.body.data.singleApproverLimit).toBe(1000);

    // Exceeding maxOrderAmount cannot even be submitted
    const huge = await makePo('abel', 15000);
    expect(huge.status).toBe(201);
    expect((await call('abel', 'PATCH', `/procurement/pos/${huge.body.data._id}/status`, { status: 'pending_approval' })).status).toBe(400);

    // Under singleApproverLimit: 1 approval completes
    const small = await makePo('abel', 800, { status: 'pending_approval' });
    const smallApprove = await call('alma', 'PATCH', `/procurement/pos/${small.body.data._id}/status`, { status: 'approved' });
    expect(smallApprove.status).toBe(200);
    expect(smallApprove.body.data.status).toBe('approved');
    expect(smallApprove.body.data.awaitingSecondApproval).toBe(false);

    // Above singleApproverLimit: requires 2 distinct approvers, and 2nd must be Farah
    const big = await makePo('abel', 5000, { status: 'pending_approval' });
    const bigId = big.body.data._id;

    const first = await call('alma', 'PATCH', `/procurement/pos/${bigId}/status`, { status: 'approved' });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('pending_approval');
    expect(first.body.data.awaitingSecondApproval).toBe(true);
    expect(first.body.data.firstApprovedBy._id).toBe(ids.alma);

    // Same approver cannot provide 2nd approval
    expect((await call('alma', 'PATCH', `/procurement/pos/${bigId}/status`, { status: 'approved' })).status).toBe(403);
    // Undesignated admin cannot provide 2nd approval when secondApproverIds is configured
    expect((await call('boss', 'PATCH', `/procurement/pos/${bigId}/status`, { status: 'approved' })).status).toBe(403);
    // Creator cannot provide 2nd approval
    expect((await call('abel', 'PATCH', `/procurement/pos/${bigId}/status`, { status: 'approved' })).status).toBe(403);

    // Designated second approver (Farah) completes approval
    const second = await call('farah', 'PATCH', `/procurement/pos/${bigId}/status`, { status: 'approved' });
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('approved');
    expect(second.body.data.approvedBy._id).toBe(ids.farah);
  });
});
