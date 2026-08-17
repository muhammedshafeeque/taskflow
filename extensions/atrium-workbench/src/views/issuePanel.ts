import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { addComment, listComments, updateIssue, type IssueRef } from '../api/issues';
import { isClosedStatus } from '../util/status';
import { loadIssueWithStatuses } from './issuesTree';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
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
          await updateIssue(this.client, this.issueId, { status: msg.status });
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
    const open = !isClosedStatus(issue.status, statuses);
    this.panel.title = issue.key || issue.title;
    this.panel.webview.html = this.html(issue, statuses, comments.data, open);
  }

  private html(
    issue: IssueRef,
    statuses: Array<{ name: string; isClosed?: boolean }>,
    comments: Array<{ body: string; author?: { name?: string }; createdAt?: string }>,
    open: boolean
  ): string {
    const desc = stripHtml(issue.description || '');
    const statusOptions = (statuses.length
      ? statuses.map((s) => s.name)
      : [issue.status]
    )
      .filter(Boolean)
      .map((name) => `<option value="${escapeHtml(name)}" ${name === issue.status ? 'selected' : ''}>${escapeHtml(name)}</option>`)
      .join('');

    const commentHtml = comments
      .map(
        (c) =>
          `<div class="c"><div class="meta">${escapeHtml(c.author?.name || 'User')} · ${escapeHtml(c.createdAt || '')}</div><div>${escapeHtml(c.body)}</div></div>`
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .key { opacity: 0.7; font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
  select, button, textarea { font: inherit; }
  button { cursor: pointer; padding: 6px 12px; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  .desc { white-space: pre-wrap; margin: 12px 0; line-height: 1.4; opacity: 0.95; }
  .c { border-top: 1px solid var(--vscode-widget-border); padding: 8px 0; }
  .meta { opacity: 0.6; font-size: 11px; margin-bottom: 4px; }
  textarea { width: 100%; min-height: 64px; box-sizing: border-box; }
</style>
</head>
<body>
  <div class="key">${escapeHtml(issue.key || '')} · ${escapeHtml(issue.type || '')} · ${escapeHtml(issue.priority || '')}</div>
  <h1>${escapeHtml(issue.title)}</h1>
  <div class="row">
    <label>Status
      <select id="status">${statusOptions}</select>
    </label>
    <button class="primary" id="saveStatus">Update status</button>
    ${open ? '<button class="primary" id="doBtn">Do</button>' : ''}
  </div>
  <div>Assignee: ${escapeHtml(issue.assignee?.name || 'Unassigned')}</div>
  <div class="desc">${escapeHtml(desc) || '<em>No description</em>'}</div>
  <h2>Comments</h2>
  <div>${commentHtml || '<em>No comments</em>'}</div>
  <textarea id="comment" placeholder="Add a comment"></textarea>
  <div class="row"><button id="addComment">Add comment</button> <button id="refresh">Refresh</button></div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('saveStatus')?.addEventListener('click', () => {
      const status = document.getElementById('status').value;
      vscode.postMessage({ type: 'setStatus', status });
    });
    document.getElementById('addComment')?.addEventListener('click', () => {
      const body = document.getElementById('comment').value;
      if (body.trim()) vscode.postMessage({ type: 'addComment', body });
    });
    document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('doBtn')?.addEventListener('click', () => vscode.postMessage({ type: 'do' }));
  </script>
</body>
</html>`;
  }
}
