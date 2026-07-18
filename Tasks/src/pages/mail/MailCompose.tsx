import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { mailApi, type MailMailbox, type MailMessage } from '../../lib/api';

export default function MailCompose() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [mailboxId, setMailboxId] = useState(params.get('mailbox') ?? '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [threadId, setThreadId] = useState<string | undefined>();

  useEffect(() => {
    if (!token) return;
    mailApi.listMailboxes(token).then((res) => {
      if (res.success && res.data) {
        const mbs = res.data as MailMailbox[];
        setMailboxes(mbs);
        if (!mailboxId && mbs[0]) setMailboxId(mbs[0]._id);
      }
    });
    const replyId = params.get('reply');
    if (replyId && token) {
      mailApi.getMessage(replyId, token).then((res) => {
        if (res.success && res.data) {
          const msg = res.data as MailMessage;
          setTo(msg.from);
          setSubject(msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`);
          setInReplyTo(msg._id);
          setThreadId(params.get('thread') ?? msg.threadId);
        }
      });
    }
  }, [token, params, mailboxId]);

  const send = async () => {
    if (!token || !mailboxId || !to.trim()) return;
    const res = await mailApi.send(
      {
        mailboxId,
        to: to.split(',').map((e) => e.trim()).filter(Boolean),
        subject,
        bodyHtml: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
        inReplyTo,
        threadId,
      },
      token
    );
    if (res.success) navigate('/mail');
    else alert(res.message ?? 'Send failed');
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">Compose</h1>
      <div className="space-y-3">
        <select
          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          value={mailboxId}
          onChange={(e) => setMailboxId(e.target.value)}
        >
          {mailboxes.map((m) => (
            <option key={m._id} value={m._id}>{m.email}</option>
          ))}
        </select>
        <input
          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          placeholder="To (comma-separated)"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm min-h-[200px]"
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="button" onClick={send} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">
            Send
          </button>
          <button type="button" onClick={() => navigate('/mail')} className="px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
