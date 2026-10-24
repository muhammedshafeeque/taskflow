import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { monitorApi, organizationsApi, type MonitorOnCall } from '../../lib/api';
import { PersonSelect, toPeople } from '../people';

type Member = { _id: string; name: string; email: string };

/** On-call rotation for a monitor project: who gets paged for new errors, regressions and outages. */
export default function OnCallCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { token, user } = useAuth();
  const [data, setData] = useState<MonitorOnCall | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!token) return;
    monitorApi.getOnCall(projectId, token).then((r) => {
      if (r.success && r.data) {
        setData(r.data);
        setPeople(r.data.people.map((p) => p._id));
        setDays(r.data.rotationDays);
        setEnabled(r.data.enabled);
      }
    });
    const orgId = (user as { activeOrganizationId?: string } | null)?.activeOrganizationId;
    if (orgId && canManage) {
      organizationsApi.listMembers(orgId, token).then((r) => {
        const list = (r.success && r.data ? r.data.members : [])
          .filter((m) => m.status === 'active' && m.user)
          .map((m) => ({ _id: m.user!._id, name: m.user!.name, email: m.user!.email }));
        setMembers(list);
      });
    }
  }, [token, projectId, user, canManage]);

  async function save() {
    if (!token) return;
    const r = await monitorApi.setOnCall(projectId, { enabled, userIds: people, rotationDays: days }, token);
    if (r.success && r.data) {
      setData(r.data);
      setMsg('Saved');
    } else setMsg(r.message ?? 'Save failed');
  }

  const current = data?.current ? data.people.find((p) => p._id === data.current!.userId) : null;
  const move = (i: number, d: -1 | 1) =>
    setPeople((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const nameOf = (id: string) => members.find((m) => m._id === id)?.name ?? data?.people.find((p) => p._id === id)?.name ?? id;

  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">On call</h3>
          <p className="text-xs text-[color:var(--text-muted)]">
            {current
              ? `${current.name} until ${new Date(data!.current!.until).toLocaleString()}`
              : 'Nobody is on call — new errors and outages only go to alert rules.'}
          </p>
        </div>
        {canManage && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Page on-call
          </label>
        )}
      </div>
      {canManage && (
        <>
          <ol className="space-y-1">
            {people.map((id, i) => (
              <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--border-subtle)] px-3 py-1.5 text-sm">
                <span>
                  {i + 1}. {nameOf(id)}
                </span>
                <span className="flex gap-2 text-xs">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === people.length - 1}>↓</button>
                  <button type="button" className="text-rose-500" onClick={() => setPeople((p) => p.filter((x) => x !== id))}>Remove</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PersonSelect
              size="sm"
              className="w-56"
              value=""
              onChange={(v) => v && setPeople((p) => [...p, v])}
              people={toPeople(members.filter((m) => !people.includes(m._id)))}
              placeholder="+ Add person to rotation…"
              aria-label="Add person to on-call rotation"
            />
            <label className="flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
              Rotate every
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-14 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1"
              />
              days
            </label>
            <button type="button" className="btn-primary px-3 py-1 rounded-md text-xs" onClick={save}>
              Save rotation
            </button>
            {msg && <span className="text-xs text-[color:var(--text-muted)]">{msg}</span>}
          </div>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            The on-call person is paged (in-app, push, email per their notification settings) at most once an hour per error or check.
          </p>
        </>
      )}
    </div>
  );
}
