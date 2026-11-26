import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { apiRoutes } from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { Role } from '../roles/role.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { Project } from './project.model';
import { ProjectDesignation } from './projectDesignation.model';
import { ProjectMember } from './projectMember.model';
import { ProjectInvitation } from './projectInvitation.model';
import { DesignationTemplate } from './designationTemplate.model';
import { pickTemplate } from './designationTemplates.service';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
const id: Record<string, string> = {};
const token: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token[who]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: string; data?: any } };
}
const templates = async () => (await call('owner', 'GET', '/project-designation-templates')).body.data as Array<{ _id: string; name: string; permissions: string[] }>;
const tid = async (name: string) => (await templates()).find((t) => t.name === name)!._id;
const designationsOf = async (projectId: string) => (await ProjectDesignation.find({ projectId }).lean()).map((d) => d.name).sort();
async function newProject(key: string, extra: Record<string, unknown> = {}) {
  return call('owner', 'POST', '/projects', { name: key, key, lead: id.owner, ...extra });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() }))._id as mongoose.Types.ObjectId;
  const pm = await Role.create({ name: 'PM', permissions: ['project.project.create', 'project.project.list'] });
  const staff = await Role.create({ name: 'Staff', permissions: ['taskflow.self.profile.read'] });
  const people: Array<[string, mongoose.Types.ObjectId | null, Record<string, string> | null]> = [
    ['owner', null, null],
    ['pam', pm._id as mongoose.Types.ObjectId, null],
    ['sam', staff._id as mongoose.Types.ObjectId, { designation: 'Software Engineer', level: 'Senior' }],
    ['quinn', staff._id as mongoose.Types.ObjectId, { designation: 'QA Analyst', level: 'Senior' }],
    ['ivy', staff._id as mongoose.Types.ObjectId, { designation: 'Software Engineer', level: 'Intern' }],
    ['nora', staff._id as mongoose.Types.ObjectId, null],
  ];
  for (const [name, roleId, hr] of people) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, role: name === 'owner' ? 'admin' : 'user', roleId });
    id[name] = String(u._id);
    await OrganizationMember.create({ organization: org, user: u._id, role: 'org_member', status: 'active' });
    token[name] = (await createToken(id[name], String(org), { name: 't' })).token;
    if (hr) await HrmsEmployee.create({ taskflowOrganizationId: org, userId: u._id, employeeCode: name, name, joinedDate: new Date(), ...hr });
  }
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('company designation templates (AUT-23)', () => {
  it('a workspace starts with editable defaults, once', async () => {
    const names = (await templates()).map((t) => t.name);
    expect(names).toEqual(['Business Analyst', 'Designer', 'Dev Lead', 'DevOps Engineer', 'Developer', 'Intern', 'QA Engineer', 'Senior Developer', 'Support Engineer']);
    expect(await templates()).toHaveLength(9);
    // Removing one keeps it removed; it is not seeded again.
    expect((await call('owner', 'DELETE', `/project-designation-templates/${await tid('Designer')}`)).status).toBe(200);
    expect((await templates()).map((t) => t.name)).not.toContain('Designer');
  });

  it('checks names, permissions and levels; only designation managers edit', async () => {
    const post = (body: Record<string, unknown>, who = 'owner') => call(who, 'POST', '/project-designation-templates', body);
    expect((await post({ name: 'Scrum Master', permissions: ['sprint.sprint.start'], levels: ['Senior'], keywords: 'scrum, agile coach' })).status).toBe(201);
    expect((await post({ name: 'Project Lead' })).status).toBe(400);
    expect((await post({ name: 'X', permissions: ['taskflow.hr.salary.read'] })).status).toBe(400);
    expect((await post({ name: 'Y', levels: ['Wizard'] })).status).toBe(400);
    expect((await post({ name: 'Scrum master' })).status).toBe(409);
    // Someone who creates projects can read them (for the form) but not change them.
    expect((await call('pam', 'GET', '/project-designation-templates')).status).toBe(200);
    expect((await post({ name: 'Mine' }, 'pam')).status).toBe(403);
    expect((await call('nora', 'GET', '/project-designation-templates')).status).toBe(403);
  });
});

