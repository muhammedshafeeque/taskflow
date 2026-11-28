import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useProjectPermissions } from '../hooks/useProjectPermissions';
import { projectsApi, requirementsApi, type ChangeRequest, type ProjectMember, type Requirement } from '../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../components/moduleKit';

const REQ_TONE: Record<Requirement['status'], 'slate' | 'amber' | 'green' | 'red'> = { draft: 'slate', awaiting_signoff: 'amber', signed_off: 'green', rejected: 'red' };
const REQ_LABEL: Record<Requirement['status'], string> = { draft: 'draft', awaiting_signoff: 'waiting for sign-off', signed_off: 'signed off', rejected: 'rejected by customer' };
const CR_TONE: Record<ChangeRequest['status'], 'slate' | 'amber' | 'green' | 'red'> = { draft: 'slate', pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate' };
const ROLE: Record<string, string> = { ba_lead: 'BA lead', pm: 'Project manager', customer: 'Customer' };
const refName = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name?: string }).name ?? '') : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : v ? String(v) : '');
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '');
const impact = (c: Pick<ChangeRequest, 'costImpact' | 'currency' | 'scheduleImpactDays'>) =>
  `${c.currency} ${c.costImpact.toLocaleString()} · ${c.scheduleImpactDays === 0 ? 'no date change' : `${c.scheduleImpactDays > 0 ? '+' : ''}${c.scheduleImpactDays} day(s)`}`;

type Msg = { ok: boolean; text: string } | null;

/** Requirements with customer sign-off, and change requests (AUT-44). */
export default function ProjectRequirements() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'requirements' | 'changes' | 'settings'>(params.get('cr') ? 'changes' : 'requirements');
  const { can } = useProjectPermissions(projectId);
  const canManage = can('project.requirement.manage');
  if (!projectId) return null;
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[color:var(--border-subtle)] px-4 sm:px-6 lg:px-8 pt-4" role="tablist">
        {(
          [
            ['requirements', 'Requirements'],
            ['changes', 'Change requests'],
            ['settings', 'Approvers'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-[color:var(--accent)] font-semibold' : 'border-transparent text-[color:var(--text-muted)]'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'requirements' ? <Requirements projectId={projectId} canManage={canManage} /> : tab === 'changes' ? <Changes projectId={projectId} canManage={canManage} /> : <Approvers projectId={projectId} canManage={canManage} />}
    </div>
  );
}

function Requirements({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<Requirement[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => {
    if (!token) return;
    void requirementsApi.list(projectId, token).then((r) => setRows(r.success && Array.isArray(r.data) ? r.data : []));
  }, [token, projectId]);
  useEffect(load, [load]);
  const replace = (r: Requirement) => setRows((list) => (list ?? []).map((x) => (x._id === r._id ? r : x)));

  return (
    <SectionPage
      title="Requirements"
      subtitle="Write each requirement, send a version to the customer, and they sign it off in the portal. After sign-off, changes go through a change request."
      toolbar={canManage && <PrimaryButton type="button" onClick={() => setCreating(true)}>New requirement</PrimaryButton>}
    >
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
      {rows === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No requirements yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 text-sm" data-testid="requirement">
              <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === r._id ? null : r._id)}>
                <span className="font-mono text-xs text-[color:var(--text-muted)]">{r.key}</span>
                <span className="font-medium">{r.title}</span>
                <StatusPill label={REQ_LABEL[r.status]} tone={REQ_TONE[r.status]} />
                <span className="ml-auto text-xs text-[color:var(--text-muted)]">v{r.versions[r.versions.length - 1]?.version ?? 1}</span>
              </button>
              {open === r._id && <RequirementDetail projectId={projectId} requirement={r} canManage={canManage} onChange={replace} onMessage={setMsg} />}
            </div>
          ))}
        </div>
      )}
      {creating && (
        <RequirementModal
          onClose={() => setCreating(false)}
          onSave={async (body) => {
            const r = await requirementsApi.create(projectId, body, token!);
            if (!r.success || !r.data) return r.message ?? 'Could not save';
            setCreating(false);
            setRows((list) => [r.data!, ...(list ?? [])]);
            setOpen(r.data._id);
            return null;
          }}
        />
      )}
    </SectionPage>
  );
}

