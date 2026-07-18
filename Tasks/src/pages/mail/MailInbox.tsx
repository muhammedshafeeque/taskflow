import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { mailApi, type MailMailbox, type MailMessage } from '../../lib/api';

export default function MailInbox() {
  const { token } = useAuth();
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [mailboxId, setMailboxId] = useState('');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selected, setSelected] = useState<MailMessage | null>(null);

  useEffect(() => {
    if (!token) return;
    mailApi.listMailboxes(token).then((res) => {
      if (res.success && res.data) {
        const mbs = res.data as MailMailbox[];
        setMailboxes(mbs);
        if (mbs[0]) setMailboxId(mbs[0]._id);
      }
    });
  }, [token]);

  useEffect(() => {
    if (!token || !mailboxId) return;
    mailApi.listMessages(token, { mailboxId }).then((res) => {
      if (res.success && res.data) setMessages((res.data as { data: MailMessage[] }).data ?? []);
    });
  }, [token, mailboxId]);

  const sync = async () => {
    if (!token || !mailboxId) return;
    await mailApi.syncMailbox(mailboxId, token);
    mailApi.listMessages(token, { mailboxId }).then((res) => {
      if (res.success && res.data) setMessages((res.data as { data: MailMessage[] }).data ?? []);
    });
  };

  const openMessage = async (msg: MailMessage) => {
    if (!token) return;
    const res = await mailApi.getMessage(msg._id, token);
    if (res.success && res.data) setSelected(res.data as MailMessage);
  };

  return (
    <div className="p-8 flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Mail</h1>
        <div className="flex gap-2">
          <select
            className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            value={mailboxId}
            onChange={(e) => setMailboxId(e.target.value)}
          >
            {mailboxes.map((m) => (
              <option key={m._id} value={m._id}>{m.name} ({m.email})</option>
            ))}
          </select>
          <button type="button" onClick={sync} className="px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
            Sync
          </button>
          <Link to="/mail/compose" className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">
            Compose
          </Link>
        </div>
      </div>
      <div className="flex flex-1 gap-4 min-h-0">
        <div className="w-1/3 rounded-2xl border border-[color:var(--border-subtle)] overflow-y-auto">
          {messages.map((m) => (
            <button
              key={m._id}
              type="button"
              onClick={() => openMessage(m)}
              className={`w-full text-left p-3 border-b border-[color:var(--border-subtle)] text-sm hover:bg-[color:var(--bg-surface)] ${!m.isRead ? 'font-semibold' : ''}`}
            >
              <p className="truncate">{m.subject || '(no subject)'}</p>
              <p className="text-[color:var(--text-muted)] truncate">{m.from}</p>
            </button>
          ))}
        </div>
        <div className="flex-1 rounded-2xl border border-[color:var(--border-subtle)] p-4 overflow-y-auto">
          {selected ? (
            <>
              <h2 className="font-medium mb-2">{selected.subject}</h2>
              <p className="text-sm text-[color:var(--text-muted)] mb-4">From: {selected.from}</p>
              <div
                className="prose prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: selected.bodyHtml ?? selected.bodyText ?? '' }}
              />
              <Link
                to={`/mail/compose?reply=${selected._id}&mailbox=${selected.mailboxId}&thread=${selected.threadId ?? ''}`}
                className="inline-block mt-4 text-indigo-400 text-sm hover:underline"
              >
                Reply
              </Link>
            </>
          ) : (
            <p className="text-[color:var(--text-muted)]">Select a message</p>
          )}
        </div>
      </div>
    </div>
  );
}