describe('new projects get the chosen designations (AUT-23)', () => {
  it('the ones chosen on the form, else those marked for new projects', async () => {
    const chosen = await newProject('ONE', { designationTemplateIds: [await tid('QA Engineer'), await tid('Intern')] });
    expect(chosen.status).toBe(201);
    expect(await designationsOf(chosen.body.data._id)).toEqual(['Intern', 'Project Lead', 'Project Member', 'QA Engineer']);

    await call('owner', 'PATCH', `/project-designation-templates/${await tid('Support Engineer')}`, { addToNewProjects: false });
    const byDefault = await newProject('TWO');
    expect(await designationsOf(byDefault.body.data._id)).toHaveLength(2 + 8);
    expect(await designationsOf(byDefault.body.data._id)).not.toContain('Support Engineer');

    const none = await newProject('THREE', { designationTemplateIds: [] });
    expect(await designationsOf(none.body.data._id)).toEqual(['Project Lead', 'Project Member']);
  });

  it('refuses unknown templates before creating anything', async () => {
    expect((await newProject('BAD', { designationTemplateIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    expect(await Project.countDocuments({ key: 'BAD' })).toBe(0);
  });

  it('projects keep their own copy; existing projects can add more later, without duplicates', async () => {
    const p = (await newProject('FOUR', { designationTemplateIds: [await tid('QA Engineer')] })).body.data._id;
    await call('owner', 'PATCH', `/project-designation-templates/${await tid('QA Engineer')}`, { permissions: ['issue.issue.read'] });
    expect((await ProjectDesignation.findOne({ projectId: p, code: 'qa_engineer' }).lean())!.permissions.length).toBeGreaterThan(1);

    const offered = (await call('owner', 'GET', `/projects/${p}/designations/templates`)).body.data as Array<{ name: string; inProject: boolean }>;
    expect(offered.find((t) => t.name === 'QA Engineer')!.inProject).toBe(true);
    expect(offered.find((t) => t.name === 'Designer')!.inProject).toBe(false);
    const add = await call('owner', 'POST', `/projects/${p}/designations/from-templates`, { templateIds: [await tid('Designer'), await tid('QA Engineer')] });
    expect(add.body.data.added).toEqual(['Designer']);
    expect(await designationsOf(p)).toEqual(['Designer', 'Project Lead', 'Project Member', 'QA Engineer']);
  });
});

describe('inviting suggests a designation (AUT-23)', () => {
  it('from the job title first, then the level; nothing for people without an HR record', () => {
    const ts = [
      { name: 'Senior Developer', levels: ['Senior'], keywords: [] },
      { name: 'QA Engineer', levels: [], keywords: ['qa', 'test'] },
      { name: 'QA Lead', levels: [], keywords: ['qa lead'] },
      { name: 'Designer', levels: [], keywords: ['ui', 'designer'] },
    ];
    expect(pickTemplate(ts, { designation: 'Software Engineer', level: 'Senior' })!.template.name).toBe('Senior Developer');
    expect(pickTemplate(ts, { designation: 'Senior QA Analyst', level: 'Senior' })!.template.name).toBe('QA Engineer');
    expect(pickTemplate(ts, { designation: 'QA Lead', level: 'Lead' })!.template.name).toBe('QA Lead');
    expect(pickTemplate(ts, { designation: 'Build engineer' })).toBeNull(); // "ui" inside "build" is not a word
    expect(pickTemplate(ts, { designation: 'UI/UX', level: null })!.template.name).toBe('Designer');
  });

  it('suggests in the project, and an invite without a choice uses the suggestion', async () => {
    const p = (await newProject('APP', { designationTemplateIds: [await tid('Senior Developer'), await tid('QA Engineer')] })).body.data._id;
    const suggest = async (who: string) => (await call('owner', 'GET', `/projects/${p}/designations/suggest?email=${who}@example.com`)).body.data;
    const senior = await ProjectDesignation.findOne({ projectId: p, code: 'senior_developer' }).lean();
    expect(await suggest('sam')).toMatchObject({ name: 'Senior Developer', designationId: String(senior!._id), reason: 'level “Senior”' });
    expect(await suggest('quinn')).toMatchObject({ name: 'QA Engineer' });
    // Ivy fits "Intern", which this project does not have.
    expect(await suggest('ivy')).toMatchObject({ name: 'Intern', designationId: null });
    expect(await suggest('nora')).toBeNull();
    expect((await call('nora', 'GET', `/projects/${p}/designations/suggest?email=sam@example.com`)).status).toBe(403);

    // Invite with no designation chosen: Sam gets the suggestion, Ivy and Nora the default.
    for (const who of ['sam', 'ivy', 'nora']) expect((await call('owner', 'POST', `/projects/${p}/invite`, { email: `${who}@example.com` })).status).toBeLessThan(300);
    const invited = async (who: string) => {
      const inv = await ProjectInvitation.findOne({ project: p, user: id[who] }).lean();
      return (await ProjectDesignation.findById(inv!.designationId).lean())!.name;
    };
    expect(await invited('sam')).toBe('Senior Developer');
    expect(await invited('ivy')).toBe('Project Member');
    expect(await invited('nora')).toBe('Project Member');
    // Accepting places Sam with that designation's permissions.
    const inv = await ProjectInvitation.findOne({ project: p, user: id.sam }).lean();
    expect((await call('sam', 'POST', `/invitations/${inv!._id}/accept`)).status).toBe(200);
    const member = await ProjectMember.findOne({ project: p, user: id.sam }).lean();
    expect(String(member!.designationId)).toBe(String(senior!._id));
    expect(member!.permissions.sort()).toEqual([...senior!.permissions].sort());
    // A choice made when inviting still wins.
    const qa = await ProjectDesignation.findOne({ projectId: p, code: 'qa_engineer' }).lean();
    expect((await call('owner', 'POST', `/projects/${p}/invite`, { email: 'quinn@example.com', designationId: String((await ProjectDesignation.findOne({ projectId: p, code: 'project_member' }).lean())!._id) })).status).toBeLessThan(300);
    expect(await invited('quinn')).toBe('Project Member');
    expect(qa).toBeTruthy();
  });
});

describe('templates are per workspace (AUT-23)', () => {
  it('another workspace neither sees nor uses them', async () => {
    const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: new mongoose.Types.ObjectId() });
    await OrganizationMember.create({ organization: other._id, user: id.owner, role: 'org_member', status: 'active' });
    token.ownerOther = (await createToken(id.owner, String(other._id), { name: 't2' })).token;
    const qa = await tid('QA Engineer');
    expect((await call('ownerOther', 'PATCH', `/project-designation-templates/${qa}`, { name: 'Hijack' })).status).toBe(404);
    expect((await call('ownerOther', 'POST', '/projects', { name: 'O', key: 'O', lead: id.owner, designationTemplateIds: [qa] })).status).toBe(400);
    expect(await DesignationTemplate.countDocuments({ name: 'Hijack' })).toBe(0);
  });
});
