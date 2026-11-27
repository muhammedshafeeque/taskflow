import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api, uploadFile } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput, money } from '../../components/moduleKit';
import { fmtDate, type Row } from '../../components/CrudPage';

/**
 * Employee self-service. Every tab is gated by a `taskflow.self.*` permission,
 * so admins decide (per role) what employees can do themselves.
 */
const P = {
  profile: 'taskflow.self.profile.read',
  leave: 'taskflow.self.leave.apply',
  attendance: 'taskflow.self.attendance.mark',
  payslip: 'taskflow.self.payslip.read',
  expense: 'taskflow.self.expense.claim',
  asset: 'taskflow.self.asset.read',
  directory: 'taskflow.self.directory.read',
};

const TABS = [
  { id: 'profile', label: 'My profile', perm: P.profile },
  { id: 'leave', label: 'Leave', perm: P.leave },
  { id: 'attendance', label: 'Attendance', perm: P.attendance },
  { id: 'payslips', label: 'Payslips', perm: P.payslip },
  { id: 'expenses', label: 'Expense claims', perm: P.expense },
  { id: 'assets', label: 'My assets', perm: P.asset },
  { id: 'directory', label: 'Directory', perm: P.directory },
] as const;

const tone = (s: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' =>
  ({ approved: 'green', paid: 'green', present: 'green', pending: 'amber', submitted: 'amber', rejected: 'red', cancelled: 'slate', remote: 'blue', half_day: 'amber' } as const)[s as 'approved'] ?? 'slate';

function useGet<T>(path: string | null) {
  const { token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!token || !path) return;
    api.get<T>(path, token).then((r) => (r.success ? (setData(r.data ?? null), setError('')) : setError(r.message ?? 'Failed')));
  }, [token, path]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-3 py-5 text-center text-[color:var(--text-muted)]">
                Nothing yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[color:var(--border-subtle)] last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoEmployee({ error }: { error: string }) {
  return <Card><p className="text-sm text-[color:var(--text-muted)]">{error || 'Your account is not linked to an employee record yet — ask HR to link it.'}</p></Card>;
}

function ProfileTab() {
  const { data, error } = useGet<Row>('/me/hr/profile');
  if (!data) return <NoEmployee error={error} />;
  const rows: [string, unknown][] = [
    ['Name', data.name],
    ['Employee code', data.employeeCode],
    ['Email', data.email],
    ['Phone', data.phone],
    ['Department', data.department],
    ['Designation', (data.designationId as Row)?.name ?? data.designation],
    ['Manager', (data.managerId as Row)?.name],
    ['Joined', fmtDate(data.joinedDate)],
    ['Status', data.status],
  ];
  return (
    <Card title="My employee record">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-[color:var(--border-subtle)] py-1.5">
            <dt className="text-[color:var(--text-muted)]">{k}</dt>
            <dd className="font-medium text-right">{v ? String(v) : '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function LeaveTab() {
  const { token } = useAuth();
  const balances = useGet<Row[]>('/me/hr/leave/balances');
  const types = useGet<Row[]>('/me/hr/leave/types');
  const leaves = useGet<Row[]>('/me/hr/leave');
  const [form, setForm] = useState<Row | null>(null);
  if (balances.error && !balances.data) return <NoEmployee error={balances.error} />;

  const apply = async () => {
    if (!token || !form) return;
    const r = await api.post('/me/hr/leave', form, token);
    if (!r.success) return alert(r.message);
    setForm(null);
    leaves.reload();
    balances.reload();
  };
  const cancel = async (id: string) => {
    if (!token || !confirm('Cancel this leave request?')) return;
    const r = await api.post(`/me/hr/leave/${id}/cancel`, {}, token);
    if (!r.success) alert(r.message);
    leaves.reload();
    balances.reload();
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {(balances.data ?? []).map((b) => (
          <div key={String(b.leaveTypeId)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ background: String(b.color || 'var(--accent)') }} />
              {String(b.name)}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{b.available === null ? '∞' : String(b.available)}</div>
            <div className="text-[11px] text-[color:var(--text-muted)]">
              {b.paid ? `${b.allocated} allocated · ${b.used} used${Number(b.carriedForward) ? ` · ${b.carriedForward} carried` : ''}` : `Unpaid · ${b.used} used`}
            </div>
          </div>
        ))}
        {balances.data?.length === 0 && <p className="text-sm text-[color:var(--text-muted)] col-span-4">HR hasn't configured leave types yet.</p>}
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">My requests</h2>
          <PrimaryButton onClick={() => setForm({ leaveTypeId: types.data?.[0]?._id, startDate: '', endDate: '', halfDay: false, reason: '' })}>Apply for leave</PrimaryButton>
        </div>
        <Table
          head={['Type', 'From', 'To', 'Days', 'Status', '']}
          rows={(leaves.data ?? []).map((l) => [
            String((l.leaveTypeId as Row)?.name ?? l.type ?? '—'),
            fmtDate(l.startDate),
            fmtDate(l.endDate),
            String(l.days ?? ''),
            <StatusPill key="s" label={String(l.status)} tone={tone(String(l.status))} />,
            l.status === 'pending' || (l.status === 'approved' && new Date(String(l.startDate)) > new Date()) ? (
              <button key="c" className="text-xs text-rose-500 hover:underline" onClick={() => cancel(String(l._id))}>
                Cancel
              </button>
            ) : null,
          ])}
        />
      </Card>
      {form && (
        <Modal
          title="Apply for leave"
          onClose={() => setForm(null)}
          footer={
            <>
              <GhostButton onClick={() => setForm(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={apply}>Submit</PrimaryButton>
            </>
          }
        >
          <Field label="Leave type">
            <Select value={String(form.leaveTypeId ?? '')} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
              {(types.data ?? []).map((t) => (
                <option key={String(t._id)} value={String(t._id)}>
                  {String(t.name)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <TextInput type="date" value={String(form.startDate)} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate || e.target.value })} />
            </Field>
            <Field label="To">
              <TextInput type="date" value={String(form.endDate)} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(form.halfDay)} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} /> Half day
          </label>
          <Field label="Reason">
            <TextArea rows={3} value={String(form.reason)} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function AttendanceTab() {
  const { token } = useAuth();
  const list = useGet<Row[]>('/me/hr/attendance');
  if (list.error && !list.data) return <NoEmployee error={list.error} />;
  const mark = async (status: string) => {
    if (!token) return;
    const r = await api.post('/me/hr/attendance', { status, date: today }, token);
    if (!r.success) alert(r.message);
    list.reload();
  };
  // Your own date, not the server's: someone in India marking at 2 am is on today, not yesterday.
  const today = new Date().toLocaleDateString('en-CA');
  const todays = (list.data ?? []).find((a) => String(a.date).slice(0, 10) === today);
  return (
    <div className="space-y-4">
      <Card title="Today">
        <div className="flex flex-wrap items-center gap-2">
          {todays ? <StatusPill label={String(todays.status)} tone={tone(String(todays.status))} /> : <span className="text-sm text-[color:var(--text-muted)]">Not marked</span>}
          <PrimaryButton onClick={() => mark('present')}>In office</PrimaryButton>
          <GhostButton onClick={() => mark('remote')}>Remote</GhostButton>
          <GhostButton onClick={() => mark('half_day')}>Half day</GhostButton>
        </div>
      </Card>
      <Card title="Recent">
        <Table head={['Date', 'Status', 'Hours']} rows={(list.data ?? []).map((a) => [fmtDate(a.date), <StatusPill key="s" label={String(a.status)} tone={tone(String(a.status))} />, String(a.hoursWorked ?? '')])} />
      </Card>
    </div>
  );
}

function PayslipsTab() {
  const { token } = useAuth();
  const list = useGet<Row[]>('/me/hr/payslips');
  if (list.error && !list.data) return <NoEmployee error={list.error} />;
  const open = async (runId: string) => {
    if (!token) return;
    const r = await api.get<{ html: string }>(`/me/hr/payslips/${runId}`, token);
    if (!r.success || !r.data) return alert(r.message);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(r.data.html);
      w.document.close();
    }
  };
  return (
    <Card title="Payslips">
      <Table
        head={['Period', 'Gross', 'Net', 'Status', '']}
        rows={(list.data ?? []).map((p) => [
          String(p.period),
          money(Number(p.gross), String(p.currency || 'USD')),
          money(Number(p.net), String(p.currency || 'USD')),
          <StatusPill key="s" label={String(p.status)} tone={tone(String(p.status))} />,
          <button key="o" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => open(String(p.runId))}>
            View / print
          </button>,
        ])}
      />
    </Card>
  );
}

function ExpensesTab() {
  const { token } = useAuth();
  const list = useGet<Row[]>('/me/hr/expenses');
  const cats = useGet<string[]>('/me/hr/expense-categories');
  const categories = (cats.data ?? []).filter(Boolean);
  const [form, setForm] = useState<Row | null>(null);
  const [uploading, setUploading] = useState(false);
  const submit = async () => {
    if (!token || !form) return;
    const r = await api.post('/me/hr/expenses', form, token);
    if (!r.success) return alert(r.message);
    setForm(null);
    list.reload();
  };
  const upload = async (files: FileList | null) => {
    if (!token || !files?.length || !form) return;
    setUploading(true);
    const urls: string[] = [...((form.receiptUrls as string[]) ?? [])];
    for (const f of Array.from(files)) {
      const r = await uploadFile(f, token);
      if (r.success && r.data) urls.push(r.data.url);
    }
    setUploading(false);
    setForm({ ...form, receiptUrls: urls });
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">My claims</h2>
        <PrimaryButton onClick={() => setForm({ description: '', category: categories[0] ?? '', amount: '', currency: '', expenseDate: new Date().toISOString().slice(0, 10), receiptUrls: [] })}>New claim</PrimaryButton>
      </div>
      <Table
        head={['Date', 'Description', 'Category', 'Amount', 'Status', 'Receipts']}
        rows={(list.data ?? []).map((e) => [
          fmtDate(e.expenseDate),
          String(e.description),
          String(e.category ?? '—'),
          money(Number(e.amount), String(e.currency || 'USD')),
          <StatusPill key="s" label={String(e.status)} tone={tone(String(e.status))} />,
          ((e.receiptUrls as string[]) ?? []).map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-[color:var(--accent)] hover:underline mr-2">
              #{i + 1}
            </a>
          )),
        ])}
      />
      {form && (
        <Modal
          title="New expense claim"
          onClose={() => setForm(null)}
          footer={
            <>
              <GhostButton onClick={() => setForm(null)}>Cancel</GhostButton>
              <PrimaryButton disabled={uploading} onClick={submit}>
                Submit
              </PrimaryButton>
            </>
          }
        >
          <Field label="Description">
            <TextInput value={String(form.description)} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              {categories.length ? (
                <Select value={String(form.category)} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              ) : (
                <TextInput value={String(form.category)} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              )}
            </Field>
            <Field label="Date">
              <TextInput type="date" value={String(form.expenseDate)} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
            </Field>
            <Field label="Amount">
              <TextInput type="number" step="any" value={String(form.amount)} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Currency (blank = company default)">
              <TextInput value={String(form.currency)} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <Field label="Receipts">
            <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => upload(e.target.files)} />
            <span className="block text-[11px] text-[color:var(--text-muted)] mt-1">
              {uploading ? 'Uploading…' : `${((form.receiptUrls as string[]) ?? []).length} attached`}
            </span>
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function AssetsTab() {
  const list = useGet<Row[]>('/me/hr/assets');
  return (
    <Card title="Assets assigned to me">
      <Table head={['Asset', 'Tag', 'Type', 'Since']} rows={(list.data ?? []).map((a) => [String(a.name ?? '—'), String(a.assetTag ?? a.serialNumber ?? '—'), String(a.category ?? a.type ?? '—'), fmtDate(a.assignedAt ?? a.updatedAt)])} />
    </Card>
  );
}

function DirectoryTab() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useGet<Row[]>(`/me/hr/directory?q=${encodeURIComponent(query)}`);
  return (
    <Card>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <TextInput placeholder="Search name, department, designation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <GhostButton type="submit">Search</GhostButton>
      </form>
      <Table
        head={['Name', 'Designation', 'Department', 'Email', 'Phone']}
        rows={(list.data ?? []).map((p) => [String(p.name), String((p.designationId as Row)?.name ?? p.designation ?? '—'), String(p.department ?? '—'), String(p.email ?? '—'), String(p.phone ?? '—')])}
      />
    </Card>
  );
}

type Team = { people: Row[]; leave: Row[] };

/** Leave of the people who report to me. */
function TeamTab({ team, reload }: { team: Team; reload: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const decide = async (id: string, status: 'approved' | 'rejected') => {
    if (!token) return;
    setBusy(id);
    const r = await api.patch(`/me/hr/team/leave/${id}/decision`, { status }, token);
    setBusy('');
    setError(r.success ? '' : (r.message ?? 'Could not save the decision'));
    reload();
  };
  const name = (v: unknown) => String((v as Row | null)?.name ?? '—');
  return (
    <div className="space-y-4">
      <Card title="Leave requests">
        {error && (
          <p role="alert" className="text-xs text-rose-500">
            {error}
          </p>
        )}
        {team.leave.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No leave requests.</p>}
        {team.leave.length > 0 && (
          <Table
            head={['Name', 'Type', 'Dates', 'Days', 'Reason', 'Status', '']}
            rows={team.leave.map((l) => [
              name(l.employeeId),
              l.leaveTypeId ? name(l.leaveTypeId) : String(l.type ?? '').replace('_', ' '),
              `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`,
              String(l.days),
              String(l.reason ?? ''),
              <StatusPill key="s" label={String(l.status)} tone={tone(String(l.status))} />,
              l.status === 'pending' ? (
                <span key="a" className="whitespace-nowrap">
                  <button disabled={busy === l._id} onClick={() => decide(String(l._id), 'approved')} className="text-emerald-600 hover:underline text-xs mr-3">
                    Approve
                  </button>
                  <button disabled={busy === l._id} onClick={() => decide(String(l._id), 'rejected')} className="text-rose-500 hover:underline text-xs">
                    Reject
                  </button>
                </span>
              ) : (
                ''
              ),
            ])}
          />
        )}
      </Card>
      <Card title="People who report to me">
        <Table
          head={['Name', 'Designation', 'Department', 'Email', 'Phone']}
          rows={team.people.map((p) => [String(p.name), String(p.designation ?? '—'), String(p.department ?? '—'), String(p.email ?? '—'), String(p.phone ?? '—')])}
        />
      </Card>
    </div>
  );
}

type MyPolicy = { documentId: string; title: string; summary?: string; version: number; status: 'pending' | 'new_version' | 'accepted'; acceptedAt: string | null };

/** Policies HR asked me to read and accept (AUT-36). */
function PoliciesTab({ list, reload, openId }: { list: MyPolicy[]; reload: () => void; openId: string | null }) {
  const { token } = useAuth();
  const [open, setOpenId] = useState<string | null>(openId);
  const [doc, setDoc] = useState<(MyPolicy & { content: string; fileUrl: string | null }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setOpen = (id: string | null) => {
    setDoc(null);
    setError('');
    setOpenId(id);
  };
  useEffect(() => {
    if (!token || !open) return;
    void api.get<MyPolicy & { content: string; fileUrl: string | null }>(`/me/hr/policies/${open}`, token).then((r) => (r.success && r.data ? setDoc(r.data) : setError(r.message ?? 'Could not open the policy')));
  }, [token, open]);
  const accept = async () => {
    if (!token || !doc) return;
    setBusy(true);
    const r = await api.post<MyPolicy>(`/me/hr/policies/${doc.documentId}/accept`, { version: doc.version }, token);
    setBusy(false);
    if (!r.success) return setError(r.message ?? 'Could not accept');
    setOpen(null);
    reload();
  };
  const label = { pending: 'To accept', new_version: 'New version to accept', accepted: 'Accepted' } as const;
  return (
    <Card title="Policies">
      {list.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No policies have been assigned to you.</p>
      ) : (
        <Table
          head={['Policy', 'Version', 'Status', '']}
          rows={list.map((p) => [
            <span key="t" className="font-medium">{p.title}</span>,
            `v${p.version}`,
            <StatusPill key="s" label={p.status === 'accepted' && p.acceptedAt ? `${label[p.status]} ${fmtDate(p.acceptedAt)}` : label[p.status]} tone={p.status === 'accepted' ? 'green' : 'amber'} />,
            <GhostButton key="o" onClick={() => setOpen(p.documentId)}>{p.status === 'accepted' ? 'Read' : 'Read and accept'}</GhostButton>,
          ])}
        />
      )}
      {open && (
        <Modal
          title={doc?.title ?? 'Policy'}
          onClose={() => setOpen(null)}
          wide
          footer={
            <>
              <GhostButton onClick={() => setOpen(null)}>Close</GhostButton>
              {doc && doc.status !== 'accepted' && <PrimaryButton onClick={accept} disabled={busy}>I have read and accept version {doc.version}</PrimaryButton>}
            </>
          }
        >
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
          {doc && (
            <div className="space-y-3">
              {doc.status === 'new_version' && <p className="text-sm text-amber-500">This policy has changed since you accepted it. Please read version {doc.version}.</p>}
              {doc.summary && <p className="text-sm text-[color:var(--text-muted)]">{doc.summary}</p>}
              <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-4 text-sm">{doc.content || 'No text.'}</div>
              {doc.fileUrl && <a className="text-sm text-[color:var(--accent)] hover:underline" href={doc.fileUrl} target="_blank" rel="noreferrer">Open the attached file</a>}
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

export default function SelfService() {
  const { user } = useAuth();
  const { id: policyParam } = useParams<{ id?: string }>();
  const team = useGet<Team>('/me/hr/team');
  const policies = useGet<MyPolicy[]>('/me/hr/policies');
  const manages = (team.data?.people.length ?? 0) > 0;
  const toAccept = (policies.data ?? []).filter((p) => p.status !== 'accepted').length;
  const tabs: Array<{ id: string; label: string }> = [
    ...TABS.filter((t) => canAny(user, t.perm)),
    ...((policies.data?.length ?? 0) > 0 ? [{ id: 'policies', label: toAccept ? `Policies (${toAccept})` : 'Policies' }] : []),
    ...(manages ? [{ id: 'team', label: 'My team' }] : []),
  ];
  const [tab, setTab] = useState<string>(() => (policyParam ? 'policies' : new URLSearchParams(window.location.search).get('tab') ?? tabs[0]?.id ?? 'profile'));
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <SectionPage title="Me" subtitle="Your leave, attendance, payslips, expense claims, policies and more.">
      {toAccept > 0 && active?.id !== 'policies' && (
        <button type="button" onClick={() => setTab('policies')} className="w-full text-left rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          You have {toAccept} {toAccept === 1 ? 'policy' : 'policies'} to read and accept. <span className="text-[color:var(--accent)]">Open</span>
        </button>
      )}
      {tabs.length === 0 ? (
        <Card>
          <p className="text-sm text-[color:var(--text-muted)]">Self-service isn't enabled for your role. An administrator can grant the "Self-service" permissions.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[color:var(--border-subtle)]">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm -mb-px border-b-2 ${active?.id === t.id ? 'border-[color:var(--accent)] font-semibold' : 'border-transparent text-[color:var(--text-muted)]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {active?.id === 'profile' && <ProfileTab />}
          {active?.id === 'leave' && <LeaveTab />}
          {active?.id === 'attendance' && <AttendanceTab />}
          {active?.id === 'payslips' && <PayslipsTab />}
          {active?.id === 'expenses' && <ExpensesTab />}
          {active?.id === 'assets' && <AssetsTab />}
          {active?.id === 'directory' && <DirectoryTab />}
          {active?.id === 'team' && team.data && <TeamTab team={team.data} reload={team.reload} />}
          {active?.id === 'policies' && policies.data && <PoliciesTab list={policies.data} reload={policies.reload} openId={policyParam ?? null} />}
        </>
      )}
    </SectionPage>
  );
}
