import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { CrudPage, type Row } from '../../components/CrudPage';
import { Field, GhostButton, PrimaryButton, SectionPage, Select, TextInput } from '../../components/moduleKit';

const MANAGE = 'taskflow.service.settings.manage';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Settings = {
  defaultSlaPolicyId?: string | null;
  businessHours: { enabled: boolean; utcOffsetMinutes: number; days: { day: number; start: string; end: string }[] };
  assignment: { mode: 'none' | 'round_robin' | 'least_open'; queues: Record<string, string[]> };
  csat: { enabled: boolean; question: string };
};

export function ServiceSettingsPage() {
  const { token, user } = useAuth();
  const manage = canAny(user, MANAGE);
  const [s, setS] = useState<Settings | null>(null);
  const [slas, setSlas] = useState<Row[]>([]);
  const [people, setPeople] = useState<Row[]>([]);
  const [newQueue, setNewQueue] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!token) return;
    api.get<Settings>('/service/settings', token).then((r) => r.data && setS({ ...r.data, assignment: { mode: r.data.assignment?.mode ?? 'none', queues: r.data.assignment?.queues ?? {} } }));
    api.get<Row[]>('/service/sla', token).then((r) => setSlas(Array.isArray(r.data) ? r.data : []));
    api.get<Row[]>('/core/people', token).then((r) => setPeople(Array.isArray(r.data) ? r.data : []));
  }, [token]);
  if (!s) return <SectionPage title="Service settings">Loading…</SectionPage>;
  const bh = s.businessHours;
  const save = async () => {
    if (!token) return;
    const r = await api.put('/service/settings', s, token);
    setMsg(r.success ? 'Saved.' : r.message ?? 'Failed');
    setTimeout(() => setMsg(''), 3000);
  };
  const setDay = (day: number, patch: Partial<{ start: string; end: string }> | null) => {
    const rest = bh.days.filter((d) => d.day !== day);
    const cur = bh.days.find((d) => d.day === day) ?? { day, start: '09:00', end: '18:00' };
    setS({ ...s, businessHours: { ...bh, days: patch === null ? rest : [...rest, { ...cur, ...patch }].sort((a, b) => a.day - b.day) } });
  };
  const queues = s.assignment.queues;
  return (
    <SectionPage title="Service settings" subtitle="SLA clock, default policy, auto-assignment and satisfaction surveys.">
      <fieldset disabled={!manage} className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
          <h2 className="text-sm font-semibold">SLA</h2>
          <Field label="Default SLA policy for new tickets">
            <Select value={String(s.defaultSlaPolicyId ?? '')} onChange={(e) => setS({ ...s, defaultSlaPolicyId: e.target.value || null })}>
              <option value="">None</option>
              {slas.map((p) => (
                <option key={String(p._id)} value={String(p._id)}>
                  {String(p.name)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bh.enabled} onChange={(e) => setS({ ...s, businessHours: { ...bh, enabled: e.target.checked } })} /> SLA clock runs only during business hours
          </label>
          {bh.enabled && (
            <>
              <Field label="Timezone offset from UTC (minutes, e.g. 330 = UTC+5:30)">
                <TextInput type="number" value={bh.utcOffsetMinutes} onChange={(e) => setS({ ...s, businessHours: { ...bh, utcOffsetMinutes: Number(e.target.value) } })} />
              </Field>
              {DAYS.map((label, day) => {
                const d = bh.days.find((x) => x.day === day);
                return (
                  <div key={day} className="grid grid-cols-[4rem_auto_1fr_1fr] items-center gap-2 text-sm">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(d)} onChange={(e) => setDay(day, e.target.checked ? {} : null)} />
                    <TextInput type="time" disabled={!d} value={d?.start ?? ''} onChange={(e) => setDay(day, { start: e.target.value })} />
                    <TextInput type="time" disabled={!d} value={d?.end ?? ''} onChange={(e) => setDay(day, { end: e.target.value })} />
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Auto-assignment</h2>
            <Field label="Mode">
              <Select value={s.assignment.mode} onChange={(e) => setS({ ...s, assignment: { ...s.assignment, mode: e.target.value as Settings['assignment']['mode'] } })}>
                <option value="none">Off — assign manually</option>
                <option value="round_robin">Round robin</option>
                <option value="least_open">Fewest open tickets</option>
              </Select>
            </Field>
            {s.assignment.mode !== 'none' && (
              <>
                {Object.entries(queues).map(([q, ids]) => (
                  <Field key={q} label={q === '*' ? 'Any queue (fallback)' : `Queue: ${q}`}>
                    <div className="flex flex-wrap gap-1.5 rounded-lg border border-[color:var(--border-subtle)] p-2">
                      {people.map((p) => {
                        const on = ids.includes(String(p._id));
                        return (
                          <button
                            type="button"
                            key={String(p._id)}
                            onClick={() => setS({ ...s, assignment: { ...s.assignment, queues: { ...queues, [q]: on ? ids.filter((x) => x !== p._id) : [...ids, String(p._id)] } } })}
                            className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15' : 'border-[color:var(--border-subtle)]'}`}
                          >
                            {String(p.name)}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="ml-auto text-xs text-rose-500"
                        onClick={() => {
                          const { [q]: _drop, ...rest } = queues;
                          setS({ ...s, assignment: { ...s.assignment, queues: rest } });
                        }}
                      >
                        remove
                      </button>
                    </div>
                  </Field>
                ))}
                <div className="flex gap-2">
                  <TextInput placeholder='Queue name (or "*" for any)' value={newQueue} onChange={(e) => setNewQueue(e.target.value)} />
                  <GhostButton
                    onClick={() => {
                      const q = newQueue.trim();
                      if (q && !queues[q]) setS({ ...s, assignment: { ...s.assignment, queues: { ...queues, [q]: [] } } });
                      setNewQueue('');
                    }}
                  >
                    Add queue
                  </GhostButton>
                </div>
              </>
            )}
          </div>
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Customer satisfaction (CSAT)</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.csat.enabled} onChange={(e) => setS({ ...s, csat: { ...s.csat, enabled: e.target.checked } })} /> Email a 1–5 rating request when a ticket is resolved or closed
            </label>
            <Field label="Question">
              <TextInput value={s.csat.question} onChange={(e) => setS({ ...s, csat: { ...s.csat, question: e.target.value } })} />
            </Field>
          </div>
        </div>
      </fieldset>
      {manage && (
        <div className="flex items-center gap-3">
          <PrimaryButton onClick={save}>Save settings</PrimaryButton>
          {msg && <span className="text-sm text-[color:var(--text-muted)]">{msg}</span>}
        </div>
      )}
    </SectionPage>
  );
}

export function SavedRepliesPage() {
  return (
    <CrudPage
      title="Saved replies"
      subtitle="Reusable answers for agents. Shared replies are visible to everyone; private ones only to you."
      endpoint="/service/saved-replies"
      createLabel="New reply"
      columns={[
        { header: 'Title', render: (r) => <span className="font-medium">{String(r.title)}</span> },
        { header: 'Reply', render: (r) => <span className="line-clamp-2 text-[color:var(--text-muted)]">{String(r.body)}</span> },
        { header: 'Shared', render: (r) => (r.shared ? 'Yes' : 'Private') },
      ]}
      fields={[
        { key: 'title', label: 'Title', required: true },
        { key: 'body', label: 'Reply', type: 'textarea', required: true },
        { key: 'shared', label: 'Shared', type: 'checkbox', placeholder: 'Share with all agents (needs service settings permission)' },
      ]}
    />
  );
}
