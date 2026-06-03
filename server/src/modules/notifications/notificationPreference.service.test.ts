import {
  defaultMethodState,
  isChannelEnabledForUser,
  legacyDefaultPreferences,
} from './notificationPreference.service';
import { NOTIFICATION_EVENTS } from '../../shared/constants/notificationCatalog';

describe('notificationPreference.service', () => {
  it('legacyDefaultPreferences has email disabled for all events', () => {
    const prefs = legacyDefaultPreferences();
    for (const eventKey of NOTIFICATION_EVENTS) {
      expect(prefs[eventKey].email).toBe(false);
      expect(prefs[eventKey].in_app).toBe(true);
    }
  });

  it('isChannelEnabledForUser respects in_app preference', () => {
    const prefs = {
      ...legacyDefaultPreferences(),
      release_deployed: { ...defaultMethodState(), in_app: false },
    };
    expect(isChannelEnabledForUser(prefs, 'release_deployed', 'in_app')).toBe(false);
    expect(isChannelEnabledForUser(prefs, 'release_deployed', 'in_app', ['in_app'])).toBe(false);
  });

  it('isChannelEnabledForUser blocks methods outside allowedChannels', () => {
    const prefs = {
      ...legacyDefaultPreferences(),
      task_assigned: { ...defaultMethodState(), in_app: true, push: true },
    };
    expect(isChannelEnabledForUser(prefs, 'task_assigned', 'in_app', ['email'])).toBe(false);
    expect(isChannelEnabledForUser(prefs, 'task_assigned', 'in_app', ['in_app'])).toBe(true);
  });
});
