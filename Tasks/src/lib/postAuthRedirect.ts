import { TASKFLOW_ACTIVE_ORG_STORAGE_KEY, type AuthUser } from './api';

/** After login: ensure a single organization is active, then land on Home. */
export async function resolvePostAuthRoute(
  user: AuthUser,
  switchWorkspace: (organizationId: string) => Promise<{ ok: boolean; error?: string }>
): Promise<string> {
  if (user.userType === 'customer') return '/portal';
  const organizations = user.organizations ?? [];
  if (organizations.length === 0) return '/app-settings';

  const orgId = organizations[0].id;
  if (orgId && user.activeOrganizationId !== orgId) {
    await switchWorkspace(orgId);
    try {
      localStorage.setItem(TASKFLOW_ACTIVE_ORG_STORAGE_KEY, orgId);
    } catch {
      /* ignore */
    }
  }
  return '/';
}
