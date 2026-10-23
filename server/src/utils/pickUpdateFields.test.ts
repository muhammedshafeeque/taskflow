import { pickUpdateFields } from './pickUpdateFields';

describe('pickUpdateFields', () => {
  it('keeps allowlisted keys only', () => {
    expect(
      pickUpdateFields(
        { title: 'a', taskflowOrganizationId: 'evil', authorId: 'x', body: 'b' },
        ['title', 'body']
      )
    ).toEqual({ title: 'a', body: 'b' });
  });

  it('strips forbidden keys even if allowlisted by mistake', () => {
    expect(
      pickUpdateFields(
        { taskflowOrganizationId: 'evil', title: 'ok' },
        ['taskflowOrganizationId', 'title']
      )
    ).toEqual({ title: 'ok' });
  });
});
