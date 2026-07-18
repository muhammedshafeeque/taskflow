import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmAccount, type CrmDeal, type CrmPipeline } from '../../lib/api';

function accountLabel(ref: CrmDeal['accountId']): string {
  if (!ref) return '—';
  if (typeof ref === 'string') return ref;
  return ref.name;
}

export default function CrmDeals() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.deal.create');
  const [pipeline, setPipeline] = useState<CrmPipeline | null>(null);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [wizardDeal, setWizardDeal] = useState<CrmDeal | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    accountId: '',
    value: 0,
    expectedCloseDate: '',
    stageId: '',
  });

  const load = async () => {
    if (!token) return;
    const [pRes, dRes, aRes] = await Promise.all([
      crmApi.listPipelines(token),
      crmApi.listDeals(token),
      crmApi.listAccounts(token),
    ]);
    if (pRes.success && pRes.data) {
      const pipes = pRes.data as CrmPipeline[];
      const pipe = pipes.find((p) => p.isDefault) ?? pipes[0] ?? null;
      setPipeline(pipe);
      if (pipe?.stages?.length && !form.stageId) {
        const first = [...pipe.stages].sort((a, b) => a.order - b.order)[0];
        setForm((f) => ({ ...f, stageId: first._id }));
      }
    }
    if (dRes.success && dRes.data) setDeals(dRes.data as CrmDeal[]);
    if (aRes.success && aRes.data) setAccounts((aRes.data as { data: CrmAccount[] }).data ?? []);
  };

  useEffect(() => {
    void load();
  }, [token]);

  const dealsByStage = (stageId: string) => deals.filter((d) => d.stageId === stageId && d.status !== 'lost');

  const moveDeal = async (dealId: string, stageId: string) => {
    if (!token) return;
    await crmApi.moveDealStage(dealId, stageId, token);
    load();
  };

  const createProject = async () => {
    if (!token || !wizardDeal || !projectName.trim() || !projectKey.trim()) return;
    await crmApi.createProjectFromDeal(
      wizardDeal._id,
      { name: projectName.trim(), key: projectKey.trim().toUpperCase() },
      token
    );
    setWizardDeal(null);
    setProjectName('');
    setProjectKey('');
    load();
  };

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !pipeline || !form.title.trim() || !form.accountId || !form.stageId) return;
    await crmApi.createDeal(
      {
        title: form.title.trim(),
        accountId: form.accountId,
        pipelineId: pipeline._id,
        stageId: form.stageId,
        value: Number(form.value) || 0,
        expectedCloseDate: form.expectedCloseDate || undefined,
        probability: pipeline.stages.find((s) => s._id === form.stageId)?.probability ?? 0,
      },
      token
    );
    setCreateOpen(false);
    setForm({ title: '', accountId: accounts[0]?._id ?? '', value: 0, expectedCloseDate: '', stageId: form.stageId });
    load();
  }

  if (!pipeline) return <div className="p-8 text-[color:var(--text-muted)]">Loading pipeline…</div>;

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Deals pipeline</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">{pipeline.name}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-primary px-4 py-2 rounded-lg text-sm"
            onClick={() => {
              setForm((f) => ({ ...f, accountId: accounts[0]?._id ?? '', title: '', value: 0 }));
              setCreateOpen(true);
            }}
            disabled={accounts.length === 0}
          >
            Add deal
          </button>
        )}
      </div>
      {accounts.length === 0 && (
        <p className="text-sm text-amber-400 mb-4">Create an account before adding deals.</p>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[...pipeline.stages]
          .sort((a, b) => a.order - b.order)
          .map((stage) => (
            <div key={stage._id} className="min-w-[240px] rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-3">
              <h3 className="font-medium text-sm mb-2 flex justify-between gap-2">
                <span>{stage.name}</span>
                <span className="text-[color:var(--text-muted)]">{stage.probability}%</span>
              </h3>
              <div className="space-y-2">
                {dealsByStage(stage._id).map((deal) => (
                  <div key={deal._id} className="rounded-lg border border-[color:var(--border-subtle)] p-3 text-sm bg-[color:var(--bg-page)]">
                    <p className="font-medium">{deal.title}</p>
                    <p className="text-[color:var(--text-muted)] text-xs">{accountLabel(deal.accountId)}</p>
                    <p className="text-[color:var(--text-muted)]">${(deal.value ?? 0).toLocaleString()} · {deal.status}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {pipeline.stages
                        .filter((s) => s._id !== stage._id)
                        .map((s) => (
                          <button
                            key={s._id}
                            type="button"
                            onClick={() => moveDeal(deal._id, s._id)}
                            className="text-[10px] px-2 py-0.5 rounded bg-[color:var(--accent)]/15 text-[color:var(--accent)]"
                          >
                            → {s.name}
                          </button>
                        ))}
                      {(stage.isWon || deal.status === 'won') && (
                        <button
                          type="button"
                          onClick={() => setWizardDeal(deal)}
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300"
                        >
                          Create project
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>

      {createOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCreateOpen(false)}>
          <form onSubmit={createDeal} className="rounded-2xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">New deal</h2>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Title</span>
              <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Account</span>
              <select required value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Value</span>
                <input type="number" min={0} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Close date</span>
                <input type="date" value={form.expectedCloseDate} onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Stage</span>
              <select value={form.stageId} onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {[...pipeline.stages].sort((a, b) => a.order - b.order).map((s) => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Create</button>
            </div>
          </form>
        </div>
      )}

      {wizardDeal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-6 max-w-md w-full">
            <h2 className="font-semibold mb-4">Create project from deal</h2>
            <p className="text-sm text-[color:var(--text-muted)] mb-4">{wizardDeal.title}</p>
            <input className="w-full mb-2 rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-sm" placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            <input className="w-full mb-4 rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-sm" placeholder="Project key (e.g. ACME)" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setWizardDeal(null)} className="px-4 py-2 text-sm">Cancel</button>
              <button type="button" onClick={createProject} className="btn-primary px-4 py-2 rounded-lg text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
