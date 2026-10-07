import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { CrudPage, fmtDate, type Row } from '../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../components/moduleKit';

const HEALTH_TONE = { green: 'green', amber: 'amber', red: 'red' } as const;
const score = (r: Row) => Number(r.probability ?? 0) * Number(r.impact ?? 0);

/** Risk register + client status reports for one project. */
export default function ProjectGovernance() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<'risks' | 'reports'>('risks');
  if (!projectId) return null;
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[color:var(--border-subtle)] px-4 sm:px-6 lg:px-8 pt-4">
        {(
          [
            ['risks', 'Risk register'],
            ['reports', 'Status reports'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-[color:var(--accent)] font-semibold' : 'border-transparent text-[color:var(--text-muted)]'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'risks' ? <Risks projectId={projectId} /> : <Reports projectId={projectId} />}
    </div>
  );
}

function Risks({ projectId }: { projectId: string }) {
  const base = `/projects/${projectId}/governance/risks`;
  return (
    <CrudPage
      title="Risk register"
      subtitle="Probability × impact (1–5 each). Open risks feed the project's status report health."
      endpoint={base}
      createLabel="Add risk"
      columns={[
        { header: 'Risk', render: (r) => <div><div className="font-medium">{String(r.title)}</div><div className="text-[11px] text-[color:var(--text-muted)]">{String(r.category ?? '')}</div></div> },
        { header: 'Score', render: (r) => <StatusPill label={`${score(r)} (P${r.probability}·I${r.impact})`} tone={score(r) >= 15 ? 'red' : score(r) >= 8 ? 'amber' : 'green'} /> },
        { header: 'Status', render: (r) => <StatusPill label={String(r.status)} tone={r.status === 'closed' ? 'slate' : r.status === 'occurred' ? 'red' : 'blue'} /> },
        { header: 'Owner', render: (r) => String((r.ownerId as Row)?.name ?? '—') },
        { header: 'Mitigation', render: (r) => <span className="line-clamp-2 text-[color:var(--text-muted)]">{String(r.mitigation ?? '')}</span> },
        { header: 'Review', render: (r) => fmtDate(r.reviewDate) },
      ]}
      fields={[
        { key: 'title', label: 'Risk', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'category', label: 'Category', placeholder: 'e.g. scope, schedule, vendor, technical' },
        { key: 'probability', label: 'Probability (1–5)', type: 'number', defaultValue: 3 },
        { key: 'impact', label: 'Impact (1–5)', type: 'number', defaultValue: 3 },
        { key: 'status', label: 'Status', type: 'select', defaultValue: 'open', options: ['open', 'mitigating', 'closed', 'occurred'].map((v) => ({ value: v, label: v })) },
        { key: 'ownerId', label: 'Owner', type: 'select', optionsFrom: { endpoint: '/core/people' } },
        { key: 'mitigation', label: 'Mitigation plan', type: 'textarea' },
        { key: 'reviewDate', label: 'Next review', type: 'date' },
      ]}
    />
  );
}

function Reports({ projectId }: { projectId: string }) {
  const { token } = useAuth();
  const base = `/projects/${projectId}/governance/status-reports`;
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [drafting, setDrafting] = useState(false);
  const load = useCallback(() => {
    if (!token) return;
    api.get<Row[]>(base, token).then((r) => setRows(Array.isArray(r.data) ? r.data : []));
  }, [token, base]);
  useEffect(load, [load]);

  const draft = async () => {
    if (!token) return;
    setDrafting(true);
    const r = await api.post<Row>(`${base}/draft`, {}, token);
    setDrafting(false);
    if (!r.success || !r.data) return alert(r.message);
    const d = r.data;
    setEdit({
      title: `Status · ${fmtDate(d.periodEnd)}`,
      periodStart: String(d.periodStart).slice(0, 10),
      periodEnd: String(d.periodEnd).slice(0, 10),
      health: d.health,
      summary: d.summary ?? '',
      accomplishments: '',
      nextSteps: '',
      risksAndIssues: '',
      metrics: d.metrics,
      shareWithCustomer: true,
    });
  };
  const save = async (publish: boolean) => {
    if (!token || !edit) return;
    const body = { ...edit, publish };
    const r = edit._id ? await api.patch(`${base}/${edit._id}`, body, token) : await api.post(base, body, token);
    if (!r.success) return alert(r.message);
    setEdit(null);
    load();
  };
  const m = (edit?.metrics as Row) ?? {};
  return (
    <SectionPage
      title="Status reports"
      subtitle="Weekly / periodic client updates. Metrics are captured automatically; published reports marked as shared appear in the client portal."
      toolbar={<PrimaryButton disabled={drafting} onClick={draft}>{drafting ? 'Preparing…' : 'New report'}</PrimaryButton>}
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={String(r._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{String(r.title)}</span>
              <StatusPill label={String(r.health)} tone={HEALTH_TONE[String(r.health) as 'green'] ?? 'slate'} />
              {r.publishedAt ? <StatusPill label={r.shareWithCustomer ? 'published · client' : 'published · internal'} tone="blue" /> : <StatusPill label="draft" tone="amber" />}
              <span className="ml-auto text-[11px] text-[color:var(--text-muted)]">
                {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
              </span>
              <button className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setEdit({ ...r, periodStart: String(r.periodStart).slice(0, 10), periodEnd: String(r.periodEnd).slice(0, 10) })}>
                Open
              </button>
            </div>
            {r.summary ? <p className="mt-2 text-sm text-[color:var(--text-muted)] line-clamp-3 whitespace-pre-wrap">{String(r.summary)}</p> : null}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No reports yet.</p>}
      </div>
      {edit && (
        <Modal
          wide
          title={edit._id ? String(edit.title) : 'New status report'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <GhostButton onClick={() => setEdit(null)}>Cancel</GhostButton>
              <GhostButton onClick={() => save(false)}>Save draft</GhostButton>
              <PrimaryButton onClick={() => save(true)}>{edit.publishedAt ? 'Save' : 'Publish'}</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ['Completed', m.completed],
              ['Created', m.created],
              ['Open', m.open],
              ['Overdue', m.overdue],
              ['Open risks', m.openRisks],
              ['Sprint', m.activeSprint ? `${m.activeSprint} · ${m.sprintProgress ?? 0}%` : '—'],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-[color:var(--border-subtle)] px-2 py-1.5">
                <div className="text-[color:var(--text-muted)]">{String(k)}</div>
                <div className="font-semibold">{String(v ?? '—')}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field label="Title">
              <TextInput value={String(edit.title ?? '')} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Health">
              <Select value={String(edit.health)} onChange={(e) => setEdit({ ...edit, health: e.target.value })}>
                <option value="green">Green</option>
                <option value="amber">Amber</option>
                <option value="red">Red</option>
              </Select>
            </Field>
          </div>
          {!edit._id && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start">
                <TextInput type="date" value={String(edit.periodStart)} onChange={(e) => setEdit({ ...edit, periodStart: e.target.value })} />
              </Field>
              <Field label="Period end">
                <TextInput type="date" value={String(edit.periodEnd)} onChange={(e) => setEdit({ ...edit, periodEnd: e.target.value })} />
              </Field>
            </div>
          )}
          {(
            [
              ['summary', 'Summary'],
              ['accomplishments', 'Accomplishments'],
              ['nextSteps', 'Next steps'],
              ['risksAndIssues', 'Risks & issues'],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l}>
              <TextArea rows={k === 'summary' ? 4 : 3} value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(edit.shareWithCustomer)} onChange={(e) => setEdit({ ...edit, shareWithCustomer: e.target.checked })} /> Share with the client in the customer portal
          </label>
        </Modal>
      )}
    </SectionPage>
  );
}

/** Customer portal: published reports for the customer's projects. */
export function PortalStatusReports() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    api.get<Row[]>('/customer/status-reports', token).then((r) => (r.success ? setRows(r.data ?? []) : setError(r.message ?? 'Failed')));
  }, [token]);
  return (
    <div className="p-4 md:p-8 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Project status reports</h1>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {rows.length === 0 && !error && <p className="text-sm text-[color:var(--text-muted)]">No reports have been shared yet.</p>}
      {rows.map((r) => (
        <article key={String(r._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{String(r.title)}</span>
            <StatusPill label={String(r.health)} tone={HEALTH_TONE[String(r.health) as 'green'] ?? 'slate'} />
            <span className="ml-auto text-[11px] text-[color:var(--text-muted)]">
              {String((r.project as Row)?.name ?? '')} · {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
            </span>
          </header>
          {(
            [
              ['summary', 'Summary'],
              ['accomplishments', 'Accomplishments'],
              ['nextSteps', 'Next steps'],
              ['risksAndIssues', 'Risks & issues'],
            ] as const
          )
            .filter(([k]) => String(r[k] ?? '').trim())
            .map(([k, l]) => (
              <section key={k}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">{l}</h3>
                <p className="text-sm whitespace-pre-wrap">{String(r[k])}</p>
              </section>
            ))}
        </article>
      ))}
    </div>
  );
}
