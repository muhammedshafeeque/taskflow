import {
  approveIdeSession,
  clearIdeAuthSessionsForTests,
  createIdeSession,
  exchangeIdeCode,
  isAllowedIdeRedirectUri,
} from './ideAuth.session';

describe('ideAuth.session', () => {
  beforeEach(() => {
    clearIdeAuthSessionsForTests();
  });

  it('allows vscode and cursor redirect URIs for atrium-workbench', () => {
    expect(isAllowedIdeRedirectUri('vscode://atrium.atrium-workbench/auth-callback')).toBe(true);
    expect(isAllowedIdeRedirectUri('cursor://atrium.atrium-workbench/auth-callback')).toBe(true);
    expect(isAllowedIdeRedirectUri('vscode://atrium.atrium-workbench')).toBe(true);
    expect(isAllowedIdeRedirectUri('https://evil.example/callback')).toBe(false);
    expect(isAllowedIdeRedirectUri('vscode://other.extension/auth')).toBe(false);
  });

  it('creates a session and exchanges a one-time code', () => {
    const session = createIdeSession({
      redirectUri: 'vscode://atrium.atrium-workbench/auth-callback',
      state: 'state-value-123',
    });
    const approved = approveIdeSession(session.sid, 'user-1');
    expect(approved.state).toBe('state-value-123');
    expect(approved.code.length).toBeGreaterThan(16);

    const exchanged = exchangeIdeCode(approved.code, 'state-value-123');
    expect(exchanged.userId).toBe('user-1');

    expect(() => exchangeIdeCode(approved.code, 'state-value-123')).toThrow('INVALID_CODE');
  });

  it('rejects state mismatch', () => {
    const session = createIdeSession({
      redirectUri: 'vscode://atrium.atrium-workbench/auth-callback',
      state: 'expected-state',
    });
    const approved = approveIdeSession(session.sid, 'user-2');
    expect(() => exchangeIdeCode(approved.code, 'wrong-state')).toThrow('STATE_MISMATCH');
  });
});
