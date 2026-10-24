import type { Router } from 'express';
import { PERMISSION_TAG, type PermissionTag } from '../../middleware/requirePermission';
import { MODULE_TAG } from '../../middleware/requireModuleEnabled';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { canAny, MODULE_ACCESS, type ModuleId } from '../../shared/constants/moduleAccess';
import { isPlatformModuleEnabled } from '../core/core.service';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CatalogEntry {
  method: HttpMethod;
  /** Path under /api, e.g. /crm/deals/:id */
  path: string;
  /** First path segment, used to group endpoints (crm, hrms, issues…). */
  area: string;
  module?: ModuleId;
  /** Global permissions checked by the route (all of `all`, one of `any`). Project-level checks happen at call time. */
  permissions: PermissionTag[];
}

/**
 * Areas an assistant must never reach, whatever the user's permissions: credentials and token management,
 * sign-in flows, machine-to-machine and public endpoints, the customer portal, and this MCP endpoint itself.
 */
const BLOCKED: RegExp[] = [
  /^\/api-tokens(\/|$)/,
  /^\/auth(?!\/(users|roles)(\/|$))(\/|$)/,
  /^\/mcp(\/|$)/,
  /^\/internal(\/|$)/,
  /^\/public(\/|$)/,
  /^\/customer(\/|$)/,
  /^\/webhooks(\/|$)/,
  /^\/push(-subscriptions)?(\/|$)/,
  /^\/monitor\/(ingest|events|envelope)(\/|$)/,
  /^\/health$/,
];

export function isBlockedPath(path: string) {
  return BLOCKED.some((re) => re.test(path));
}

type Layer = {
  handle: ((...a: unknown[]) => unknown) & { stack?: Layer[]; [k: symbol]: unknown };
  regexp: RegExp & { fast_slash?: boolean };
  keys: Array<{ name: string | number }>;
  route?: { path: unknown; methods: Record<string, boolean>; stack: Layer[] };
};

/** Rebuilds the mount path Express 4 only keeps as a regular expression. */
function mountPath(layer: Layer): string | null {
  if (layer.regexp.fast_slash) return '';
  let i = 0;
  let src = layer.regexp.source
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys[i++]?.name ?? 'param'}`)
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '')
    .replace(/\\\/\?\$$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.')
    .replace(/\\-/g, '-');
  if (/[()[\]*+?|\\]/.test(src)) return null; // not a plain path
  if (src && !src.startsWith('/')) src = `/${src}`;
  return src;
}

function tagsOf(layer: Layer): { perms?: PermissionTag; module?: ModuleId } {
  const fn = layer.handle;
  return { perms: fn[PERMISSION_TAG] as PermissionTag | undefined, module: fn[MODULE_TAG] as ModuleId | undefined };
}

function walk(stack: Layer[], prefix: string, inherited: { perms: PermissionTag[]; module?: ModuleId }, out: CatalogEntry[]) {
  // Middleware mounted at "/" applies to everything registered after it in this router.
  let running = { perms: [...inherited.perms], module: inherited.module };
  // Middleware mounted on a specific path applies to the router/route on the same path.
  const pending = new Map<string, { perms: PermissionTag[]; module?: ModuleId }>();

  for (const layer of stack) {
    if (layer.route) {
      const routePath = typeof layer.route.path === 'string' ? layer.route.path : null;
      if (routePath === null) continue;
      const extra = layer.route.stack.map((l) => tagsOf(l).perms).filter((p): p is PermissionTag => Boolean(p));
      const full = `${prefix}${routePath === '/' ? '' : routePath}` || '/';
      for (const [m, on] of Object.entries(layer.route.methods)) {
        const method = m.toUpperCase();
        if (!on || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
        out.push({ method: method as HttpMethod, path: full, area: full.split('/')[1] ?? '', module: running.module, permissions: [...running.perms, ...extra] });
      }
      continue;
    }

    const path = mountPath(layer);
    if (path === null) continue;
    const child = layer.handle.stack;
    const { perms, module } = tagsOf(layer);
    if (child) {
      const ctx = pending.get(path) ?? { perms: [] };
      walk(child, `${prefix}${path}`, { perms: [...running.perms, ...ctx.perms], module: ctx.module ?? running.module }, out);
      continue;
    }
    if (!perms && !module) continue;
    if (path === '') {
      running = { perms: perms ? [...running.perms, perms] : running.perms, module: module ?? running.module };
    } else {
      const ctx = pending.get(path) ?? { perms: [] };
      pending.set(path, { perms: perms ? [...ctx.perms, perms] : ctx.perms, module: module ?? ctx.module });
    }
  }
}

let cache: CatalogEntry[] | null = null;

/** Every endpoint under /api, read from the live router (so new routes appear without changes here). */
export function apiCatalog(): CatalogEntry[] {
  if (cache) return cache;
  // Loaded lazily: the API router imports the MCP router.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { apiRoutes } = require('../../routes') as { apiRoutes: Router & { stack: Layer[] } };
  const out: CatalogEntry[] = [];
  walk(apiRoutes.stack, '', { perms: [] }, out);
  const seen = new Set<string>();
  cache = out
    .filter((e) => !isBlockedPath(e.path))
    .filter((e) => {
      const k = `${e.method} ${e.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return cache;
}

type CatalogUser = { role: string; permissions: string[] };

function allowedByTags(e: CatalogEntry, perms: string[]) {
  return e.permissions.every((t) => (t.all ?? []).every((p) => userHasPermission(perms, p)) && (!t.any?.length || t.any.some((p) => userHasPermission(perms, p))));
}

/**
 * Endpoints this user can plausibly call: their module is switched on, and the route's global permission
 * checks pass. Routes without a declared permission are shown when the user can open that module.
 * The API still decides every call, including project-level permissions.
 */
export async function catalogFor(user: CatalogUser): Promise<CatalogEntry[]> {
  const entries = apiCatalog();
  const modules = [...new Set(entries.map((e) => e.module).filter((m): m is ModuleId => Boolean(m)))];
  const enabled = new Map(await Promise.all(modules.map(async (m) => [m, await isPlatformModuleEnabled(m)] as const)));
  const opens = (m: ModuleId) => canAny(user, ...(MODULE_ACCESS[m] ?? []));
  return entries.filter((e) => {
    if (e.module && enabled.get(e.module) === false) return false;
    if (e.permissions.length) return allowedByTags(e, user.permissions);
    // Project work is granted per project (membership), not by a global permission, and those routes
    // check project permissions on every call — so they stay listed whenever the module is on.
    return !e.module || e.module === 'pm' || opens(e.module);
  });
}

/** Turns /crm/deals/:id into a matcher, to look an incoming path up in the catalog. */
export function matchEntry(entries: CatalogEntry[], method: string, path: string) {
  return entries.find((e) => {
    if (e.method !== method) return false;
    const re = new RegExp(`^${e.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+')}/?$`);
    return re.test(path);
  });
}
