import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { CrudPage, fmtDate, type Row } from '../../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput, money } from '../../components/moduleKit';

const COMMISSION_MANAGE = 'taskflow.crm.commission.manage';
const MAIL = {
  use: 'taskflow.mail.mailbox.read',
  manage: 'taskflow.mail.mailbox.manage',
  send: 'taskflow.mail.mailbox.send',
  read: 'taskflow.mail.message.read',
};

// ── Commissions ─────────────────────────────────────────────────────────────
export function CrmCommissions() {
  const { token, user } = useAuth();
  const manage = canAny(user, COMMISSION_MANAGE);
  const [tab, setTab] = useState<'entries' | 'plans'>('entries');
  const [period, setPeriod] = useState('');
  const [entries, setEntries] = useState<Row[]>([]);
  const load = useCallback(() => {
    if (!token) return;
    api.get<Row[]>(`/crm/commissions/entries${period ? `?period=${period}` : ''}`, token).then((r) => setEntries(Array.isArray(r.data) ? r.data : []));
  }, [token, period]);
  useEffect(load, [load]);
  const setStatus = async (e: Row, status: string) => {
    if (!token) return;
    const r = await api.patch(`/crm/commissions/entries/${e._id}`, { status }, token);
    if (!r.success) alert(r.message);
    load();
  };
  const totals = entries.filter((e) => e.status !== 'void').reduce<Record<string, number>>((acc, e) => ({ ...acc, [String(e.status)]: (acc[String(e.status)] ?? 0) + Number(e.amount) }), {});
  const tabs = (
    <div className="flex gap-1 border-b border-[color:var(--border-subtle)]">
      {(manage ? (['entries', 'plans'] as const) : (['entries'] as const)).map((k) => (
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 capitalize ${tab === k ? 'border-[color:var(--accent)] font-semibold' : 'border-transparent text-[color:var(--text-muted)]'}`}>
          {k === 'entries' ? 'Earned commissions' : 'Plans'}
        </button>
      ))}
    </div>
  );
  if (tab === 'plans')
    return (
      <CrudPage
        title="Commissions"
        subtitle="Plans apply to chosen users and/or roles. Tiers are marginal on the won deal value."
        endpoint="/crm/commissions/plans"
        managePermissions={[COMMISSION_MANAGE]}
        createLabel="New plan"
        toolbar={
          <GhostButton
            onClick={async () => {
              if (!token) return;
              const r = await api.post<Row>('/crm/commissions/recalculate', {}, token);
              alert(r.success ? `Checked ${r.data?.deals ?? 0} won deals.` : r.message);
            }}
          >
            Recalculate last 90 days
          </GhostButton>
        }
        columns={[
          { header: 'Plan', render: (r) => <span className="font-medium">{String(r.name)}</span> },
          { header: 'Rate', render: (r) => (((r.tiers as Row[]) ?? []).length ? ((r.tiers as Row[]) ?? []).map((t) => `${t.ratePct}% from ${t.from}`).join(' · ') : `${r.ratePct}%`) },
          { header: 'Applies to', render: (r) => `${((r.userIds as unknown[]) ?? []).length} user(s), ${((r.roleIds as unknown[]) ?? []).length} role(s)` },
          { header: 'Min deal', render: (r) => String(r.minDealValue ?? 0) },
          { header: 'Priority', render: (r) => String(r.priority ?? 0) },
          { header: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
        ]}
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'ratePct', label: 'Flat rate %', type: 'number', help: 'Used when no tiers are set.' },
          { key: 'tiers', label: 'Tiers (JSON, optional)', type: 'json', placeholder: '[{"from":0,"ratePct":5},{"from":100000,"ratePct":8}]' },
          { key: 'userIds', label: 'Users', type: 'multiselect', optionsFrom: { endpoint: '/core/people' } },
          { key: 'roleIds', label: 'Roles', type: 'multiselect', optionsFrom: { endpoint: '/roles' } },
          { key: 'minDealValue', label: 'Minimum deal value', type: 'number', defaultValue: 0 },
          { key: 'priority', label: 'Priority (higher wins)', type: 'number', defaultValue: 0 },
          { key: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
        ]}
      >
        {tabs}
      </CrudPage>
    );
  return (
    <SectionPage
      title="Commissions"
      subtitle={manage ? 'Accrued automatically when a deal is won. Approve and mark as paid.' : 'Your commissions from won deals.'}
      toolbar={<TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" />}
    >
      {tabs}
      <div className="grid grid-cols-3 gap-3">
        {(['pending', 'approved', 'paid'] as const).map((s) => (
          <div key={s} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">{s}</div>
            <div className="text-xl font-bold tabular-nums">{money(totals[s] ?? 0, String(entries[0]?.currency ?? 'USD'))}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
              {['Rep', 'Deal', 'Deal value', 'Commission', 'Period', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={String(e._id)} className="border-b border-[color:var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5">{String((e.userId as Row)?.name ?? '—')}</td>
                <td className="px-4 py-2.5">{String((e.dealId as Row)?.title ?? '—')}</td>
                <td className="px-4 py-2.5 tabular-nums">{money(Number(e.base), String(e.currency ?? 'USD'))}</td>
                <td className="px-4 py-2.5 tabular-nums font-medium">{money(Number(e.amount), String(e.currency ?? 'USD'))}</td>
                <td className="px-4 py-2.5">{String(e.period ?? '')}</td>
                <td className="px-4 py-2.5">
                  <StatusPill label={String(e.status)} tone={({ pending: 'amber', approved: 'blue', paid: 'green', void: 'slate' } as const)[String(e.status) as 'pending'] ?? 'slate'} />
                </td>
                <td className="px-4 py-2.5 text-right space-x-2 text-xs whitespace-nowrap">
                  {manage && e.status === 'pending' && (
                    <button className="text-[color:var(--accent)]" onClick={() => setStatus(e, 'approved')}>
                      Approve
                    </button>
                  )}
                  {manage && e.status === 'approved' && (
                    <button className="text-emerald-600" onClick={() => setStatus(e, 'paid')}>
                      Mark paid
                    </button>
                  )}
                  {manage && e.status !== 'paid' && e.status !== 'void' && (
                    <button className="text-rose-500" onClick={() => setStatus(e, 'void')}>
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  No commissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionPage>
  );
}

// ── Mailboxes ───────────────────────────────────────────────────────────────
/** Common IMAP/SMTP presets — just defaults, every field stays editable. */
const PRESETS: Record<string, { imap: string; imapPort: number; smtp: string; smtpPort: number; hint: string }> = {
  google: { imap: 'imap.gmail.com', imapPort: 993, smtp: 'smtp.gmail.com', smtpPort: 465, hint: 'Google Workspace / Gmail: enable 2-step verification and create an App password.' },
  microsoft: { imap: 'outlook.office365.com', imapPort: 993, smtp: 'smtp.office365.com', smtpPort: 587, hint: 'Microsoft 365: IMAP and SMTP AUTH must be enabled for the mailbox; use an app password if MFA is on.' },
  zoho: { imap: 'imap.zoho.com', imapPort: 993, smtp: 'smtp.zoho.com', smtpPort: 465, hint: 'Zoho Mail: enable IMAP access in mail settings.' },
  custom: { imap: '', imapPort: 993, smtp: '', smtpPort: 465, hint: 'Any provider that supports IMAP and SMTP.' },
};

export function MailboxSettings() {
  const { token, user } = useAuth();
  const manageAll = canAny(user, MAIL.manage);
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Row | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    if (!token) return;
    api.get<Row[]>(`/mail/accounts${all ? '?all=1' : ''}`, token).then((r) => setRows(Array.isArray(r.data) ? r.data : []));
  }, [token, all]);
  useEffect(load, [load]);

  const preset = (k: string) => {
    const p = PRESETS[k];
    setForm((f) => ({ ...(f ?? {}), provider: k, imapHost: p.imap, imapPort: p.imapPort, smtpHost: p.smtp, smtpPort: p.smtpPort }));
  };
  const save = async () => {
    if (!token || !form) return;
    setBusy('save');
    const body = {
      label: form.label,
      emailAddress: form.emailAddress,
      displayName: form.displayName,
      imap: { host: form.imapHost, port: Number(form.imapPort), secure: Number(form.imapPort) === 993, user: form.username || form.emailAddress },
      smtp: { host: form.smtpHost, port: Number(form.smtpPort), secure: Number(form.smtpPort) === 465, user: form.username || form.emailAddress },
      imapPassword: form.password || undefined,
      smtpPassword: form.smtpPassword || undefined,
      folders: String(form.folders ?? 'INBOX, Sent').split(',').map((s) => s.trim()).filter(Boolean),
      crmOnly: form.crmOnly !== false,
      shareWithTeam: form.shareWithTeam !== false,
      ignore: String(form.ignore ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      syncSince: form.syncSince || undefined,
      signature: form.signature,
      syncEnabled: form.syncEnabled !== false,
    };
    const r = form._id ? await api.patch(`/mail/accounts/${form._id}`, body, token) : await api.post('/mail/accounts', body, token);
    setBusy('');
    if (!r.success) return alert(r.message);
    setForm(null);
    load();
  };
  const sync = async (a: Row) => {
    if (!token) return;
    setBusy(String(a._id));
    const r = await api.post<Row>(`/mail/accounts/${a._id}/sync`, {}, token);
    setBusy('');
    alert(r.success ? (r.data?.lastError ? `Sync error: ${r.data.lastError}` : `Synced — ${r.data?.stored ?? 0} new CRM email(s).`) : r.message);
    load();
  };
  const remove = async (a: Row) => {
    if (!token) return;
    const purge = confirm('Disconnect this mailbox.\n\nOK = also delete its synced emails from the CRM\nCancel = keep them');
    const r = await api.delete(`/mail/accounts/${a._id}${purge ? '?purge=1' : ''}`, token);
    if (!r.success) alert(r.message);
    load();
  };
  const edit = (a: Row) =>
    setForm({
      _id: a._id,
      label: a.label,
      emailAddress: a.emailAddress,
      displayName: a.displayName,
      imapHost: (a.imap as Row)?.host,
      imapPort: (a.imap as Row)?.port,
      smtpHost: (a.smtp as Row)?.host,
      smtpPort: (a.smtp as Row)?.port,
      username: (a.imap as Row)?.user,
      folders: ((a.folders as string[]) ?? []).join(', '),
      crmOnly: a.crmOnly,
      shareWithTeam: a.shareWithTeam,
      ignore: ((a.ignore as string[]) ?? []).join(', '),
      signature: a.signature,
      syncEnabled: a.syncEnabled,
    });
  const f = form ?? {};
  const set = (k: string, v: unknown) => setForm({ ...f, [k]: v });
  return (
    <SectionPage
      title="Email sync"
      subtitle="Connect your own mailbox. Emails with your CRM contacts and leads are logged on their timeline automatically, and you can email them from the CRM."
      toolbar={
        <>
          {manageAll && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Everyone's mailboxes
            </label>
          )}
          {canAny(user, MAIL.use, MAIL.manage) && (
            <PrimaryButton
              onClick={() => {
                setForm({ crmOnly: true, shareWithTeam: true, folders: 'INBOX, Sent', syncEnabled: true, emailAddress: user?.email ?? '', displayName: user?.name ?? '' });
                setTimeout(() => preset('google'));
              }}
            >
              Connect mailbox
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((a) => (
          <div key={String(a._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-sm">{String(a.emailAddress)}</div>
                <div className="text-[11px] text-[color:var(--text-muted)]">
                  {String((a.userId as Row)?.name ?? '')} · {String((a.imap as Row)?.host ?? '')}
                </div>
              </div>
              <StatusPill label={a.lastError ? 'error' : a.syncEnabled ? 'syncing' : 'paused'} tone={a.lastError ? 'red' : a.syncEnabled ? 'green' : 'slate'} />
            </div>
            <div className="text-xs text-[color:var(--text-muted)]">
              Last sync: {fmtDate(a.lastSyncAt, true)} · {a.crmOnly ? 'CRM contacts only' : 'all mail'} · {a.shareWithTeam ? 'shared with team' : 'private'}
            </div>
            {a.lastError ? <p className="text-xs text-rose-500 break-words">{String(a.lastError)}</p> : null}
            <div className="flex gap-3 text-xs">
              <button className="text-[color:var(--accent)]" disabled={busy === a._id} onClick={() => sync(a)}>
                {busy === a._id ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="text-[color:var(--accent)]" onClick={() => edit(a)}>
                Settings
              </button>
              <button className="text-rose-500" onClick={() => remove(a)}>
                Disconnect
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No mailbox connected yet.</p>}
      </div>
      {form && (
        <Modal
          wide
          title={form._id ? 'Mailbox settings' : 'Connect mailbox'}
          onClose={() => setForm(null)}
          footer={
            <>
              <GhostButton onClick={() => setForm(null)}>Cancel</GhostButton>
              <PrimaryButton disabled={busy === 'save'} onClick={save}>
                {busy === 'save' ? 'Testing connection…' : 'Save'}
              </PrimaryButton>
            </>
          }
        >
          {!form._id && (
            <Field label="Provider">
              <Select value={String(f.provider ?? 'custom')} onChange={(e) => preset(e.target.value)}>
                <option value="google">Google Workspace / Gmail</option>
                <option value="microsoft">Microsoft 365 / Outlook</option>
                <option value="zoho">Zoho Mail</option>
                <option value="custom">Other (IMAP/SMTP)</option>
              </Select>
              <span className="mt-1 block text-[11px] text-[color:var(--text-muted)]">{PRESETS[String(f.provider ?? 'custom')]?.hint}</span>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email address">
              <TextInput value={String(f.emailAddress ?? '')} onChange={(e) => set('emailAddress', e.target.value)} />
            </Field>
            <Field label="Display name">
              <TextInput value={String(f.displayName ?? '')} onChange={(e) => set('displayName', e.target.value)} />
            </Field>
            <Field label="IMAP host">
              <TextInput value={String(f.imapHost ?? '')} onChange={(e) => set('imapHost', e.target.value)} />
            </Field>
            <Field label="IMAP port">
              <TextInput type="number" value={String(f.imapPort ?? 993)} onChange={(e) => set('imapPort', e.target.value)} />
            </Field>
            <Field label="SMTP host">
              <TextInput value={String(f.smtpHost ?? '')} onChange={(e) => set('smtpHost', e.target.value)} />
            </Field>
            <Field label="SMTP port">
              <TextInput type="number" value={String(f.smtpPort ?? 465)} onChange={(e) => set('smtpPort', e.target.value)} />
            </Field>
            <Field label="Username (blank = email)">
              <TextInput value={String(f.username ?? '')} onChange={(e) => set('username', e.target.value)} />
            </Field>
            <Field label={form._id ? 'Password / app password (leave blank to keep)' : 'Password / app password'}>
              <TextInput type="password" autoComplete="new-password" value={String(f.password ?? '')} onChange={(e) => set('password', e.target.value)} />
            </Field>
          </div>
          <Field label="Folders to sync">
            <TextInput value={String(f.folders ?? '')} onChange={(e) => set('folders', e.target.value)} />
          </Field>
          <Field label="Never log these addresses / domains (e.g. your own company domain)">
            <TextInput placeholder="@yourcompany.com, noreply@" value={String(f.ignore ?? '')} onChange={(e) => set('ignore', e.target.value)} />
          </Field>
          {!form._id && (
            <Field label="Import mail since">
              <TextInput type="date" value={String(f.syncSince ?? '')} onChange={(e) => set('syncSince', e.target.value)} />
            </Field>
          )}
          <Field label="Signature">
            <TextArea rows={3} value={String(f.signature ?? '')} onChange={(e) => set('signature', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.crmOnly !== false} onChange={(e) => set('crmOnly', e.target.checked)} /> Only keep emails with CRM contacts / leads (recommended — personal mail is never stored)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.shareWithTeam !== false} onChange={(e) => set('shareWithTeam', e.target.checked)} /> Teammates can see these CRM emails
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.syncEnabled !== false} onChange={(e) => set('syncEnabled', e.target.checked)} /> Sync automatically
          </label>
        </Modal>
      )}
    </SectionPage>
  );
}

/** Email timeline + compose for a CRM record (lead, contact, account, deal). */
export function CrmEmailPanel({ relatedType, relatedId, defaultTo }: { relatedType: 'lead' | 'contact' | 'account' | 'deal'; relatedId: string; defaultTo?: string }) {
  const { token, user } = useAuth();
  const canRead = canAny(user, MAIL.read, MAIL.manage);
  const canSend = canAny(user, MAIL.send);
  const [msgs, setMsgs] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [compose, setCompose] = useState<Row | null>(null);
  const load = useCallback(() => {
    if (!token || !canRead) return;
    api.get<Row[]>(`/mail/messages?relatedType=${relatedType}&relatedId=${relatedId}`, token).then((r) => setMsgs(Array.isArray(r.data) ? r.data : []));
  }, [token, canRead, relatedType, relatedId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!token || !canSend) return;
    api.get<Row[]>('/mail/accounts', token).then((r) => setAccounts(Array.isArray(r.data) ? r.data : []));
  }, [token, canSend]);
  if (!canRead && !canSend) return null;

  const view = async (m: Row) => {
    if (!token) return;
    const r = await api.get<Row>(`/mail/messages/${m._id}`, token);
    if (r.success && r.data) setOpen(r.data);
  };
  const send = async () => {
    if (!token || !compose) return;
    const r = await api.post(`/mail/accounts/${compose.accountId}/send`, {
      to: String(compose.to).split(',').map((s) => s.trim()).filter(Boolean),
      cc: String(compose.cc ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      subject: compose.subject,
      body: compose.body,
      inReplyTo: compose.inReplyTo,
      related: { type: relatedType, id: relatedId },
    }, token);
    if (!r.success) return alert(r.message);
    setCompose(null);
    load();
  };
  const startCompose = (reply?: Row) =>
    setCompose({
      accountId: accounts[0]?._id,
      to: reply ? (reply.direction === 'inbound' ? (reply.from as Row)?.email : ((reply.to as Row[]) ?? []).map((t) => t.email).join(', ')) : defaultTo ?? '',
      subject: reply ? (String(reply.subject).startsWith('Re:') ? reply.subject : `Re: ${reply.subject}`) : '',
      body: '',
      inReplyTo: reply?.messageId,
    });
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Emails</h3>
        {canSend && (accounts.length ? <GhostButton onClick={() => startCompose()}>Compose</GhostButton> : <a href="/crm/email-sync" className="text-xs text-[color:var(--accent)] hover:underline">Connect your mailbox to send</a>)}
      </div>
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {msgs.map((m) => (
          <li key={String(m._id)} className="py-2 text-sm cursor-pointer" onClick={() => view(m)}>
            <div className="flex items-center gap-2">
              <span className={m.direction === 'inbound' ? 'text-sky-500' : 'text-emerald-600'}>{m.direction === 'inbound' ? '←' : '→'}</span>
              <span className="font-medium truncate">{String(m.subject || '(no subject)')}</span>
              <span className="ml-auto shrink-0 text-[11px] text-[color:var(--text-muted)]">{fmtDate(m.date, true)}</span>
            </div>
            <div className="text-xs text-[color:var(--text-muted)] truncate">
              {String((m.from as Row)?.name ?? (m.from as Row)?.email ?? '')} · {String(m.snippet ?? '')}
            </div>
          </li>
        ))}
        {msgs.length === 0 && <li className="py-2 text-xs text-[color:var(--text-muted)]">No synced emails yet.</li>}
      </ul>
      {open && (
        <Modal
          wide
          title={String(open.subject || '(no subject)')}
          onClose={() => setOpen(null)}
          footer={canSend && accounts.length ? <PrimaryButton onClick={() => (startCompose(open), setOpen(null))}>Reply</PrimaryButton> : undefined}
        >
          <div className="text-xs text-[color:var(--text-muted)] space-y-0.5">
            <div>From: {String((open.from as Row)?.name ?? '')} &lt;{String((open.from as Row)?.email ?? '')}&gt;</div>
            <div>To: {((open.to as Row[]) ?? []).map((t) => t.email).join(', ')}</div>
            <div>{fmtDate(open.date, true)} · via {String((open.userId as Row)?.name ?? '')}</div>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm">{String(open.text ?? '')}</pre>
        </Modal>
      )}
      {compose && (
        <Modal
          wide
          title="New email"
          onClose={() => setCompose(null)}
          footer={
            <>
              <GhostButton onClick={() => setCompose(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={send}>Send</PrimaryButton>
            </>
          }
        >
          {accounts.length > 1 && (
            <Field label="From">
              <Select value={String(compose.accountId)} onChange={(e) => setCompose({ ...compose, accountId: e.target.value })}>
                {accounts.map((a) => (
                  <option key={String(a._id)} value={String(a._id)}>
                    {String(a.emailAddress)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="To">
            <TextInput value={String(compose.to ?? '')} onChange={(e) => setCompose({ ...compose, to: e.target.value })} />
          </Field>
          <Field label="Cc">
            <TextInput value={String(compose.cc ?? '')} onChange={(e) => setCompose({ ...compose, cc: e.target.value })} />
          </Field>
          <Field label="Subject">
            <TextInput value={String(compose.subject ?? '')} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <TextArea rows={8} value={String(compose.body ?? '')} onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
