import crypto from 'crypto';

export interface IdeAuthSession {
  sid: string;
  redirectUri: string;
  state: string;
  code?: string;
  userId?: string;
  expiresAt: number;
  codeConsumed?: boolean;
}

const SESSION_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;

const sessions = new Map<string, IdeAuthSession>();
const codeIndex = new Map<string, string>(); // code -> sid

function purgeExpired(): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(sid);
      if (session.code) codeIndex.delete(session.code);
    }
  }
}

export function clearIdeAuthSessionsForTests(): void {
  sessions.clear();
  codeIndex.clear();
}

export function isAllowedIdeRedirectUri(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== 'vscode:' && u.protocol !== 'cursor:') return false;
    // vscode://atrium.atrium-workbench/... or vscode://atrium.atrium-workbench?...
    const hostPath = `${u.hostname}${u.pathname}`.replace(/\/+$/, '');
    return (
      hostPath === 'atrium.atrium-workbench' ||
      hostPath.startsWith('atrium.atrium-workbench/')
    );
  } catch {
    return false;
  }
}

export function createIdeSession(input: { redirectUri: string; state: string }): IdeAuthSession {
  purgeExpired();
  if (!isAllowedIdeRedirectUri(input.redirectUri)) {
    throw new Error('INVALID_REDIRECT_URI');
  }
  if (!input.state || input.state.length < 8) {
    throw new Error('INVALID_STATE');
  }
  const sid = crypto.randomBytes(24).toString('hex');
  const session: IdeAuthSession = {
    sid,
    redirectUri: input.redirectUri,
    state: input.state,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sid, session);
  return session;
}

export function getIdeSession(sid: string): IdeAuthSession | undefined {
  purgeExpired();
  const session = sessions.get(sid);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    if (session.code) codeIndex.delete(session.code);
    return undefined;
  }
  return session;
}

export function approveIdeSession(sid: string, userId: string): { code: string; redirectUri: string; state: string } {
  const session = getIdeSession(sid);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.code) {
    // Re-approve replaces previous unused code
    codeIndex.delete(session.code);
  }
  const code = crypto.randomBytes(24).toString('hex');
  session.userId = userId;
  session.code = code;
  session.codeConsumed = false;
  session.expiresAt = Date.now() + CODE_TTL_MS;
  codeIndex.set(code, sid);
  return { code, redirectUri: session.redirectUri, state: session.state };
}

export function exchangeIdeCode(code: string, state: string): { userId: string } {
  purgeExpired();
  const sid = codeIndex.get(code);
  if (!sid) throw new Error('INVALID_CODE');
  const session = sessions.get(sid);
  if (!session || !session.userId || session.code !== code) {
    codeIndex.delete(code);
    throw new Error('INVALID_CODE');
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sid);
    codeIndex.delete(code);
    throw new Error('EXPIRED');
  }
  if (session.state !== state) throw new Error('STATE_MISMATCH');
  if (session.codeConsumed) throw new Error('CODE_USED');
  session.codeConsumed = true;
  codeIndex.delete(code);
  sessions.delete(sid);
  return { userId: session.userId };
}
