import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertTriangle, FiCheck, FiChevronDown, FiEdit3, FiFolder, FiHash, FiLink2, FiMaximize2, FiMinimize2, FiSliders, FiSmile, FiTag, FiX } from 'react-icons/fi';
import DocEditor from './DocEditor';
import { btnPrimary, btnSecondary } from '../../pages/resources/resourceKit';
import { docsApi, type DocIssueRef, type DocPage, type DocPageInput } from '../../lib/docsApi';
import { IssuePicker } from './DocsModals';
import { IssueChip, PageCover, docLayout, errorText, useDocsOptions } from './docsUi';

const EMOJIS = ['📄', '📘', '📋', '🗓️', '🛠️', '🚀', '⚖️', '🔁', '🧯', '💡', '✅', '📌', '🎯', '📊', '🔒', '🧭', '🧪', '🐞', '📣', '🤝', '🗂️', '🏗️', '📝', '⭐'];

interface Draft {
  title: string;
  emoji: string;
  content: string;
  labels: string[];
  issues: DocIssueRef[];
  projectIds: string[];
  narrow: boolean;
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
    narrow: p.narrow,
  };
}

function same(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.emoji === b.emoji &&
    a.content === b.content &&
    a.labels.join() === b.labels.join() &&
    a.issues.map((i) => i.id).join() === b.issues.map((i) => i.id).join() &&
    a.projectIds.join() === b.projectIds.join() &&
    !!a.narrow === !!b.narrow
  );
}

