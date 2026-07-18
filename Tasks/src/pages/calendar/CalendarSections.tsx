import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { calendarApi } from '../../lib/api';
import type { CalendarEvent } from '../../lib/api';
import {
  Field, GhostButton, Modal, PrimaryButton, SectionPage, TextArea, TextInput, nameOf,
} from '../../components/moduleKit';

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function EventList({ kind, title, subtitle }: { kind: string; title: string; subtitle: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<CalendarEvent[]>([]);
  const [editing, setEditing] = useState<Partial<CalendarEvent> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    calendarApi.listEvents(token, { kind }).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token, kind]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    if (!editing.title || !editing.start) return alert('Title and start are required');
    const payload = { ...editing, kind };
    const res = editing._id ? await calendarApi.updateEvent(editing._id, payload, token) : await calendarApi.createEvent(payload, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const remove = async (id: string) => { if (!token || !confirm('Delete event?')) return; await calendarApi.removeEvent(id, token); load(); };

  const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <SectionPage title={title} subtitle={subtitle} toolbar={<PrimaryButton onClick={() => setEditing({ start: nowLocal(), allDay: false })}>+ Schedule</PrimaryButton>}>
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">Nothing scheduled.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr><th className="text-left px-4 py-2.5 font-medium">Title</th><th className="text-left px-4 py-2.5 font-medium">When</th><th className="text-left px-4 py-2.5 font-medium">Account</th><th className="text-left px-4 py-2.5 font-medium">Location</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-2.5 font-medium">{e.title}</td>
                <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{new Date(e.start).toLocaleString([], { dateStyle: 'medium', timeStyle: e.allDay ? undefined : 'short' })}</td>
                <td className="px-4 py-2.5">{nameOf(e.accountId, '—')}</td>
                <td className="px-4 py-2.5">{e.meetingUrl ? <a href={e.meetingUrl} className="text-[color:var(--accent)] hover:underline" target="_blank" rel="noreferrer">Join</a> : e.location || '—'}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(e)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                  <button onClick={() => remove(e._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </>
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit event' : `New ${kind}`} onClose={() => setEditing(null)} footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <Field label="Title"><TextInput value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><TextInput type="datetime-local" value={(editing.start ?? '').slice(0, 16)} onChange={(e) => setEditing({ ...editing, start: e.target.value })} /></Field>
            <Field label="End"><TextInput type="datetime-local" value={(editing.end ?? '').slice(0, 16)} onChange={(e) => setEditing({ ...editing, end: e.target.value })} /></Field>
          </div>
          <Field label="Location"><TextInput value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></Field>
          <Field label="Meeting URL"><TextInput value={editing.meetingUrl ?? ''} onChange={(e) => setEditing({ ...editing, meetingUrl: e.target.value })} /></Field>
          <Field label="Notes"><TextArea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}

export function CalendarMeetings() {
  return <EventList kind="meeting" title="Meetings" subtitle="Team and customer meetings." />;
}
export function CalendarDemos() {
  return <EventList kind="demo" title="Demos" subtitle="Product and solution demos tied to the sales pipeline." />;
}
export function CalendarReviews() {
  return <EventList kind="review" title="Reviews" subtitle="Client and internal review cadences." />;
}
export function CalendarStandups() {
  return <EventList kind="standup" title="Standups" subtitle="Recurring delivery standups and ceremonies." />;
}
