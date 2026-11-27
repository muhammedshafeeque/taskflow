import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi, type CrmStageRules } from '../../lib/api';
import { btnPrimary, errorOf } from './crmKit';

type Flow = CrmStageRules['leads'];

/** Stage rules (AUT-32): may leads and deals skip stages or move back? Lost and unqualified always need a reason. */
export default function StageRulesSection({ onError }: { onError: (m: string) => void }) {
  const { token } = useAuth();
  const [leads, setLeads] = useState<Flow | null>(null);
  const [deals, setDeals] = useState<Flow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    void crmApi.stageRules(token).then((r) => {
      if (!r.success || !r.data) return onError(errorOf(r, 'Could not load stage rules.'));
      setLeads(r.data.leads);
      setDeals(r.data.deals);
    });
  }, [token, onError]);

  if (!leads || !deals) return null;

  const group = (title: string, value: Flow, set: (f: Flow) => void, hint: string) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-[color:var(--text-muted)]">{hint}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.allowSkip} onChange={(e) => set({ ...value, allowSkip: e.target.checked })} />
        Allow skipping stages
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.allowBack} onChange={(e) => set({ ...value, allowBack: e.target.checked })} />
        Allow moving back to an earlier stage, or reopening
      </label>
    </fieldset>
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Stage rules</h2>
        <p className="text-xs text-[color:var(--text-muted)]">
          How leads and deals move through their stages. Closing is always allowed from an open stage, and lost deals and unqualified leads always need a reason.
        </p>
      </div>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 grid gap-5 sm:grid-cols-2">
        {group('Leads', leads, setLeads, 'New, Contacted, Discovery, Qualified, Proposal requested. Nurturing can be used at any point.')}
        {group('Deals', deals, setDeals, 'The open stages of each pipeline, in order.')}
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={async () => {
              if (!token) return;
              setSaving(true);
              setSaved(false);
              const r = await crmApi.saveStageRules({ leads, deals }, token);
              setSaving(false);
              if (!r.success) return onError(errorOf(r, 'Could not save stage rules.'));
              setSaved(true);
            }}
          >
            Save stage rules
          </button>
          {saved && <span className="text-xs text-emerald-500">Saved</span>}
        </div>
      </div>
    </section>
  );
}
