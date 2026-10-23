import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../utils/ApiError';
import { assertAccessTokenClaims } from './assertAccessToken';

describe('assertAccessTokenClaims', () => {
  it('allows normal access tokens', () => {
    assert.doesNotThrow(() =>
      assertAccessTokenClaims({ sub: 'u1', userType: 'taskflow' })
    );
    assert.doesNotThrow(() =>
      assertAccessTokenClaims({ sub: 'u1', userType: 'customer', type: 'access' })
    );
  });

  it('rejects refresh tokens', () => {
    assert.throws(
      () => assertAccessTokenClaims({ sub: 'u1', type: 'refresh' }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });

  it('rejects 2fa challenge tokens', () => {
    assert.throws(
      () => assertAccessTokenClaims({ sub: 'u1', purpose: '2fa' }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });

  it('rejects missing sub', () => {
    assert.throws(
      () => assertAccessTokenClaims({ userType: 'taskflow' }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 401
    );
  });
});
