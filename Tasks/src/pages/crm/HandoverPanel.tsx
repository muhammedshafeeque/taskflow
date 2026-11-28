import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { handoverApi, type DealHandover } from '../../lib/api';
import { GhostButton, PrimaryButton, SectionPage, StatusPill, TextArea, TextInput } from '../../components/moduleKit';
import ProjectManagerPicker from './ProjectManagerPicker';

const TONE: Record<DealHandover['status'], 'amber' | 'blue' | 'green' | 'red' | 'slate'> = {
  open: 'amber',
  submitted: 'blue',
  returned: 'red',
  accepted: 'green',
  cancelled: 'slate',
};
const LABEL: Record<DealHandover['status'], string> = {
  open: 'in progress',
  submitted: 'with the project manager',
  returned: 'returned to sales',
  accepted: 'accepted',
  cancelled: 'cancelled',
};
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : v ? String(v) : '');
const refName = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name?: string }).name ?? '') : '');
const day = (v?: string) => (v ? new Date(v).toLocaleDateString() : '');

/**
 * The handover checklist (AUT-41). `mode="sales"` on the deal: tick items, write notes, choose the PM
 * and send it. `mode="pm"` for the project manager: read it, then accept it or return it with a note.
 */
export function HandoverChecklist({ handover, mode, onChange }: { handover: DealHandover; mode: 'sales' | 'pm'; onChange: (h: DealHandover) => void }) {
  const { token, user } = useAuth();
  const [notes, setNotes] = useState(handover.notes ?? '');
  const [newItem, setNewItem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const editable = mode === 'sales' && (handover.status === 'open' || handover.status === 'returned');
  const isPm = refId(handover.pmUserId) === user?.id;
  const required = handover.items.filter((i) => i.required);
  const missing = required.filter((i) => !i.done).length;

  const run = async (call: () => Promise<{ success: boolean; data?: DealHandover | null; message?: string }>, ok?: string) => {
    setBusy(true);
    const r = await call();
    setBusy(false);
    if (!r.success || !r.data) return setMessage({ ok: false, text: r.message ?? 'Could not save' });
    onChange(r.data);
    setMessage(ok ? { ok: true, text: ok } : null);
  };
  const dealId = refId(handover.dealId);
  const update = async (body: Record<string, unknown>, ok?: string) => {
    if (token) await run(() => handoverApi.update(dealId, body, token), ok);
  };

  return (
    <div className="space-y-3 text-sm" data-testid="handover">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={LABEL[handover.status]} tone={TONE[handover.status]} />
        <span className="text-xs text-[color:var(--text-muted)]">
          {required.length - missing} of {required.length} required items done
        </span>
      </div>

      {handover.status === 'returned' && handover.returnNote && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs">
          <strong>Returned by {refName(handover.returnedBy) || 'the project manager'}:</strong> {handover.returnNote}
        </p>
      )}
      {handover.status === 'accepted' && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs">
          Accepted by {refName(handover.acceptedBy) || 'the project manager'} on {day(handover.acceptedAt)}.{handover.returnNote ? ` ${handover.returnNote}` : ''}
        </p>
      )}
      {handover.status === 'cancelled' && <p className="text-xs text-[color:var(--text-muted)]">The deal is no longer won, so this handover does not apply. Winning it again reopens it.</p>}

      <ul className="space-y-1.5">
        {handover.items.map((item) => (
          <li key={item._id} className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={item.done}
                disabled={!editable || busy}
                onChange={(e) => void update({ items: [{ id: item._id, done: e.target.checked }] })}
              />
              <span className="flex-1">
                {item.title}
                {item.required ? <span className="text-rose-500" title="Required"> *</span> : null}
                {item.done && <span className="ml-2 text-[11px] text-[color:var(--text-muted)]">{refName(item.doneBy)} {day(item.doneAt)}</span>}
              </span>
              {editable && !item.required && (
                <button type="button" className="text-[11px] text-[color:var(--text-muted)] hover:text-rose-500" onClick={() => void update({ removeItemIds: [item._id] })}>
                  Remove
                </button>
              )}
            </label>
            {editable ? (
              <TextInput
                placeholder="Note or link (optional)"
                defaultValue={item.note ?? ''}
                onBlur={(e) => { if (e.target.value !== (item.note ?? '')) void update({ items: [{ id: item._id, note: e.target.value }] }); }}
              />
            ) : (
              item.note && <p className="mt-1 pl-6 text-xs text-[color:var(--text-muted)]">{item.note}</p>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <div className="flex gap-2">
          <TextInput placeholder="Add an item for this deal" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <GhostButton type="button" disabled={!newItem.trim() || busy} onClick={() => void update({ addItems: [newItem] }).then(() => setNewItem(''))}>
            Add
          </GhostButton>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium">Notes for delivery</p>
        {editable ? (
          <TextArea rows={4} placeholder="Scope, promises made, key contacts, risks…" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (handover.notes ?? '')) void update({ notes }); }} />
        ) : (
          <p className="whitespace-pre-wrap text-xs">{handover.notes || '—'}</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">Project manager</p>
        {editable ? (
          <ProjectManagerPicker value={refId(handover.pmUserId)} onChange={(pmUserId) => void update({ pmUserId })} />
        ) : (
          <p className="text-xs">{refName(handover.pmUserId) || '—'}</p>
        )}
      </div>

      {editable && (
        <PrimaryButton
          type="button"
          disabled={busy || missing > 0 || !refId(handover.pmUserId)}
          title={missing > 0 ? 'Complete the required items first' : !refId(handover.pmUserId) ? 'Choose the project manager first' : undefined}
          onClick={() => token && run(() => handoverApi.submit(dealId, token), 'Sent to the project manager.')}
        >
          Send to project manager
        </PrimaryButton>
      )}

      {mode === 'pm' && handover.status === 'submitted' && isPm && (
        <div className="space-y-2 rounded-lg border border-[color:var(--border-subtle)] p-3">
          <TextArea rows={2} placeholder="Note (required when returning: say what is missing)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <PrimaryButton type="button" disabled={busy} onClick={() => token && run(() => handoverApi.decide(handover._id, 'accept', note, token), 'Handover accepted.')}>
              Accept handover
            </PrimaryButton>
            <GhostButton type="button" disabled={busy || !note.trim()} onClick={() => token && run(() => handoverApi.decide(handover._id, 'return', note, token), 'Returned to sales.')}>
              Return to sales
            </GhostButton>
          </div>
        </div>
      )}
      {mode === 'pm' && handover.status === 'submitted' && !isPm && <p className="text-xs text-[color:var(--text-muted)]">Waiting for {refName(handover.pmUserId) || 'the project manager'} to accept it.</p>}

      {message && <p className={`text-xs ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  );
}

/** On the deal page: the handover of a won deal. */
export function DealHandoverPanel({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { token } = useAuth();
  const [h, setH] = useState<DealHandover | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    void handoverApi.forDeal(dealId, token).then((r) => setH(r.success ? (r.data ?? null) : null));
  }, [token, dealId]);
  if (!h) return null;
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-bold">Handover to delivery</h2>
      <HandoverChecklist handover={h} mode={canEdit ? 'sales' : 'pm'} onChange={setH} />
    </section>
  );
}

/** Handovers sent to me as project manager, and (for CRM users) every handover. */
export function HandoversPage() {
  const { token, user } = useAuth();
  const canSeeAll = canAny(user, 'taskflow.crm.deal.read', 'taskflow.crm.deal.list');
  const [mine, setMine] = useState(true);
  const [status, setStatus] = useState('submitted');
  const [rows, setRows] = useState<DealHandover[] | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    void handoverApi.list(token, { mine: mine || !canSeeAll, status }).then((r) => setRows(r.success && Array.isArray(r.data) ? r.data : []));
  }, [token, mine, status, canSeeAll]);
  useEffect(load, [load]);
  return (
    <SectionPage title="Handovers" subtitle="Won deals handed over from sales. Accept a handover once you have what you need to start delivery, or return it with what is missing.">
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs" role="tablist">
        {[
          ['submitted', 'Waiting for acceptance'],
          ['returned', 'Returned'],
          ['accepted', 'Accepted'],
          ['open', 'With sales'],
          ['', 'All'],
        ].map(([v, l]) => (
          <button key={l} type="button" role="tab" aria-selected={status === v} onClick={() => setStatus(v)} className={`rounded-full border px-3 py-1 ${status === v ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'}`}>
            {l}
          </button>
        ))}
        {canSeeAll && (
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
          </label>
        )}
      </div>
      {rows === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((h) => (
            <Link key={h._id} to={`/handovers/${h._id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 text-sm hover:border-[color:var(--accent)]">
              <span className="font-medium">{typeof h.dealId === 'object' ? h.dealId.title : 'Deal'}</span>
              <StatusPill label={LABEL[h.status]} tone={TONE[h.status]} />
              <span className="ml-auto text-xs text-[color:var(--text-muted)]">
                PM: {refName(h.pmUserId) || '—'} · {h.items.filter((i) => i.done).length}/{h.items.length} done
              </span>
            </Link>
          ))}
        </div>
      )}
    </SectionPage>
  );
}

/** One handover, for the project manager to accept or return. */
export function HandoverDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const [h, setH] = useState<DealHandover | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    void handoverApi.get(id, token).then((r) => (r.success && r.data ? setH(r.data) : (setH(null), setError(r.message ?? 'Handover not found'))));
  }, [token, id]);
  const deal = h && typeof h.dealId === 'object' ? h.dealId : null;
  const canOpenDeal = canAny(user, 'taskflow.crm.deal.read', 'taskflow.crm.deal.list');
  return (
    <SectionPage
      title={deal ? `Handover: ${deal.title}` : 'Handover'}
      subtitle={deal?.value != null ? `${deal.currency ?? ''} ${deal.value.toLocaleString()}` : undefined}
      toolbar={
        <>
          <Link to="/handovers" className="text-xs text-[color:var(--accent)] hover:underline">All handovers</Link>
          {deal && canOpenDeal && <Link to={`/crm/deals/${deal._id}`} className="text-xs text-[color:var(--accent)] hover:underline">Open deal</Link>}
          {h && typeof h.projectId === 'object' && h.projectId && <Link to={`/projects/${h.projectId._id}/dashboard`} className="text-xs text-[color:var(--accent)] hover:underline">Open project</Link>}
        </>
      }
    >
      {h === undefined ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : h === null ? <p className="text-sm text-red-500">{error}</p> : (
        <div className="max-w-2xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
          <HandoverChecklist handover={h} mode="pm" onChange={setH} />
        </div>
      )}
    </SectionPage>
  );
}
