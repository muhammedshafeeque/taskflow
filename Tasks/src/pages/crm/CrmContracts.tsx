import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmAccount, type CrmContract } from '../../lib/api';

export default function CrmContracts() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.contract.create');
  const canUpdate = canAny(user, 'taskflow.crm.contract.update');
  const [rows, setRows] = useState<CrmContract[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [modal, setModal] = useState(false);
  const [burn, setBurn] = useState<{ hoursUsed: number; hoursRemaining: number; percentUsed: number } | null>(null);
  const [form, setForm] = useState({
    accountId: '',
    title: '',
    kind: 'retainer' as 'msa' | 'retainer' | 'amc' | 'other',
    value: 0,
    currency: 'USD',
    billingCycle: 'monthly',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    renewalDate: '',
    hoursIncluded: 0,
    status: 'active',
    notes: '',
  });

  const load = () => {
    if (!token) return;
    crmApi.listContracts(token).then((res) => {
      if (res.success && res.data) setRows(res.data as CrmContract[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    crmApi.listAccounts(token).then((res) => {
      if (res.success && res.data) setAccounts((res.data as { data: CrmAccount[] }).data ?? []);
    });
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.accountId || !form.title.trim()) return;
    await crmApi.createContract(
      {
        accountId: form.accountId,
        title: form.title.trim(),
        kind: form.kind,
        value: Number(form.value) || 0,
        currency: form.currency,
        billingCycle: form.billingCycle,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        renewalDate: form.renewalDate || form.endDate || undefined,
        hoursIncluded: form.hoursIncluded || undefined,
        status: form.status,
        notes: form.notes.trim() || undefined,
      },
      token
    );
    setModal(false);
    load();
  }

  async function activate(id: string) {
    if (!token || !canUpdate) return;
    await crmApi.updateContract(id, { status: 'active' }, token);
    load();
  }

  async function showBurn(id: string) {
    if (!token) return;
    const res = await crmApi.getContractBurnDown(id, token);
    if (res.success && res.data) setBurn(res.data as typeof burn);
  }

  const accountName = (id: CrmContract['accountId']) => {
    if (id && typeof id === 'object') return id.name;
    return accounts.find((a) => a._id === id)?.name ?? String(id);
  };

  const accountLinkId = (id: CrmContract['accountId']) =>
    id && typeof id === 'object' ? id._id : String(id);

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">CRM Contracts</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Retainers and account agreements with hour burn-down.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-primary px-4 py-2 rounded-lg text-sm"
            disabled={accounts.length === 0}
            onClick={() => {
              setForm((f) => ({ ...f, accountId: accounts[0]?._id ?? '', title: '' }));
              setModal(true);
            }}
          >
            Add contract
          </button>
        )}
      </div>
      {burn && (
        <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 text-sm flex justify-between">
          <span>
            Hours used {burn.hoursUsed.toFixed(1)} · remaining {burn.hoursRemaining.toFixed(1)} ({burn.percentUsed}%)
          </span>
          <button type="button" className="text-xs text-[color:var(--text-muted)]" onClick={() => setBurn(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex flex-wrap justify-between gap-3">
            <div>
              <p className="font-medium">{c.title}</p>
              <p className="text-sm text-[color:var(--text-muted)]">
                <Link to={`/crm/accounts/${accountLinkId(c.accountId)}`} className="text-[color:var(--accent)] hover:underline">
                  {accountName(c.accountId)}
                </Link>
                {' '}· {c.kind ?? 'other'} · {c.status} · ${c.value} {c.currency}
                {c.hoursIncluded != null ? ` · ${c.hoursIncluded}h included` : ''}
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              {c.hoursIncluded != null && (
                <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => void showBurn(c._id)}>
                  Burn-down
                </button>
              )}
              {c.status === 'draft' && canUpdate && (
                <button type="button" className="text-emerald-400 hover:underline" onClick={() => void activate(c._id)}>
                  Activate
                </button>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No contracts yet.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form onSubmit={create} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">New contract</h2>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Account</span>
              <select required value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Title</span>
              <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Kind</span>
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof f.kind }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                  <option value="msa">MSA</option>
                  <option value="retainer">Retainer</option>
                  <option value="amc">AMC</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Renewal</span>
                <input type="date" value={form.renewalDate} onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Value</span>
                <input type="number" min={0} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Hours included</span>
                <input type="number" min={0} value={form.hoursIncluded} onChange={(e) => setForm((f) => ({ ...f, hoursIncluded: Number(e.target.value) }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Start</span>
                <input type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">End</span>
                <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Create</button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
