import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { accountsRoutes } from './accounts.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.setTimeout(120_000);

const A = TASK_FLOW_PERMISSIONS.TASKFLOW.ACCOUNTS;

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
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
  app.use('/api/accounts', accountsRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const [claimantRole, editorRole, approverRole, adminRole] = await Role.create([
    { name: 'Claimant', permissions: [A.EXPENSE.LIST, A.EXPENSE.CREATE] },
    // The old gap: update alone used to be enough to approve.
    { name: 'Expense Editor', permissions: [A.EXPENSE.LIST, A.EXPENSE.CREATE, A.EXPENSE.UPDATE] },
    { name: 'Expense Approver', permissions: [A.EXPENSE.LIST, A.EXPENSE.APPROVE] },
    { name: 'Accounts Admin', permissions: [A.EXPENSE.LIST, A.EXPENSE.CREATE, A.EXPENSE.UPDATE, A.EXPENSE.APPROVE, A.CHART.MANAGE] },
  ]);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  const specs = {
    cara: { roleId: claimantRole._id },
    eddy: { roleId: editorRole._id },
    anna: { roleId: approverRole._id },
    abel: { roleId: approverRole._id },
    adam: { roleId: adminRole._id },
    boss: { role: 'admin' as const },
  };
  for (const [name, extra] of Object.entries(specs)) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, ...extra });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], String(org._id), { name: 't' })).token;
  }
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

const claim = (who: string, amount: number, extra: Record<string, unknown> = {}) =>
  call(who, 'POST', '/accounts/expenses', { description: 'Taxi', category: 'travel', amount, ...extra });
const move = (who: string, id: string, status: string) => call(who, 'PATCH', `/accounts/expenses/${id}/status`, { status });

describe('expense claims: approve permission, self-approval, limits, valid moves (AUT-26)', () => {
  it('needs the separate approve permission; update alone can no longer approve', async () => {
    const c = await claim('cara', 100);
    expect(c.status).toBe(201);
    const id = c.body.data._id;

    // Old path: setting status through the edit endpoint is refused.
    const viaEdit = await call('eddy', 'PATCH', `/accounts/expenses/${id}`, { status: 'approved' });
    expect(viaEdit.status).toBe(400);
    // Editor without approve permission is refused on the status endpoint too.
    expect((await move('eddy', id, 'approved')).status).toBe(403);
    // Approver can.
    const ok = await move('anna', id, 'approved');
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('approved');
    expect(ok.body.data.approvedBy).toBe(ids.anna);
    // Approver without update can't mark paid; the editor can.
    expect((await move('anna', id, 'paid')).status).toBe(403);
    expect((await move('eddy', id, 'paid')).status).toBe(200);
  });

  it('nobody can approve their own claim, not even an admin', async () => {
    for (const who of ['adam', 'boss']) {
      const c = await claim(who, 50);
      expect(c.status).toBe(201);
      const res = await move(who, c.body.data._id, 'approved');
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own expense claim/);
      expect((await move('anna', c.body.data._id, 'approved')).status).toBe(200);
    }
  });

  it('rejects invalid status values and moves', async () => {
    expect((await claim('adam', 10, { status: 'approved' })).status).toBe(400);
    expect((await claim('adam', 10, { status: 'paid' })).status).toBe(400);
    expect((await claim('adam', -5)).status).toBe(400);

    const d = await claim('cara', 10, { status: 'draft' });
    const id = d.body.data._id;
    expect((await move('adam', id, 'banana')).status).toBe(400);
    expect((await move('anna', id, 'approved')).status).toBe(400); // draft → approved skips submission
    expect((await move('adam', id, 'paid')).status).toBe(400);
    expect((await move('cara', id, 'submitted')).status).toBe(200); // claimant submits own draft
    expect((await move('adam', id, 'paid')).status).toBe(400); // can't pay before approval
    expect((await move('anna', id, 'rejected')).status).toBe(200);
    expect((await move('anna', id, 'approved')).status).toBe(400); // rejected must go back to draft first
    expect((await move('cara', id, 'draft')).status).toBe(200);
    expect((await call('eddy', 'PATCH', `/accounts/expenses/${id}`, { amount: 12 })).status).toBe(200);
    expect((await move('cara', id, 'submitted')).status).toBe(200);
    expect((await move('anna', id, 'approved')).status).toBe(200);
    expect((await call('eddy', 'PATCH', `/accounts/expenses/${id}`, { amount: 999 })).status).toBe(400); // approved = locked
    expect((await move('eddy', id, 'paid')).status).toBe(200);
    expect((await move('eddy', id, 'draft')).status).toBe(400); // paid is final
  });

  it('applies configurable amount limits and a second approver', async () => {
    // Only accounts admins set limits.
    expect((await call('anna', 'PUT', '/accounts/expenses/approval-settings', { maxClaimAmount: 1 })).status).toBe(403);
    expect((await call('adam', 'PUT', '/accounts/expenses/approval-settings', { singleApproverLimit: 5000, maxClaimAmount: 1000 })).status).toBe(400);
    const set = await call('adam', 'PUT', '/accounts/expenses/approval-settings', {
      singleApproverLimit: 500,
      maxClaimAmount: 5000,
      secondApproverIds: [ids.adam],
      approverLimits: [{ userId: ids.abel, maxAmount: 200 }],
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ singleApproverLimit: 500, maxClaimAmount: 5000, secondApproverIds: [ids.adam] });

    // Over the maximum: can't be submitted.
    expect((await claim('cara', 6000)).status).toBe(400);

    // Personal limit: abel can approve up to 200.
    const small = await claim('cara', 300);
    expect((await move('abel', small.body.data._id, 'approved')).status).toBe(403);
    expect((await move('anna', small.body.data._id, 'approved')).body.data.status).toBe('approved');

    // Above 500: two different approvers, and the second must be a designated one.
    const big = await claim('cara', 800);
    const id = big.body.data._id;
    const first = await move('anna', id, 'approved');
    expect(first.status).toBe(200);
    expect(first.body.data.awaitingSecondApproval).toBe(true);
    expect(first.body.data.status).toBe('submitted');
    expect((await move('anna', id, 'approved')).status).toBe(403); // same person twice
    expect((await move('boss', id, 'approved')).status).toBe(403); // not a designated second approver

    // Changing the amount under review drops the first approval.
    await call('eddy', 'PATCH', `/accounts/expenses/${id}`, { amount: 900 });
    const again = await move('adam', id, 'approved');
    expect(again.body.data.awaitingSecondApproval).toBe(true);
    const done = await move('anna', id, 'approved');
    expect(done.status).toBe(403); // anna isn't a designated second approver
    await call('adam', 'PUT', '/accounts/expenses/approval-settings', { secondApproverIds: [] });
    const final = await move('anna', id, 'approved');
    expect(final.status).toBe(200);
    expect(final.body.data.status).toBe('approved');
    expect(final.body.data.firstApprovedBy).toBe(ids.adam);
  });
});