function RequirementModal({ initial, title, onClose, onSave }: { initial?: { title?: string; content?: string; summary?: string }; title?: string; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<string | null> }) {
  const [form, setForm] = useState({ title: initial?.title ?? '', content: initial?.content ?? '', summary: initial?.summary ?? '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title ?? 'New requirement'}
      wide
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const e = await onSave(form);
              setBusy(false);
              if (e) setError(e);
            }}
          >
            Save
          </PrimaryButton>
        </>
      }
    >
      <Field label="Title"><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Requirement"><TextArea rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="What the system must do, acceptance criteria, out of scope…" /></Field>
      <Field label="What changed in this version"><TextInput value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </Modal>
  );
}

function RequirementDetail({ projectId, requirement: r, canManage, onChange, onMessage }: { projectId: string; requirement: Requirement; canManage: boolean; onChange: (r: Requirement) => void; onMessage: (m: Msg) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState<'edit' | 'version' | null>(null);
  const [approvedChanges, setApprovedChanges] = useState<ChangeRequest[]>([]);
  const last = r.versions[r.versions.length - 1];
  const everSigned = r.versions.some((v) => v.signOff?.decision === 'signed');
  useEffect(() => {
    if (!token || !everSigned) return;
    void requirementsApi.changes(projectId, token).then((res) => {
      const used = new Set(r.versions.map((v) => refId(v.changeRequestId)).filter(Boolean));
      setApprovedChanges((res.data ?? []).filter((c) => c.status === 'approved' && !used.has(c._id) && (!c.requirementId || refId(c.requirementId) === r._id)));
    });
  }, [token, projectId, everSigned, r]);

  const act = async (call: () => Promise<{ success: boolean; data?: Requirement; message?: string }>, ok: string) => {
    const res = await call();
    if (!res.success || !res.data) return onMessage({ ok: false, text: res.message ?? 'Could not save' });
    onChange(res.data);
    onMessage({ ok: true, text: ok });
  };

  return (
    <div className="mt-3 space-y-3 border-t border-[color:var(--border-subtle)] pt-3">
      {[...r.versions].reverse().map((v) => (
        <div key={v.version} className="rounded-lg border border-[color:var(--border-subtle)] p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <strong>Version {v.version}</strong>
            {v.summary && <span className="text-[color:var(--text-muted)]">— {v.summary}</span>}
            {refId(v.changeRequestId) && <span className="text-[color:var(--text-muted)]">for {typeof v.changeRequestId === 'object' && v.changeRequestId ? v.changeRequestId.key : 'a change request'}</span>}
            <span className="ml-auto">
              {v.signOff ? (
                <StatusPill label={`${v.signOff.decision === 'signed' ? 'signed off' : 'rejected'} by ${v.signOff.by?.name ?? 'customer'} ${day(v.signOff.at)}`} tone={v.signOff.decision === 'signed' ? 'green' : 'red'} />
              ) : v.sentAt ? (
                <StatusPill label={`sent ${day(v.sentAt)}, waiting for sign-off`} tone="amber" />
              ) : (
                <StatusPill label="draft" tone="slate" />
              )}
            </span>
          </div>
          {v.signOff?.note && <p className="mt-1 text-xs text-[color:var(--text-muted)]">Customer: {v.signOff.note}</p>}
          <p className="mt-2 whitespace-pre-wrap text-xs">{v.content || '—'}</p>
        </div>
      ))}

      {canManage && last && (
        <div className="flex flex-wrap items-center gap-2">
          {!last.sentAt && (
            <>
              <GhostButton type="button" onClick={() => setEditing('edit')}>Edit draft</GhostButton>
              <PrimaryButton type="button" onClick={() => act(() => requirementsApi.send(projectId, r._id, token!), `Version ${last.version} sent to the customer for sign-off.`)}>
                Send version {last.version} for sign-off
              </PrimaryButton>
            </>
          )}
          {last.signOff && (!everSigned ? (
            <GhostButton type="button" onClick={() => setEditing('version')}>Start version {last.version + 1}</GhostButton>
          ) : approvedChanges.length ? (
            <GhostButton type="button" onClick={() => setEditing('version')}>Start version {last.version + 1} from a change request</GhostButton>
          ) : (
            <span className="text-xs text-[color:var(--text-muted)]">Signed off. To change it, raise a change request and get it approved.</span>
          ))}
        </div>
      )}

      {editing === 'edit' && last && (
        <RequirementModal
          title={`Edit version ${last.version}`}
          initial={{ title: r.title, content: last.content, summary: last.summary }}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const res = await requirementsApi.update(projectId, r._id, body, token!);
            if (!res.success || !res.data) return res.message ?? 'Could not save';
            onChange(res.data);
            setEditing(null);
            return null;
          }}
        />
      )}
      {editing === 'version' && last && (
        <NewVersionModal
          next={last.version + 1}
          content={last.content}
          changes={everSigned ? approvedChanges : []}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const res = await requirementsApi.newVersion(projectId, r._id, body, token!);
            if (!res.success || !res.data) return res.message ?? 'Could not save';
            onChange(res.data);
            setEditing(null);
            return null;
          }}
        />
      )}
    </div>
  );
}

