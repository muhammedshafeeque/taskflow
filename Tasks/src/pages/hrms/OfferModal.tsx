import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import type { Row } from '../../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, StatusPill, TextArea, TextInput } from '../../components/moduleKit';

type Offer = {
  _id: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn';
  designation?: string;
  annualCtc: number;
  currency: string;
  joiningDate?: string;
  expiresAt?: string;
  letter: string;
  aboveBand: boolean;
  rejectionNote?: string;
  createdBy?: { _id: string; name?: string } | string;
  approvedBy?: { name?: string };
  sentAt?: string;
  sentTo?: string;
  response?: { decision: string; name?: string; note?: string; at?: string };
};

const TONE: Record<Offer['status'], 'slate' | 'amber' | 'blue' | 'green' | 'red'> = {
  draft: 'slate', pending_approval: 'amber', approved: 'blue', sent: 'blue', accepted: 'green', declined: 'red', withdrawn: 'slate',
};
const day = (v?: string) => (v ? v.slice(0, 10) : '');

/** Offer for one candidate (AUT-37): draft the letter, get it approved, send it, see the answer. */
export default function OfferModal({ candidate, job, onClose, onChanged }: { candidate: Row; job: Row; onClose: () => void; onChanged: () => void }) {
  const { token, user } = useAuth();
  const canSetPay = canAny(user, 'taskflow.hr.salary.manage', 'taskflow.hr.payroll.manage');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [form, setForm] = useState({ annualCtc: candidate.expectedSalary == null ? '' : String(candidate.expectedSalary), designation: String(job.title ?? ''), joiningDate: '', expiresAt: '', letter: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    void api.get<Offer[]>(`/hrms/candidates/${candidate._id}/offers`, token).then((r) => r.success && r.data && setOffers(r.data));
  }, [token, candidate._id]);
  useEffect(load, [load]);

  const live = offers.find((o) => ['draft', 'pending_approval', 'approved', 'sent'].includes(o.status));
  const mine = live && String(typeof live.createdBy === 'object' ? live.createdBy?._id : live.createdBy) === user?.id;

  const act = async (path: string, body?: unknown, done?: string) => {
    if (!token) return;
    setBusy(true);
    setMessage('');
    const r = await api.post<Offer & { url?: string }>(path, body ?? {}, token);
    setBusy(false);
    if (!r.success) return setMessage(r.message ?? 'Something went wrong');
    setMessage(done ?? '');
    load();
    onChanged();
  };

  const create = async () => {
    if (!token) return;
    setBusy(true);
    setMessage('');
    const r = await api.post(`/hrms/candidates/${candidate._id}/offers`, {
      annualCtc: Number(form.annualCtc) || 0,
      designation: form.designation || undefined,
      joiningDate: form.joiningDate || undefined,
      expiresAt: form.expiresAt || undefined,
      letter: form.letter || undefined,
    }, token);
    setBusy(false);
    if (!r.success) return setMessage(r.message ?? 'Could not create the offer');
    load();
  };

  const saveLetter = async () => {
    if (!token || !live) return;
    const r = await api.patch(`/hrms/offers/${live._id}`, { letter: live.letter }, token);
    setMessage(r.success ? 'Saved.' : r.message ?? 'Could not save');
    load();
  };

  return (
    <Modal title={`Offer for ${String(candidate.name)}`} onClose={onClose} wide footer={<GhostButton onClick={onClose}>Close</GhostButton>}>
      {!live ? (
        <>
          {!canSetPay && <p className="text-sm text-amber-500">Putting a salary in an offer needs the permission to set pay.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Annual CTC${job.currency ? ` (${String(job.currency)})` : ''}`}>
              <TextInput type="number" min={0} value={form.annualCtc} onChange={(e) => setForm({ ...form, annualCtc: e.target.value })} disabled={!canSetPay} />
            </Field>
            <Field label="Designation"><TextInput value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
            <Field label="Joining date"><TextInput type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} /></Field>
            <Field label="Respond by"><TextInput type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">The letter is filled in from the template in HR settings. You can change it before sending it for approval.</p>
          <PrimaryButton onClick={create} disabled={busy || !canSetPay}>Draft offer</PrimaryButton>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill label={live.status.replace('_', ' ')} tone={TONE[live.status]} />
            <span>{live.currency} {live.annualCtc.toLocaleString()}</span>
            {live.designation && <span>· {live.designation}</span>}
            {live.joiningDate && <span>· joins {day(live.joiningDate)}</span>}
            {live.aboveBand && <StatusPill label="above band" tone="amber" />}
          </div>
          {live.rejectionNote && live.status === 'draft' && <p className="text-sm text-amber-500">Sent back: {live.rejectionNote}</p>}
          {live.sentAt && <p className="text-xs text-[color:var(--text-muted)]">Sent to {live.sentTo} on {day(live.sentAt)}. The candidate answers from the link in that email.</p>}
          <Field label="Letter">
            <TextArea rows={10} value={live.letter} readOnly={live.status !== 'draft'} onChange={(e) => setOffers((list) => list.map((o) => (o._id === live._id ? { ...o, letter: e.target.value } : o)))} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {live.status === 'draft' && (
              <>
                <GhostButton onClick={saveLetter} disabled={busy}>Save letter</GhostButton>
                <PrimaryButton onClick={() => act(`/hrms/offers/${live._id}/submit`, undefined, 'Sent for approval.')} disabled={busy}>Send for approval</PrimaryButton>
              </>
            )}
            {live.status === 'pending_approval' && canSetPay && !mine && (
              <>
                <PrimaryButton onClick={() => act(`/hrms/offers/${live._id}/approve`, undefined, 'Approved.')} disabled={busy}>Approve</PrimaryButton>
                <GhostButton onClick={() => { const note = window.prompt('Why send it back?'); if (note) void act(`/hrms/offers/${live._id}/reject`, { note }); }} disabled={busy}>Send back</GhostButton>
              </>
            )}
            {live.status === 'pending_approval' && (mine || !canSetPay) && <p className="text-sm text-[color:var(--text-muted)]">Waiting for someone who may approve pay (or the offer approval chain in Approvals).</p>}
            {(live.status === 'approved' || live.status === 'sent') && (
              <PrimaryButton onClick={() => act(`/hrms/offers/${live._id}/send`, undefined, 'Emailed to the candidate.')} disabled={busy}>
                {live.status === 'sent' ? 'Send again' : 'Send to candidate'}
              </PrimaryButton>
            )}
            <GhostButton onClick={() => act(`/hrms/offers/${live._id}/withdraw`, undefined, 'Withdrawn.')} disabled={busy}>Withdraw</GhostButton>
          </div>
        </div>
      )}
      {message && <p className="text-sm text-[color:var(--text-muted)]" role="status">{message}</p>}
      {offers.filter((o) => o !== live).length > 0 && (
        <div className="pt-2 border-t border-[color:var(--border-subtle)] space-y-1">
          <p className="text-xs font-medium text-[color:var(--text-muted)]">Earlier offers</p>
          {offers.filter((o) => o !== live).map((o) => (
            <p key={o._id} className="text-xs">
              <StatusPill label={o.status} tone={TONE[o.status]} /> {o.currency} {o.annualCtc.toLocaleString()}
              {o.response?.name ? ` · ${o.response.decision} by ${o.response.name} on ${day(o.response.at)}` : ''}
              {o.response?.note ? ` · “${o.response.note}”` : ''}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}
