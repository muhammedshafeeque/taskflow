import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import {
  addComment,
  listAttachments,
  listComments,
  updateIssue,
  type IssueAttachment,
  type IssueRef,
} from '../api/issues';
import { isClosedStatus } from '../util/status';
import { clearIssueContextIfActive } from '../do/clearContext';
import { loadIssueWithStatuses } from './issuesTree';
import { escapeHtml, renderAttachmentsList, renderRichContent } from './richContent';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function formatWhen(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function priorityClass(priority?: string): string {
  const p = (priority || '').toLowerCase();
  if (p.includes('highest') || p.includes('critical') || p === 'blocker') return 'prio-critical';
  if (p.includes('high')) return 'prio-high';
  if (p.includes('low') || p.includes('lowest')) return 'prio-low';
  return 'prio-med';
}

function hasMeaningfulBody(body?: string): boolean {
  if (!body?.trim()) return false;
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return true;
  return /<(img|video|iframe)\b|data-video-block|data-attachment-block/i.test(body);
}

export class IssuePanel {
  public static current: IssuePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private issueId: string;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly client: AtriumClient,
    private readonly onDo: (issue: IssueRef) => void,
    private readonly onChanged: () => void,
    issueId: string
  ) {
    this.panel = panel;
    this.issueId = issueId;
    this.panel.onDidDispose(() => {
      if (IssuePanel.current === this) IssuePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === 'refresh') await this.render();
        if (msg.type === 'setStatus') {
          const { issue, statuses } = await loadIssueWithStatuses(this.client, this.issueId);
          await updateIssue(this.client, this.issueId, { status: msg.status });
          if (isClosedStatus(String(msg.status || ''), statuses)) {
            const cleared = await clearIssueContextIfActive(this.issueId, issue.key);
            if (cleared) {
              vscode.window.showInformationMessage(
                `Cleared local Atrium context for ${issue.key || 'issue'} (.atrium packet & attachments).`
              );
            }
          }
          this.onChanged();
          await this.render();
        }
        if (msg.type === 'addComment') {
          await addComment(this.client, this.issueId, String(msg.body || ''));
          await this.render();
        }
        if (msg.type === 'do') {
          const { issue } = await loadIssueWithStatuses(this.client, this.issueId);
          this.onDo(issue);
        }
        if (msg.type === 'openInBrowser') {
          await vscode.commands.executeCommand('atrium.openInBrowser', { _id: this.issueId } as IssueRef);
        }
        if (msg.type === 'openExternal' && typeof msg.url === 'string') {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
      } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    });
  }

  static show(
    client: AtriumClient,
    issue: IssueRef,
    onDo: (issue: IssueRef) => void,
    onChanged: () => void
  ): void {
    if (IssuePanel.current) {
      IssuePanel.current.issueId = issue._id;
      IssuePanel.current.panel.reveal();
      void IssuePanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'atriumIssue',
      issue.key || 'Issue',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    IssuePanel.current = new IssuePanel(panel, client, onDo, onChanged, issue._id);
    void IssuePanel.current.render();
  }

  private async render(): Promise<void> {
    const { issue, statuses } = await loadIssueWithStatuses(this.client, this.issueId);
    const comments = await listComments(this.client, issue._id);
    let attachments: IssueAttachment[] = [];
    try {
      attachments = await listAttachments(this.client, issue._id);
    } catch {
      attachments = [];
    }
    const open = !isClosedStatus(issue.status, statuses);
    this.panel.title = issue.key || issue.title;
    const apiBase = this.client.getApiBaseUrl();
    const token = await this.client.getAccessToken();
    this.panel.webview.html = this.html(issue, statuses, comments.data, attachments, open, apiBase, token);
  }

  private html(
    issue: IssueRef,
    statuses: Array<{ name: string; isClosed?: boolean }>,
    comments: Array<{ body: string; author?: { name?: string }; createdAt?: string }>,
    attachments: IssueAttachment[],
    open: boolean,
    apiBase: string,
    token: string | undefined
  ): string {
    const n = nonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${this.panel.webview.cspSource} https: http: data: blob:`,
      `media-src https: http: blob:`,
      `frame-src https: http:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${n}'`,
      `font-src ${this.panel.webview.cspSource} data:`,
    ].join('; ');

    const hasDesc = hasMeaningfulBody(issue.description);
    const descHtml = hasDesc
      ? renderRichContent(issue.description || '', apiBase, token)
      : `<div class="empty">No description</div>`;
    const attachmentsBlock = attachments.length
      ? `<section class="section"><div class="section-head"><h2>Attachments</h2><span class="count">${attachments.length}</span></div><div class="section-body">${renderAttachmentsList(
          attachments,
          apiBase,
          token,
          { skipHeading: true }
        )}</div></section>`
      : '';

    const statusOptions = (statuses.length ? statuses.map((s) => s.name) : [issue.status])
      .filter(Boolean)
      .map(
        (name) =>
          `<option value="${escapeHtml(name)}" ${name === issue.status ? 'selected' : ''}>${escapeHtml(name)}</option>`
      )
      .join('');

    const commentHtml = comments.length
      ? comments
          .map((c) => {
            const initial = escapeHtml((c.author?.name || 'U').trim().charAt(0).toUpperCase() || 'U');
            return `<article class="comment">
  <div class="avatar" aria-hidden="true">${initial}</div>
  <div class="comment-main">
    <div class="comment-head">
      <span class="author">${escapeHtml(c.author?.name || 'User')}</span>
      <time>${escapeHtml(formatWhen(c.createdAt))}</time>
    </div>
    <div class="comment-body">${renderRichContent(c.body || '', apiBase, token)}</div>
  </div>
</article>`;
          })
          .join('')
      : `<div class="empty">No comments yet</div>`;

    const type = escapeHtml(issue.type || 'Issue');
    const priority = escapeHtml(issue.priority || '');
    const key = escapeHtml(issue.key || '');
    const prioCls = priorityClass(issue.priority);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root {
    --pad: 20px;
    --radius: 8px;
    --border: var(--vscode-widget-border, rgba(127,127,127,.35));
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground, color-mix(in srgb, var(--fg) 65%, transparent));
    --panel: var(--vscode-sideBar-background, color-mix(in srgb, var(--bg) 92%, var(--fg)));
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--border));
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --sec-bg: var(--vscode-button-secondaryBackground, transparent);
    --sec-fg: var(--vscode-button-secondaryForeground, var(--fg));
    --link: var(--vscode-textLink-foreground);
    --focus: var(--vscode-focusBorder);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--fg);
    background: var(--bg);
    line-height: 1.5;
  }
  .page { max-width: 860px; margin: 0 auto; padding: var(--pad); padding-bottom: 48px; }
  .hero {
    display: flex; flex-direction: column; gap: 14px;
    padding-bottom: 16px; margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.02em; border: 1px solid var(--border);
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    color: var(--muted);
  }
  .badge.key { color: var(--fg); background: color-mix(in srgb, var(--btn-bg) 22%, transparent); border-color: color-mix(in srgb, var(--btn-bg) 45%, var(--border)); }
  .badge.prio-critical { color: #ff6b6b; border-color: color-mix(in srgb, #ff6b6b 50%, var(--border)); background: color-mix(in srgb, #ff6b6b 12%, transparent); }
  .badge.prio-high { color: #ffa94d; border-color: color-mix(in srgb, #ffa94d 45%, var(--border)); background: color-mix(in srgb, #ffa94d 10%, transparent); }
  .badge.prio-med { color: var(--fg); }
  .badge.prio-low { color: var(--muted); }
  h1 {
    margin: 0; font-size: 22px; font-weight: 600; line-height: 1.3;
    letter-spacing: -0.01em;
  }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 12px; border-radius: var(--radius);
    background: var(--panel); border: 1px solid var(--border);
  }
  .field {
    display: flex; flex-direction: column; gap: 4px; min-width: 160px; flex: 1;
  }
  .field label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  select, textarea, button {
    font: inherit; border-radius: 6px; outline: none;
  }
  select, textarea {
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); padding: 7px 10px;
  }
  select:focus, textarea:focus { border-color: var(--focus); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
  button {
    cursor: pointer; padding: 7px 14px; border: 1px solid transparent;
    transition: background .12s ease, border-color .12s ease;
  }
  button:hover { filter: brightness(1.05); }
  button.primary { background: var(--btn-bg); color: var(--btn-fg); }
  button.primary:hover { background: var(--btn-hover, var(--btn-bg)); }
  button.secondary {
    background: var(--sec-bg); color: var(--sec-fg);
    border-color: var(--border);
  }
  button.ghost {
    background: transparent; color: var(--muted); border-color: transparent;
  }
  button.ghost:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); }
  .meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px 16px; margin-top: 4px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-item .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .meta-item .val { font-size: 13px; }
  .section { margin-top: 22px; }
  .section-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px;
  }
  .section-head h2 {
    margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted);
  }
  .count {
    font-size: 11px; padding: 1px 7px; border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--muted);
  }
  .section-body {
    padding: 14px 16px; border-radius: var(--radius);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 70%, var(--bg));
  }
  .empty {
    color: var(--muted); font-size: 13px; font-style: italic;
    padding: 8px 0;
  }
  .prose img, .media-block img {
    max-width: 100%; max-height: 480px; height: auto; object-fit: contain;
    border-radius: 8px; border: 1px solid var(--border); display: block; background: var(--bg);
  }
  .media-block { margin: 12px 0; }
  .media-block video {
    max-width: 100%; max-height: 420px; border-radius: 8px; background: #000; display: block;
    border: 1px solid var(--border);
  }
  .pdf-frame {
    width: 100%; height: 480px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg);
  }
  .media-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
  .media-actions { margin-top: 8px; font-size: 12px; }
  .media-actions a, .file-chip a, .prose a { color: var(--link); text-decoration: none; }
  .media-actions a:hover, .file-chip a:hover, .prose a:hover { text-decoration: underline; }
  .file-chip {
    display: inline-flex; align-items: center; margin: 4px 8px 4px 0;
    padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg);
  }
  .comment {
    display: flex; gap: 12px; padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .comment:last-child { border-bottom: none; padding-bottom: 0; }
  .comment:first-child { padding-top: 0; }
  .avatar {
    flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
    display: grid; place-items: center; font-size: 12px; font-weight: 700;
    background: color-mix(in srgb, var(--btn-bg) 35%, var(--panel));
    color: var(--fg); border: 1px solid var(--border);
  }
  .comment-main { flex: 1; min-width: 0; }
  .comment-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 4px; }
  .author { font-weight: 600; font-size: 13px; }
  .comment-head time { font-size: 11px; color: var(--muted); }
  .composer {
    margin-top: 14px; display: flex; flex-direction: column; gap: 10px;
  }
  .composer textarea {
    width: 100%; min-height: 88px; resize: vertical;
  }
  .composer-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .mention {
    display: inline-flex; padding: 0 6px; border-radius: 4px;
    border: 1px solid var(--border); font-size: 12px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .prose p { margin: 0.45em 0; }
  .prose ul, .prose ol { padding-left: 1.25em; margin: 0.4em 0; }
  .prose h1, .prose h2, .prose h3 { font-size: 1.05em; margin: 0.8em 0 0.35em; }
</style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <div class="badges">
        ${key ? `<span class="badge key">${key}</span>` : ''}
        <span class="badge">${type}</span>
        ${priority ? `<span class="badge ${prioCls}">${priority}</span>` : ''}
        ${open ? '' : `<span class="badge">Closed</span>`}
      </div>
      <h1>${escapeHtml(issue.title)}</h1>
      <div class="toolbar">
        <div class="field">
          <label for="status">Status</label>
          <select id="status">${statusOptions}</select>
        </div>
        <div class="actions">
          <button class="primary" id="saveStatus">Update</button>
          ${open ? '<button class="primary" id="doBtn">Do</button>' : ''}
          <button class="secondary" id="openBrowser">Open in Browser</button>
          <button class="ghost" id="refresh" title="Refresh">Refresh</button>
        </div>
      </div>
      <div class="meta">
        <div class="meta-item">
          <span class="lbl">Assignee</span>
          <span class="val">${escapeHtml(issue.assignee?.name || 'Unassigned')}</span>
        </div>
        <div class="meta-item">
          <span class="lbl">Reporter</span>
          <span class="val">${escapeHtml(issue.reporter?.name || '—')}</span>
        </div>
        <div class="meta-item">
          <span class="lbl">Updated</span>
          <span class="val">${escapeHtml(formatWhen(issue.updatedAt) || '—')}</span>
        </div>
      </div>
    </header>

    <section class="section">
      <div class="section-head"><h2>Description</h2></div>
      <div class="section-body desc">${descHtml}</div>
    </section>

    ${attachmentsBlock}

    <section class="section">
      <div class="section-head">
        <h2>Comments</h2>
        <span class="count">${comments.length}</span>
      </div>
      <div class="section-body">
        <div class="comments">${commentHtml}</div>
        <div class="composer">
          <textarea id="comment" placeholder="Write a comment…"></textarea>
          <div class="composer-actions">
            <button class="primary" id="addComment">Add comment</button>
          </div>
        </div>
      </div>
    </section>
  </div>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    document.getElementById('saveStatus')?.addEventListener('click', () => {
      const status = document.getElementById('status').value;
      vscode.postMessage({ type: 'setStatus', status });
    });
    document.getElementById('addComment')?.addEventListener('click', () => {
      const el = document.getElementById('comment');
      const body = el.value;
      if (body.trim()) {
        vscode.postMessage({ type: 'addComment', body });
        el.value = '';
      }
    });
    document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('doBtn')?.addEventListener('click', () => vscode.postMessage({ type: 'do' }));
    document.getElementById('openBrowser')?.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href === '#' || href.startsWith('mailto:')) return;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        vscode.postMessage({ type: 'openExternal', url: href });
      }
    });
  </script>
</body>
</html>`;
  }
}
