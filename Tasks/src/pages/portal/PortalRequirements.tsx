import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { customerRequirementsApi, type CustomerChangeView, type CustomerRequirementView } from '../../lib/api';
import { userHasPermission } from '../../utils/permissions';
import { CUSTOMER_PERMISSIONS } from '@shared/constants/permissions';

const projectName = (p: CustomerRequirementView['project']) => (typeof p === 'object' ? p.name ?? '' : '');
const day = (v?: string) => (v ? new Date(v).toLocaleDateString() : '');
const card = 'rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2';
const input = 'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm';

/** Portal: sign off requirement versions and approve change requests (AUT-44). */
export default function PortalRequirements() {
  const { token, user } = useAuth();
  const canApprove = userHasPermission(user?.customerPermissions ?? [], CUSTOMER_PERMISSIONS.REQUIREMENT.REQUIREMENT.APPROVE) || Boolean(user?.isOrgAdmin);
  const [reqs, setReqs] = useState<CustomerRequirementView[] | null>(null);
  const [changes, setChanges] = useState<CustomerChangeView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    void customerRequirementsApi.list(token).then((r) => (r.success ? setReqs(r.data ?? []) : setError(r.message ?? 'Could not load requirements')));
    void customerRequirementsApi.changes(token).then((r) => setChanges(r.success ? (r.data ?? []) : []));
  }, [token]);

  const waitingReqs = (reqs ?? []).filter((r) => r.awaitingSignOff);
  const waitingChanges = (changes ?? []).filter((c) => c.waitingForYou);

  return (
    <div className="p-4 md:p-8 animate-fade-in space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Requirements and changes</h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">Sign off the requirements we've written for your projects, and approve or reject changes with their cost and date impact.</p>
      </div>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
      {reqs === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Waiting for your sign-off ({waitingReqs.length})</h2>
            {waitingReqs.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">Nothing to sign off.</p>}
            {waitingReqs.map((r) => (
              <RequirementCard key={r._id} requirement={r} canApprove={canApprove} onChange={(n) => setReqs((list) => (list ?? []).map((x) => (x._id === n._id ? n : x)))} />
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Changes waiting for your approval ({waitingChanges.length})</h2>
            {waitingChanges.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No changes to approve.</p>}
            {waitingChanges.map((c) => (
              <ChangeCard key={c._id} change={c} canApprove={canApprove} onChange={(n) => setChanges((list) => (list ?? []).map((x) => (x._id === n._id ? n : x)))} />
            ))}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">History</h2>
            {(reqs ?? []).filter((r) => !r.awaitingSignOff).map((r) => {
              const v = r.versions[r.versions.length - 1];
              return (
                <p key={r._id} className="text-xs">
                  <strong>{r.key}</strong> {r.title} · version {v?.version} {v?.signOff ? `${v.signOff.decision === 'signed' ? 'signed off' : 'rejected'} by ${v.signOff.name ?? ''} on ${day(v.signOff.at)}` : ''}
                </p>
              );
            })}
            {(changes ?? []).filter((c) => !c.waitingForYou).map((c) => (
              <p key={c._id} className="text-xs">
                <strong>{c.key}</strong> {c.title} · {c.yourDecision ? `${c.yourDecision.status} by ${c.yourDecision.name ?? ''} on ${day(c.yourDecision.at)}` : c.status}
              </p>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function RequirementCard({ requirement: r, canApprove, onChange }: { requirement: CustomerRequirementView; canApprove: boolean; onChange: (r: CustomerRequirementView) => void }) {
  const { token } = useAuth();
  const v = r.versions[r.versions.length - 1]!;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (decision: 'sign' | 'reject') => {
    setBusy(true);
    setError('');
    const res = await customerRequirementsApi.signOff(r._id, { decision, name, note, version: v.version }, token!);
    setBusy(false);
    if (!res.success || !res.data) return setError(res.message ?? 'Could not save your answer');
    onChange(res.data);
  };
  return (
    <div className={card} data-testid="portal-requirement">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{r.key}</strong>
        <span>{r.title}</span>
        <span className="ml-auto text-xs text-[color:var(--text-muted)]">{projectName(r.project)} · version {v.version}, sent {day(v.sentAt)}</span>
      </div>
      {v.summary && <p className="text-xs text-[color:var(--text-muted)]">{v.summary}</p>}
      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[color:var(--bg-page)] p-3 text-sm">{v.content}</div>
      {canApprove ? (
        <div className="space-y-2">
          <input className={input} placeholder="Type your full name to sign" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className={input} rows={2} placeholder="Comments (required if you reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !name.trim()} onClick={() => answer('sign')} className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Sign off</button>
            <button type="button" disabled={busy || !name.trim() || !note.trim()} onClick={() => answer('reject')} className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-50">Reject</button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-[color:var(--text-muted)]">Someone in your organisation with approval rights can sign this off.</p>
      )}
    </div>
  );
}

function ChangeCard({ change: c, canApprove, onChange }: { change: CustomerChangeView; canApprove: boolean; onChange: (c: CustomerChangeView) => void }) {
  const { token } = useAuth();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError('');
    const res = await customerRequirementsApi.decideChange(c._id, { decision, note }, token!);
    setBusy(false);
    if (!res.success || !res.data) return setError(res.message ?? 'Could not save your answer');
    onChange(res.data);
  };
  return (
    <div className={card} data-testid="portal-change">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{c.key}</strong>
        <span>{c.title}</span>
        <span className="ml-auto text-xs text-[color:var(--text-muted)]">{projectName(c.project)}{c.requirement ? ` · changes ${c.requirement.key}` : ''}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-[color:var(--bg-page)] p-2"><span className="block text-[11px] text-[color:var(--text-muted)]">Cost impact</span>{c.currency} {c.costImpact.toLocaleString()}</div>
        <div className="rounded-lg bg-[color:var(--bg-page)] p-2"><span className="block text-[11px] text-[color:var(--text-muted)]">Date impact</span>{c.scheduleImpactDays === 0 ? 'No change' : `${c.scheduleImpactDays > 0 ? '+' : ''}${c.scheduleImpactDays} day(s)`}</div>
      </div>
      <p className="whitespace-pre-wrap text-sm">{c.description}</p>
      {canApprove ? (
        <div className="space-y-2">
          <textarea className={input} rows={2} placeholder="Comments (required if you reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => answer('approve')} className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Approve change</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => answer('reject')} className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-50">Reject</button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-[color:var(--text-muted)]">Someone in your organisation with approval rights can approve this.</p>
      )}
    </div>
  );
}
