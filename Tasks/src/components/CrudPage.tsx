import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { canAny } from '../utils/moduleAccess';
import { Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, TextArea, TextInput } from './moduleKit';

/**
 * Config-driven list + create/edit form for simple admin collections
 * (leave types, holidays, saved replies, commission plans, status pages …).
 * Everything — endpoints, fields, option sources, permissions — is data.
 */
export type Row = Record<string, unknown> & { _id?: string };

export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'datetime' | 'list' | 'multiselect' | 'json' | 'color';

export type CrudField = {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Static options for select / multiselect. */
  options?: { value: string; label: string }[];
  /** Options loaded from an API list: GET endpoint → [{ _id, name }] */
  optionsFrom?: { endpoint: string; label?: string; value?: string };
  /** Hide on edit (e.g. immutable keys). */
  createOnly?: boolean;
  defaultValue?: unknown;
};

export type CrudColumn = { header: string; render: (row: Row) => ReactNode; className?: string };

export type CrudAction = { label: string; onClick: (row: Row, reload: () => void) => void | Promise<void>; show?: (row: Row) => boolean; danger?: boolean };

export type CrudConfig = {
  title: string;
  subtitle?: string;
  endpoint: string;
  /** Override list URL (e.g. with query string). */
  listEndpoint?: string;
  columns: CrudColumn[];
  fields?: CrudField[];
  /** Permission(s) needed to create/edit/delete; omit to always allow (server still enforces). */
  managePermissions?: string[];
  createLabel?: string;
  updateMethod?: 'patch' | 'put';
  allowDelete?: boolean;
  rowActions?: CrudAction[];
  toolbar?: ReactNode;
  emptyText?: string;
  /** Transform form values before save. */
  beforeSave?: (values: Row) => Row;
  children?: ReactNode;
};

