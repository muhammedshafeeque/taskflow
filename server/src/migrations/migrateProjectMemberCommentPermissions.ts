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

  const designations = await mongoose.connection
    .collection('projectdesignations')
    .updateMany(
      { code: 'project_member', isSystem: true, permissions: { $all: [COMMENT_CREATE], $nin: [COMMENT_READ] } },
      { $addToSet: { permissions: COMMENT_READ } }
    );

  if (updatedMembers > 0 || designations.modifiedCount > 0) {
    console.log(
      `[migrate] comment permissions: updated ${updatedMembers} project member(s), ${designations.modifiedCount} designation(s)`
    );
  }
}
