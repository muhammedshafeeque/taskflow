import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { signInWithEmail } from './emailLogin';
import { configureApiUrl, ensureApiUrl, startBrowserSignIn } from './ideLogin';
import type { SessionStore } from './session';

/**
 * One guided flow: URL (if needed) → sign-in method → ready.
 */
export async function runGetStarted(
  session: SessionStore,
  client: AtriumClient,
  context: vscode.ExtensionContext
): Promise<boolean> {
  const hasUrl = Boolean(session.getApiBaseUrl());
  if (!hasUrl) {
    const ok = await configureApiUrl(session);
    if (!ok) return false;
  } else {
    const change = await vscode.window.showQuickPick(
      [
        {
          label: `Keep ${session.getApiBaseUrl()}`,
          description: 'Continue',
          id: 'keep' as const,
        },
        { label: 'Change server URL', id: 'change' as const },
      ],
      { title: 'Atrium server', ignoreFocusOut: true }
    );
    if (!change) return false;
    if (change.id === 'change') {
      const ok = await configureApiUrl(session);
      if (!ok) return false;
    }
  }

  if (await session.isSignedIn()) {
    vscode.window.showInformationMessage('Already signed in to Atrium.');
    return true;
  }

  const method = await vscode.window.showQuickPick(
    [
      {
        label: 'Sign in with Browser',
        description: 'Recommended — uses your Atrium web login / SSO',
        id: 'browser' as const,
      },
      {
        label: 'Sign in with Email',
        description: 'Email + password in the IDE',
        id: 'email' as const,
      },
    ],
    { title: 'Sign in to Atrium', ignoreFocusOut: true, placeHolder: 'Choose how to sign in' }
  );
  if (!method) return false;

  if (method.id === 'browser') {
    await startBrowserSignIn(session, client, context);
    return true; // completion happens via URI callback
  }

  return signInWithEmail(session, client);
}

export async function ensureReadyForUse(
  session: SessionStore,
  client: AtriumClient,
  context: vscode.ExtensionContext
): Promise<boolean> {
  if (!(await ensureApiUrl(session))) return false;
  if (await session.isSignedIn()) return true;
  return runGetStarted(session, client, context);
}
