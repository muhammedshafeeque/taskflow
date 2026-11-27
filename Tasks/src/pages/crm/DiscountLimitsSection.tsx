import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi, type CrmDiscountPolicy } from '../../lib/api';
import { btnPrimary, btnSecondary, errorOf, inputCls } from './crmKit';

type Row<K extends string> = { [P in K]: string } & { maxPercent: string };

/**
 * Quotation discount limits (AUT-31): how far below list price people may quote before a quote needs
 * approval. A person gets the highest limit among their roles and level, else the default.
 */
export default function DiscountLimitsSection({ onError }: { onError: (m: string) => void }) {
  const { token } = useAuth();
  const [policy, setPolicy] = useState<CrmDiscountPolicy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [defaultMax, setDefaultMax] = useState('10');
  const [roles, setRoles] = useState<Array<Row<'roleId'>>>([]);
  const [levels, setLevels] = useState<Array<Row<'level'>>>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    void crmApi.discountPolicy(token).then((res) => {
      if (!res.success || !res.data) return onError(errorOf(res, 'Could not load discount limits.'));
      const p = res.data;
      setPolicy(p);
      setEnabled(p.enabled);
      setDefaultMax(String(p.defaultMaxPercent));
      setRoles(p.roleLimits.map((r) => ({ roleId: r.roleId, maxPercent: String(r.maxPercent) })));
      setLevels(p.levelLimits.map((l) => ({ level: l.level, maxPercent: String(l.maxPercent) })));
    });
  }, [token, onError]);

  if (!policy) return null;
  const roleOptions = policy.options?.roles ?? [];
  const levelOptions = policy.options?.levels ?? [];

  async function save() {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    const res = await crmApi.saveDiscountPolicy(
      {
        enabled,
        defaultMaxPercent: Number(defaultMax),
        roleLimits: roles.filter((r) => r.roleId).map((r) => ({ roleId: r.roleId, maxPercent: Number(r.maxPercent) })),
        levelLimits: levels.filter((l) => l.level).map((l) => ({ level: l.level, maxPercent: Number(l.maxPercent) })),
      },
      token
    );
    setSaving(false);
    if (!res.success) return onError(errorOf(res, 'Could not save discount limits.'));
    setSaved(true);
  }

  const pctInput = (value: string, onChange: (v: string) => void, label: string) => (
    <span className="inline-flex items-center gap-1">
      <input type="number" min={0} max={100} step={0.5} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} !w-24`} aria-label={label} />
      <span className="text-xs text-[color:var(--text-muted)]">%</span>
    </span>
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Quotation discount limits</h2>
        <p className="text-xs text-[color:var(--text-muted)]">
          How far below list price people may quote. A quotation above the sender's limit can't be sent or accepted until someone whose limit covers it approves.
          Each person gets the highest limit among their roles and level, or the default when none match.
        </p>
      </div>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Limit quotation discounts
        </label>
        <div className={enabled ? 'space-y-4' : 'space-y-4 opacity-50 pointer-events-none'} aria-disabled={!enabled}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-40">Default limit</span>
            {pctInput(defaultMax, setDefaultMax, 'Default limit')}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">By role</p>
            {roles.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3">
                <select className={`${inputCls} !w-56`} value={r.roleId} onChange={(e) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))} aria-label="Role">
                  <option value="">Choose a role…</option>
                  {roleOptions.map((o) => (
                    <option key={o._id} value={o._id}>{o.name}</option>
                  ))}
                </select>
                {pctInput(r.maxPercent, (v) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, maxPercent: v } : x))), 'Role limit')}
                <button type="button" className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10" aria-label="Remove role limit" onClick={() => setRoles((rs) => rs.filter((_, j) => j !== i))}>
                  <FiTrash2 />
                </button>
              </div>
            ))}
            <button type="button" className={btnSecondary} onClick={() => setRoles((rs) => [...rs, { roleId: '', maxPercent: defaultMax }])}>
              <FiPlus /> Add role limit
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">By employee level</p>
            {levels.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3">
                <select className={`${inputCls} !w-56`} value={l.level} onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))} aria-label="Level">
                  <option value="">Choose a level…</option>
                  {[...new Set([...levelOptions, ...(l.level ? [l.level] : [])])].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                {pctInput(l.maxPercent, (v) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, maxPercent: v } : x))), 'Level limit')}
                <button type="button" className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10" aria-label="Remove level limit" onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}>
                  <FiTrash2 />
                </button>
              </div>
            ))}
            <button type="button" className={btnSecondary} onClick={() => setLevels((ls) => [...ls, { level: '', maxPercent: defaultMax }])}>
              <FiPlus /> Add level limit
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            Save limits
          </button>
          {saved && <span className="text-xs text-emerald-500">Saved</span>}
        </div>
      </div>
    </section>
  );
}
