/** A member whose project access comes only from a colon-era role (no permissions of their own) can use comments. */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getProjectPermissionsForUser } from './requireProjectPermission';
import { userHasPermission } from '../shared/constants/legacyPermissionMap';
import { Project } from '../modules/projects/project.model';
import { ProjectMember } from '../modules/projects/projectMember.model';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/auth/user.model';

jest.setTimeout(120_000);
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('derives comment access from the role a designation-less member relies on', async () => {
  const org = new mongoose.Types.ObjectId();
  const [lead, member] = await User.create([
    { email: 'lead@example.com', name: 'Lead', mustChangePassword: false },
    { email: 'member@example.com', name: 'Member', mustChangePassword: false },
  ]);
  const project = await Project.create({ name: 'Task flow', key: 'TSKF', lead: lead._id, taskflowOrganizationId: org });
  const role = await Role.create({ name: 'Old member role', permissions: ['issues:view', 'issues:create', 'issues:edit'] });
  await ProjectMember.create({ project: project._id, user: member._id, role: role._id, permissions: [] });

  const perms = await getProjectPermissionsForUser(String(project._id), String(member._id), [], String(org));
  expect(userHasPermission(perms, 'issue.issue.read')).toBe(true);
  expect(userHasPermission(perms, 'issue.comment.read')).toBe(true);
  expect(userHasPermission(perms, 'issue.comment.create')).toBe(true);
});
