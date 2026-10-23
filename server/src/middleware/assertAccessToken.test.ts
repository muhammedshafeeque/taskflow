import { ApiError } from '../utils/ApiError';
import { assertAccessTokenClaims } from './assertAccessToken';

function expectUnauthorized(fn: () => void) {
  try {
    fn();
    throw new Error('expected ApiError');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(401);
  }
}

describe('assertAccessTokenClaims', () => {
  it('allows normal access tokens', () => {
    expect(() =>
      assertAccessTokenClaims({ sub: 'u1', userType: 'taskflow' })
    ).not.toThrow();
    expect(() =>
      assertAccessTokenClaims({ sub: 'u1', userType: 'customer', type: 'access' })
    ).not.toThrow();
  });

  it('rejects refresh tokens', () => {
    expectUnauthorized(() => assertAccessTokenClaims({ sub: 'u1', type: 'refresh' }));
  });

  it('rejects 2fa challenge tokens', () => {
    expectUnauthorized(() => assertAccessTokenClaims({ sub: 'u1', purpose: '2fa' }));
  });

  it('rejects missing sub', () => {
    expectUnauthorized(() => assertAccessTokenClaims({ userType: 'taskflow' }));
  });
});
