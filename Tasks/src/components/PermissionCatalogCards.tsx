import { useMemo, useState } from 'react';
import type { PermissionItem } from '../lib/api';
import { ChevronDownIcon, ChevronUpIcon } from './icons/NavigationIcons';

export type PermSource = 'role' | 'granted' | 'revoked' | 'none';

function titleCase(s: string): string {
  return s
    .split(/[_-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Resource path under a module, e.g. taskflow.accounts.invoice.list → Invoice */
export function permissionResourceLabel(code: string): string {
  const parts = code.split('.');
  if (parts.length < 2) return code;
  const resourceParts = parts.slice(0, -1).filter((p) => p !== 'taskflow');
  if (resourceParts.length === 0) return 'General';
  const withoutModule =
    resourceParts.length > 1 ? resourceParts.slice(1) : resourceParts;
  return withoutModule.map(titleCase).join(' · ') || 'General';
}

export function permissionActionLabel(perm: PermissionItem): string {
  const parts = perm.code.split('.');
  const action = parts[parts.length - 1] ?? '';
  const actionLabels: Record<string, string> = {
    create: 'Create',
    read: 'Read',
    update: 'Update',
    delete: 'Delete',
    list: 'List',
    manage: 'Manage',
    view: 'View',
  };
  return actionLabels[action] ?? (titleCase(action) || perm.label);
}

export type PermissionModuleGroup = {
  module: string;
  resources: { resource: string; perms: PermissionItem[] }[];
};

export function groupPermissionsByModule(
  permissions: PermissionItem[]
): PermissionModuleGroup[] {
  const map = new Map<string, Map<string, PermissionItem[]>>();
  for (const p of permissions) {
    const module = p.group ?? 'Other';
    const resource = permissionResourceLabel(p.code);
    if (!map.has(module)) map.set(module, new Map());
    const resources = map.get(module)!;
    const list = resources.get(resource) ?? [];
    list.push(p);
    resources.set(resource, list);
  }
  return [...map.entries()]
    .map(([module, resources]) => ({
      module,
      resources: [...resources.entries()]
        .map(([resource, perms]) => ({
          resource,
          perms: [...perms].sort((a, b) => a.code.localeCompare(b.code)),
        }))
        .sort((a, b) => a.resource.localeCompare(b.resource)),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

function filterModules(
  modules: PermissionModuleGroup[],
  query: string
): PermissionModuleGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return modules;
  return modules
    .map((m) => {
      if (m.module.toLowerCase().includes(q)) return m;
      const resources = m.resources
        .map((r) => {
          if (r.resource.toLowerCase().includes(q)) return r;
          const perms = r.perms.filter(
            (p) =>
              p.code.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)
          );
          return perms.length ? { ...r, perms } : null;
        })
        .filter((r): r is NonNullable<typeof r> => r != null);
      return resources.length ? { ...m, resources } : null;
    })
    .filter((m): m is PermissionModuleGroup => m != null);
}

type PermissionCatalogCardsProps = {
  permissions: PermissionItem[];
  isChecked: (code: string) => boolean;
  onToggle: (code: string) => void;
  onToggleMany: (perms: PermissionItem[]) => void;
  getSource?: (code: string) => PermSource;
  showLegend?: boolean;
  filterPlaceholder?: string;
};

export function PermissionCatalogCards({
  permissions,
  isChecked,
  onToggle,
  onToggleMany,
  getSource,
  showLegend = false,
  filterPlaceholder = 'Filter modules or permissions…',
}: PermissionCatalogCardsProps) {
  const [moduleFilter, setModuleFilter] = useState('');
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  const permissionsByModule = useMemo(
    () => groupPermissionsByModule(permissions),
    [permissions]
  );
  const filteredModules = useMemo(
    () => filterModules(permissionsByModule, moduleFilter),
    [permissionsByModule, moduleFilter]
  );

  function toggleModuleCollapse(module: string) {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          placeholder={filterPlaceholder}
          className="w-full sm:max-w-sm px-3 py-2 rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
        />
        {showLegend && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-[color:var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[color:var(--border-subtle)]" />
              From role
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Extra grant
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Revoked
            </span>
          </div>
        )}
      </div>

      <div className="space-y-8">
        {filteredModules.map(({ module, resources }) => {
          const modulePerms = resources.flatMap((r) => r.perms);
          const selectedCount = modulePerms.filter((p) => isChecked(p.code)).length;
          const collapsed = collapsedModules.has(module);
          return (
            <section key={module} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] pb-2">
                <button
                  type="button"
                  onClick={() => toggleModuleCollapse(module)}
                  className="p-0.5 text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
                  title={collapsed ? 'Expand' : 'Collapse'}
                >
                  {collapsed ? (
                    <ChevronDownIcon className="w-4 h-4" />
                  ) : (
                    <ChevronUpIcon className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleMany(modulePerms)}
                  className="text-left text-base font-semibold text-[color:var(--text-primary)] hover:text-[color:var(--accent)]"
                  title="Toggle all in module"
                >
                  {module}
                </button>
                <span className="text-xs text-[color:var(--text-muted)]">
                  {selectedCount}/{modulePerms.length}
                </span>
              </div>

              {!collapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {resources.map(({ resource, perms }) => {
                    const resourceSelected = perms.filter((p) => isChecked(p.code)).length;
                    return (
                      <article
                        key={resource}
                        className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] flex flex-col min-h-0"
                      >
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[color:var(--border-subtle)]/70">
                          <h3 className="text-sm font-semibold text-[color:var(--text-primary)] truncate">
                            {resource}
                          </h3>
                          <button
                            type="button"
                            onClick={() => onToggleMany(perms)}
                            className="text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] shrink-0"
                            title="Toggle all in this resource"
                          >
                            {resourceSelected}/{perms.length}
                          </button>
                        </div>
                        <ul className="p-2 space-y-0.5 flex-1">
                          {perms.map((perm) => {
                            const checked = isChecked(perm.code);
                            const source = getSource?.(perm.code);
                            const sourceDot =
                              source === 'granted'
                                ? 'bg-emerald-500'
                                : source === 'revoked'
                                  ? 'bg-red-500'
                                  : source === 'role'
                                    ? 'bg-[color:var(--border-subtle)]'
                                    : 'bg-transparent';
                            return (
                              <li key={perm.code}>
                                <label
                                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                                    checked
                                      ? 'bg-[color:var(--bg-page)]/80'
                                      : 'hover:bg-[color:var(--bg-page)]/50'
                                  }`}
                                  title={perm.code}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => onToggle(perm.code)}
                                    className="w-4 h-4 shrink-0 rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)] focus:ring-[color:var(--accent)]/40"
                                  />
                                  <span className="flex-1 min-w-0">
                                    <span className="flex items-center gap-1.5">
                                      <span className="text-sm text-[color:var(--text-primary)]">
                                        {permissionActionLabel(perm)}
                                      </span>
                                      {getSource && (
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceDot}`}
                                          aria-hidden
                                        />
                                      )}
                                    </span>
                                    <span className="block text-[10px] text-[color:var(--text-muted)] font-mono truncate">
                                      {perm.code}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {filteredModules.length === 0 && (
          <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">
            No permissions match your filter.
          </p>
        )}
      </div>
    </div>
  );
}
