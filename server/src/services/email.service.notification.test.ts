import {
  escapeHtml,
  renderForgotPasswordEmail,
  renderIssueAssignedEmail,
  renderIssueStatusChangedEmail,
  renderProjectInviteEmail,
  renderTaskMentionedEmail,
  renderWatchCommentEmail,
  renderWatchFieldEmail,
  renderWatchStatusEmail,
  renderReleaseDeployedEmail,
} from './email.service';

describe('notification email templates', () => {
  it('escapes HTML in user content', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('renderForgotPasswordEmail uses shared layout and reset CTA', () => {
    const html = renderForgotPasswordEmail({
      name: 'Alex',
      appUrl: 'https://app.example.com',
      resetLink: 'https://app.example.com/reset-password?token=abc',
    });
    expect(html).toContain('Reset your TaskFlow password');
    expect(html).toContain('Reset password');
    expect(html).toContain('https://app.example.com/reset-password?token=abc');
    expect(html).not.toContain('<script>');
  });

  it('renderIssueAssignedEmail includes issue key and CTA', () => {
    const html = renderIssueAssignedEmail({
      issueKey: 'PROJ-1',
      title: 'Fix bug',
      type: 'Bug',
      status: 'Open',
      assigneeName: 'Alex',
      projectName: 'Demo',
      issueUrl: 'https://app.example.com/projects/p1/issues/PROJ-1',
      changedByName: 'Sam',
    });
    expect(html).toContain('PROJ-1');
    expect(html).toContain('Issue assigned to you');
    expect(html).toContain('Open issue');
    expect(html).not.toContain('<script>');
  });

  it('renderIssueStatusChangedEmail shows status transition', () => {
    const html = renderIssueStatusChangedEmail({
      issueKey: 'PROJ-2',
      title: 'Task',
      type: 'Task',
      fromStatus: 'Open',
      toStatus: 'Done',
      issueUrl: 'https://app.example.com/issues/PROJ-2',
    });
    expect(html).toContain('Open → Done');
    expect(html).toContain('Issue status changed');
  });

  it('renderTaskMentionedEmail includes comment excerpt', () => {
    const html = renderTaskMentionedEmail({
      issueKey: 'PROJ-3',
      issueTitle: 'Mention me',
      authorName: 'Jordan',
      commentExcerpt: 'Please review this',
      issueUrl: 'https://app.example.com/issues/PROJ-3',
    });
    expect(html).toContain('You were mentioned');
    expect(html).toContain('Please review this');
    expect(html).toContain('View comment');
  });

  it('renderWatchCommentEmail includes watched issue context', () => {
    const html = renderWatchCommentEmail({
      issueKey: 'PROJ-4',
      issueTitle: 'Watched',
      authorName: 'Casey',
      commentExcerpt: 'Update here',
      issueUrl: 'https://app.example.com/issues/PROJ-4',
    });
    expect(html).toContain('New comment on watched issue');
    expect(html).toContain('Update here');
  });

  it('renderWatchStatusEmail includes from and to status', () => {
    const html = renderWatchStatusEmail({
      issueKey: 'PROJ-5',
      issueTitle: 'Status watch',
      fromStatus: 'In Progress',
      toStatus: 'Review',
      issueUrl: 'https://app.example.com/issues/PROJ-5',
    });
    expect(html).toContain('In Progress → Review');
  });

  it('renderWatchFieldEmail lists field changes', () => {
    const html = renderWatchFieldEmail({
      issueKey: 'PROJ-6',
      issueTitle: 'Fields',
      changes: [{ field: 'priority', from: 'Low', to: 'High' }],
      issueUrl: 'https://app.example.com/issues/PROJ-6',
    });
    expect(html).toContain('priority');
    expect(html).toContain('Low → High');
  });

  it('renderReleaseDeployedEmail includes version, environment, and CTA', () => {
    const html = renderReleaseDeployedEmail({
      versionName: '2.0.0',
      environmentName: 'Production',
      projectName: 'Demo',
      releasedAt: 'May 28, 2026, 3:00 PM',
      issueCount: 12,
      actionLabel: 'Release',
      versionsUrl: 'https://app.example.com/projects/p1/versions',
    });
    expect(html).toContain('2.0.0');
    expect(html).toContain('Production');
    expect(html).toContain('View release notes');
    expect(html).toContain('12');
  });

  it('renderProjectInviteEmail includes project and inbox CTA', () => {
    const html = renderProjectInviteEmail({
      projectName: 'Alpha',
      inviterName: 'Pat',
      appUrl: 'https://app.example.com',
      roleName: 'Developer',
    });
    expect(html).toContain('Alpha');
    expect(html).toContain('Open inbox');
    expect(html).toContain('Developer');
  });
});
