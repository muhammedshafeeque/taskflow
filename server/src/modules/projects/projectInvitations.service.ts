import mongoose from 'mongoose';
import { Project } from './project.model';
import { ProjectMember } from './projectMember.model';
import { ProjectDesignation } from './projectDesignation.model';
import { ProjectInvitation } from './projectInvitation.model';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { InboxMessage } from '../inbox/message.model';
import { ApiError } from '../../utils/ApiError';
import {
  DEFAULT_PROJECT_MEMBER_PERMISSION_CODES,
  FULL_PROJECT_ROLE_PERMISSION_CODES,
} from '../../constants/permissions';
import { mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';
import * as inboxService from '../inbox/inbox.service';
import { sendProjectInviteEmail } from '../../services/email.service';
import { sendPushToUser } from '../../services/push.service';
import { env } from '../../config/env';
import * as notificationsService from '../notifications/notifications.service';

const PROJECT_MEMBER_ROLE_NAME = 'Project Member';
const PROJECT_LEAD_ROLE_NAME = 'Project Lead';

const FULL_PROJECT_PERMS_DOT = mapLegacyProjectOrGlobalPermissions([...FULL_PROJECT_ROLE_PERMISSION_CODES]);
const DEFAULT_MEMBER_PERMS_DOT = mapLegacyProjectOrGlobalPermissions([...DEFAULT_PROJECT_MEMBER_PERMISSION_CODES]);

async function snapshotFromRoleId(roleId: unknown): Promise<string[]> {
  const id =
    roleId && typeof roleId === 'object' && '_id' in (roleId as object)
      ? (roleId as { _id: mongoose.Types.ObjectId })._id
      : roleId;
  const role = await Role.findById(id).select('permissions').lean();
  const raw = Array.isArray(role?.permissions) ? role.permissions : [];
  return mapLegacyProjectOrGlobalPermissions(raw);
}

/** Syncs the "Project Member" role permissions to the default (no project:edit / project:delete). Call once per process so existing DB roles are updated. */
export async function syncProjectMemberRolePermissions(): Promise<void> {
  await Role.updateOne(
    { name: PROJECT_MEMBER_ROLE_NAME },
    { $set: { permissions: [...DEFAULT_PROJECT_MEMBER_PERMISSION_CODES] } }
  );
}

export async function getOrCreateProjectMemberRole(): Promise<{ _id: mongoose.Types.ObjectId }> {
  let role = await Role.findOne({ name: PROJECT_MEMBER_ROLE_NAME }).select('_id').lean();
  if (role) {
    await syncProjectMemberRolePermissions();
    return { _id: role._id };
  }
  const created = await Role.create({
    name: PROJECT_MEMBER_ROLE_NAME,
    permissions: [...DEFAULT_PROJECT_MEMBER_PERMISSION_CODES],
  });
  return { _id: created._id };
}

/** Role with all project permissions (settings, issues, boards, delete, etc.) — used for project lead on create/update. */
export async function getOrCreateProjectLeadRole(): Promise<{ _id: mongoose.Types.ObjectId }> {
  let role = await Role.findOne({ name: PROJECT_LEAD_ROLE_NAME }).select('_id').lean();
  if (role) {
    await Role.updateOne(
      { _id: role._id },
      { $set: { permissions: [...FULL_PROJECT_ROLE_PERMISSION_CODES] } }
    );
    return { _id: role._id };
  }
  const created = await Role.create({
    name: PROJECT_LEAD_ROLE_NAME,
    permissions: [...FULL_PROJECT_ROLE_PERMISSION_CODES],
  });
  return { _id: created._id };
}

/** If the user holds the Project Lead role on this project, switch them to Project Member (e.g. after lead reassignment). */
export async function downgradeToProjectMemberIfHasLeadRole(projectId: string, userId: string): Promise<void> {
  const leadRole = await getOrCreateProjectLeadRole();
  const memberRole = await getOrCreateProjectMemberRole();
  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const projectObjectId = mongoose.Types.ObjectId.isValid(projectId)
    ? new mongoose.Types.ObjectId(projectId)
    : projectId;
  const m = await ProjectMember.findOne({ project: projectObjectId, user: userObjectId }).lean();
  if (!m) return;
  const roleId =
    m.role && typeof m.role === 'object' && '_id' in m.role
      ? String((m.role as { _id: unknown })._id)
      : String(m.role);
  if (roleId === String(leadRole._id)) {
    await ProjectMember.updateOne(
      { _id: m._id },
      { $set: { role: memberRole._id, permissions: DEFAULT_MEMBER_PERMS_DOT } }
    );
  }
}

/** Ensures the user is a project member with full project permissions (e.g. after assigning them as lead). */
export async function ensureUserHasFullProjectAccess(projectId: string, userId: string): Promise<void> {
  const leadDesignation = await ProjectDesignation.findOne({ projectId, code: 'project_lead' }).lean();
  
  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const projectObjectId = mongoose.Types.ObjectId.isValid(projectId)
    ? new mongoose.Types.ObjectId(projectId)
    : projectId;
    
  const existing = await ProjectMember.findOne({ project: projectObjectId, user: userObjectId }).lean();
  if (existing) {
    await ProjectMember.updateOne(
      { _id: existing._id },
      { 
        $set: { 
          designationId: leadDesignation?._id,
          permissions: leadDesignation?.permissions || FULL_PROJECT_PERMS_DOT 
        } 
      }
    );
    return;
  }
  await ProjectMember.create({
    project: projectObjectId,
    user: userObjectId,
    designationId: leadDesignation?._id,
    permissions: leadDesignation?.permissions || FULL_PROJECT_PERMS_DOT,
  });
}

export async function inviteToProject(
  projectId: string,
  email: string,
  invitedByUserId: string,
  roleId?: string
): Promise<unknown> {
  const project = await Project.findById(projectId).lean();
  if (!project) throw new ApiError(404, 'Project not found');

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('_id name email').lean();
  if (!user) throw new ApiError(400, 'User not found. They must have a TaskFlow account.');

  const userIdStr = user._id.toString();
  const existingMember = await ProjectMember.findOne({ project: projectId, user: userIdStr }).lean();
  if (existingMember) throw new ApiError(409, 'User is already a member of this project.');

  const pendingInvite = await ProjectInvitation.findOne({
    project: projectId,
    user: userIdStr,
    status: 'pending',
  }).lean();
  if (pendingInvite) throw new ApiError(409, 'User has already been invited.');

  let roleObjectId: mongoose.Types.ObjectId;
  if (roleId) {
    const role = await Role.findById(roleId).select('_id').lean();
    if (!role) throw new ApiError(400, 'Selected role not found');
    roleObjectId = role._id;
  } else {
    const role = await getOrCreateProjectMemberRole();
    roleObjectId = role._id;
  }
  await ProjectInvitation.deleteOne({ project: projectId, user: userIdStr });

  const inviter = await User.findById(invitedByUserId).select('name').lean();
  const inviterName = inviter?.name ?? 'A team member';
  const projectName = (project as { name?: string }).name ?? 'Project';

  const invitation = await ProjectInvitation.create({
    project: projectId,
    user: userIdStr,
    invitedBy: invitedByUserId,
    role: roleObjectId,
    status: 'pending',
  });

  const title = `Project invitation: ${projectName}`;
  const body = `${inviterName} invited you to the project "${projectName}". Open your inbox to accept or decline.`;
  await inboxService.createMessage({
    toUser: userIdStr,
    type: 'project_invitation',
    title,
    body,
    meta: { invitationId: invitation._id.toString(), url: `${env.appUrl}/inbox` },
  });

  sendProjectInviteEmail((user as { email: string }).email, {
    projectName,
    inviterName,
    appUrl: env.appUrl,
  }).catch((err) => console.error('Failed to send project invite email:', err));

  sendPushToUser(userIdStr, {
    title: 'Project invitation',
    body: `You were invited to the project "${projectName}". Open your inbox to accept or decline.`,
    url: `${env.appUrl}/inbox`,
    data: { type: 'project_invitation', invitationId: invitation._id.toString() },
  }).catch((err) => console.error('Failed to send push notification:', err));

  return ProjectInvitation.findById(invitation._id)
    .populate('user', 'name email')
    .populate('invitedBy', 'name')
    .populate('role', 'name')
    .lean();
}

export async function listMembers(projectId: string): Promise<unknown[]> {
  const members = await ProjectMember.find({ project: projectId })
    .populate('user', 'name email avatarUrl')
    .populate('designationId', 'name code permissions isSystem')
    .lean();
  return members;
}

export async function updateMemberDesignation(projectId: string, memberId: string, designationId: string) {
  const member = await ProjectMember.findOne({ _id: memberId, project: projectId });
  if (!member) throw new ApiError(404, 'Member not found');

  const designation = await ProjectDesignation.findOne({ _id: designationId, projectId }).lean();
  if (!designation) throw new ApiError(404, 'Designation not found');

  member.designationId = new mongoose.Types.ObjectId(designationId);
  member.permissions = designation.permissions;
  await member.save();

  return ProjectMember.findById(memberId)
    .populate('user', 'name email avatarUrl')
    .populate('designationId', 'name code permissions isSystem')
    .lean();
}

export async function removeMember(projectId: string, memberId: string) {
  const member = await ProjectMember.findOne({ _id: memberId, project: projectId }).populate('user', 'email').lean();
  if (!member) throw new ApiError(404, 'Member not found');

  const project = await Project.findById(projectId).select('lead').lean();
  if (project && String(project.lead) === String((member.user as any)._id)) {
    throw new ApiError(400, 'Cannot remove the project lead');
  }

  await ProjectMember.findByIdAndDelete(memberId);
}

export async function listInvitations(projectId: string): Promise<unknown[]> {
  const invitations = await ProjectInvitation.find({ project: projectId, status: 'pending' })
    .populate('user', 'name email')
    .populate('invitedBy', 'name')
    .lean();
  return invitations;
}

export async function cancelInvitation(
  projectId: string,
  invitationId: string,
  _userId: string
): Promise<void> {
  const invitation = await ProjectInvitation.findOne({
    _id: invitationId,
    project: projectId,
    status: 'pending',
  }).lean();
  if (!invitation) throw new ApiError(404, 'Invitation not found or already accepted/declined.');
  await ProjectInvitation.findByIdAndUpdate(invitationId, { $set: { status: 'declined' } });
}

export async function acceptInvitation(invitationId: string, userId: string): Promise<{ projectId: string }> {
  const invitation = await ProjectInvitation.findById(invitationId)
    .populate('project', 'name')
    .populate('user', 'name')
    .populate('invitedBy', 'name')
    .lean();
  if (!invitation) throw new ApiError(404, 'Invitation not found.');
  const inviteeId = (invitation.user as { _id?: unknown })._id?.toString?.() ?? String(invitation.user);
  if (inviteeId !== userId) throw new ApiError(403, 'You can only accept invitations sent to you.');

  const projectId = (invitation.project as { _id?: unknown })._id?.toString?.() ?? String(invitation.project);

  if (invitation.status === 'accepted') {
    return { projectId };
  }
  if (invitation.status !== 'pending') throw new ApiError(400, 'Invitation was already declined.');

  const projectName = (invitation.project as { name?: string })?.name ?? 'Project';
  const inviteeName = (invitation.user as { name?: string })?.name ?? 'A user';
  const inviterId = (invitation.invitedBy as { _id?: unknown })._id?.toString?.() ?? String(invitation.invitedBy);

  const permSnapshot = await snapshotFromRoleId(invitation.role);
  await ProjectMember.create({
    project: new mongoose.Types.ObjectId(projectId),
    user: new mongoose.Types.ObjectId(userId),
    role: invitation.role,
    permissions: permSnapshot,
  });
  await ProjectInvitation.findByIdAndUpdate(invitationId, { $set: { status: 'accepted' } });

  await InboxMessage.findOneAndUpdate(
    {
      toUser: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
      type: 'project_invitation',
      'meta.invitationId': invitationId,
    },
    { $set: { readAt: new Date(), 'meta.status': 'accepted' } }
  );

  const acceptanceTitle = 'Invitation accepted';
  const acceptanceBody = `${inviteeName} accepted your invitation to the project "${projectName}".`;
  await inboxService.createMessage({
    toUser: inviterId,
    type: 'project_invitation_accepted',
    title: acceptanceTitle,
    body: acceptanceBody,
    meta: { projectId, inviteeId, invitationId },
  });
  notificationsService.createNotification({
    userId: inviterId,
    type: 'invitation_accepted',
    title: acceptanceTitle,
    body: acceptanceBody,
    link: `${env.appUrl}/projects/${projectId}/settings`,
    metadata: { projectId, inviteeId, invitationId },
  }).catch(() => {});

  const superAdminRole = await Role.findOne({ name: 'Super Admin' }).select('_id').lean();
  if (superAdminRole) {
    const superAdmins = await User.find({ roleId: superAdminRole._id }).select('_id').lean();
    const recipientIds = superAdmins
      .map((u) => u._id.toString())
      .filter((id) => id !== inviterId);
    const superAdminBody = `${inviteeName} accepted an invitation to the project "${projectName}".`;
    for (const toUserId of recipientIds) {
      await inboxService.createMessage({
        toUser: toUserId,
        type: 'project_invitation_accepted',
        title: acceptanceTitle,
        body: superAdminBody,
        meta: { projectId, inviteeId, invitationId },
      });
      notificationsService.createNotification({
        userId: toUserId,
        type: 'invitation_accepted',
        title: acceptanceTitle,
        body: superAdminBody,
        link: `${env.appUrl}/projects/${projectId}/settings`,
        metadata: { projectId, inviteeId, invitationId },
      }).catch(() => {});
    }
  }

  return { projectId };
}

export async function declineInvitation(invitationId: string, userId: string): Promise<void> {
  const invitation = await ProjectInvitation.findById(invitationId).lean();
  if (!invitation) throw new ApiError(404, 'Invitation not found.');
  if (invitation.status !== 'pending') throw new ApiError(400, 'Invitation was already accepted or declined.');
  const inviteeId = (invitation.user as { _id?: unknown })._id?.toString?.() ?? String(invitation.user);
  if (inviteeId !== userId) throw new ApiError(403, 'You can only decline invitations sent to you.');
  await ProjectInvitation.findByIdAndUpdate(invitationId, { $set: { status: 'declined' } });
}

export async function ensureUserIsDefaultProjectMember(projectId: string, userId: string): Promise<void> {
  const defaultDesignation = await ProjectDesignation.findOne({ projectId, code: 'project_member' }).lean();

  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const projectObjectId = mongoose.Types.ObjectId.isValid(projectId)
    ? new mongoose.Types.ObjectId(projectId)
    : projectId;

  const existing = await ProjectMember.findOne({ project: projectObjectId, user: userObjectId }).lean();
  if (existing) {
    return;
  }

  const memberPerms = defaultDesignation?.permissions || DEFAULT_MEMBER_PERMS_DOT;

  await ProjectInvitation.deleteMany({ project: projectObjectId, user: userObjectId });

  await ProjectMember.create({
    project: projectObjectId,
    user: userObjectId,
    designationId: defaultDesignation?._id,
    permissions: memberPerms,
  });
}
