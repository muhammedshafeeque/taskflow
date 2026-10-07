import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { fmtDate, type Row } from '../../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../../components/moduleKit';

const P = {
  status: 'taskflow.monitor.status_page.manage',
  pmRead: 'taskflow.monitor.postmortem.read',
  pmManage: 'taskflow.monitor.postmortem.manage',
};
const STATES = ['investigating', 'identified', 'monitoring', 'resolved'];

function useRows(path: string | null) {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const reload = useCallback(() => {
    if (!token || !path) return;
    api.get<Row[]>(path, token).then((r) => setRows(Array.isArray(r.data) ? r.data : []));
  }, [token, path]);
  useEffect(reload, [reload]);
  return { rows, reload };
}

/** Public status pages built from uptime checks, with incident updates. */
export function MonitorStatusPages() {
  const { token, user } = useAuth();
  const pages = useRows(canAny(user, P.status) ? '/monitor/status-pages' : null);
  const projects = useRows('/monitor/projects');
  const [checks, setChecks] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [incident, setIncident] = useState<{ page: Row; incident?: Row; status: string; title: string; impact: string; message: string } | null>(null);

  useEffect(() => {
    if (!token || !projects.rows.length) return;
    Promise.all(projects.rows.map((p) => api.get<Row[]>(`/monitor/projects/${p._id}/uptime`, token).then((r) => (Array.isArray(r.data) ? r.data.map((c) => ({ ...c, projectName: p.name })) : []))))
      .then((lists) => setChecks(lists.flat()));
  }, [token, projects.rows]);

  const save = async () => {
    if (!token || !edit) return;
    const body = { slug: edit.slug, title: edit.title, description: edit.description, logoUrl: edit.logoUrl, published: Boolean(edit.published), components: edit.components };
    const r = edit._id ? await api.patch(`/monitor/status-pages/${edit._id}`, body, token) : await api.post('/monitor/status-pages', body, token);
    if (!r.success) return alert(r.message);
    setEdit(null);
    pages.reload();
  };
  const postIncident = async () => {
    if (!token || !incident) return;
    const r = incident.incident
      ? await api.post(`/monitor/status-pages/${incident.page._id}/incidents/${incident.incident._id}/updates`, { status: incident.status, message: incident.message }, token)
      : await api.post(`/monitor/status-pages/${incident.page._id}/incidents`, { title: incident.title, impact: incident.impact, message: incident.message }, token);
    if (!r.success) return alert(r.message);
    setIncident(null);
    pages.reload();
  };
  const comps = (edit?.components as Row[]) ?? [];
  return (
    <SectionPage
      title="Status pages"
      subtitle="Public pages at /status/<slug> showing uptime of chosen checks and the incidents you post."
      toolbar={<PrimaryButton onClick={() => setEdit({ slug: '', title: '', published: false, components: [] })}>New status page</PrimaryButton>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {pages.rows.map((p) => {
          const open = ((p.incidents as Row[]) ?? []).filter((i) => i.status !== 'resolved');
          return (
            <div key={String(p._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{String(p.title)}</div>
                  <a href={`/status/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-[color:var(--accent)] hover:underline">
                    /status/{String(p.slug)}
                  </a>
                </div>
                <StatusPill label={p.published ? 'public' : 'hidden'} tone={p.published ? 'green' : 'slate'} />
              </div>
              <div className="text-xs text-[color:var(--text-muted)]">{((p.components as Row[]) ?? []).length} component(s) · {open.length} open incident(s)</div>
              {open.map((i) => (
                <div key={String(i._id)} className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs">
                  <span>
                    {String(i.title)} · {String(i.status)}
                  </span>
                  <button className="text-[color:var(--accent)]" onClick={() => setIncident({ page: p, incident: i, status: String(i.status), title: '', impact: '', message: '' })}>
                    Post update
                  </button>
                </div>
              ))}
              <div className="flex gap-3 text-xs">
                <button className="text-[color:var(--accent)]" onClick={() => setEdit(p)}>
                  Edit
                </button>
                <button className="text-amber-600" onClick={() => setIncident({ page: p, status: 'investigating', title: '', impact: 'minor', message: '' })}>
                  Report incident
                </button>
                <button
                  className="text-rose-500"
                  onClick={async () => {
                    if (token && confirm('Delete this status page?')) {
                      await api.delete(`/monitor/status-pages/${p._id}`, token);
                      pages.reload();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {pages.rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No status pages yet.</p>}
      </div>
      {edit && (
        <Modal
          wide
          title={edit._id ? 'Edit status page' : 'New status page'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <GhostButton onClick={() => setEdit(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={save}>Save</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title">
              <TextInput value={String(edit.title ?? '')} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Slug (URL)">
              <TextInput value={String(edit.slug ?? '')} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </Field>
          </div>
          <Field label="Description">
            <TextInput value={String(edit.description ?? '')} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <Field label="Logo URL">
            <TextInput value={String(edit.logoUrl ?? '')} onChange={(e) => setEdit({ ...edit, logoUrl: e.target.value })} />
          </Field>
          <Field label="Components (public name → uptime check)">
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <TextInput placeholder="Public name" value={String(c.name ?? '')} onChange={(e) => setEdit({ ...edit, components: comps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <Select value={String(c.checkId ?? '')} onChange={(e) => setEdit({ ...edit, components: comps.map((x, j) => (j === i ? { ...x, checkId: e.target.value } : x)) })}>
                    <option value="">— check —</option>
                    {checks.map((k) => (
                      <option key={String(k._id)} value={String(k._id)}>
                        {String(k.projectName)} · {String(k.name)}
                      </option>
                    ))}
                  </Select>
                  <button className="text-rose-500" onClick={() => setEdit({ ...edit, components: comps.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <GhostButton onClick={() => setEdit({ ...edit, components: [...comps, { name: '', checkId: '' }] })}>+ Component</GhostButton>
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(edit.published)} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} /> Publicly visible
          </label>
        </Modal>
      )}
      {incident && (
        <Modal
          title={incident.incident ? `Update: ${incident.incident.title}` : 'Report incident'}
          onClose={() => setIncident(null)}
          footer={
            <>
              <GhostButton onClick={() => setIncident(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={postIncident}>Post</PrimaryButton>
            </>
          }
        >
          {!incident.incident && (
            <>
              <Field label="Title">
                <TextInput value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} />
              </Field>
              <Field label="Impact">
                <Select value={incident.impact} onChange={(e) => setIncident({ ...incident, impact: e.target.value })}>
                  {['none', 'minor', 'major', 'critical'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          {incident.incident && (
            <Field label="Status">
              <Select value={incident.status} onChange={(e) => setIncident({ ...incident, status: e.target.value })}>
                {STATES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Public message">
            <TextArea rows={4} value={incident.message} onChange={(e) => setIncident({ ...incident, message: e.target.value })} />
          </Field>
        </Modal>
      )}
    </SectionPage>
  );
}

/** Blameless postmortems for outages and serious errors. */
export function MonitorPostmortems() {
  const { token, user } = useAuth();
  const manage = canAny(user, P.pmManage);
  const list = useRows('/monitor/postmortems');
  const projects = useRows('/monitor/projects');
  const [edit, setEdit] = useState<Row | null>(null);
  const save = async () => {
    if (!token || !edit) return;
    const { _id, authorId: _a, createdAt: _c, updatedAt: _u, taskflowOrganizationId: _o, __v: _v, ...body } = edit;
    const clean = { ...body, actionItems: ((body.actionItems as Row[]) ?? []).map((a) => ({ ...a, ownerId: (a.ownerId as Row)?._id ?? a.ownerId ?? undefined })) };
    const r = _id ? await api.patch(`/monitor/postmortems/${_id}`, clean, token) : await api.post('/monitor/postmortems', clean, token);
    if (!r.success) return alert(r.message);
    setEdit(null);
    list.reload();
  };
  const timeline = (edit?.timeline as Row[]) ?? [];
  const actions = (edit?.actionItems as Row[]) ?? [];
  return (
    <SectionPage
      title="Postmortems"
      subtitle="What happened, why, and what we'll change. Keep them blameless."
      toolbar={manage && <PrimaryButton onClick={() => setEdit({ title: '', severity: 'sev3', status: 'draft', timeline: [], actionItems: [] })}>New postmortem</PrimaryButton>}
    >
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
              {['Title', 'Severity', 'Started', 'Resolved', 'Actions done', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.rows.map((p) => {
              const ai = (p.actionItems as Row[]) ?? [];
              return (
                <tr key={String(p._id)} className="border-b border-[color:var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 font-medium">{String(p.title)}</td>
                  <td className="px-4 py-2.5">{String(p.severity ?? '')}</td>
                  <td className="px-4 py-2.5">{fmtDate(p.startedAt, true)}</td>
                  <td className="px-4 py-2.5">{fmtDate(p.resolvedAt, true)}</td>
                  <td className="px-4 py-2.5">
                    {ai.filter((a) => a.done).length}/{ai.length}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill label={String(p.status)} tone={p.status === 'published' ? 'green' : 'amber'} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setEdit(p)}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  No postmortems yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          wide
          title={edit._id ? String(edit.title) : 'New postmortem'}
          onClose={() => setEdit(null)}
          footer={
            manage ? (
              <>
                <GhostButton onClick={() => setEdit(null)}>Cancel</GhostButton>
                <PrimaryButton onClick={save}>Save</PrimaryButton>
              </>
            ) : undefined
          }
        >
          <fieldset disabled={!manage} className="space-y-3">
            <div className="grid grid-cols-[1fr_7rem_8rem] gap-3">
              <Field label="Title">
                <TextInput value={String(edit.title ?? '')} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </Field>
              <Field label="Severity">
                <TextInput value={String(edit.severity ?? '')} onChange={(e) => setEdit({ ...edit, severity: e.target.value })} />
              </Field>
              <Field label="Status">
                <Select value={String(edit.status)} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {['draft', 'in_review', 'published'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Monitor project">
                <Select value={String((edit.monitorProjectId as Row)?._id ?? edit.monitorProjectId ?? '')} onChange={(e) => setEdit({ ...edit, monitorProjectId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {projects.rows.map((p) => (
                    <option key={String(p._id)} value={String(p._id)}>
                      {String(p.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Started">
                <TextInput type="datetime-local" value={edit.startedAt ? new Date(String(edit.startedAt)).toISOString().slice(0, 16) : ''} onChange={(e) => setEdit({ ...edit, startedAt: e.target.value })} />
              </Field>
              <Field label="Resolved">
                <TextInput type="datetime-local" value={edit.resolvedAt ? new Date(String(edit.resolvedAt)).toISOString().slice(0, 16) : ''} onChange={(e) => setEdit({ ...edit, resolvedAt: e.target.value })} />
              </Field>
            </div>
            {(
              [
                ['summary', 'Summary'],
                ['impact', 'Customer impact'],
                ['rootCause', 'Root cause'],
                ['resolution', 'Resolution'],
                ['lessons', 'What we learned'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <TextArea rows={3} value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              </Field>
            ))}
            <Field label="Timeline">
              <div className="space-y-2">
                {timeline.map((t, i) => (
                  <div key={i} className="grid grid-cols-[12rem_1fr_auto] gap-2">
                    <TextInput type="datetime-local" value={t.at ? new Date(String(t.at)).toISOString().slice(0, 16) : ''} onChange={(e) => setEdit({ ...edit, timeline: timeline.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)) })} />
                    <TextInput value={String(t.note ?? '')} onChange={(e) => setEdit({ ...edit, timeline: timeline.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
                    <button type="button" className="text-rose-500" onClick={() => setEdit({ ...edit, timeline: timeline.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <GhostButton type="button" onClick={() => setEdit({ ...edit, timeline: [...timeline, { at: new Date().toISOString(), note: '' }] })}>
                  + Event
                </GhostButton>
              </div>
            </Field>
            <Field label="Action items">
              <div className="space-y-2">
                {actions.map((a, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_8rem_auto] items-center gap-2">
                    <input type="checkbox" checked={Boolean(a.done)} onChange={(e) => setEdit({ ...edit, actionItems: actions.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
                    <TextInput value={String(a.text ?? '')} onChange={(e) => setEdit({ ...edit, actionItems: actions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <TextInput placeholder="Issue key" value={String(a.issueKey ?? '')} onChange={(e) => setEdit({ ...edit, actionItems: actions.map((x, j) => (j === i ? { ...x, issueKey: e.target.value } : x)) })} />
                    <button type="button" className="text-rose-500" onClick={() => setEdit({ ...edit, actionItems: actions.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <GhostButton type="button" onClick={() => setEdit({ ...edit, actionItems: [...actions, { text: '', done: false }] })}>
                  + Action item
                </GhostButton>
              </div>
            </Field>
          </fieldset>
        </Modal>
      )}
    </SectionPage>
  );
}
