import { useEffect, useMemo, useState } from 'react';
import { FiCheckCircle, FiCornerDownRight, FiEdit2, FiMessageSquare, FiTrash2 } from 'react-icons/fi';
import TaskCommentBox from '../issue/TaskCommentBox';
import RichTextContent from '../richText/RichTextContent';
import { Avatar, RelativeDate } from '../issues/issueUi';
import { docsApi, type DocComment } from '../../lib/docsApi';
import { errorText, useDocsOptions } from './docsUi';

export default function PageComments({ pageId, token, canModerate, onCount }: { pageId: string; token: string; canModerate: boolean; onCount?: (n: number) => void }) {
  const options = useDocsOptions(token);
  const mentionUsers = useMemo(() => options.people.map((p) => ({ _id: p.id, name: p.name ?? '', email: p.email ?? '' })), [options.people]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    docsApi.comments(pageId, token).then((r) => r.success && r.data && setComments(r.data));
  }, [pageId, token]);

  useEffect(() => onCount?.(comments.length), [comments.length, onCount]);

  async function run(p: Promise<{ success: boolean; data?: DocComment[]; message?: string }>) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (r.success && r.data) {
      setComments(r.data);
      setError('');
      return true;
    }
    setError(errorText(r));
    return false;
  }

  const roots = comments.filter((c) => !c.parentId);
  const replies = (id: string) => comments.filter((c) => c.parentId === id);
  const resolvedCount = roots.filter((c) => c.resolved).length;
  const shown = roots.filter((c) => showResolved || !c.resolved);

  const renderComment = (c: DocComment, isReply = false) => (
    <div key={c.id} className={`flex gap-3 ${isReply ? 'mt-3' : ''}`}>
      <Avatar name={c.author.name ?? c.author.email} size={isReply ? 24 : 28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-semibold text-[color:var(--text-primary)]">{c.author.name ?? 'Someone'}</span>
          <RelativeDate value={c.createdAt} />
          {c.updatedAt !== c.createdAt && <span className="text-[color:var(--text-muted)]">(edited)</span>}
          {c.resolved && <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-500">Resolved</span>}
        </div>
        {editing === c.id ? (
          <div className="mt-1.5">
            <TaskCommentBox
              initialBody={c.body}
              submitting={busy}
              submitLabel="Save"
              mentionUsers={mentionUsers}
              onCancel={() => setEditing(null)}
              onSubmit={async (body) => (await run(docsApi.updateComment(pageId, c.id, { body }, token))) && setEditing(null)}
            />
          </div>
        ) : (
          <div className="mt-1 text-sm">
            <RichTextContent body={c.body} />
          </div>
        )}
        <div className="mt-1 flex items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
          {!isReply && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-[color:var(--accent)]" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
              <FiCornerDownRight /> Reply
            </button>
          )}
          {!isReply && (c.mine || canModerate) && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-emerald-500" onClick={() => run(docsApi.updateComment(pageId, c.id, { resolved: !c.resolved }, token))}>
              <FiCheckCircle /> {c.resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
          {c.mine && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-[color:var(--accent)]" onClick={() => setEditing(c.id)}>
              <FiEdit2 /> Edit
            </button>
          )}
          {(c.mine || canModerate) && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-red-400" onClick={() => run(docsApi.deleteComment(pageId, c.id, token))}>
              <FiTrash2 /> Delete
            </button>
          )}
        </div>
        {!isReply && (
          <div className="border-l-2 border-[color:var(--border-subtle)] pl-3 ml-0.5">
            {replies(c.id).map((r) => renderComment(r, true))}
            {replyTo === c.id && (
              <div className="mt-3">
                <TaskCommentBox
                  submitting={busy}
                  placeholder="Write a reply…"
                  submitLabel="Reply"
                  mentionUsers={mentionUsers}
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async (body) => (await run(docsApi.addComment(pageId, { body, parentId: c.id }, token))) && setReplyTo(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section className="mt-12 border-t border-[color:var(--border-subtle)] pt-6" id="comments">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <FiMessageSquare /> Comments {comments.length > 0 && <span className="text-[color:var(--text-muted)] font-normal">{comments.length}</span>}
        </h2>
        {resolvedCount > 0 && (
          <button type="button" className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
          </button>
        )}
      </div>
      <div className="space-y-5">{shown.map((c) => renderComment(c))}</div>
      <div className="mt-5">
        <TaskCommentBox submitting={busy} mentionUsers={mentionUsers} placeholder="Add a comment…" onSubmit={(body) => void run(docsApi.addComment(pageId, { body }, token))} />
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
