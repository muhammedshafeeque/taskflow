import type { IProjectReleaseRule } from './project.model';
import { ProjectMember } from './projectMember.model';
import * as inboxService from '../inbox/inbox.service';
import { notifyUser, appUrl } from '../notifications/notificationDispatch.service';
import { shouldSend } from '../notifications/notificationPreference.service';
import { renderReleaseDeployedEmail } from '../../services/email.service';
import type { NotificationMethod } from '../../shared/constants/notificationCatalog';

export type ReleaseNotifyChannel = 'email' | 'in_app' | 'third_party';

/** True when the release rule has explicit notify users or channels configured. */
export function ruleHasReleaseNotifications(rule: IProjectReleaseRule): boolean {
  return (rule.notifyUserIds?.length ?? 0) > 0 || (rule.notifyChannels?.length ?? 0) > 0;
}

/** Resolve recipient user ids from a release rule and project membership. */
export function resolveReleaseNotifyUserIds(
  rule: IProjectReleaseRule,
  allProjectMemberUserIds: string[]
): string[] {
  if (rule.notifyUserIds?.length) {
    return [...new Set(rule.notifyUserIds.map(String))];
  }
  if (ruleHasReleaseNotifications(rule)) {
    return [...new Set(allProjectMemberUserIds.map(String))];
  }
  return [];
}

/** Map project release-rule channels to notification methods (still filtered by user prefs). */
export function ruleChannelsToAllowedMethods(channels: ReleaseNotifyChannel[]): NotificationMethod[] {
  const out: NotificationMethod[] = [];
  if (channels.includes('in_app')) out.push('in_app');
  if (channels.includes('email')) out.push('email');
  if (channels.includes('third_party')) {
    out.push('slack', 'teams', 'telegram', 'discord');
  }
  return out;
}

function releaseNotesPlainExcerpt(markdown: string, maxLen: number): string {
  let s = markdown
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
  return s;
}

export async function dispatchReleaseNotifications(params: {
  projectId: string;
  rule: IProjectReleaseRule;
  releaseTitle: string;
  releaseNotesMarkdown: string;
  versionName: string;
  environmentName: string;
  projectName: string;
  releasedAtFormatted: string;
  issueCount: number;
  promoteRelease: boolean;
  releasedByName?: string;
}): Promise<void> {
  const { rule, projectId } = params;
  if (!ruleHasReleaseNotifications(rule)) return;

  let userIds: string[];
  if (rule.notifyUserIds?.length) {
    userIds = [...new Set(rule.notifyUserIds.map(String))];
  } else {
    const memberIds = await ProjectMember.find({ project: projectId })
      .distinct('user')
      .then((ids) => ids.map(String));
    userIds = resolveReleaseNotifyUserIds(rule, memberIds);
  }
  if (userIds.length === 0) return;

  const channels: ReleaseNotifyChannel[] = rule.notifyChannels?.length
    ? [...rule.notifyChannels]
    : ['in_app'];

  const versionsUrl = appUrl(`projects/${projectId}/versions`) ?? '';
  const emailHtml = renderReleaseDeployedEmail({
    versionName: params.versionName,
    environmentName: params.environmentName,
    projectName: params.projectName,
    releasedAt: params.releasedAtFormatted,
    issueCount: params.issueCount,
    actionLabel: params.promoteRelease ? 'Promotion' : 'Release',
    versionsUrl,
    releasedByName: params.releasedByName,
  });
  const bodyExcerpt = releaseNotesPlainExcerpt(params.releaseNotesMarkdown, 400);
  const meta = {
    projectId,
    versionName: params.versionName,
    environmentName: params.environmentName,
    issueCount: params.issueCount,
  };
  const allowedChannels = ruleChannelsToAllowedMethods(channels);

  await Promise.all(
    userIds.map(async (uid) => {
      try {
        if (
          channels.includes('in_app') &&
          (await shouldSend(uid, 'release_deployed', 'in_app', allowedChannels))
        ) {
          await inboxService.createMessage({
            toUser: uid,
            type: 'release_notes',
            title: params.releaseTitle,
            body: params.releaseNotesMarkdown,
            meta,
          });
        }
        if (allowedChannels.length > 0) {
          await notifyUser({
            userId: uid,
            eventKey: 'release_deployed',
            title: params.releaseTitle,
            body: bodyExcerpt,
            link: versionsUrl,
            html: emailHtml,
            allowedChannels,
            metadata: meta,
          });
        }
      } catch (err) {
        console.error('Release notification failed for user', uid, err);
      }
    })
  );
}
