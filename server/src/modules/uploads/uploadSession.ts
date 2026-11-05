import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../../config/env';

/**
 * <video> tags and "Open" links can't send an Authorization header, and tokens never go in
 * URLs (logs/Referer leak). So a signed-in client swaps its bearer token for this HttpOnly
 * cookie, which is sent only to /api/uploads and only allows reading stored files.
 */
const COOKIE_NAME = 'upload_session';
const COOKIE_PATH = '/api/uploads';
const TTL_SECONDS = 12 * 60 * 60;

/** A derived key, so this cookie can never verify as an access token. */
function sessionSecret(): string {
  return crypto.createHmac('sha256', env.jwtSecret).update('upload-session').digest('hex');
}

function cookieOptions(req: Request) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: COOKIE_PATH };
}

export function setUploadSession(req: Request, res: Response): void {
  const value = jwt.sign({}, sessionSecret(), { expiresIn: TTL_SECONDS });
  res.cookie(COOKIE_NAME, value, { ...cookieOptions(req), maxAge: TTL_SECONDS * 1000 });
}

export function clearUploadSession(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

export function hasUploadSession(req: Request): boolean {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(req.headers.cookie ?? '');
  if (!match) return false;
  try {
    jwt.verify(match[1], sessionSecret());
    return true;
  } catch {
    return false;
  }
}
