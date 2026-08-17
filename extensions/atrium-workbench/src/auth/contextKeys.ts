import * as vscode from 'vscode';
import type { SessionStore } from '../auth/session';

const SIGNED_IN = 'atrium.signedIn';
const HAS_URL = 'atrium.hasUrl';

export async function refreshAtriumContext(session: SessionStore): Promise<void> {
  const signedIn = await session.isSignedIn();
  const hasUrl = Boolean(session.getApiBaseUrl());
  await vscode.commands.executeCommand('setContext', SIGNED_IN, signedIn);
  await vscode.commands.executeCommand('setContext', HAS_URL, hasUrl);
}
