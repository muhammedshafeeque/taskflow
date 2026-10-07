import QRCode from 'qrcode';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { decryptSecret, encryptSecret } from '../../utils/secretCrypto';
import { generateSecret, otpauthUrl, verifyTotp } from '../../services/totp';
import { User } from './user.model';
import { CoreCompanySettings } from '../core/models/coreCompanySettings.model';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const CHALLENGE_TTL = '5m';

async function issuerName(): Promise<string> {
  const company = await CoreCompanySettings.findOne().select('companyName').lean();
  return company?.companyName || 'Atrium';
}

/** Step 1: create a secret (not yet active) and return what the authenticator app needs. */
export async function beginSetup(userId: string) {
  const user = await User.findById(userId).select('email twoFactorEnabled');
  if (!user) throw new ApiError(404, 'User not found');
  if (user.twoFactorEnabled) throw new ApiError(409, 'Two-factor authentication is already on');
  const secret = generateSecret();
  await User.updateOne({ _id: userId }, { $set: { twoFactorSecret: encryptSecret(secret) } });
  const url = otpauthUrl(secret, user.email, await issuerName());
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

/** Step 2: prove the app works, switch 2FA on, hand out recovery codes once. */
export async function confirmSetup(userId: string, code: string) {
  const user = await User.findById(userId).select('+twoFactorSecret twoFactorEnabled');
  if (!user?.twoFactorSecret) throw new ApiError(400, 'Start setup first');
  if (!verifyTotp(decryptSecret(user.twoFactorSecret), code)) throw new ApiError(400, 'That code is not valid — check the time on your phone and try again');
  const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  await User.updateOne(
    { _id: userId },
    { $set: { twoFactorEnabled: true, twoFactorRecoveryHashes: recoveryCodes.map(sha) } }
  );
  return { enabled: true, recoveryCodes };
}

export async function disable(userId: string, code: string) {
  const user = await User.findById(userId).select('+twoFactorSecret +twoFactorRecoveryHashes twoFactorEnabled');
  if (!user?.twoFactorEnabled) return { enabled: false };
  if (!(await checkCode(user, code))) throw new ApiError(400, 'Invalid code');
  await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryHashes: [] } });
  return { enabled: false };
}

/** Admin reset for a locked-out user (they set it up again on next sign-in if required). */
export async function adminReset(userId: string) {
  await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryHashes: [] } });
}

async function checkCode(
  user: { _id: unknown; twoFactorSecret?: string | null; twoFactorRecoveryHashes?: string[] },
  code: string
): Promise<boolean> {
  const clean = String(code ?? '').trim().toLowerCase();
  if (user.twoFactorSecret && verifyTotp(decryptSecret(user.twoFactorSecret), clean)) return true;
  // One-time recovery code
  const hash = sha(clean);
  if ((user.twoFactorRecoveryHashes ?? []).includes(hash)) {
    await User.updateOne({ _id: user._id }, { $pull: { twoFactorRecoveryHashes: hash } });
    return true;
  }
  return false;
}

/** Short-lived token proving the password step passed; exchanged for real tokens with a code. */
export function issueChallenge(userId: string): string {
  return jwt.sign({ sub: userId, purpose: '2fa' }, env.jwtSecret, { expiresIn: CHALLENGE_TTL });
}

export async function verifyChallenge(challengeToken: string, code: string): Promise<string> {
  let payload: { sub?: string; purpose?: string };
  try {
    payload = jwt.verify(challengeToken, env.jwtSecret) as typeof payload;
  } catch {
    throw new ApiError(401, 'Sign-in expired — enter your password again');
  }
  if (payload.purpose !== '2fa' || !payload.sub) throw new ApiError(401, 'Invalid sign-in challenge');
  const user = await User.findById(payload.sub).select('+twoFactorSecret +twoFactorRecoveryHashes twoFactorEnabled');
  if (!user?.twoFactorEnabled) throw new ApiError(401, 'Invalid sign-in challenge');
  if (!(await checkCode(user, code))) throw new ApiError(401, 'Invalid code');
  return payload.sub;
}
