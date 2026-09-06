import {
  normalizeGroupProjects,
  type WhatsappGroupDoc,
} from '../Models/WhatsappGroup';

/** Official support group: auto-reply on + at least one Atrium project. */
export function isOfficialSupportGroup(group: WhatsappGroupDoc): boolean {
  return (
    Boolean(group.autoReplyEnabled) &&
    normalizeGroupProjects(group).length > 0
  );
}
