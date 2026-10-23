import { Request, Response } from 'express';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import * as authService from './auth.service';
import {
  consumeOAuthExchangeCode,
  issueOAuthExchangeCode,
} from './oauthCode.store';

export async function oauthSuccessHandler(req: Request, res: Response): Promise<void> {
  const user = req.user as
    | { _id?: { toString(): string }; id?: string; userType?: string }
    | undefined;
  const sub =
    user && '_id' in user && user._id
      ? user._id.toString()
      : user && 'id' in user && user.id
        ? user.id
        : undefined;
  if (!sub) {
    res.redirect(`${env.frontendUrl}/auth/error?reason=no_user`);
    return;
  }
  const ut =
    user && 'userType' in user && typeof user.userType === 'string' ? user.userType : 'taskflow';
  try {
    const tokens = await authService.issueTaskflowTokensForOAuth(sub);
    const code = issueOAuthExchangeCode(tokens, ut);
    res.redirect(
      `${env.frontendUrl}/auth/oauth-callback?code=${encodeURIComponent(code)}`
    );
  } catch {
    res.redirect(`${env.frontendUrl}/auth/error?reason=oauth_failed`);
  }
}

export function oauthFailureHandler(_req: Request, res: Response): void {
  res.redirect(`${env.frontendUrl}/auth/error?reason=oauth_failed`);
}

/** Exchange one-time OAuth code for access + refresh tokens (no JWT in redirect URL). */
export async function oauthExchangeHandler(req: Request, res: Response): Promise<void> {
  const code = String((req.body as { code?: string })?.code || '').trim();
  if (!code) throw new ApiError(400, 'code is required');
  const tokens = consumeOAuthExchangeCode(code);
  if (!tokens) throw new ApiError(401, 'Invalid or expired OAuth code');
  res.json({ success: true, data: { tokens } });
}
