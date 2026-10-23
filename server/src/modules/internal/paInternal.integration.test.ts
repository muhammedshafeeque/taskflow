/**
 * WhatsApp PA service identity, end to end against a real (in-memory) Mongo:
 * owner full access, client chats downscoped to their own client, files
 * through the storage layer, and audit rows for every AI action.
 */
import { PassThrough } from 'stream';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

const KEY = 'k'.repeat(64);
process.env.ATRIUM_INTERNAL_SECRET = KEY;
process.env.PA_API_URL = 'off';
// Ignore a developer's server/.env (dotenv never overrides keys that already exist).
process.env.PA_DEFAULT_ORG_ID = '';

import app from '../../app';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';
import { CrmContact } from '../crm/models/crmContact.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { AuditLog } from '../auditLogs/auditLog.model';
import { PaChatBinding } from './paChatBinding.model';
import { resetPaServiceAccountCacheForTests } from './paServiceAccount';
import { setStorageForTests, type StorageDriver } from '../../services/storage';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};

const GROUP_A = '120363000000000001@g.us';
const GROUP_UNBOUND = '120363000000000099@g.us';
const PHONE_A = '+91 98765 43210';

/** PNG signature + padding: passes the magic-byte sniff. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

function memoryStorage(): StorageDriver & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    name: 'local',
    objects,
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      const body = objects.get(key);
      if (!body) return null;
      const stream = new PassThrough();
      stream.end(body);
      return { stream, size: body.length };
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

/** Audit rows are written fire-and-forget after the response finishes. */
async function eventually<T>(load: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; i < 50; i++) {
    const v = await load();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

function owner(path: string, method: 'get' | 'post' | 'put' = 'get') {
  return request(app)[method](path).set('x-atrium-internal-key', KEY).set('x-pa-actor', 'owner');
}

function client(path: string, chatId: string, method: 'get' | 'post' = 'get', senderPhone?: string) {
  const r = request(app)[method](path).set('x-atrium-internal-key', KEY).set('x-pa-actor', 'client').set('x-pa-chat-id', chatId);
  return senderPhone ? r.set('x-pa-sender-phone', senderPhone) : r;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const human = await User.create({ email: 'owner@example.com', name: 'Owner', role: 'admin', mustChangePassword: false });
  const org = await Organization.create({ name: 'Acme Studio', slug: 'acme', createdBy: human._id });
  await OrganizationMember.create({ organization: org._id, user: human._id, role: 'org_admin', status: 'active' });

  const [clientA, clientB] = await CustomerOrg.create([
    { name: 'Client A', slug: 'client-a', contactEmail: 'a@a.test', taskflowOrganizationId: org._id, createdBy: human._id },
    { name: 'Client B', slug: 'client-b', contactEmail: 'b@b.test', taskflowOrganizationId: org._id, createdBy: human._id },
  ]);
  const [projA, projB] = await Project.create([
    { name: 'A App', key: 'AAPP', lead: human._id, taskflowOrganizationId: org._id },
    { name: 'B App', key: 'BAPP', lead: human._id, taskflowOrganizationId: org._id },
  ]);
  await CustomerProjectMapping.create([
    { customerOrgId: clientA._id, projectId: projA._id, mappedBy: human._id },
    { customerOrgId: clientB._id, projectId: projB._id, mappedBy: human._id },
  ]);
  await Issue.create([
    { title: 'A login bug', key: 'AAPP-1', project: projA._id, reporter: human._id },
    { title: 'B secret roadmap', key: 'BAPP-1', project: projB._id, reporter: human._id },
  ]);
  await ServiceTicket.create([
    { taskflowOrganizationId: org._id, subject: 'A ticket', customerOrgId: clientA._id, projectId: projA._id },
    { taskflowOrganizationId: org._id, subject: 'B ticket', customerOrgId: clientB._id, projectId: projB._id },
  ]);
  await CrmContact.create({ taskflowOrganizationId: org._id, name: 'Asha (Client A)', phone: '9876543210', customerOrgId: clientA._id });
  await HrmsEmployee.create({
    taskflowOrganizationId: org._id,
    employeeCode: 'E1',
    name: 'Owner',
    joinedDate: new Date('2024-01-01'),
    userId: human._id,
    whatsappPhone: '919000000001',
  });
  await PaChatBinding.create({ taskflowOrganizationId: org._id, chatId: GROUP_A, customerOrgId: clientA._id });

  Object.assign(ids, {
    org: String(org._id),
    human: String(human._id),
    clientA: String(clientA._id),
    clientB: String(clientB._id),
    projA: String(projA._id),
    projB: String(projB._id),
  });
});

