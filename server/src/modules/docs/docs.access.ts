import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { Project } from '../projects/project.model';
import { getProjectObjectIdsInWorkspace } from '../projects/workspaceProjectAccess';
import type { DocSpaceRole, IDocSpace } from './models/docSpace.model';

const D = TASK_FLOW_PERMISSIONS.TASKFLOW.DOCS;

/** The signed-in user plus lazily loaded facts the access rules need. */
export class DocsActor {
  readonly orgOid: mongoose.Types.ObjectId;
  readonly isDocsAdmin: boolean;
  readonly canCreateSpace: boolean;
  private memberProjects?: Promise<Set<string>>;
  private orgProjects?: Promise<mongoose.Types.ObjectId[]>;

  constructor(
    readonly id: string,
    readonly orgId: string,
    permissions: string[]
  ) {
    this.orgOid = new mongoose.Types.ObjectId(orgId);
    this.isDocsAdmin = userHasPermission(permissions, D.ADMIN);
    this.canCreateSpace = this.isDocsAdmin || userHasPermission(permissions, D.SPACE.CREATE);
  }

  /** Projects in this workspace the user is a member of. */
  projectIds(): Promise<Set<string>> {
    this.memberProjects ??= getProjectObjectIdsInWorkspace(this.id, this.orgId).then((ids) => new Set(ids.map(String)));
    return this.memberProjects;
  }

  /** Every project in this workspace. */
  workspaceProjectIds(): Promise<mongoose.Types.ObjectId[]> {
    this.orgProjects ??= Project.find({ taskflowOrganizationId: this.orgOid })
      .distinct('_id')
      .then((ids) => ids as mongoose.Types.ObjectId[]);
    return this.orgProjects;
  }
}

export function makeActor(userId: string | undefined, workspaceId: string | null | undefined, permissions: string[] | undefined) {
  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) throw new ApiError(400, 'Active workspace required');
  return new DocsActor(userId, workspaceId, permissions ?? []);
}

type SpaceAccessFields = Pick<IDocSpace, 'audience' | 'audienceRole' | 'members' | 'projectIds' | 'createdBy'>;

/** The user's role in a space, or null when they cannot open it. */
export async function roleIn(space: SpaceAccessFields, actor: DocsActor): Promise<DocSpaceRole | null> {
  if (actor.isDocsAdmin) return 'admin';
  if (String(space.createdBy) === actor.id) return 'admin';
  const member = space.members.find((m) => String(m.user) === actor.id);
  if (member) return member.role;
  if (space.audience === 'workspace') return space.audienceRole;
  if (space.audience === 'project' && space.projectIds.length > 0) {
    const mine = await actor.projectIds();
    if (space.projectIds.some((p) => mine.has(String(p)))) return space.audienceRole;
  }
  return null;
}

export const canEditRole = (role: DocSpaceRole | null) => role === 'admin' || role === 'editor';