function NewVersionModal({ next, content, changes, onClose, onSave }: { next: number; content: string; changes: ChangeRequest[]; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<string | null> }) {
  const [form, setForm] = useState({ content, summary: '', changeRequestId: changes[0]?._id ?? '' });
  const [error, setError] = useState('');
  return (
    <Modal
      title={`Version ${next}`}
      wide
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="button" onClick={async () => setError((await onSave({ ...form, changeRequestId: form.changeRequestId || undefined })) ?? '')}>Save draft</PrimaryButton>
        </>
      }
    >
      {changes.length > 0 && (
        <Field label="Approved change request">
          <Select value={form.changeRequestId} onChange={(e) => setForm({ ...form, changeRequestId: e.target.value })}>
            {changes.map((c) => <option key={c._id} value={c._id}>{c.key} {c.title}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Requirement"><TextArea rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
      <Field label="What changed"><TextInput value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </Modal>
  );
}

function Changes({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { token, user } = useAuth();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<ChangeRequest[] | null>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [editing, setEditing] = useState<ChangeRequest | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(params.get('cr'));
  const [msg, setMsg] = useState<Msg>(null);
  const [approvers, setApprovers] = useState<{ ba: string; pm: string }>({ ba: '', pm: '' });
  const load = useCallback(() => {
    if (!token) return;
    void requirementsApi.changes(projectId, token).then((r) => setRows(r.success && Array.isArray(r.data) ? r.data : []));
    void requirementsApi.list(projectId, token).then((r) => setReqs(r.data ?? []));
    void requirementsApi.settings(projectId, token).then((r) => setApprovers({ ba: refId(r.data?.baLeadUserId), pm: refId(r.data?.projectManager) }));
  }, [token, projectId]);
  useEffect(load, [load]);
  const replace = (c: ChangeRequest) => setRows((list) => (list ?? []).map((x) => (x._id === c._id ? c : x)));

  const act = async (c: ChangeRequest, action: 'submit' | 'approve' | 'reject' | 'cancel') => {
    let note: string | undefined;
    if (action === 'reject') {
      note = window.prompt('Why is this change rejected?') ?? '';
      if (!note.trim()) return;
    }
    if (action === 'cancel' && !window.confirm(`Cancel ${c.key}?`)) return;
    const r = await requirementsApi.changeAction(projectId, c._id, action, token!, note);
    if (!r.success || !r.data) return setMsg({ ok: false, text: r.message ?? 'Could not update' });
    replace(r.data);
    setMsg({ ok: true, text: action === 'submit' ? 'Sent to the BA lead for approval.' : action === 'approve' ? 'Approved.' : action === 'reject' ? 'Rejected.' : 'Cancelled.' });
  };
  const link = async (c: ChangeRequest, body: { issueKey?: string; title?: string }) => {
    const r = await requirementsApi.linkIssue(projectId, c._id, body, token!);
    if (!r.success || !r.data) return setMsg({ ok: false, text: r.message ?? 'Could not link' });
    replace(r.data);
  };

  return (
    <SectionPage
      title="Change requests"
      subtitle="Each change records its cost and date impact. It is approved by the BA lead, then the project manager, then the customer in the portal. Approved changes are linked to the stories that deliver them."
      toolbar={canManage && <PrimaryButton type="button" onClick={() => setEditing('new')}>New change request</PrimaryButton>}
    >
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
      {rows === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No change requests yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const pending = c.steps.find((s) => s.status === 'pending');
            const myTurn = c.status === 'pending' && pending && pending.role !== 'customer' && (pending.role === 'ba_lead' ? approvers.ba : approvers.pm) === user?.id;
            return (
              <div key={c._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 text-sm" data-testid="change-request">
                <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === c._id ? null : c._id)}>
                  <span className="font-mono text-xs text-[color:var(--text-muted)]">{c.key}</span>
                  <span className="font-medium">{c.title}</span>
                  <StatusPill label={c.status === 'pending' && pending ? `waiting for ${ROLE[pending.role].toLowerCase()}` : c.status} tone={CR_TONE[c.status]} />
                  <span className="ml-auto text-xs text-[color:var(--text-muted)]">{impact(c)}</span>
                </button>
                {open === c._id && (
                  <div className="mt-3 space-y-3 border-t border-[color:var(--border-subtle)] pt-3">
                    {typeof c.requirementId === 'object' && c.requirementId && <p className="text-xs text-[color:var(--text-muted)]">Changes {c.requirementId.key} {c.requirementId.title}</p>}
                    <p className="whitespace-pre-wrap text-xs">{c.description || '—'}</p>
                    <ol className="space-y-1 text-xs">
                      {c.steps.map((s) => (
                        <li key={s.role} className="flex flex-wrap items-center gap-2">
                          <span className="w-32 font-medium">{ROLE[s.role]}</span>
                          <StatusPill label={s.status} tone={s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : s.status === 'pending' ? 'amber' : 'slate'} />
                          {(refName(s.userId) || s.customer?.name) && <span>{refName(s.userId) || s.customer?.name} {day(s.at)}</span>}
                          {s.note && <span className="text-[color:var(--text-muted)]">— {s.note}</span>}
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      {canManage && (c.status === 'draft' || c.status === 'rejected') && (
                        <>
                          <GhostButton type="button" onClick={() => setEditing(c)}>Edit</GhostButton>
                          <PrimaryButton type="button" onClick={() => act(c, 'submit')}>Send for approval</PrimaryButton>
                        </>
                      )}
                      {myTurn && (
                        <>
                          <PrimaryButton type="button" onClick={() => act(c, 'approve')}>Approve as {ROLE[pending!.role].toLowerCase()}</PrimaryButton>
                          <GhostButton type="button" onClick={() => act(c, 'reject')}>Reject</GhostButton>
                        </>
                      )}
                      {canManage && ['draft', 'pending', 'rejected'].includes(c.status) && <GhostButton type="button" onClick={() => act(c, 'cancel')}>Cancel</GhostButton>}
                    </div>
                    {c.status === 'approved' && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Stories</p>
                        {c.linkedIssueIds.length === 0 && <p className="text-xs text-[color:var(--text-muted)]">No stories linked yet.</p>}
                        {c.linkedIssueIds.map((i) => (
                          <div key={i._id} className="flex items-center gap-2 text-xs">
                            <a className="text-[color:var(--accent)] hover:underline" href={`/projects/${projectId}/issues/${encodeURIComponent(i.key ?? i._id)}`}>{i.key}</a>
                            <span>{i.title}</span>
                            <span className="text-[color:var(--text-muted)]">{i.status}</span>
                            {canManage && (
                              <button type="button" className="ml-auto text-[color:var(--text-muted)] hover:text-rose-500" onClick={async () => { const r = await requirementsApi.unlinkIssue(projectId, c._id, i._id, token!); if (r.success && r.data) replace(r.data); }}>
                                Unlink
                              </button>
                            )}
                          </div>
                        ))}
                        {canManage && <LinkStory onLink={(body) => link(c, body)} />}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <ChangeModal
          change={editing === 'new' ? undefined : editing}
          requirements={reqs}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const r = editing === 'new' ? await requirementsApi.createChange(projectId, body, token!) : await requirementsApi.updateChange(projectId, editing._id, body, token!);
            if (!r.success || !r.data) return r.message ?? 'Could not save';
            setEditing(null);
            load();
            setOpen(r.data._id);
            return null;
          }}
        />
      )}
    </SectionPage>
  );
}

function LinkStory({ onLink }: { onLink: (body: { issueKey?: string; title?: string }) => void }) {
  const [value, setValue] = useState('');
  const isKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(value.trim());
  return (
    <div className="flex gap-2 pt-1">
      <TextInput placeholder="Issue key (e.g. APP-12) or a title for a new story" value={value} onChange={(e) => setValue(e.target.value)} />
      <GhostButton
        type="button"
        disabled={!value.trim()}
        onClick={() => {
          onLink(isKey ? { issueKey: value.trim() } : { title: value.trim() });
          setValue('');
        }}
      >
        {isKey ? 'Link issue' : 'Create story'}
      </GhostButton>
    </div>
  );
}

function ChangeModal({ change, requirements, onClose, onSave }: { change?: ChangeRequest; requirements: Requirement[]; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<string | null> }) {
  const [form, setForm] = useState({
    title: change?.title ?? '',
    description: change?.description ?? '',
    requirementId: refId(change?.requirementId),
    costImpact: String(change?.costImpact ?? 0),
    currency: change?.currency ?? 'USD',
    scheduleImpactDays: String(change?.scheduleImpactDays ?? 0),
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal
      title={change ? `Edit ${change.key}` : 'New change request'}
      wide
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="button" onClick={async () => setError((await onSave({ ...form, requirementId: form.requirementId || null, costImpact: Number(form.costImpact), scheduleImpactDays: Number(form.scheduleImpactDays) })) ?? '')}>
            Save
          </PrimaryButton>
        </>
      }
    >
      {change?.status === 'rejected' && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs">Rejected: {change.steps.find((s) => s.status === 'rejected')?.note}</p>}
      <Field label="Title"><TextInput value={form.title} onChange={set('title')} /></Field>
      <Field label="Requirement it changes">
        <Select value={form.requirementId} onChange={set('requirementId')}>
          <option value="">None</option>
          {requirements.map((r) => <option key={r._id} value={r._id}>{r.key} {r.title}</option>)}
        </Select>
      </Field>
      <Field label="What changes and why"><TextArea rows={6} value={form.description} onChange={set('description')} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cost impact"><TextInput type="number" step="0.01" value={form.costImpact} onChange={set('costImpact')} /></Field>
        <Field label="Currency"><TextInput maxLength={3} value={form.currency} onChange={set('currency')} /></Field>
        <Field label="Date impact (days)"><TextInput type="number" step="1" value={form.scheduleImpactDays} onChange={set('scheduleImpactDays')} /></Field>
      </div>
      <p className="text-[11px] text-[color:var(--text-muted)]">Use a negative cost or number of days for savings or an earlier date.</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </Modal>
  );
}

function Approvers({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { token } = useAuth();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [baLead, setBaLead] = useState('');
  const [pm, setPm] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (!token) return;
    void projectsApi.getMembers(projectId, token).then((r) => setMembers(r.data ?? []));
    void requirementsApi.settings(projectId, token).then((r) => {
      setBaLead(refId(r.data?.baLeadUserId));
      setPm(refName(r.data?.projectManager));
    });
  }, [token, projectId]);
  return (
    <SectionPage title="Approvers" subtitle="Change requests are approved by the BA lead, then the project manager (the project lead), then the customer in the portal.">
      <div className="max-w-md space-y-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
        <Field label="BA lead">
          <Select value={baLead} disabled={!canManage} onChange={(e) => setBaLead(e.target.value)}>
            <option value="">Not chosen</option>
            {members.map((m) => <option key={m.user._id} value={m.user._id}>{m.user.name}</option>)}
          </Select>
        </Field>
        <p className="text-xs">Project manager: <strong>{pm || 'no project lead'}</strong> <span className="text-[color:var(--text-muted)]">(change it in project settings)</span></p>
        <p className="text-xs text-[color:var(--text-muted)]">Customer: anyone in a customer organisation this project is shared with, who has the requirement approve permission in the portal.</p>
        {canManage && (
          <PrimaryButton
            type="button"
            onClick={async () => {
              const r = await requirementsApi.saveSettings(projectId, { baLeadUserId: baLead || null }, token!);
              setMsg(r.success ? { ok: true, text: 'Saved.' } : { ok: false, text: r.message ?? 'Could not save' });
            }}
          >
            Save
          </PrimaryButton>
        )}
        {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
      </div>
    </SectionPage>
  );
}
