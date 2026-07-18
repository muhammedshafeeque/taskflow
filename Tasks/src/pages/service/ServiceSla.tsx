import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { serviceApi, type SlaPolicy } from '../../lib/api';
import { EmptyChart, Field, GhostButton, LoadingCard, Modal, ModuleHeader, PrimaryButton, StatusPill, TextInput } from '../../components/moduleKit';

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

type TargetForm = { priority: string; firstResponseMinutes: number; resolutionMinutes: number };

const DEFAULT_TARGETS: TargetForm[] = [
  { priority: 'urgent', firstResponseMinutes: 30, resolutionMinutes: 240 },
  { priority: 'high', firstResponseMinutes: 60, resolutionMinutes: 480 },
  { priority: 'medium', firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { priority: 'low', firstResponseMinutes: 480, resolutionMinutes: 2880 },
];

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round((m / 60) * 10) / 10}h`;
  return `${Math.round((m / 1440) * 10) / 10}d`;
}

export default function ServiceSla() {
  const { token } = useAuth();
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SlaPolicy | 'new' | null>(null);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [targets, setTargets] = useState<TargetForm[]>(DEFAULT_TARGETS);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    serviceApi.listSla(token).then((r) => { setLoading(false); if (r.success && r.data) setPolicies(r.data); });
  };
  useEffect(load, [token]);

  const openNew = () => {
    setName('');
    setEnabled(true);
    setTargets(DEFAULT_TARGETS);
    setEditing('new');
  };

  const openEdit = (p: SlaPolicy) => {
    setName(p.name);
    setEnabled(p.enabled);
    setTargets(PRIORITIES.map((pr) => {
      const t = p.targets?.find((x) => x.priority === pr);
      return { priority: pr, firstResponseMinutes: t?.firstResponseMinutes ?? 0, resolutionMinutes: t?.resolutionMinutes ?? 0 };
    }));
    setEditing(p);
  };

  const save = async () => {
    if (!token || !name.trim()) return;
    setSaving(true);
    const payload = { name: name.trim(), enabled, targets };
    const res = editing === 'new'
      ? await serviceApi.createSla(payload, token)
      : await serviceApi.updateSla((editing as SlaPolicy)._id, payload, token);
    setSaving(false);
    if (res.success) { setEditing(null); load(); }
  };

  const toggleEnabled = async (p: SlaPolicy) => {
    if (!token) return;
    await serviceApi.updateSla(p._id, { enabled: !p.enabled }, token);
    load();
  };

  if (loading) return <LoadingCard label="Loading SLA policies…" />;

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Service Desk"
        title="SLA policies"
        subtitle="Response and resolution targets applied to tickets. Customers on active contracts automatically inherit the linked policy."
        accent="#e11d48"
        actions={[
          { label: 'New policy', primary: true, onClick: openNew },
          { to: '/service/tickets', label: 'Tickets' },
        ]}
      />

      {policies.length === 0 ? (
        <EmptyChart label="No SLA policies yet. Create one to set response and resolution targets." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {policies.map((p) => (
            <div key={p._id} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <StatusPill label={p.enabled ? 'enabled' : 'disabled'} tone={p.enabled ? 'green' : 'slate'} />
                </div>
                <div className="flex gap-2">
                  <GhostButton onClick={() => toggleEnabled(p)} className="!py-1 !px-2 text-xs">{p.enabled ? 'Disable' : 'Enable'}</GhostButton>
                  <GhostButton onClick={() => openEdit(p)} className="!py-1 !px-2 text-xs">Edit</GhostButton>
                </div>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] text-left">
                    <th className="pb-1 font-medium">Priority</th>
                    <th className="pb-1 font-medium">First response</th>
                    <th className="pb-1 font-medium">Resolution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-subtle)]">
                  {PRIORITIES.map((pr) => {
                    const t = p.targets?.find((x) => x.priority === pr);
                    return (
                      <tr key={pr}>
                        <td className="py-1.5 capitalize">{pr}</td>
                        <td className="py-1.5">{t ? fmtMinutes(t.firstResponseMinutes) : '—'}</td>
                        <td className="py-1.5">{t ? fmtMinutes(t.resolutionMinutes) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'New SLA policy' : 'Edit SLA policy'}
          onClose={() => setEditing(null)}
          wide
          footer={<>
            <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save policy'}</PrimaryButton>
          </>}
        >
          <div className="space-y-4">
            <Field label="Policy name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Enterprise SLA" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Targets (minutes)</p>
              <div className="space-y-2">
                <div className="grid grid-cols-[80px_1fr_1fr] gap-2 text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                  <span>Priority</span><span>First response</span><span>Resolution</span>
                </div>
                {targets.map((t, i) => (
                  <div key={t.priority} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                    <span className="capitalize text-sm">{t.priority}</span>
                    <TextInput type="number" min={0} value={t.firstResponseMinutes}
                      onChange={(e) => setTargets((prev) => prev.map((x, j) => j === i ? { ...x, firstResponseMinutes: Number(e.target.value) } : x))} />
                    <TextInput type="number" min={0} value={t.resolutionMinutes}
                      onChange={(e) => setTargets((prev) => prev.map((x, j) => j === i ? { ...x, resolutionMinutes: Number(e.target.value) } : x))} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
