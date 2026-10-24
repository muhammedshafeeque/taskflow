import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertTriangle, FiFolder, FiHash, FiLink2, FiTag, FiX } from 'react-icons/fi';
import DescriptionEditor from '../issue/DescriptionEditor';
import { btnPrimary, btnSecondary, inputCls } from '../../pages/resources/resourceKit';
import { docsApi, type DocIssueRef, type DocPage, type DocPageInput } from '../../lib/docsApi';
import { IssuePicker } from './DocsModals';
import { errorText, useDocsOptions } from './docsUi';

const EMOJIS = ['📄', '📘', '📋', '🗓️', '🛠️', '🚀', '⚖️', '🔁', '🧯', '💡', '✅', '📌', '🎯', '📊', '🔒', '🧭', '🧪', '🐞', '📣', '🤝', '🗂️', '🏗️', '📝', '⭐'];

interface Draft {
  title: string;
  emoji: string;
  content: string;
  labels: string[];
  issues: DocIssueRef[];
  projectIds: string[];
}

const LOCAL_KEY = (id: string) => `docs.unsaved.${id}`;

function fromPage(p: DocPage): Draft {
  return {
    title: p.title,
    emoji: p.emoji ?? '',
    content: p.content,
    labels: p.labels,
    issues: p.issues,
    projectIds: p.projects.map((x) => x.id),
  };
}

function same(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.emoji === b.emoji &&
    a.content === b.content &&
    a.labels.join() === b.labels.join() &&
    a.issues.map((i) => i.id).join() === b.issues.map((i) => i.id).join() &&
    a.projectIds.join() === b.projectIds.join()
  );
}