export default function PageEditor({
  page,
  token,
  spaceColor,
  onSaved,
  onCancel,
}: {
  page: DocPage;
  token: string;
  spaceColor?: string;
  onSaved: (p: DocPage) => void;
  onCancel: () => void;
}) {
  const options = useDocsOptions(token);
  const original = useMemo(() => fromPage(page), [page]);
  const [draft, setDraft] = useState<Draft>(original);
  const [base, setBase] = useState(page.version);
  const [message, setMessage] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(page.issues.length + page.projects.length + page.labels.length > 0);
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
        narrow: draft.narrow,
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

  const layout = docLayout(draft.narrow);
  const detailCount = draft.issues.length + draft.projectIds.length + draft.labels.length;

  return (
    <div className="relative min-h-full">
      {/* Edit bar */}
      <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 px-4 backdrop-blur-md sm:px-6">
        <span className="inline-flex items-center gap-2 text-[13px]">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[color:var(--accent-subtle)] text-[color:var(--accent)]">
            <FiEdit3 className="h-3.5 w-3.5" />
          </span>
          <span className="font-medium">Editing</span>
          <span className="hidden text-[color:var(--text-muted)] sm:inline">{page.status === 'draft' ? 'draft' : `from v${base}`}</span>
          {dirty ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-amber-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--text-muted)]">
              <FiCheck className="h-3.5 w-3.5" /> No changes
            </span>
          )}
        </span>
        <input
          className="ml-auto hidden h-8 w-64 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 text-[13px] outline-none focus:border-[color:var(--accent)] md:block"
          placeholder="Describe your change (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <button
            type="button"
            onClick={() => set('narrow', !draft.narrow)}
            className={`hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition sm:inline-flex ${
              draft.narrow ? 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
            }`}
            title={draft.narrow ? 'Use the full width of the page' : 'Limit the page to a narrow reading column'}
            aria-pressed={draft.narrow}
          >
            {draft.narrow ? <FiMaximize2 className="h-3.5 w-3.5" /> : <FiMinimize2 className="h-3.5 w-3.5" />}
            <span className="hidden lg:inline">{draft.narrow ? 'Narrow' : 'Full width'}</span>
          </button>
          <button type="button" className="h-8 rounded-lg px-3 text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          {page.status === 'draft' && (
            <button type="button" className={`${btnSecondary} h-8`} onClick={() => save('draft')} disabled={busy}>
              Save draft
            </button>
          )}
          <button type="button" className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-4 text-sm disabled:opacity-50" onClick={() => save('published')} disabled={busy} title="Ctrl+S">
            {busy ? 'Saving…' : page.status === 'draft' ? 'Publish' : 'Update'}
          </button>
        </div>
      </div>

      <PageCover color={spaceColor ?? page.space?.color} compact />

      <div className={`${layout.shell} pb-32`}>
      <div className={layout.grid}>
      <div className={layout.column}>
        {recoverable && (
          <div className="-mt-6 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm backdrop-blur">
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
          <div className="-mt-6 mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-amber-500">
              <FiAlertTriangle /> {conflict.updatedBy.name ?? 'Someone'} saved version {conflict.version} while you were editing.
            </p>
            <p className="mt-1 text-[color:var(--text-muted)]">Keep yours to replace theirs (theirs stays in page history), or load theirs and lose your changes.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  const v = conflict.version;
                  setBase(v);
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

        {/* Icon + title */}
        <div className="group/title -mt-8">
          <div className="relative">
            {draft.emoji ? (
              <button
                type="button"
                onClick={() => setEmojiOpen((v) => !v)}
                className="relative mb-3 grid h-20 w-20 place-items-center rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-5xl shadow-lg transition hover:scale-105"
                title="Change icon"
              >
                {draft.emoji}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEmojiOpen((v) => !v)}
                className="relative mb-2 inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--bg-surface)]/80 px-2.5 py-1 text-xs text-[color:var(--text-muted)] opacity-70 transition hover:opacity-100 group-hover/title:opacity-100"
              >
                <FiSmile /> Add icon
              </button>
            )}
            {emojiOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 grid w-80 grid-cols-8 gap-1 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-2.5 shadow-2xl animate-scale-in">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className="rounded-lg p-1.5 text-xl transition hover:scale-110 hover:bg-[color:var(--bg-elevated)]" onClick={() => (set('emoji', e), setEmojiOpen(false))}>
                    {e}
                  </button>
                ))}
                {draft.emoji && (
                  <button type="button" className="col-span-8 mt-1 rounded-lg py-1 text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-red-400" onClick={() => (set('emoji', ''), setEmojiOpen(false))}>
                    Remove icon
                  </button>
                )}
              </div>
            )}
          </div>
          <textarea
            ref={titleRef}
            rows={1}
            value={draft.title}
            onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
            placeholder="Untitled"
            className="w-full resize-none overflow-hidden bg-transparent py-1 text-[2.4rem] font-extrabold leading-[1.2] tracking-tight text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]/50"
          />
        </div>

        {/* Page details */}
        <div className="mt-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]/60">
          <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px]">
            <FiSliders className="text-[color:var(--text-muted)]" />
            <span className="font-medium">Page details</span>
            <span className="text-[color:var(--text-muted)]">
              {detailCount ? `${draft.issues.length} issue${draft.issues.length === 1 ? '' : 's'} · ${draft.projectIds.length} project${draft.projectIds.length === 1 ? '' : 's'} · ${draft.labels.length} label${draft.labels.length === 1 ? '' : 's'}` : 'Link issues, projects and labels'}
            </span>
            <FiChevronDown className={`ml-auto text-[color:var(--text-muted)] transition ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen && (
            <div className="grid gap-5 border-t border-[color:var(--border-subtle)] px-4 py-4 md:grid-cols-2">
              <section className="md:col-span-2">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  <FiLink2 /> Linked issues
                </p>
                {draft.issues.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {draft.issues.map((i) => (
                      <IssueChip key={i.id} issue={i} onRemove={() => set('issues', draft.issues.filter((x) => x.id !== i.id))} />
                    ))}
                  </div>
                )}
                <IssuePicker token={token} exclude={draft.issues.map((i) => i.id)} onPick={(i) => set('issues', [...draft.issues, i])} />
                <p className="mt-1.5 text-[11px] text-[color:var(--text-muted)]">
                  Issue keys you type in the page (like <span className="font-mono">ABC-12</span>) are linked automatically too.
                </p>
              </section>

              <section>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
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
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] transition ${
                          on ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--accent)]/50'
                        }`}
                        title={p.name}
                      >
                        {on && <FiCheck className="h-3 w-3" />}
                        <span className="font-mono font-semibold">{p.key}</span>
                        <span className="max-w-[120px] truncate">{p.name}</span>
                      </button>
                    );
                  })}
                  {page.projects
                    .filter((p) => !options.projects.some((o) => o.id === p.id) && draft.projectIds.includes(p.id))
                    .map((p) => (
                      <span key={p.id} className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-subtle)] px-2 py-1 text-[12px] text-[color:var(--accent)]">
                        {p.key}
                      </span>
                    ))}
                  {!options.projects.length && <span className="text-xs text-[color:var(--text-muted)]">You aren’t on any projects.</span>}
                </div>
              </section>

              <section>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  <FiTag /> Labels
                </p>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1.5 focus-within:border-[color:var(--accent)]">
                  {draft.labels.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 rounded-md bg-[color:var(--bg-elevated)] px-1.5 py-0.5 text-[11px]">
                      <FiHash className="h-3 w-3" />
                      {l}
                      <button type="button" onClick={() => set('labels', draft.labels.filter((x) => x !== l))} className="text-[color:var(--text-muted)] hover:text-red-400" aria-label="Remove label">
                        <FiX className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    className="min-w-[100px] flex-1 bg-transparent text-[13px] outline-none"
                    placeholder={draft.labels.length ? '' : 'Type and press Enter'}
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addLabel();
                      } else if (e.key === 'Backspace' && !labelInput && draft.labels.length) {
                        set('labels', draft.labels.slice(0, -1));
                      }
                    }}
                    onBlur={addLabel}
                  />
                </div>
              </section>
            </div>
          )}
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <div className="mt-6">
          <DocEditor value={draft.content} onChange={onContent} stickyTop={48} placeholder="Start writing… paste images, add headings, tables and files from the toolbar." />
        </div>
      </div>
      {/* Empty rail keeps the writing column where it sits when reading. */}
      <div className={layout.rail} aria-hidden />
      </div>
      </div>
    </div>
  );
}
