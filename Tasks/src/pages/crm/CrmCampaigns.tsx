import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiSearch } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmCampaign } from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Chip,
  CrmShell,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  RowMenu,
  Segmented,
  Stat,
  btnPrimary,
  btnSecondary,
  errorOf,
  fmtDate,
  inputCls,
  prettyLabel,
  toDateInput,
} from './crmKit';

const TYPES = ['inbound', 'outbound', 'event', 'partner', 'other'] as const;
const STATUSES = ['draft', 'active', 'paused', 'completed'] as const;
const STATUS_TONE: Record<string, 'good' | 'neutral' | 'warn' | 'info'> = { active: 'good', draft: 'neutral', paused: 'warn', completed: 'info' };

type Form = { name: string; code: string; type: string; status: string; channel: string; utmCampaign: string; startsAt: string; endsAt: string };

export default function CrmCampaigns() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.campaign.create');
  const canUpdate = canAny(user, 'taskflow.crm.campaign.update');
  const canDelete = canAny(user, 'taskflow.crm.campaign.delete');
  const [rows, setRows] = useState<CrmCampaign[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<{ editing: CrmCampaign | null } | null>(null);
  const [deleting, setDeleting] = useState<CrmCampaign | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    crmApi.listCampaigns(token, { search: search || undefined }).then((res) => {
      if (stale) return;
      if (res.success && res.data) setRows(res.data);
      else setNotice(errorOf(res, 'Could not load campaigns.'));
    });
    return () => {
      stale = true;
    };
  }, [token, search, tick]);

  const all = rows ?? [];
  const shown = status ? all.filter((c) => c.status === status) : all;
  const leads = all.reduce((s, c) => s + (c.leadCount ?? 0), 0);
  const converted = all.reduce((s, c) => s + (c.convertedCount ?? 0), 0);
  const best = [...all].filter((c) => (c.leadCount ?? 0) >= 3).sort((a, b) => rate(b) - rate(a))[0];

  async function run(fn: () => Promise<{ success: boolean }>, fallback: string) {
    const res = await fn();
    if (!res.success) setNotice(errorOf(res, fallback));
    load();
  }

  return (
    <CrmShell
      title="Campaigns"
      description="Attribute leads to campaigns and see which ones convert."
      actions={
        canCreate && (
          <button type="button" className={btnPrimary} onClick={() => setModal({ editing: null })}>
            <FiPlus /> New campaign
          </button>
        )
      }
    >
      <Notice message={notice} onClose={() => setNotice(null)} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Active campaigns" value={all.filter((c) => c.status === 'active').length} hint={`${all.length} total`} />
        <Stat label="Attributed leads" value={leads} />
        <Stat label="Conversion" value={`${leads ? Math.round((converted / leads) * 100) : 0}%`} hint={`${converted} converted`} tone="good" />
        <Stat label="Best campaign" value={best ? best.name : '—'} hint={best ? `${Math.round(rate(best))}% conversion` : 'Needs 3+ leads'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<string>
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All', count: all.length },
            ...STATUSES.map((s) => ({ value: s, label: prettyLabel(s), count: all.filter((c) => c.status === s).length })),
          ]}
        />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" className={`${inputCls} pl-9`} />
        </div>
      </div>

      {!rows ? (
        <LoadingBlock label="Loading campaigns…" />
      ) : shown.length === 0 ? (
        <EmptyState title="No campaigns here">{all.length ? 'Try another filter.' : 'Create one to start attributing leads.'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left border-b border-[color:var(--border-subtle)]">
                <th className="py-2.5 px-4 font-medium">Campaign</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium text-right">Leads</th>
                <th className="py-2.5 px-3 font-medium w-48">Conversion</th>
                <th className="py-2.5 px-3 font-medium hidden md:table-cell">Dates</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border-subtle)]">
              {shown.map((c) => (
                <tr key={c._id} className="hover:bg-[color:var(--bg-elevated)]/60">
                  <td className="py-2.5 px-4">
                    <Link to={`/crm/campaigns/${c._id}`} className="font-medium hover:text-[color:var(--accent)]">
                      {c.name}
                    </Link>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">
                      <span className="font-mono">{c.code}</span> · {prettyLabel(c.type)}
                      {c.channel ? ` · ${c.channel}` : ''}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <Chip tone={STATUS_TONE[c.status] ?? 'neutral'}>{prettyLabel(c.status)}</Chip>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{c.leadCount ?? 0}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rate(c)}%` }} />
                      </div>
                      <span className="text-xs tabular-nums w-16 text-right">
                        {c.convertedCount ?? 0} · {Math.round(rate(c))}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-[color:var(--text-muted)] hidden md:table-cell">
                    {c.startsAt || c.endsAt ? `${fmtDate(c.startsAt)} → ${c.endsAt ? fmtDate(c.endsAt) : 'ongoing'}` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <RowMenu
                      onEdit={canUpdate ? () => setModal({ editing: c }) : undefined}
                      onDelete={canDelete && !c.leadCount ? () => setDeleting(c) : undefined}
                      extra={
                        canUpdate
                          ? STATUSES.filter((s) => s !== c.status && s !== 'draft').map((s) => ({
                              label: s === 'active' ? 'Activate' : s === 'paused' ? 'Pause' : 'Complete',
                              onClick: () => void run(() => crmApi.updateCampaign(c._id, { status: s }, token!), 'Could not update the campaign.'),
                            }))
                          : []
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CampaignModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        title="Delete campaign?"
        message={`“${deleting?.name ?? ''}” will be removed permanently. (Campaigns with leads can only be paused.)`}
        confirmLabel="Delete campaign"
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void run(() => crmApi.deleteCampaign(target._id, token!), 'Could not delete the campaign.');
        }}
        onCancel={() => setDeleting(null)}
      />
    </CrmShell>
  );
}

function rate(c: CrmCampaign) {
  return c.leadCount ? ((c.convertedCount ?? 0) / c.leadCount) * 100 : 0;
}

function CampaignModal({ editing, onClose, onSaved }: { editing: CrmCampaign | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [form, setForm] = useState<Form>({
    name: editing?.name ?? '',
    code: editing?.code ?? '',
    type: editing?.type ?? 'inbound',
    status: editing?.status ?? 'active',
    channel: editing?.channel ?? '',
    utmCampaign: editing?.utmCampaign ?? '',
    startsAt: toDateInput(editing?.startsAt),
    endsAt: toDateInput(editing?.endsAt),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim()) return;
    setSaving(true);
    const body = {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      type: form.type,
      status: form.status,
      channel: form.channel.trim() || undefined,
      utmCampaign: form.utmCampaign.trim() || undefined,
      startsAt: form.startsAt || undefined,
      endsAt: form.endsAt || undefined,
    };
    const res = editing ? await crmApi.updateCampaign(editing._id, body, token) : await crmApi.createCampaign(body, token);
    setSaving(false);
    if (!res.success) return setError(errorOf(res, 'Could not save the campaign.'));
    onSaved();
  }

  return (
    <Modal open title={editing ? 'Edit campaign' : 'New campaign'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" className="col-span-2">
            <input required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Code">
            <input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="Auto" className={`${inputCls} font-mono`} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select value={form.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {prettyLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {prettyLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <input value={form.channel} onChange={(e) => set({ channel: e.target.value })} placeholder="Webinar, ads, partner…" className={inputCls} />
          </Field>
          <Field label="UTM campaign">
            <input value={form.utmCampaign} onChange={(e) => set({ utmCampaign: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Starts">
            <input type="date" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Ends">
            <input type="date" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} className={inputCls} />
          </Field>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
