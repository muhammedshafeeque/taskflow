import * as vscode from 'vscode';
import { AtriumClient } from '../api/client';
import type { SessionStore, AtriumUser, AuthTokens } from './session';

export async function configureApiUrl(session: SessionStore): Promise<boolean> {
  const current = session.getApiBaseUrl();
  const value = await vscode.window.showInputBox({
    title: 'Atrium Server URL',
    prompt: 'Enter your self-hosted Atrium API origin (without /api)',
    value: current || 'http://localhost:5000',
    placeHolder: 'https://atrium.example.com',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return 'URL is required';
      try {
        const u = new URL(t);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Use http:// or https://';
      } catch {
        return 'Invalid URL';
      }
      return undefined;
    },
  });
  if (!value) return false;
  await session.setApiBaseUrl(value.trim());
  vscode.window.showInformationMessage(`Atrium URL set to ${session.getApiBaseUrl()}`);
  return true;
}

export async function ensureApiUrl(session: SessionStore): Promise<boolean> {
  if (session.getApiBaseUrl()) return true;
  return configureApiUrl(session);
}

export async function pickOrganization(session: SessionStore, user: AtriumUser): Promise<void> {
  const orgs = user.organizations ?? [];
  if (orgs.length <= 1) {
    if (orgs[0]?.id) await session.setOrganizationId(orgs[0].id);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    orgs.map((o) => ({ label: o.name, description: o.slug || o.id, id: o.id })),
    { title: 'Select Atrium organization', ignoreFocusOut: true }
  );
  if (picked) await session.setOrganizationId(picked.id);
}

export async function startBrowserSignIn(
  session: SessionStore,
  client: AtriumClient,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!(await ensureApiUrl(session))) return;

  const state = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const redirectUri = `${vscode.env.uriScheme}://atrium.atrium-workbench/auth-callback`;

  const data = await client.post<{ authorizeUrl: string; sid: string }>(
    '/auth/ide/start',
    { redirectUri, state },
    { auth: false }
  );

  await context.globalState.update('atrium.pendingIdeState', state);
  await vscode.env.openExternal(vscode.Uri.parse(data.authorizeUrl));
  vscode.window.showInformationMessage('Complete sign-in in your browser, then return to the editor.');
}

export function registerIdeUriHandler(
  context: vscode.ExtensionContext,
  session: SessionStore,
  client: AtriumClient,
  onSignedIn: () => void
): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri: vscode.Uri) => {
        if (!uri.path.includes('auth-callback') && uri.path !== '/auth-callback') {
          // vscode://publisher.ext/auth-callback — path may be /auth-callback
          if (!String(uri).includes('auth-callback')) return;
        }
        const params = new URLSearchParams(uri.query);
        const code = params.get('code');
        const state = params.get('state');
        const expected = context.globalState.get<string>('atrium.pendingIdeState');
        if (!code || !state) {
          vscode.window.showErrorMessage('Atrium IDE sign-in failed: missing code.');
          return;
        }
        if (expected && expected !== state) {
          vscode.window.showErrorMessage('Atrium IDE sign-in failed: state mismatch.');
          return;
        }
        try {
          const data = await client.post<{ user: AtriumUser; tokens: AuthTokens }>(
            '/auth/ide/exchange',
            { code, state },
            { auth: false }
          );
          await session.setSession(data.user, data.tokens);
          await pickOrganization(session, data.user);
          await context.globalState.update('atrium.pendingIdeState', undefined);
          vscode.window.showInformationMessage(`Signed in to Atrium as ${data.user.email}`);
          onSignedIn();
        } catch (e) {
          vscode.window.showErrorMessage(`Atrium sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    })
  );
}
