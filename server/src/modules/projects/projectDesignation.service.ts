import { ProjectDesignation } from './projectDesignation.model';
import { ProjectMember } from './projectMember.model';
import { ApiError } from '../../utils/ApiError';
import { DEFAULT_PROJECT_MEMBER_PERMISSION_CODES } from '../../constants/permissions';
import { ALL_PROJECT_PERMISSIONS, PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';

const DEFAULT_PERMS = [
  ...mapLegacyProjectOrGlobalPermissions([...DEFAULT_PROJECT_MEMBER_PERMISSION_CODES]),
  PROJECT_PERMISSIONS.ISSUE.ESTIMATE.SUBMIT,
  PROJECT_PERMISSIONS.ISSUE.ESTIMATE.VIEW,
  PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.CREATE,
  PROJECT_PERMISSIONS.ISSUE.COMMENT.CREATE,
];
// Project Lead always gets every project-scoped permission
const FULL_PERMS = [...ALL_PROJECT_PERMISSIONS];

export async function createDefaultDesignations(projectId: string): Promise<void> {
  await ProjectDesignation.create([
    {
      name: 'Project Lead',
      code: 'project_lead',
      projectId,
      permissions: FULL_PERMS,
      isSystem: true,
    },
    {
      name: 'Project Member',
      code: 'project_member',
      projectId,
      permissions: DEFAULT_PERMS,
      isSystem: true,
    },
  ]);
}

export async function listDesignations(projectId: string) {
  // Ensure the project_lead designation always has full permissions (self-healing for existing projects)
  await ProjectDesignation.updateOne(
    { projectId, code: 'project_lead' },
    { $set: { permissions: FULL_PERMS } }
  );
  return ProjectDesignation.find({ projectId }).sort({ isSystem: -1, name: 1 }).lean();
}

export async function createDesignation(projectId: string, data: { name: string; permissions: string[] }) {
  const code = data.name.toLowerCase().trim().replace(/\s+/g, '_');
  const existing = await ProjectDesignation.findOne({ projectId, code }).lean();
  if (existing) throw new ApiError(400, 'Designation with this name already exists in project');

  return ProjectDesignation.create({
    name: data.name,
    code,
    projectId,
    permissions: data.permissions,
    isSystem: false,
  });
}

export async function updateDesignation(projectId: string, designationId: string, data: { name?: string; permissions?: string[] }) {
  const designation = await ProjectDesignation.findOne({ _id: designationId, projectId });
  if (!designation) throw new ApiError(404, 'Designation not found');
  if (designation.isSystem && data.name) throw new ApiError(400, 'Cannot rename system designations');

  if (data.name) {
    designation.name = data.name;
    designation.code = data.name.toLowerCase().trim().replace(/\s+/g, '_');
  }
  if (data.permissions) {
    // Project Lead always keeps full project permissions regardless of what was sent
    designation.permissions = designation.code === 'project_lead' ? FULL_PERMS : data.permissions;
  }

  await designation.save();

  // Sync permissions to all members using this designation
  await ProjectMember.updateMany(
    { project: projectId, designationId },
    { $set: { permissions: designation.permissions } }
  );

  return designation;
}

export async function deleteDesignation(projectId: string, designationId: string) {
  const designation = await ProjectDesignation.findOne({ _id: designationId, projectId });
  if (!designation) throw new ApiError(404, 'Designation not found');
  if (designation.isSystem) throw new ApiError(400, 'Cannot delete system designations');

  // Find default member designation to reassign members
  const memberDesignation = await ProjectDesignation.findOne({ projectId, code: 'project_member' }).lean();
  if (!memberDesignation) throw new ApiError(500, 'Default project member designation not found');

  // Reassign members
  await ProjectMember.updateMany(
    { project: projectId, designationId },
    { $set: { designationId: memberDesignation._id, permissions: memberDesignation.permissions } }
  );

  await ProjectDesignation.findByIdAndDelete(designationId);
}
