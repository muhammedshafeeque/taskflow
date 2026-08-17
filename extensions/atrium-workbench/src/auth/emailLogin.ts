import * as vscode from 'vscode';
import { AtriumClient } from '../api/client';
import { ensureApiUrl, pickOrganization } from './ideLogin';
import type { SessionStore, AtriumUser, AuthTokens } from './session';

export async function signInWithEmail(session: SessionStore, client: AtriumClient): Promise<boolean> {
  if (!(await ensureApiUrl(session))) return false;

  const email = await vscode.window.showInputBox({
    title: 'Atrium email',
    prompt: 'Email address',
    ignoreFocusOut: true,
    validateInput: (v) => (v.includes('@') ? undefined : 'Enter a valid email'),
  });
  if (!email) return false;

  const password = await vscode.window.showInputBox({
    title: 'Atrium password',
    prompt: 'Password',
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) return false;

  try {
    const data = await client.post<{ user: AtriumUser; tokens: AuthTokens }>(
      '/auth/login',
      { email: email.trim(), password },
      { auth: false }
    );
    if (data.user.userType === 'customer') {
      vscode.window.showErrorMessage('Customer portal accounts cannot use Atrium Workbench.');
      return false;
    }
    await session.setSession(data.user, data.tokens);
    await pickOrganization(session, data.user);
    vscode.window.showInformationMessage(`Signed in as ${data.user.email}`);
    return true;
  } catch (e) {
    vscode.window.showErrorMessage(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
