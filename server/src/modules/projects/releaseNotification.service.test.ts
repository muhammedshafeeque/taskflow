import {
  dispatchReleaseNotifications,
  resolveReleaseNotifyUserIds,
  ruleChannelsToAllowedMethods,
  ruleHasReleaseNotifications,
} from './releaseNotification.service';
import type { IProjectReleaseRule } from './project.model';

jest.mock('./projectMember.model', () => ({
  ProjectMember: {
    find: jest.fn(() => ({
      distinct: jest.fn().mockResolvedValue(['member-a', 'member-b']),
    })),
  },
}));

jest.mock('../inbox/inbox.service', () => ({
  createMessage: jest.fn().mockResolvedValue({}),
}));

jest.mock('../notifications/notificationPreference.service', () => ({
  shouldSend: jest.fn().mockResolvedValue(true),
}));

jest.mock('../notifications/notificationDispatch.service', () => ({
  appUrl: (path: string) => `https://app.test/${path}`,
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { ProjectMember } from './projectMember.model';
import * as inboxService from '../inbox/inbox.service';
import { notifyUser } from '../notifications/notificationDispatch.service';
import { shouldSend } from '../notifications/notificationPreference.service';

const mockedShouldSend = shouldSend as jest.MockedFunction<typeof shouldSend>;

describe('releaseNotification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldSend.mockResolvedValue(true);
  });

  it('ruleHasReleaseNotifications is true when channels or users are set', () => {
    expect(ruleHasReleaseNotifications({ environmentId: 'e1', statusName: 'Done' })).toBe(false);
    expect(
      ruleHasReleaseNotifications({
        environmentId: 'e1',
        statusName: 'Done',
        notifyChannels: ['email'],
      })
    ).toBe(true);
  });

  it('resolveReleaseNotifyUserIds prefers explicit users', () => {
    const rule: IProjectReleaseRule = {
      environmentId: 'e1',
      statusName: 'Done',
      notifyUserIds: ['u1', 'u2'],
      notifyChannels: ['email'],
    };
    expect(resolveReleaseNotifyUserIds(rule, ['member-a'])).toEqual(['u1', 'u2']);
  });

  it('ruleChannelsToAllowedMethods maps release rule channels', () => {
    expect(ruleChannelsToAllowedMethods(['email'])).toEqual(['email']);
    expect(ruleChannelsToAllowedMethods(['in_app', 'email', 'third_party'])).toEqual([
      'in_app',
      'email',
      'slack',
      'teams',
      'telegram',
      'discord',
    ]);
  });

  it('dispatchReleaseNotifications respects user prefs for inbox and notifyUser', async () => {
    const rule: IProjectReleaseRule = {
      environmentId: 'e1',
      statusName: 'Done',
      notifyUserIds: ['u1'],
      notifyChannels: ['email', 'in_app'],
    };

    await dispatchReleaseNotifications({
      projectId: 'proj-1',
      rule,
      releaseTitle: 'Release: v1 → Production',
      releaseNotesMarkdown: '# Release notes',
      versionName: 'v1',
      environmentName: 'Production',
      projectName: 'Demo',
      releasedAtFormatted: 'May 28, 2026',
      issueCount: 3,
      promoteRelease: false,
    });

    expect(ProjectMember.find).not.toHaveBeenCalled();
    expect(inboxService.createMessage).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        eventKey: 'release_deployed',
        allowedChannels: ['in_app', 'email'],
      })
    );
    expect(mockedShouldSend).toHaveBeenCalledWith('u1', 'release_deployed', 'in_app', ['in_app', 'email']);
  });

  it('dispatchReleaseNotifications skips inbox when in_app preference is off', async () => {
    mockedShouldSend.mockImplementation(async (_uid, _event, method) => method !== 'in_app');

    await dispatchReleaseNotifications({
      projectId: 'proj-1',
      rule: {
        environmentId: 'e1',
        statusName: 'Done',
        notifyUserIds: ['u1'],
        notifyChannels: ['in_app', 'email'],
      },
      releaseTitle: 'Release: v1 → Production',
      releaseNotesMarkdown: '# Notes',
      versionName: 'v1',
      environmentName: 'Production',
      projectName: 'Demo',
      releasedAtFormatted: 'May 28, 2026',
      issueCount: 1,
      promoteRelease: false,
    });

    expect(inboxService.createMessage).not.toHaveBeenCalled();
    expect(notifyUser).toHaveBeenCalled();
  });
});
