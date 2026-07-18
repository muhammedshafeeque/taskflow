import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { documentsApi } from '../../lib/api';
import type { DocumentRecord } from '../../lib/api';
import {
  Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';

const STATUSES = ['draft', 'in_review', 'sent', 'signed', 'approved', 'archived'];
const statusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  draft: 'slate', in_review: 'amber', sent: 'blue', signed: 'green', approved: 'green', archived: 'slate',
};

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function DocList({ kind, title, subtitle, isTemplate = false }: { kind: string; title: string; subtitle: string; isTemplate?: boolean }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<DocumentRecord[]>([]);
  const [editing, setEditing] = useState<Partial<DocumentRecord> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    documentsApi.list(token, { kind, isTemplate }).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token, kind, isTemplate]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    const payload = { ...editing, kind, isTemplate };
    const res = editing._id ? await documentsApi.update(editing._id, payload, token) : await documentsApi.create(payload, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const setStatus = async (id: string, status: string) => { if (!token) return; await documentsApi.update(id, { status }, token); load(); };
  const clone = async (id: string) => { if (!token) return; const res = await documentsApi.clone(id, {}, token); if (res.success) alert('Draft created from template. Find it under Proposals.'); };
  const remove = async (id: string) => { if (!token || !confirm('Delete document?')) return; await documentsApi.remove(id, token); load(); };

  return (
    <SectionPage title={title} subtitle={subtitle} toolbar={<PrimaryButton onClick={() => setEditing({ status: 'draft', currency: 'USD', value: 0 })}>+ New {isTemplate ? 'template' : kind}</PrimaryButton>}>
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">Nothing here yet.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Title</th>
              <th className="text-left px-4 py-2.5 font-medium">Account</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              {!isTemplate && <th className="text-right px-4 py-2.5 font-medium">Value</th>}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d._id} className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]">
                <td className="px-4 py-2.5"><p className="font-medium">{d.title}</p>{d.summary && <p className="text-[11px] text-[color:var(--text-muted)] truncate max-w-xs">{d.summary}</p>}</td>
                <td className="px-4 py-2.5">{nameOf(d.accountId, '—')}</td>
                <td className="px-4 py-2.5"><StatusPill label={d.status} tone={statusTone[d.status]} /></td>
                {!isTemplate && <td className="px-4 py-2.5 text-right tabular-nums">{money(d.value, d.currency)}</td>}
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {isTemplate ? (
                    <button onClick={() => clone(d._id)} className="text-emerald-500 hover:underline text-xs mr-3">Use</button>
                  ) : (
                    <>
                      {d.status === 'draft' && <button onClick={() => setStatus(d._id, 'sent')} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Send</button>}
                      {d.status === 'sent' && <button onClick={() => setStatus(d._id, 'signed')} className="text-emerald-500 hover:underline text-xs mr-3">Mark signed</button>}
                    </>
                  )}
                  <button onClick={() => setEditing(d)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                  <button onClick={() => remove(d._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </>
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit document' : 'New document'} onClose={() => setEditing(null)} wide footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <Field label="Title"><TextInput value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <Field label="Summary"><TextArea rows={2} value={editing.summary ?? ''} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} /></Field>
          {!isTemplate && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Status">
                <Select value={editing.status ?? 'draft'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </Select>
              </Field>
              <Field label="Value"><TextInput type="number" value={editing.value ?? 0} onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })} /></Field>
              <Field label="Currency"><TextInput value={editing.currency ?? 'USD'} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Content"><TextArea rows={5} value={editing.content ?? ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}

export function DocumentsProposals() {
  return <DocList kind="proposal" title="Proposals" subtitle="Customer proposals with value and signature tracking." />;
}
export function DocumentsSows() {
  return <DocList kind="sow" title="SOWs" subtitle="Statements of work and delivery scopes." />;
}
export function DocumentsPolicies() {
  return <DocList kind="policy" title="Policies" subtitle="Company policies and process documentation." />;
}
export function DocumentsTemplates() {
  return <DocList kind="template" title="Templates" subtitle="Reusable templates. Use a template to spin up a new draft proposal." isTemplate />;
}
