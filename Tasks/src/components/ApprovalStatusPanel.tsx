import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { approvalsApi, type ApprovalRecordStatus, type ApprovalRecordType } from '../lib/api';

const STEP_DOT: Record<string, string> = {
  approved: 'bg-emerald-500 border-emerald-500',
  rejected: 'bg-rose-500 border-rose-500',
  pending: 'bg-amber-400 border-amber-400 ring-2 ring-amber-200/60',
  skipped: 'bg-slate-300 border-slate-300',
  waiting: 'bg-transparent border-slate-400',
};

const HEADLINE: Record<string, { text: string; tone: string }> = {
  pending: { text: 'Waiting for approval', tone: 'border-amber-500/40 bg-amber-500/5' },
  approved: { text: 'Approved', tone: 'border-emerald-500/40 bg-emerald-500/5' },
  rejected: { text: 'Rejected', tone: 'border-rose-500/40 bg-rose-500/5' },
  cancelled: { text: 'Approval cancelled', tone: 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]' },
};

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '');

/**
 * Where a record stands in its approval chain, for the record's own page. Shows nothing while the
 * record type's chain is off and no request was ever made. `refreshKey` reloads it after an action.
 */
export default function ApprovalStatusPanel({
  recordType,
  recordId,
  refreshKey,
  actionLabel,
}: {
  recordType: ApprovalRecordType;
  recordId: string;
  refreshKey?: unknown;
  /** What the approval unlocks, e.g. "send this invoice". */
  actionLabel?: string;
}) {
  const { token } = useAuth();
  const [data, setData] = useState<ApprovalRecordStatus | null>(null);

  useEffect(() => {
    if (!token || !recordId) return;
    let live = true;
    approvalsApi.recordStatus(recordType, recordId, token).then((r) => {
      if (live && r.success && r.data) setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [token, recordType, recordId, refreshKey]);

  if (!data || (!data.request && !data.chainEnabled)) return null;
  const req = data.request;

  if (!req) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] px-4 py-3 text-[13px] text-[color:var(--text-muted)]">
        An approval chain is on for this record type.{actionLabel ? ` The first time you ${actionLabel}, it is sent for approval.` : ''}
      </div>
    );
  }

  const head = HEADLINE[req.status] ?? HEADLINE.pending;
  const current = req.status === 'pending' ? req.steps[req.currentStep] : undefined;

  return (
    <section className={`rounded-xl border px-4 py-3 ${head.tone}`} aria-label="Approval status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{head.text}</p>
          <p className="text-[12px] text-[color:var(--text-muted)]">
            Asked by {req.requestedBy || 'someone'} on {fmt(req.createdAt)}
            {req.completedAt ? ` · finished ${fmt(req.completedAt)}` : ''}
            {current ? ` · now with ${current.approvers.length ? current.approvers.join(', ') : 'the approvers'} (${current.name})` : ''}
          </p>
        </div>
        <Link
          to={`/approvals?request=${req._id}`}
          className={req.canDecide ? 'btn-primary rounded-lg px-3 py-1.5 text-sm' : 'text-sm text-[color:var(--accent)] hover:underline'}
        >
          {req.canDecide ? 'Review and decide' : 'Open in Approvals'}
        </Link>
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
        {req.steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-4 bg-[color:var(--border-subtle)]" aria-hidden />}
            <span className={`h-2.5 w-2.5 rounded-full border ${STEP_DOT[s.status] ?? STEP_DOT.waiting}`} aria-hidden />
            <span className={s.status === 'pending' ? 'font-medium' : 'text-[color:var(--text-muted)]'}>
              {s.name}
              <span className="sr-only">: {s.status}</span>
              {s.decidedBy ? ` · ${s.decidedBy}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
