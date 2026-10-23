import { ApiError } from '../utils/ApiError';

export type JwtAuthClaims = {
  sub?: string;
  userType?: string;
  type?: string;
  purpose?: string;
  activeOrganizationId?: string;
  orgId?: string;
};

/**
 * Access tokens must not carry refresh/2fa markers.
 * Refresh JWTs use `type: 'refresh'`; 2FA challenge JWTs use `purpose: '2fa'`.
 */
export function assertAccessTokenClaims(decoded: JwtAuthClaims): void {
  if (decoded.type === 'refresh') {
    throw new ApiError(401, 'Refresh token cannot be used as access token');
  }
  if (decoded.type != null && decoded.type !== 'access') {
    throw new ApiError(401, 'Invalid token type');
  }
  if (decoded.purpose === '2fa') {
    throw new ApiError(401, 'Two-factor challenge token cannot be used as access token');
  }
  if (decoded.purpose != null) {
    throw new ApiError(401, 'Invalid token purpose');
  }
  if (!decoded.sub) {
    throw new ApiError(401, 'Invalid token');
  }
}
