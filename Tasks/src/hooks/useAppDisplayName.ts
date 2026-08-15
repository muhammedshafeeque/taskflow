import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME } from '../brand';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/** Resolve uploaded asset path to a browser URL. */
export function resolveMediaUrl(url?: string | null): string | null {
  if (!url?.trim()) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const base = API_BASE.replace(/\/api\/?$/, '') || 'http://localhost:5000';
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * Workspace / company display name for the signed-in shell.
 * Prefer active organization name (kept in sync with Core company name); fall back to product brand.
 */
export function useAppDisplayName(): string {
  const { user } = useAuth();
  if (user?.userType === 'taskflow') {
    const activeId = user.activeOrganizationId;
    const org = user.organizations?.find((o) => o.id === activeId);
    const name = org?.name?.trim();
    if (name) return name;
  }
  return APP_NAME;
}

/** Active workspace company logo (from org summary / Core company sync). */
export function useAppLogoUrl(): string | null {
  const { user } = useAuth();
  if (user?.userType !== 'taskflow') return null;
  const activeId = user.activeOrganizationId;
  const org = user.organizations?.find((o) => o.id === activeId);
  return resolveMediaUrl(org?.logoUrl);
}

/** Keep the browser tab title aligned with the workspace/company name. */
export function AppDisplayTitle({ suffix = 'Work hub' }: { suffix?: string }) {
  const name = useAppDisplayName();
  useEffect(() => {
    document.title = `${name} — ${suffix}`;
  }, [name, suffix]);
  return null;
}
