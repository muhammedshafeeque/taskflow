import * as vscode from 'vscode';
import type { AtriumClient } from './client';
import { listOrganizations, switchOrganization } from './issues';
import type { AtriumUser, SessionStore } from '../auth/session';

/**
 * Pick an organization (QuickPick when multiple), persist id, and call server switch
 * so the session token matches the active org.
 */
export async function selectAndSwitchOrganization(
  session: SessionStore,
  client: AtriumClient,
  userHint?: AtriumUser
): Promise<string | undefined> {
  let orgs = userHint?.organizations ?? [];
  if (orgs.length === 0) {
    try {
      const data = await listOrganizations(client);
      orgs = data.organizations || [];
    } catch {
      orgs = [];
    }
  }

  if (orgs.length === 0) {
    return session.getOrganizationId() || undefined;
  }

  let orgId = orgs[0].id;
  if (orgs.length > 1) {
    const current = session.getOrganizationId() || userHint?.activeOrganizationId || '';
    const picked = await vscode.window.showQuickPick(
      orgs.map((o) => ({
        label: o.name,
        description: o.slug || o.id,
        detail: o.id === current ? 'Current' : undefined,
        id: o.id,
      })),
      { title: 'Select Atrium organization', ignoreFocusOut: true }
    );
    if (!picked) {
      // Keep existing / first if user cancels after login
      orgId = current || orgs[0].id;
    } else {
      orgId = picked.id;
    }
  }

  await session.setOrganizationId(orgId);

  try {
    const switched = await switchOrganization(client, orgId);
    const user = userHint || (await session.getUser());
    if (switched.tokens && user) {
      await session.setSession({ ...user, activeOrganizationId: orgId }, switched.tokens);
    }
  } catch (e) {
    // Settings header still has org id; switch may fail on single-org installs
    const msg = e instanceof Error ? e.message : String(e);
    if (orgs.length > 1) {
      vscode.window.showWarningMessage(`Organization saved, but server switch failed: ${msg}`);
    }
  }

  return orgId;
}
