import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ALL_CRM_PERMISSIONS, SALES_CRM_PERMISSIONS } from './salesRoleTemplate';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/auth/user.model';
import { Organization } from '../modules/organizations/organization.model';
import { OrganizationMember } from '../modules/organizations/organizationMember.model';
import { CrmDeal } from '../modules/crm/models/crmDeal.model';
import { CommissionEntry, CommissionPlan, commissionRoutes } from '../modules/crm/commissions/commissions';
import { crmRoutes } from '../modules/crm/crm.routes';
import { createToken } from '../modules/apiTokens/apiToken.service';
import { errorHandler } from '../middleware/errorHandler';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => mongoose.connection.dropDatabase());
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('a seeded Sales user over HTTP (AUT-8)', () => {
  let server: Server;
  afterEach(() => new Promise((r) => server.close(r)));

  async function setup(permissions: string[]) {
    const role = await Role.create({ code: 'sales', name: 'Sales', permissions });
    const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
    const user = await User.create({ email: 's@example.com', name: 'Sam', password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: user._id, role: 'org_member', status: 'active' });
    const token = (await createToken(String(user._id), String(org._id), { name: 't' })).token;
    const oid = () => new mongoose.Types.ObjectId();
    const deal = await CrmDeal.create({ taskflowOrganizationId: org._id, title: 'D', pipelineId: oid(), stageId: oid(), ownerId: user._id });
    const entry = await CommissionEntry.create({ taskflowOrganizationId: org._id, userId: user._id, dealId: deal._id, base: 100, amount: 5 });
    const app = express();
    app.use(express.json());
    app.use('/crm/commissions', commissionRoutes);
    app.use('/crm', crmRoutes);
    app.use(errorHandler);
    server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crm`;
    const call = async (method: string, path: string, body?: unknown) =>
      (await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })).status;
    return { call, deal, entry };
  }

  it('can work deals and see commission, but not approve it, edit pipelines or delete', async () => {
    const { call, deal, entry } = await setup(SALES_CRM_PERMISSIONS);
    for (const path of ['/leads', '/deals', '/pipelines', '/commissions/entries']) expect([path, await call('GET', path)]).toEqual([path, 200]);
    expect(await call('POST', '/leads', { title: 'L' })).toBeLessThan(300);

    expect(await call('PATCH', `/commissions/entries/${entry._id}`, { status: 'approved' })).toBe(403);
    expect(await call('POST', '/commissions/plans', { name: 'P', ratePct: 50 })).toBe(403);
    expect(await call('POST', '/pipelines', { name: 'P' })).toBe(403);
    for (const r of ['accounts', 'contacts', 'activities', 'leads', 'deals', 'quotes', 'contracts', 'campaigns']) {
      expect([r, await call('DELETE', `/${r}/${deal._id}`)]).toEqual([r, 403]);
    }
    expect((await CommissionEntry.findById(entry._id).lean())?.status).toBe('pending');
    expect(await CommissionPlan.countDocuments()).toBe(0);
  });

  it('control: the old template allowed it', async () => {
    const { call, deal, entry } = await setup(ALL_CRM_PERMISSIONS);
    expect(await call('PATCH', `/commissions/entries/${entry._id}`, { status: 'approved' })).toBe(200);
    expect(await call('POST', '/pipelines', { name: 'P' })).toBeLessThan(300);
    expect(await call('DELETE', `/deals/${deal._id}`)).toBe(200);
  });
});
