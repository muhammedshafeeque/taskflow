import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiLink2, FiPlus, FiX } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { linksApi, type RecordGraph, type RecordGraphEdge, type RecordSummary, type RecordType } from '../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, Select, StatusPill, TextInput } from './moduleKit';

const TYPE_LABEL: Record<RecordType, string> = {
  lead: 'Leads',
  deal: 'Deals',
  quote: 'Quotes',
  contract: 'Contracts',
  account: 'Accounts',
  customer: 'Customers',
  project: 'Projects',
  issue: 'Issues',
  invoice: 'Invoices',
  ticket: 'Tickets',
  employee: 'People',
  asset: 'Assets',
  purchase_order: 'Purchase orders',
};

/** Suggestions only — any short label is accepted. */
const RELATIONS = ['related', 'delivers', 'blocks', 'depends on', 'billed by', 'supports', 'replaces'];

function statusTone(status?: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  const s = (status ?? '').toLowerCase();
  if (/(won|paid|done|closed|resolved|accepted|active|received|completed)/.test(s)) return 'green';
  if (/(lost|overdue|rejected|cancel|expired|terminated|void)/.test(s)) return 'red';
  if (/(pending|draft|sent|progress|review|open)/.test(s)) return 'blue';
  return 'slate';
}

/**
 * Everything linked to one record — explicit links plus the references records
 * already carry (deal → project, ticket → issue, …) — with a picker to add more.
 * Records the viewer cannot open are left out and counted.
 */
export default function RecordLinksPanel({ type, id, className = '' }: { type: RecordType; id: string; className?: string }) {
  const { token } = useAuth();
  const [graph, setGraph] = useState<RecordGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!token || !id) return;
    let live = true;
    void linksApi.graph(type, id, token).then((res) => {
      if (!live) return;
      if (res.success && res.data) {
        setGraph(res.data);
        setError(null);
      } else setError(res.message ?? 'Could not load linked records');
    });
    return () => {
      live = false;
    };
  }, [token, type, id, version]);

  const groups = useMemo(() => {
    const map = new Map<RecordType, RecordGraphEdge[]>();
    for (const e of graph?.edges ?? []) map.set(e.record.type, [...(map.get(e.record.type) ?? []), e]);
    return [...map.entries()];
  }, [graph]);

  async function unlink(edge: RecordGraphEdge) {
    if (!token || !edge.linkId) return;
    const res = await linksApi.remove(edge.linkId, token);
    if (res.success) load();
    else setError(res.message ?? 'Could not remove link');
  }

  return (
    <section
      className={`min-w-0 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FiLink2 className="text-[color:var(--text-muted)]" /> Linked records
        </h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--accent)] hover:underline"
        >
          <FiPlus /> Link
        </button>
      </div>

      {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}
      {!graph && !error && <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>}
      {graph && groups.length === 0 && (
        <p className="text-sm text-[color:var(--text-muted)]">Nothing linked yet. Link a deal, quote, ticket, invoice or any other record.</p>
      )}

      <div className="space-y-4">
        {groups.map(([groupType, edges]) => (
          <div key={groupType}>
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5">
              {TYPE_LABEL[groupType]} · {edges.length}
            </h3>
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {edges.map((e) => (
                <li key={`${e.source}-${e.linkId ?? e.relation}-${e.record.type}-${e.record.id}`} className="flex items-center gap-3 py-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <Link to={e.record.link} className="block truncate text-sm font-medium hover:text-[color:var(--accent)]">
                      {e.record.title}
                    </Link>
                    <p className="truncate text-xs text-[color:var(--text-muted)]">
                      {e.relation}
                      {e.record.subtitle ? ` · ${e.record.subtitle}` : ''}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  {e.record.status && <StatusPill label={e.record.status} tone={statusTone(e.record.status)} />}
                  {e.source === 'link' ? (
                    <button
                      type="button"
                      onClick={() => void unlink(e)}
                      title="Remove link"
                      className="shrink-0 rounded p-1 text-[color:var(--text-muted)] hover:text-rose-500"
                    >
                      <FiX />
                    </button>
                  ) : (
                    <span className="shrink-0 w-6" title="Set on the record itself" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {graph && graph.hidden > 0 && (
        <p className="mt-3 text-xs text-[color:var(--text-muted)]">
          {graph.hidden} linked record{graph.hidden === 1 ? '' : 's'} you don't have access to.
        </p>
      )}

      {adding && (
        <AddLinkModal
          from={{ type, id }}
          onClose={() => setAdding(false)}
          onLinked={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function AddLinkModal({
  from,
  onClose,
  onLinked,
}: {
  from: { type: RecordType; id: string };
  onClose: () => void;
  onLinked: () => void;
}) {
  const { token } = useAuth();
  const [types, setTypes] = useState<Array<{ type: RecordType; label: string }>>([]);
  const [toType, setToType] = useState<RecordType | ''>('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<RecordSummary[]>([]);
  const [picked, setPicked] = useState<RecordSummary | null>(null);
  const [relation, setRelation] = useState('related');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void linksApi.types(token).then((res) => {
      const list = res.data?.types ?? [];
      setTypes(list);
      setToType((cur) => cur || list[0]?.type || '');
    });
  }, [token]);

  useEffect(() => {
    if (!token || !toType) return;
    const handle = window.setTimeout(() => {
      void linksApi.search(toType, q, token).then((res) => {
        setResults((res.data?.records ?? []).filter((r) => !(r.type === from.type && r.id === from.id)));
      });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [token, toType, q, from.type, from.id]);

  async function save() {
    if (!token || !picked) return;
    setSaving(true);
    const res = await linksApi.create(
      { from, to: { type: picked.type, id: picked.id }, relation: relation.trim() || 'related', note: note.trim() || undefined },
      token
    );
    setSaving(false);
    if (res.success) onLinked();
    else setError(res.message ?? 'Could not link');
  }

  return (
    <Modal
      title="Link a record"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton disabled={!picked || saving} onClick={() => void save()}>
            {saving ? 'Linking…' : 'Link'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Record type">
        <Select
          value={toType}
          onChange={(e) => {
            setToType(e.target.value as RecordType);
            setPicked(null);
          }}
        >
          {types.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Find">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, number or key" autoFocus />
      </Field>
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-[color:var(--border-subtle)] divide-y divide-[color:var(--border-subtle)]">
        {results.length === 0 && <li className="px-3 py-2 text-sm text-[color:var(--text-muted)]">No matches</li>}
        {results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setPicked(r)}
              className={`w-full text-left px-3 py-2 text-sm transition ${
                picked?.id === r.id ? 'bg-[color:var(--accent)]/10' : 'hover:bg-[color:var(--bg-page)]'
              }`}
            >
              <span className="block truncate font-medium">{r.title}</span>
              {(r.subtitle || r.status) && (
                <span className="block truncate text-xs text-[color:var(--text-muted)]">
                  {[r.subtitle, r.status].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Field label="Relation">
        <TextInput list="record-link-relations" value={relation} maxLength={40} onChange={(e) => setRelation(e.target.value)} />
        <datalist id="record-link-relations">
          {RELATIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>
      <Field label="Note (optional)">
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </Modal>
  );
}
