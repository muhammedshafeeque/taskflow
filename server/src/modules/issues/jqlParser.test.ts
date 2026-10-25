import { parseJql } from './jqlParser';

describe('parseJql', () => {
  it('parses simple equality and order by', () => {
    const result = parseJql('project = ABC order by created asc');

    expect(result.filter).toEqual({ project: 'ABC' });
    expect(result.order).toEqual({ field: 'createdAt', direction: 1 });
  });

  it('maps assignee = me to concrete user id', () => {
    const result = parseJql('assignee = me', 'user-123');

    expect(result.filter).toEqual({ assignee: 'user-123' });
  });

  it('supports IN and NOT IN clauses', () => {
    const inResult = parseJql('status in (Open, "In Progress")');
    const notInResult = parseJql('labels not in (bug, urgent)');

    expect(inResult.filter).toEqual({ status: { $in: ['Open', 'In Progress'] } });
    expect(notInResult.filter).toEqual({ labels: { $nin: ['bug', 'urgent'] } });
  });

  it('keeps issue keys whole', () => {
    expect(parseJql('key = APP-12', 'u1').filter).toEqual({ key: 'APP-12' });
    expect(parseJql('key in (APP-1, WEB-22)', 'u1').filter).toEqual({ key: { $in: ['APP-1', 'WEB-22'] } });
  });

  it('parses OR expressions into $or filter', () => {
    const result = parseJql('status = Open OR status = Closed');
    expect(result.filter).toEqual({
      $or: [{ status: 'Open' }, { status: 'Closed' }],
    });
  });
});
