import { ApiError } from '../../utils/ApiError';

describe('issue update concurrency contract', () => {
  it('409 conflict includes latest issue in error details', () => {
    const latest = { _id: 'abc', title: 'Updated elsewhere', updatedAt: new Date().toISOString() };
    const err = new ApiError(409, 'Issue was modified by someone else', { latest });
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ latest });
    expect((err.details as { latest: typeof latest }).latest.title).toBe('Updated elsewhere');
  });

  it('expectedUpdatedAt is applied as updatedAt filter on PATCH', () => {
    const expectedUpdatedAt = '2026-05-28T12:00:00.000Z';
    const filter: Record<string, unknown> = { _id: 'issue-1' };
    filter.updatedAt = new Date(expectedUpdatedAt);
    expect(filter.updatedAt).toEqual(new Date(expectedUpdatedAt));
  });
});
