import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiBookOpen, FiLink2, FiPlus, FiSearch, FiX } from 'react-icons/fi';
import { Modal, inputCls } from '../../pages/resources/resourceKit';
import { docsApi, type DocPageCard } from '../../lib/docsApi';
import { CreatePageModal } from './DocsModals';
import { PageCardRow, errorText } from './docsUi';

/** Issue detail panel: pages that link to or mention this issue, with link / create actions. */
export default function IssueDocsPanel({
  issueId,
  issueKey,
  issueTitle,
  projectId,
  token,
}: {
  issueId: string;
  issueKey?: string;
  issueTitle: string;
  projectId?: string;
  token: string;
}) {
  const [pages, setPages] = useState<DocPageCard[]>([]);
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    docsApi.links({ issueId }, token).then((r) => r.success && r.data && setPages(r.data.pages));
  }, [issueId, token]);

  useEffect(() => load(), [load]);

  async function unlink(pageId: string) {
    const page = await docsApi.getPage(pageId, token);
    if (!page.success || !page.data) return setError(errorText(page));
    const r = await docsApi.updatePage(pageId, { issueIds: page.data.issues.map((i) => i.id).filter((id) => id !== issueId) }, token);
    if (!r.success) return setError(errorText(r, 'Could not unlink'));
    setError('');
    load();
  }

  const issueIds = useMemo(() => [issueId], [issueId]);
  const projectIds = useMemo(() => (projectId ? [projectId] : undefined), [projectId]);

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--text-primary)]">
          <FiBookOpen /> Docs {pages.length > 0 && <span className="font-normal text-[color:var(--text-muted)]">{pages.length}</span>}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setLinking(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--accent)]">
            <FiLink2 /> Link page
          </button>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--accent)]">
            <FiPlus /> Create page
          </button>
        </div>
      </div>
      {pages.length ? (
        <div className="-mx-2">
          {pages.map((p) => (
            <PageCardRow
              key={p.id}
              page={p}
              right={
                p.linkType === 'linked' ? (
                  <button type="button" onClick={() => unlink(p.id)} className="p-1 text-[color:var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-400" title="Unlink">
                    <FiX />
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[color:var(--text-muted)]">
          No pages yet. Link a spec or notes page{issueKey ? `, or mention ${issueKey} in any page` : ''}.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <LinkPageModal
        open={linking}
        onClose={() => setLinking(false)}
        token={token}
        issueId={issueId}
        exclude={pages.filter((p) => p.linkType === 'linked').map((p) => p.id)}
        onLinked={load}
      />
      <CreatePageModal
        open={creating}
        onClose={() => setCreating(false)}
        token={token}
        issueIds={issueIds}
        projectIds={projectIds}
        defaultTitle={issueKey ? `${issueKey}: ${issueTitle}` : issueTitle}
        onCreated={load}
      />
    </div>
  );
}

function LinkPageModal({
  open,
  onClose,
  token,
  issueId,
  exclude,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  issueId: string;
  exclude: string[];
  onLinked: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DocPageCard[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      docsApi.search({ q: q.trim() || undefined, limit: 20 }, token).then((r) => setResults(r.data?.pages ?? []));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, open, token]);

  async function link(pageId: string) {
    const page = await docsApi.getPage(pageId, token);
    if (!page.success || !page.data) return setError(errorText(page));
    if (!page.data.canEdit) return setError('You can view that page but not edit it, so you can’t link it.');
    const r = await docsApi.updatePage(pageId, { issueIds: [...page.data.issues.map((i) => i.id), issueId] }, token);
    if (!r.success) return setError(errorText(r, 'Could not link'));
    onLinked();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Link a page" subtitle="Search pages in the spaces you can open." width="max-w-xl">
      <div className="relative mb-3">
        <FiSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
        <input autoFocus className={`${inputCls} !pl-9`} placeholder="Search pages…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[50vh] overflow-y-auto -mx-2">
        {results
          .filter((p) => !exclude.includes(p.id))
          .map((p) => (
            <button key={p.id} type="button" onClick={() => link(p.id)} className="block w-full text-left">
              <div className="pointer-events-none">
                <PageCardRow page={p} />
              </div>
            </button>
          ))}
        {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-[color:var(--text-muted)]">No pages found.</p>}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
