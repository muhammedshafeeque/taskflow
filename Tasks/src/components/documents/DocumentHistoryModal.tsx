import { useCallback, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  documentsApi,
  type DocumentRecord,
  type DocumentSignatureRequestRecord,
  type DocumentVersionRecord,
} from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, StatusPill, TextArea, TextInput } from '../moduleKit';

const reqTone = { pending: 'amber', completed: 'green', declined: 'red', cancelled: 'slate' } as const;

/** Version history (view / restore) and e-signature requests for one document. */
export default function DocumentHistoryModal({
  doc,
  token,
  canManage,
  onClose,
  onChanged,
}: {
  doc: DocumentRecord;
  token: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'sign' | 'history'>('sign');
  const [versions, setVersions] = useState<DocumentVersionRecord[]>([]);
  const [requests, setRequests] = useState<DocumentSignatureRequestRecord[]>([]);
  const [preview, setPreview] = useState<DocumentVersionRecord | null>(null);
  const [signers, setSigners] = useState([{ name: '', email: '' }]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    documentsApi.versions(doc._id, token).then((r) => r.success && r.data && setVersions(r.data));
    documentsApi.signatures(doc._id, token).then((r) => r.success && r.data && setRequests(r.data));
  }, [doc._id, token]);
  useEffect(load, [load]);

  async function send() {
    setBusy(true);
    setError('');
    const r = await documentsApi.requestSignatures(doc._id, { signers: signers.filter((s) => s.name && s.email), message }, token);
    setBusy(false);
    if (r.success) {
      setSigners([{ name: '', email: '' }]);
      setMessage('');
      load();
      onChanged();
    } else setError(r.message ?? 'Could not send');
  }

  async function restore(v: number) {
    if (!window.confirm(`Restore version ${v}? The current text is kept in history.`)) return;
    const r = await documentsApi.restoreVersion(doc._id, v, token);
    if (r.success) {
      load();
      onChanged();
      setPreview(null);
    } else setError(r.message ?? 'Restore failed');
  }

  return (
    <Modal title={`${doc.title} · v${doc.version ?? 1}`} onClose={onClose} wide footer={<GhostButton onClick={onClose}>Close</GhostButton>}>
      <div className="flex gap-2 border-b border-[color:var(--border-subtle)] pb-2">
        {(['sign', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-sm ${tab === t ? 'bg-[color:var(--accent)]/10 text-[color:var(--accent)]' : 'text-[color:var(--text-muted)]'}`}
          >
            {t === 'sign' ? 'E-signature' : `History (${versions.length})`}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {tab === 'sign' && (
        <div className="space-y-4">
          {canManage && doc.status !== 'signed' && (
            <div className="rounded-xl border border-[color:var(--border-subtle)] p-3 space-y-2">
              <p className="text-sm font-medium">Request signatures</p>
              <p className="text-xs text-[color:var(--text-muted)]">
                Each signer gets a private link by email, reviews this exact version, and signs by typing their name. Editing the document afterwards
                invalidates open requests.
              </p>
              {signers.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <TextInput placeholder="Full name" value={s.name} onChange={(e) => setSigners((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <TextInput type="email" placeholder="email@company.com" value={s.email} onChange={(e) => setSigners((x) => x.map((y, j) => (j === i ? { ...y, email: e.target.value } : y)))} />
                  <GhostButton onClick={() => setSigners((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))}>✕</GhostButton>
                </div>
              ))}
              <GhostButton onClick={() => setSigners((x) => [...x, { name: '', email: '' }])}>+ Signer</GhostButton>
              <Field label="Message (optional)">
                <TextArea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <PrimaryButton disabled={busy || !signers.some((s) => s.name && s.email)} onClick={send}>
                {busy ? 'Sending…' : 'Send for signature'}
              </PrimaryButton>
            </div>
          )}
          {requests.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">No signature requests yet.</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r._id} className="rounded-lg border border-[color:var(--border-subtle)] p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      v{r.version} · sent {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                    <StatusPill label={r.status} tone={reqTone[r.status]} />
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {r.signers.map((s) => (
                      <li key={s._id} className="flex justify-between gap-2">
                        <span>
                          {s.name} <span className="text-[color:var(--text-muted)]">{s.email}</span>
                        </span>
                        <span className={s.signedAt ? 'text-emerald-600' : s.declinedAt ? 'text-rose-500' : 'text-[color:var(--text-muted)]'}>
                          {s.signedAt
                            ? `Signed as “${s.signatureName}” · ${new Date(s.signedAt).toLocaleString()}`
                            : s.declinedAt
                              ? `Declined${s.declineReason ? `: ${s.declineReason}` : ''}`
                              : 'Waiting'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <ul className="space-y-1">
            {versions.length === 0 && <li className="text-sm text-[color:var(--text-muted)]">No earlier versions — history starts with the next edit.</li>}
            {versions.map((v) => (
              <li key={v._id}>
                <button
                  type="button"
                  onClick={() => setPreview(v)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${preview?._id === v._id ? 'bg-[color:var(--accent)]/10' : 'hover:bg-[color:var(--bg-page)]'}`}
                >
                  v{v.version} · {new Date(v.createdAt).toLocaleString()}
                  <span className="block text-[11px] text-[color:var(--text-muted)]">{v.editedBy?.name ? `replaced by ${v.editedBy.name}` : v.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-[200px] rounded-lg border border-[color:var(--border-subtle)] p-3">
            {preview ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium">{preview.title}</p>
                  {canManage && doc.status !== 'signed' && <GhostButton onClick={() => restore(preview.version)}>Restore this version</GhostButton>}
                </div>
                <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.content ?? '') }} />
              </>
            ) : (
              <p className="text-sm text-[color:var(--text-muted)]">Pick a version to preview it.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
