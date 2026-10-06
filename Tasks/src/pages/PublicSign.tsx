import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { publicSignApi, type SigningView } from '../lib/api';

/** Public page a signer opens from their email link. No account needed. */
export default function PublicSign() {
  const { token = '' } = useParams<{ token: string }>();
  const [view, setView] = useState<SigningView | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    publicSignApi.get(token).then((r) => {
      if (r.success && r.data) {
        setView(r.data);
        setName((n) => n || r.data!.signerName);
      } else setError(r.message ?? 'This link is not valid.');
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function respond(action: 'sign' | 'decline') {
    setBusy(true);
    setError('');
    const r = await publicSignApi.respond(token, action === 'sign' ? { action, signatureName: name } : { action, reason });
    setBusy(false);
    if (r.success) void load();
    else setError(r.message ?? 'Something went wrong');
  }

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] px-4 py-10 text-[color:var(--text-primary)]">
      <div className="mx-auto max-w-3xl space-y-6">
        {!view ? (
          <p className="text-center text-sm text-[color:var(--text-muted)]">{error || 'Loading…'}</p>
        ) : (
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Signature request</p>
              <h1 className="text-2xl font-semibold">{view.title}</h1>
              {view.message && <p className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--text-muted)]">{view.message}</p>}
            </div>
            <article
              className="prose max-w-none rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(view.content) }}
            />
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
              {view.status === 'signed' && <p className="font-medium text-emerald-600">✓ You signed this on {new Date(view.signedAt!).toLocaleString()}. Thank you.</p>}
              {view.status === 'declined' && <p className="font-medium text-rose-500">You declined to sign this document.</p>}
              {view.status === 'unavailable' && <p className="font-medium text-[color:var(--text-muted)]">{view.reason ?? 'This request is no longer open.'}</p>}
              {view.status === 'pending' &&
                (declining ? (
                  <>
                    <label className="block text-sm">Reason (optional)</label>
                    <textarea className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-2 text-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={() => setDeclining(false)}>Back</button>
                      <button type="button" disabled={busy} className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white" onClick={() => respond('decline')}>Decline</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium">Type your full name to sign</label>
                    <input
                      className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-lg"
                      style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
                      I have read this document and agree that typing my name above is my electronic signature.
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !agree || name.trim().length < 2} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50" onClick={() => respond('sign')}>
                        {busy ? 'Signing…' : 'Sign document'}
                      </button>
                      <button type="button" className="rounded-lg px-4 py-2 text-sm text-[color:var(--text-muted)]" onClick={() => setDeclining(true)}>
                        Decline
                      </button>
                    </div>
                  </>
                ))}
              {view.otherSigners.length > 0 && (
                <p className="text-xs text-[color:var(--text-muted)]">
                  Also signing: {view.otherSigners.map((s) => `${s.name}${s.signed ? ' ✓' : ''}`).join(', ')}
                </p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