export function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function fmtDate(v: unknown, withTime = false): string {
  if (!v) return '—';
  const d = new Date(String(v));
  if (Number.isNaN(+d)) return '—';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function toInputValue(type: FieldType | undefined, v: unknown): string {
  if (v === undefined || v === null) return '';
  if (type === 'date') return String(v).slice(0, 10);
  if (type === 'datetime') return new Date(String(v)).toISOString().slice(0, 16);
  if (type === 'list') return Array.isArray(v) ? v.join(', ') : String(v);
  if (type === 'json') return JSON.stringify(v, null, 2);
  return String(v);
}

function useOptions(fields: CrudField[] | undefined, token: string | null) {
  const [loaded, setLoaded] = useState<Record<string, { value: string; label: string }[]>>({});
  useEffect(() => {
    if (!token || !fields) return;
    fields
      .filter((f) => f.optionsFrom)
      .forEach((f) => {
        const src = f.optionsFrom!;
        api.get<Row[]>(src.endpoint, token).then((r) => {
          const list = Array.isArray(r.data) ? r.data : [];
          setLoaded((prev) => ({
            ...prev,
            [f.key]: list.map((x) => ({ value: String(get(x, src.value ?? '_id')), label: String(get(x, src.label ?? 'name') ?? get(x, 'title') ?? x._id) })),
          }));
        });
      });
  }, [fields, token]);
  return loaded;
}

export function CrudForm({
  fields,
  initial,
  options,
  onChange,
  isEdit,
}: {
  fields: CrudField[];
  initial: Row;
  options: Record<string, { value: string; label: string }[]>;
  onChange: (values: Row) => void;
  isEdit: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = get(initial, f.key) ?? f.defaultValue;
      if (f.type === 'checkbox') v[f.key] = Boolean(raw);
      else if (f.type === 'multiselect') v[f.key] = Array.isArray(raw) ? raw.map((x) => (x && typeof x === 'object' ? String((x as Row)._id) : String(x))) : [];
      else if (f.type === 'select' && raw && typeof raw === 'object') v[f.key] = String((raw as Row)._id ?? '');
      else v[f.key] = toInputValue(f.type, raw);
    }
    return v;
  });
  useEffect(() => {
    const out: Row = {};
    for (const f of fields) {
      if (isEdit && f.createOnly) continue;
      const v = values[f.key];
      switch (f.type) {
        case 'number':
          out[f.key] = v === '' ? undefined : Number(v);
          break;
        case 'list':
          out[f.key] = String(v ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          break;
        case 'json':
          try {
            out[f.key] = v ? JSON.parse(String(v)) : undefined;
          } catch {
            out[f.key] = undefined;
          }
          break;
        case 'date':
        case 'datetime':
          out[f.key] = v ? new Date(String(v)).toISOString() : null;
          break;
        default:
          out[f.key] = v === '' && f.type === 'select' ? null : v;
      }
    }
    onChange(out);
  }, [values, fields, isEdit, onChange]);

  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));
  return (
    <>
      {fields
        .filter((f) => !(isEdit && f.createOnly))
        .map((f) => {
          const opts = f.options ?? options[f.key] ?? [];
          const v = values[f.key];
          let input: ReactNode;
          switch (f.type) {
            case 'textarea':
            case 'json':
              input = <TextArea rows={f.type === 'json' ? 6 : 4} value={String(v ?? '')} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} className={f.type === 'json' ? 'font-mono text-xs' : ''} />;
              break;
            case 'select':
              input = (
                <Select value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              );
              break;
            case 'multiselect': {
              const sel = new Set((v as string[]) ?? []);
              input = (
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-[color:var(--border-subtle)] p-2 max-h-40 overflow-y-auto">
                  {opts.length === 0 && <span className="text-xs text-[color:var(--text-muted)]">No options</span>}
                  {opts.map((o) => (
                    <button
                      type="button"
                      key={o.value}
                      onClick={() => {
                        const next = new Set(sel);
                        if (next.has(o.value)) next.delete(o.value);
                        else next.add(o.value);
                        set(f.key, [...next]);
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-xs border ${sel.has(o.value) ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15' : 'border-[color:var(--border-subtle)]'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              );
              break;
            }
            case 'checkbox':
              input = (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} /> {f.placeholder ?? 'Enabled'}
                </label>
              );
              break;
            default:
              input = (
                <TextInput
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'color' ? 'color' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  value={String(v ?? '')}
                  required={f.required}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
          }
          return (
            <Field key={f.key} label={f.required ? `${f.label} *` : f.label}>
              {input}
              {f.help && <span className="mt-1 block text-[11px] text-[color:var(--text-muted)]">{f.help}</span>}
            </Field>
          );
        })}
    </>
  );
}

export function CrudPage(cfg: CrudConfig) {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const options = useOptions(cfg.fields, token);
  const canManage = !cfg.managePermissions || canAny(user, ...cfg.managePermissions);

  const load = useCallback(() => {
    if (!token) return;
    api.get<Row[]>(cfg.listEndpoint ?? cfg.endpoint, token).then((r) => {
      setLoading(false);
      if (r.success) setRows(Array.isArray(r.data) ? r.data : []);
      else setError(r.message ?? 'Failed to load');
    });
  }, [token, cfg.endpoint, cfg.listEndpoint]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    setSaving(true);
    const body = cfg.beforeSave ? cfg.beforeSave(draft) : draft;
    const res = editing._id
      ? await api[cfg.updateMethod ?? 'patch'](`${cfg.endpoint}/${editing._id}`, body, token)
      : await api.post(cfg.endpoint, body, token);
    setSaving(false);
    if (res.success) {
      setEditing(null);
      load();
    } else alert(res.message);
  };

  const remove = async (row: Row) => {
    if (!token || !confirm('Delete this item?')) return;
    const res = await api.delete(`${cfg.endpoint}/${row._id}`, token);
    if (!res.success) alert(res.message);
    load();
  };

  const onDraft = useCallback((v: Row) => setDraft(v), []);
  const actions = useMemo(() => cfg.rowActions ?? [], [cfg.rowActions]);
  const hasRowButtons = actions.length > 0 || (canManage && (cfg.fields?.length || cfg.allowDelete !== false));

  return (
    <SectionPage
      title={cfg.title}
      subtitle={cfg.subtitle}
      toolbar={
        <>
          {cfg.toolbar}
          {canManage && cfg.fields?.length ? <PrimaryButton onClick={() => setEditing({})}>{cfg.createLabel ?? 'New'}</PrimaryButton> : null}
        </>
      }
    >
      {cfg.children}
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{error}</div>}
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
              {cfg.columns.map((c) => (
                <th key={c.header} className="px-4 py-2.5 font-medium">
                  {c.header}
                </th>
              ))}
              {hasRowButtons && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={cfg.columns.length + 1} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={cfg.columns.length + 1} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  {cfg.emptyText ?? 'Nothing here yet.'}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={String(r._id)} className="border-b border-[color:var(--border-subtle)] last:border-0 hover:bg-[color:var(--bg-page)]/50">
                {cfg.columns.map((c) => (
                  <td key={c.header} className={`px-4 py-2.5 ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
                {hasRowButtons && (
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-2">
                    {actions
                      .filter((a) => !a.show || a.show(r))
                      .map((a) => (
                        <button key={a.label} className={`text-xs hover:underline ${a.danger ? 'text-rose-500' : 'text-[color:var(--accent)]'}`} onClick={() => a.onClick(r, load)}>
                          {a.label}
                        </button>
                      ))}
                    {canManage && cfg.fields?.length ? (
                      <button className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                    ) : null}
                    {canManage && cfg.allowDelete !== false && (
                      <button className="text-xs text-rose-500 hover:underline" onClick={() => remove(r)}>
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && cfg.fields && (
        <Modal
          title={editing._id ? `Edit` : cfg.createLabel ?? 'New'}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
              <PrimaryButton disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </>
          }
        >
          <CrudForm fields={cfg.fields} initial={editing} options={options} onChange={onDraft} isEdit={Boolean(editing._id)} />
        </Modal>
      )}
    </SectionPage>
  );
}

/** Small helper for one-document settings forms (GET + PUT/PATCH). */
export function SettingsForm({
  title,
  subtitle,
  endpoint,
  fields,
  method = 'put',
  managePermissions,
  transformIn,
  transformOut,
  children,
}: {
  title: string;
  subtitle?: string;
  endpoint: string;
  fields: CrudField[];
  method?: 'put' | 'patch';
  managePermissions?: string[];
  transformIn?: (v: Row) => Row;
  transformOut?: (v: Row) => Row;
  children?: ReactNode;
}) {
  const { token, user } = useAuth();
  const [initial, setInitial] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row>({});
  const [msg, setMsg] = useState('');
  const options = useOptions(fields, token);
  const canManage = !managePermissions || canAny(user, ...managePermissions);
  useEffect(() => {
    if (!token) return;
    api.get<Row>(endpoint, token).then((r) => setInitial(transformIn ? transformIn(r.data ?? {}) : r.data ?? {}));
  }, [token, endpoint, transformIn]);
  const onDraft = useCallback((v: Row) => setDraft(v), []);
  const save = async () => {
    if (!token) return;
    const res = await api[method](endpoint, transformOut ? transformOut(draft) : draft, token);
    setMsg(res.success ? 'Saved.' : res.message ?? 'Failed');
    setTimeout(() => setMsg(''), 3000);
  };
  return (
    <SectionPage title={title} subtitle={subtitle}>
      {children}
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3 max-w-2xl">
        {!initial ? (
          <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
        ) : (
          <fieldset disabled={!canManage} className="space-y-3">
            <CrudForm fields={fields} initial={initial} options={options} onChange={onDraft} isEdit />
          </fieldset>
        )}
        {canManage && (
          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={save}>Save</PrimaryButton>
            {msg && <span className="text-sm text-[color:var(--text-muted)]">{msg}</span>}
          </div>
        )}
      </div>
    </SectionPage>
  );
}
