import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlatformModules } from '../../contexts/PlatformModulesContext';
import { canAny, TOGGLEABLE_MODULES, type ModuleId, type ToggleableModuleId } from '../../utils/moduleAccess';
import { coreApi } from '../../lib/api';

const MODULE_META: Record<ToggleableModuleId, { title: string; description: string }> = {
  pm: {
    title: 'Project Manager',
    description: 'Projects, issues, boards, sprints, and delivery.',
  },
  resources: {
    title: 'Resources',
    description: 'Allocations, utilization, bench, and staffing forecasts.',
  },
  crm: {
    title: 'CRM',
    description: 'Leads, accounts, contacts, deals, and quotes.',
  },
  contracts: {
    title: 'Contracts',
    description: 'MSAs, SLAs, retainers, and renewals.',
  },
  billing: {
    title: 'Billing',
    description: 'Time-to-invoice, subscriptions, and GST invoices.',
  },
  accounts: {
    title: 'Accounts',
    description: 'Ledger, expenses, cost report, and financials.',
  },
  hrms: {
    title: 'HRMS',
    description: 'Employees, attendance, leave, and payroll.',
  },
  assets: {
    title: 'Assets & CMDB',
    description: 'Inventory, servers, licenses, and warranty.',
  },
  procurement: {
    title: 'Procurement',
    description: 'Vendors, purchase orders, and license buys.',
  },
  service: {
    title: 'Service Desk',
    description: 'Tickets, SLA queues, knowledge base, and CSAT.',
  },
  'portal-admin': {
    title: 'Customer Portal (admin)',
    description: 'Customer orgs, portal users, and request approvals.',
  },
  mail: {
    title: 'Mail',
    description: 'Shared inboxes, compose, and CRM-linked email.',
  },
  calendar: {
    title: 'Calendar',
    description: 'Meetings, standups, demos, and reviews.',
  },
  documents: {
    title: 'Documents',
    description: 'Templates, proposals, SOWs, and policies.',
  },
};

export default function CoreModules() {
  const { user, token } = useAuth();
  const { enabledModules, refresh } = usePlatformModules();
  const canManage = canAny(user, 'taskflow.core.modules.manage');

  const [local, setLocal] = useState<Partial<Record<ModuleId, boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    coreApi
      .getModules(token)
      .then((res) => {
        if (res.success && res.data) setLocal(res.data);
        else setError((res as { message?: string }).message ?? 'Failed to load modules');
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (enabledModules) setLocal(enabledModules);
  }, [enabledModules]);

  async function toggle(id: ModuleId, next: boolean) {
    if (!token || !canManage) return;
    const prev = { ...local };
    setLocal((m) => ({ ...m, [id]: next }));
    setSaving(id);
    setError(null);
    const res = await coreApi.updateModules({ [id]: next }, token);
    setSaving(null);
    if (!res.success || !res.data) {
      setLocal(prev);
      setError((res as { message?: string }).message ?? 'Failed to update module');
      return;
    }
    setLocal(res.data);
    await refresh();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Modules</h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          Completely enable or disable product modules for the entire platform and all users. This is
          not permission configuration — a disabled module is unavailable everywhere.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      {!canManage && (
        <div className="mb-4 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
          You can view module status. Only users with module manage permission can change toggles.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          <span>Module</span>
          <span className="w-16 text-center">Enabled</span>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-[13px] text-[color:var(--text-muted)]">Loading…</div>
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {TOGGLEABLE_MODULES.map((id) => {
              const meta = MODULE_META[id];
              const on = local[id] !== false;
              const busy = saving === id;
              return (
                <li
                  key={id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-[color:var(--text-primary)]">
                      {meta.title}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
                      {meta.description}
                    </div>
                  </div>
                  <label className="relative inline-flex w-16 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={on}
                      disabled={!canManage || busy}
                      onChange={(e) => void toggle(id, e.target.checked)}
                    />
                    <span
                      className={`h-6 w-11 rounded-full transition ${
                        on ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--bg-elevated)] ring-1 ring-[color:var(--border-subtle)]'
                      } ${!canManage || busy ? 'opacity-50' : ''}`}
                    />
                    <span
                      className={`pointer-events-none absolute left-[calc(50%-1.1rem)] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition ${
                        on ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-4 text-[12px] text-[color:var(--text-muted)]">
        Core, Auth, and Inbox stay always on so administrators can sign in and re-enable modules.
      </p>
    </div>
  );
}
