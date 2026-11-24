import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Role } from '../modules/roles/role.model';
import { ALL_CRM_PERMISSIONS, SALES_CRM_PERMISSIONS, isCrmAdminOnly } from '../scripts/salesRoleTemplate';
import { crmRoutes } from '../modules/crm/crm.routes';
import { commissionRoutes } from '../modules/crm/commissions/commissions';
import { PERMISSION_TAG, type PermissionTag } from '../middleware/requirePermission';
import { userHasPermission } from '../shared/constants/legacyPermissionMap';
import { LEGACY_SALES_CRM, migrateSalesRolePermissionsIfNeeded } from './migrateSalesRolePermissions';

jest.setTimeout(120_000);

const CORE = ['taskflow.core.company.read', 'taskflow.core.currency.read', 'taskflow.core.exchange_rate.read'];
let mongo: MongoMemoryServer;
const perms = async (code: string) => (await Role.findOne({ code }).lean())!.permissions;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(() => mongoose.connection.dropDatabase());
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

/** Routes a person with these permissions gets through to, as "METHOD path". */
function reachable(router: unknown, held: string[]): string[] {
  type Layer = { route?: { path: string; stack: Array<{ method: string; handle: { [PERMISSION_TAG]?: PermissionTag } }> } };
  return (router as { stack: Layer[] }).stack.flatMap(({ route }) => {
    if (!route) return [];
    const tags = route.stack.map((s) => s.handle[PERMISSION_TAG]).filter((t): t is PermissionTag => !!t);
    const ok = tags.length > 0 && tags.every((t) => (t.all ?? []).every((p) => userHasPermission(held, p)) && (!t.any || t.any.some((p) => userHasPermission(held, p))));
    return ok ? [`${route.stack[0].method.toUpperCase()} ${route.path}`] : [];
  });
}

describe('starter Sales role (AUT-8)', () => {
  it('cannot delete CRM records, edit pipelines or approve commission', () => {
    const crm = reachable(crmRoutes, SALES_CRM_PERMISSIONS);
    expect(crm.filter((r) => r.startsWith('DELETE'))).toEqual([]);
    expect(crm.filter((r) => /^(POST|PATCH) \/(pipelines|webhooks)/.test(r))).toEqual([]);
    expect(reachable(commissionRoutes, SALES_CRM_PERMISSIONS).filter((r) => !r.startsWith('GET'))).toEqual([]);
  });

  it('can still do the sales job', () => {
    expect(reachable(crmRoutes, SALES_CRM_PERMISSIONS)).toEqual(
      expect.arrayContaining(['GET /leads', 'POST /leads', 'POST /leads/:id/convert', 'PATCH /deals/:id', 'POST /quotes/:id/send', 'GET /pipelines', 'GET /dashboard'])
    );
    expect(reachable(commissionRoutes, SALES_CRM_PERMISSIONS)).toContain('GET /entries');
  });

  it('leaves CRM Admin with everything', () => {
    const admin = reachable(crmRoutes, ALL_CRM_PERMISSIONS);
    expect(admin).toEqual(expect.arrayContaining(['DELETE /leads/:id', 'PATCH /pipelines/:id']));
    expect(reachable(commissionRoutes, ALL_CRM_PERMISSIONS)).toContain('PATCH /entries/:id');
  });
});

describe('migration of existing Sales roles (AUT-8)', () => {
  it.each(LEGACY_SALES_CRM.map((p, i) => [i, p] as const))('tightens untouched roles seeded by version %i', async (_i, legacy) => {
    await Role.create([
      { code: 'sales', name: 'Sales', permissions: [...legacy, ...CORE] },
      { code: 'account_manager', name: 'Account Manager', permissions: legacy },
    ]);
    await migrateSalesRolePermissionsIfNeeded();
    for (const code of ['sales', 'account_manager']) {
      const p = await perms(code);
      expect(p.some(isCrmAdminOnly)).toBe(false);
      expect(p).toEqual(expect.arrayContaining(['taskflow.crm.lead.create', 'taskflow.crm.deal.update']));
    }
    expect(await perms('sales')).toEqual(expect.arrayContaining(CORE));
  });

  it('reports customised roles and leaves them and other roles alone', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const custom = ['taskflow.crm.lead.list', 'taskflow.crm.lead.delete'];
    await Role.create([
      { code: 'sales', name: 'Sales', permissions: custom },
      { code: 'crm_admin', name: 'CRM Admin', permissions: LEGACY_SALES_CRM[2] },
      { name: 'Sales (own)', permissions: LEGACY_SALES_CRM[2] },
    ]);
    await migrateSalesRolePermissionsIfNeeded();
    expect(await perms('sales')).toEqual(custom);
    expect(await perms('crm_admin')).toEqual(LEGACY_SALES_CRM[2]);
    expect((await Role.findOne({ name: 'Sales (own)' }).lean())?.permissions).toEqual(LEGACY_SALES_CRM[2]);
    expect(warn.mock.calls[0][0]).toContain('taskflow.crm.lead.delete');
  });

  it('runs once, so rights an administrator gives back stay', async () => {
    await Role.create({ code: 'sales', name: 'Sales', permissions: LEGACY_SALES_CRM[2] });
    await migrateSalesRolePermissionsIfNeeded();
    await Role.updateOne({ code: 'sales' }, { $set: { permissions: LEGACY_SALES_CRM[2] } });
    await migrateSalesRolePermissionsIfNeeded();
    expect(await perms('sales')).toEqual(LEGACY_SALES_CRM[2]);
  });
});
