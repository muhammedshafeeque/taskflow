import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickUpdateFields } from './pickUpdateFields';

describe('pickUpdateFields', () => {
  it('keeps allowlisted keys only', () => {
    assert.deepEqual(
      pickUpdateFields(
        { title: 'a', taskflowOrganizationId: 'evil', authorId: 'x', body: 'b' },
        ['title', 'body']
      ),
      { title: 'a', body: 'b' }
    );
  });

  it('strips forbidden keys even if allowlisted by mistake', () => {
    assert.deepEqual(
      pickUpdateFields(
        { taskflowOrganizationId: 'evil', title: 'ok' },
        ['taskflowOrganizationId', 'title']
      ),
      { title: 'ok' }
    );
  });
});
