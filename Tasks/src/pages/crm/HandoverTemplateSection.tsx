import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { handoverApi } from '../../lib/api';
import { btnPrimary, btnSecondary, errorOf, inputCls } from './crmKit';

type Item = { title: string; required: boolean };

/** The checklist every won deal's handover starts with (AUT-41). */
export default function HandoverTemplateSection({ onError }: { onError: (m: string) => void }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    void handoverApi.template(token).then((r) => {
      if (!r.success || !r.data) return onError(errorOf(r, 'Could not load the handover checklist.'));
      setItems(r.data.items);
    });
  }, [token, onError]);

  if (!items) return null;
  const change = (i: number, patch: Partial<Item>) => {
    setSaved(false);
    setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Handover checklist</h2>
        <p className="text-xs text-[color:var(--text-muted)]">
          When a deal is won, sales works through this list and sends it to the project manager, who accepts it or returns it. Required items must be done before it can be sent. Changes apply to deals won from now on.
        </p>
      </div>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={inputCls} value={it.title} aria-label={`Item ${i + 1}`} onChange={(e) => change(i, { title: e.target.value })} />
            <label className="flex shrink-0 items-center gap-1 text-xs">
              <input type="checkbox" checked={it.required} onChange={(e) => change(i, { required: e.target.checked })} /> Required
            </label>
            <button type="button" className="text-xs text-[color:var(--text-muted)] hover:text-rose-500" onClick={() => (setSaved(false), setItems(items.filter((_, j) => j !== i)))}>
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <button type="button" className={btnSecondary} onClick={() => (setSaved(false), setItems([...items, { title: '', required: true }]))}>
            Add item
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={async () => {
              if (!token) return;
              setSaving(true);
              const r = await handoverApi.saveTemplate(items.filter((it) => it.title.trim()), token);
              setSaving(false);
              if (!r.success || !r.data) return onError(errorOf(r, 'Could not save the handover checklist.'));
              setItems(r.data.items);
              setSaved(true);
            }}
          >
            Save checklist
          </button>
          {saved && <span className="text-xs text-emerald-500">Saved</span>}
        </div>
      </div>
    </section>
  );
}
