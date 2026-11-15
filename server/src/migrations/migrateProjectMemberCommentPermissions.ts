import mongoose from 'mongoose';
import { DEFAULT_PROJECT_MEMBER_PERMISSION_CODES } from '../constants/permissions';
import { PROJECT_PERMISSIONS } from '../shared/constants/permissions';
import { LEGACY_COLON_TO_DOT } from '../shared/constants/legacyPermissionMap';

const COMMENT_READ = PROJECT_PERMISSIONS.ISSUE.COMMENT.READ;
const COMMENT_CREATE = PROJECT_PERMISSIONS.ISSUE.COMMENT.CREATE;

/** The member default used by project invitations before it included comment permissions. */
const LEGACY_DEFAULT = [...new Set(DEFAULT_PROJECT_MEMBER_PERMISSION_CODES.map((p) => LEGACY_COLON_TO_DOT[p] ?? p))].sort();

function sameSet(a: string[], sortedB: string[]): boolean {
  const sortedA = [...new Set(a)].sort();
  return sortedA.length === sortedB.length && sortedA.every((p, i) => p === sortedB[i]);
}

/**
 * One-time: project members still on the untouched legacy invitation default had no comment
 * permissions at all; give them read + create. Customised permission sets are left alone.
 * Also stores comment read on "Project Member" system designations that grant create, so the
 * settings UI matches what is enforced (create already implies read at runtime).
 */
export async function migrateProjectMemberCommentPermissionsIfNeeded(): Promise<void> {
  const members = mongoose.connection.collection('projectmembers');
  let updatedMembers = 0;
  for await (const doc of members.find({ permissions: { $nin: [COMMENT_READ, COMMENT_CREATE] } })) {
    if (!Array.isArray(doc.permissions) || !sameSet(doc.permissions as string[], LEGACY_DEFAULT)) continue;
    await members.updateOne({ _id: doc._id }, { $addToSet: { permissions: { $each: [COMMENT_READ, COMMENT_CREATE] } } });
    updatedMembers += 1;
  }

  // Members who joined by accepting a project invitation got the legacy "Project Member" role snapshot
  // and no designation, so they had no comment access and later designation edits never reached them.
  // Attach them to their project's "Project Member" designation (members on any other role are left alone).
  const memberRole = await mongoose.connection.collection('roles').findOne({ name: 'Project Member' }, { projection: { _id: 1 } });
  const orphanFilter = {
    $or: [{ designationId: null }, { designationId: { $exists: false } }],
    ...(memberRole ? { role: { $in: [null, memberRole._id] } } : { role: null }),
  };
  const memberDesignationByProject = new Map<string, { _id: unknown; permissions: string[] } | null>();
  let attachedMembers = 0;
  for await (const doc of members.find(orphanFilter)) {
    const projectKey = String(doc.project);
    if (!memberDesignationByProject.has(projectKey)) {
      const d = await mongoose.connection
        .collection('projectdesignations')
        .findOne({ projectId: doc.project, code: 'project_member' }, { projection: { _id: 1, permissions: 1 } });
      memberDesignationByProject.set(projectKey, d ? { _id: d._id, permissions: (d.permissions as string[]) ?? [] } : null);
    }
    const designation = memberDesignationByProject.get(projectKey);
    if (!designation) continue;
    await members.updateOne(
      { _id: doc._id },
      { $set: { designationId: designation._id, permissions: designation.permissions } }
    );
    attachedMembers += 1;
  }

  const designations = await mongoose.connection
    .collection('projectdesignations')
    .updateMany(
      { code: 'project_member', isSystem: true, permissions: { $all: [COMMENT_CREATE], $nin: [COMMENT_READ] } },
      { $addToSet: { permissions: COMMENT_READ } }
    );

  if (updatedMembers > 0 || attachedMembers > 0 || designations.modifiedCount > 0) {
    console.log(
      `[migrate] comment permissions: updated ${updatedMembers} project member(s), attached ${attachedMembers} to "Project Member", ${designations.modifiedCount} designation(s)`
    );
  }
}
