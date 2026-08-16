import {
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
} from '../../shared/constants/notificationCatalog';
import {
  NOTIFICATION_EMAIL_TEMPLATE_KEYS,
  buildNotificationEmailHtml,
  buildNotificationEmailSubject,
} from './notificationEmailTemplates';

describe('notificationEmailTemplates', () => {
  it('covers every catalog event key', () => {
    expect([...NOTIFICATION_EMAIL_TEMPLATE_KEYS].sort()).toEqual([...NOTIFICATION_EVENTS].sort());
  });

  it.each([...NOTIFICATION_EVENTS] as NotificationEventKey[])(
    'builds branded HTML for %s',
    (eventKey) => {
      const html = buildNotificationEmailHtml(eventKey, {
        title: 'Sample title',
        body: 'Sample body',
        link: 'https://example.com/item',
        metadata: { projectName: 'Demo', issueKey: 'DEMO-1' },
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Atrium');
      expect(html).toContain('https://example.com/item');
      expect(html).toContain('Sample body');
    }
  );

  it('builds a subject with event label', () => {
    expect(buildNotificationEmailSubject('task_assigned', 'Fix login')).toContain('Task assigned');
  });
});
