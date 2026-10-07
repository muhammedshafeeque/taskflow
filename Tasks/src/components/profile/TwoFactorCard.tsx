import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { authApi } from '../../lib/api';

/** Authenticator-app 2FA: set up (QR + recovery codes) or turn off. */
export default function TwoFactorCard() {
  const { token, user, refreshUser } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(user?.twoFactorEnabled);
  const forced = Boolean(user?.mustSetupTwoFactor);

  useEffect(() => {
    // Arriving from the "2FA required" redirect: start setup straight away.
    if (forced && !setup && token && new URLSearchParams(window.location.search).get('setup2fa') === '1') void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced, token]);

  async function begin() {
    if (!token) return;
    setBusy(true);
    setError('');
    const r = await authApi.twoFactorSetup(token);
    setBusy(false);
    if (r.success && r.data) setSetup(r.data);
    else setError(r.message ?? 'Could not start setup');
  }
  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError('');
    const r = await authApi.twoFactorConfirm(code.trim(), token);
    setBusy(false);
    if (!r.success || !r.data) return setError(r.message ?? 'Invalid code');
    setCodes(r.data.recoveryCodes);
    setSetup(null);
    setCode('');
    await refreshUser();
  }
  async function disable() {
    if (!token) return;
    const c = prompt('Enter a current code from your authenticator app (or a recovery code) to turn off 2FA');
    if (!c) return;
    const r = await authApi.twoFactorDisable(c.trim(), token);
    if (!r.success) return setError(r.message ?? 'Failed');
    await refreshUser();
  }

  return (
    <div id="two-factor" className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Two-factor authentication</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${enabled ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-500/15 text-[color:var(--text-muted)]'}`}>{enabled ? 'On' : 'Off'}</span>
      </div>
      {forced && !enabled && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Your organisation requires two-factor authentication. Set it up to continue using the app.</p>
      )}
      <p className="text-sm text-[color:var(--text-muted)]">Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) to generate sign-in codes.</p>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {codes && (
        <div className="rounded-lg border border-[color:var(--border-subtle)] p-3 space-y-2">
          <p className="text-sm font-medium">Save these recovery codes somewhere safe. Each works once if you lose your phone.</p>
          <pre className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
          <button className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>
            Copy
          </button>
        </div>
      )}
      {!enabled && !setup && (
        <button disabled={busy} onClick={begin} className="btn-primary btn-primary-sm px-4 py-2 rounded-lg text-sm">
          Set up authenticator
        </button>
      )}
      {setup && (
        <div className="flex flex-wrap items-start gap-5">
          <img src={setup.qrDataUrl} alt="Scan with your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" />
          <div className="space-y-2 min-w-[14rem] flex-1">
            <p className="text-sm">Scan the QR code, or enter this key manually:</p>
            <code className="block break-all rounded bg-[color:var(--bg-page)] px-2 py-1 text-xs">{setup.secret}</code>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="6-digit code"
              className="w-40 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm tracking-widest"
            />
            <div className="flex gap-2">
              <button disabled={busy || code.length !== 6} onClick={confirm} className="btn-primary btn-primary-sm px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                Verify & turn on
              </button>
              <button onClick={() => setSetup(null)} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {enabled && (
        <button onClick={disable} className="px-3 py-2 rounded-lg border border-rose-500/40 text-sm text-rose-500">
          Turn off
        </button>
      )}
    </div>
  );
}