export default function PageEditor({ page, token, onSaved, onCancel }: { page: DocPage; token: string; onSaved: (p: DocPage) => void; onCancel: () => void }) {
  const options = useDocsOptions(token);
  const original = useMemo(() => fromPage(page), [page]);
  const [draft, setDraft] = useState<Draft>(original);
  const [base, setBase] = useState(page.version);
  const [message, setMessage] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<DocPage | null>(null);
  const [recoverable, setRecoverable] = useState<Draft | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !same(draft, original);

  // Offer to bring back changes that were never saved (tab closed, crash, lost connection).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY(page.id));
      if (!raw) return;
      const saved = JSON.parse(raw) as { base: number; draft: Draft };
      if (saved.base === page.version && !same(saved.draft, original)) setRecoverable(saved.draft);
      else localStorage.removeItem(LOCAL_KEY(page.id));
    } catch {
      /* storage unavailable */
    }
  }, [page.id, page.version, original]);

  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LOCAL_KEY(page.id), JSON.stringify({ base, draft }));
      } catch {
        /* storage unavailable */
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, dirty, base, page.id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (page.title === 'Untitled' || page.title.endsWith(': ') || page.title.endsWith('– ')) titleRef.current?.focus();
  }, [page.title]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.title]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const onContent = useCallback((html: string) => setDraft((d) => ({ ...d, content: html })), []);

  const save = useCallback(
    async (status: 'draft' | 'published', overrideBase?: number) => {
      if (!draft.title.trim()) {
        setError('Give the page a title');
        titleRef.current?.focus();
        return;
      }
      setBusy(true);
      setError('');
      const body: DocPageInput = {
        title: draft.title,
        emoji: draft.emoji,
        content: draft.content,
        labels: draft.labels,
        issueIds: draft.issues.map((i) => i.id),
        projectIds: draft.projectIds,
        status,
        baseVersion: overrideBase ?? base,
        message: message.trim() || undefined,
      };
      const res = await docsApi.updatePage(page.id, body, token);
      setBusy(false);
      if (res.status === 409 && res.data) {
        setConflict(res.data);
        return;
      }
      if (!res.success || !res.data) return setError(errorText(res, 'Could not save the page'));
      try {
        localStorage.removeItem(LOCAL_KEY(page.id));
      } catch {
        /* storage unavailable */
      }
      onSaved(res.data);
    },
    [draft, base, message, page.id, token, onSaved]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(page.status === 'draft' ? 'draft' : 'published');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, page.status]);

  function addLabel() {
    const l = labelInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (l && !draft.labels.includes(l)) set('labels', [...draft.labels, l]);
    setLabelInput('');
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    try {
      localStorage.removeItem(LOCAL_KEY(page.id));
    } catch {
      /* storage unavailable */
    }
    onCancel();
  }

  return (
    <div className="pb-24">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 mb-6 flex flex-wrap items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 px-4 sm:px-8 py-2.5 backdrop-blur">
        <span className="text-xs text-[color:var(--text-muted)]">
          Editing {page.status === 'draft' ? 'draft' : `v${base}`}
          {dirty && <span className="ml-2 text-amber-500">• unsaved changes</span>}
        </span>
        <input
          className={`${inputCls} !py-1.5 !w-auto flex-1 min-w-[160px] max-w-sm ml-auto`}
          placeholder="What did you change? (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="button" className={btnSecondary} onClick={cancel} disabled={busy}>
          Cancel
        </button>
        {page.status === 'draft' && (
          <button type="button" className={btnSecondary} onClick={() => save('draft')} disabled={busy}>
            Save draft
          </button>
        )}
        <button type="button" className={btnPrimary} onClick={() => save('published')} disabled={busy}>
          {busy ? 'Saving…' : page.status === 'draft' ? 'Publish' : 'Update'}
        </button>
      </div>

      {recoverable && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm">
          <span className="flex-1">You have unsaved changes from an earlier session.</span>
          <button type="button" className={btnSecondary} onClick={() => (setDraft(recoverable), setRecoverable(null))}>
            Restore them
          </button>
          <button
            type="button"
            className="text-xs text-[color:var(--text-muted)] underline"
            onClick={() => {
              localStorage.removeItem(LOCAL_KEY(page.id));
              setRecoverable(null);
            }}
          >
            Discard
          </button>
        </div>
      )}

      {conflict && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-500">
            <FiAlertTriangle /> {conflict.updatedBy.name ?? 'Someone'} saved version {conflict.version} while you were editing.
          </p>
          <p className="mt-1 text-[color:var(--text-muted)]">Keep your version to replace theirs (theirs stays in page history), or load theirs and lose your changes.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setBase(conflict.version);
                const v = conflict.version;
                setConflict(null);
                void save(page.status === 'draft' ? 'draft' : 'published', v);
              }}
            >
              Keep mine
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setDraft(fromPage(conflict));
                setBase(conflict.version);
                setConflict(null);
              }}
            >
              Load theirs
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="relative flex items-start gap-3">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              className="mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-dashed border-[color:var(--border-subtle)] text-2xl hover:border-[color:var(--accent)]"
              title="Page icon"
            >
              {draft.emoji || <span className="text-sm text-[color:var(--text-muted)]">＋</span>}
            </button>
            {emojiOpen && (
              <div className="absolute left-0 top-14 z-30 grid w-72 grid-cols-8 gap-1 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-2 shadow-xl">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className="rounded-md p-1 text-xl hover:bg-[color:var(--bg-elevated)]" onClick={() => (set('emoji', e), setEmojiOpen(false))}>
                    {e}
                  </button>
                ))}
                <button type="button" className="col-span-8 mt-1 text-xs text-[color:var(--text-muted)] hover:text-red-400" onClick={() => (set('emoji', ''), setEmojiOpen(false))}>
                  Remove icon
                </button>
              </div>
            )}
            <textarea
              ref={titleRef}
              rows={1}
              value={draft.title}
              onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
              placeholder="Page title"
              className="flex-1 resize-none overflow-hidden bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-[color:var(--text-muted)]"
            />
          </div>
          <p className="mt-2 mb-4 text-xs text-[color:var(--text-muted)]">
            Tip: type an issue key such as <span className="font-mono">ABC-12</span> anywhere in the page and it links to that issue automatically.
          </p>
          <div className="doc-editor [&_.ProseMirror]:min-h-[55vh] [&_.ProseMirror]:text-[15px] [&_.ProseMirror]:px-5 [&_.ProseMirror]:py-4">
            <DescriptionEditor value={draft.content} onChange={onContent} placeholder="Start writing… paste images, add tables, headings and checklists." />
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>

        <aside className="space-y-5 text-sm">
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
              <FiLink2 /> Linked issues
            </p>
            <ul className="mb-2 space-y-1">
              {draft.issues.map((i) => (
                <li key={i.id} className="flex items-center gap-2 rounded-lg bg-[color:var(--bg-elevated)] px-2 py-1">
                  <span className="font-mono text-xs text-[color:var(--accent)]">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">{i.title}</span>
                  <button type="button" className="text-[color:var(--text-muted)] hover:text-red-400" onClick={() => set('issues', draft.issues.filter((x) => x.id !== i.id))} aria-label="Unlink">
                    <FiX className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <IssuePicker token={token} exclude={draft.issues.map((i) => i.id)} onPick={(i) => set('issues', [...draft.issues, i])} />
          </section>

          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
              <FiFolder /> Projects
            </p>
            <div className="flex flex-wrap gap-1.5">
              {options.projects.map((p) => {
                const on = draft.projectIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set('projectIds', on ? draft.projectIds.filter((x) => x !== p.id) : [...draft.projectIds, p.id])}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                      on ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--accent)]/50'
                    }`}
                    title={p.name}
                  >
                    {p.key}
                  </button>
                );
              })}
              {/* Projects linked by someone else that this user isn't on stay linked. */}
              {page.projects
                .filter((p) => !options.projects.some((o) => o.id === p.id) && draft.projectIds.includes(p.id))
                .map((p) => (
                  <span key={p.id} className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent-subtle)] px-2 py-0.5 text-[11px] text-[color:var(--accent)]">
                    {p.key}
                  </span>
                ))}
            </div>
          </section>

          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
              <FiTag /> Labels
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.labels.map((l) => (
                <span key={l} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px]">
                  <FiHash className="h-3 w-3" />
                  {l}
                  <button type="button" onClick={() => set('labels', draft.labels.filter((x) => x !== l))} className="text-[color:var(--text-muted)] hover:text-red-400" aria-label="Remove label">
                    <FiX className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              className={`${inputCls} !py-1.5`}
              placeholder="Add a label and press Enter"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addLabel();
                }
              }}
              onBlur={addLabel}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