afterAll(async () => {
  setStorageForTests(null);
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => resetPaServiceAccountCacheForTests());

describe('internal key', () => {
  it('rejects a wrong key', async () => {
    const res = await request(app).get('/api/internal/pa/health').set('x-atrium-internal-key', 'x'.repeat(64)).set('x-pa-actor', 'owner');
    expect(res.status).toBe(401);
  });

  it('rejects the key when the request came through a reverse proxy', async () => {
    const res = await owner('/api/internal/pa/health').set('x-forwarded-for', '203.0.113.9');
    expect(res.status).toBe(403);
  });

  it('requires an actor', async () => {
    const res = await request(app).get('/api/internal/pa/health').set('x-atrium-internal-key', KEY);
    expect(res.status).toBe(400);
  });

  it('keeps internal routes closed to user tokens', async () => {
    const res = await request(app).get('/api/internal/pa/health').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('owner context — full access', () => {
  it('reports health and auto-creates one hidden, non-login PA service account', async () => {
    const res = await owner('/api/internal/pa/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ connected: true, organization: { id: ids.org, name: 'Acme Studio' } });

    const accounts = await User.find({ isServiceAccount: true }).lean();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].password ?? null).toBeNull();
    expect(await OrganizationMember.exists({ organization: ids.org, user: accounts[0]._id })).toBeTruthy();

    const login = await request(app).post('/api/auth/login').send({ email: accounts[0].email, password: 'anything' });
    expect([401, 403]).toContain(login.status);
  });

  it('reads every module, including HRMS and other clients', async () => {
    // Sequential: core lazily creates its module-settings row on first use.
    const projects = await owner('/api/projects');
    const employees = await owner('/api/hrms/employees');
    const tickets = await owner('/api/service/tickets');
    expect(projects.status).toBe(200);
    expect(JSON.stringify(projects.body)).toContain('B App');
    expect(employees.status).toBe(200);
    expect(tickets.status).toBe(200);
    expect(JSON.stringify(tickets.body)).toContain('B ticket');
  });

  it('acts for a signed-in owner and records them in the audit log', async () => {
    const res = await owner('/api/internal/pa/chat-bindings/test-chat@g.us', 'put')
      .set('x-pa-on-behalf-of', ids.human)
      .send({ customerOrgId: ids.clientB, label: 'B group' });
    expect(res.status).toBe(200);
    const row = await eventually(() => AuditLog.findOne({ action: 'pa.owner.put' }).lean());
    expect(row).toMatchObject({ actorType: 'ai', actorLabel: 'WhatsApp PA' });
    expect(String(row?.onBehalfOf)).toBe(ids.human);
  });

  it('resolves the owner from their own WhatsApp number', async () => {
    const res = await owner('/api/internal/pa/resolve-chat', 'post').send({ chatId: '919000000001@c.us', senderPhone: '919000000001' });
    expect(res.body.data).toEqual({ context: 'owner', ownerUserId: ids.human });
  });
});

describe('client context — downscoped on the server', () => {
  it('blocks every generic module route, including HRMS', async () => {
    for (const path of ['/api/hrms/employees', '/api/projects', '/api/service/tickets', '/api/assets', '/api/internal/pa/health']) {
      const res = await client(path, GROUP_A);
      expect(res.status).toBe(403);
    }
  });

  it('only sees its own client: projects, tickets, issues', async () => {
    const ctx = await client('/api/internal/pa/client/context', GROUP_A);
    expect(ctx.status).toBe(200);
    expect(ctx.body.data.client).toMatchObject({ customerOrgId: ids.clientA, source: 'binding' });
    expect(ctx.body.data.projects.map((p: { id: string }) => p.id)).toEqual([ids.projA]);
    const text = JSON.stringify(ctx.body);
    expect(text).toContain('A ticket');
    expect(text).not.toContain('B ticket');
    expect(text).not.toContain('B secret roadmap');

    expect((await client('/api/internal/pa/client/issues/by-key?key=AAPP-1', GROUP_A)).status).toBe(200);
    expect((await client('/api/internal/pa/client/issues/by-key?key=BAPP-1', GROUP_A)).status).toBe(404);
  });

  it('cannot create tickets in another client’s project, whatever the body says', async () => {
    const res = await client('/api/internal/pa/client/tickets', GROUP_A, 'post').send({
      projectId: ids.projB,
      customerOrgId: ids.clientB,
      subject: 'Injected',
    });
    expect(res.status).toBe(403);
    expect(await ServiceTicket.exists({ subject: 'Injected' })).toBeNull();
  });

  it('creates a ticket in its own project, tagged with its client and chat', async () => {
    const res = await client('/api/internal/pa/client/tickets', GROUP_A, 'post').send({
      projectId: ids.projA,
      subject: 'Checkout is down',
      whatsappGroupId: GROUP_UNBOUND,
    });
    expect(res.status).toBe(201);
    const t = await ServiceTicket.findOne({ subject: 'Checkout is down' }).lean();
    expect(String(t?.customerOrgId)).toBe(ids.clientA);
    expect(t?.whatsappGroupId).toBe(GROUP_A);
  });

  it('identifies a DM by the CRM contact phone (with or without country code)', async () => {
    const ctx = await client('/api/internal/pa/client/context', '919876543210@c.us', 'get', PHONE_A);
    expect(ctx.body.data.client).toMatchObject({ customerOrgId: ids.clientA, source: 'contact' });
  });

  it('gives unknown numbers and unbound groups nothing', async () => {
    const dm = await client('/api/internal/pa/client/tickets', '15550001111@c.us', 'get', '15550001111');
    const group = await client('/api/internal/pa/client/tickets', GROUP_UNBOUND, 'get', PHONE_A);
    expect(dm.status).toBe(403);
    // A client's number inside an unbound group must not unlock it.
    expect(group.status).toBe(403);
  });

  it('audit-logs client requests, including denials, as the AI actor', async () => {
    await client('/api/hrms/employees', GROUP_A);
    const denied = await eventually(() => AuditLog.findOne({ action: 'pa.client.get', 'meta.path': '/api/hrms/employees' }).lean());
    expect(denied).toMatchObject({ actorType: 'ai', meta: { status: 403, chatId: GROUP_A } });
    const svc = await User.findOne({ isServiceAccount: true }).lean();
    expect(String(denied?.user)).toBe(String(svc?._id));
  });
});

describe('files through the storage layer', () => {
  it('uploads and downloads a client file, and other clients cannot read it', async () => {
    const storage = memoryStorage();
    setStorageForTests(storage);

    const up = await client('/api/internal/pa/client/files', GROUP_A, 'post').attach('file', PNG, {
      filename: 'screenshot.png',
      contentType: 'image/png',
    });
    expect(up.status).toBe(201);
    expect(storage.objects.size).toBe(1);

    const down = await client(`/api/internal/pa/client/files/${up.body.data.id}`, GROUP_A).buffer(true);
    expect(down.status).toBe(200);
    expect(Buffer.compare(down.body as Buffer, PNG)).toBe(0);

    await PaChatBinding.create({ taskflowOrganizationId: ids.org, chatId: 'b-group@g.us', customerOrgId: ids.clientB });
    expect((await client(`/api/internal/pa/client/files/${up.body.data.id}`, 'b-group@g.us')).status).toBe(404);
  });

  it('owner uploads through /api/uploads into the active backend', async () => {
    const storage = memoryStorage();
    setStorageForTests(storage);
    const up = await owner('/api/uploads', 'post').attach('file', PNG, { filename: 'diagram.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const key = decodeURIComponent(String(up.body.data.url).split('/').pop() ?? '');
    expect(storage.objects.has(key)).toBe(true);
    const down = await request(app).get(up.body.data.url).buffer(true);
    expect(down.status).toBe(200);
  });

  it('rejects content that does not match its declared type', async () => {
    setStorageForTests(memoryStorage());
    const res = await client('/api/internal/pa/client/files', GROUP_A, 'post').attach('file', Buffer.from('<html>'), {
      filename: 'fake.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(400);
  });
});
