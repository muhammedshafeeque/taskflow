import * as vscode from 'vscode';
import type { SessionStore } from '../auth/session';

/**
 * "Agent Jobs": recent fix / command / deploy jobs that the PA server sent to
 * paired PCs (`ivx agent run`). Reads PA's admin API with your Atrium sign-in.
 * Set `atrium.paUrl` to the PA server origin to enable it.
 */
type AgentJob = {
  _id: string;
  type: string;
  status: string;
  issueKey?: string;
  command?: string;
  instruction?: string;
  summary?: string;
  diffStat?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  logs?: Array<{ at: string; line: string }>;
};

const STATUS_ICON: Record<string, string> = {
  queued: 'clock',
  running: 'sync~spin',
  needs_review: 'eye',
  approved_deploy: 'rocket',
  done: 'pass',
  failed: 'error',
  cancelled: 'circle-slash',
};

export function paUrl(): string {
  return (vscode.workspace.getConfiguration('atrium').get<string>('paUrl') || '').replace(/\/$/, '');
}

async function paRequest<T>(session: SessionStore, path: string): Promise<T> {
  const base = paUrl();
  if (!base) throw new Error('Set "atrium.paUrl" to your PA server URL');
  const token = await session.getAccessToken();
  if (!token) throw new Error('Sign in to Atrium first');
  const res = await fetch(`${base}/api/admin${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
  if (!res.ok || json.success === false) throw new Error(json.error || `PA request failed (${res.status})`);
  return json.data as T;
}

export class AgentJobItem extends vscode.TreeItem {
  constructor(readonly job: AgentJob) {
    const what = job.issueKey ?? job.command ?? job.type;
    super(`${what}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${job.status.replace('_', ' ')} · ${new Date(job.updatedAt ?? job.createdAt).toLocaleString()}`;
    this.tooltip = [job.type, job.status, job.summary, job.diffStat, job.error].filter(Boolean).join('\n');
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[job.status] ?? 'circle-outline');
    this.contextValue = 'atriumAgentJob';
    this.command = { command: 'atrium.showAgentJob', title: 'Show job log', arguments: [job._id] };
  }
}

export class AgentJobsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly session: SessionStore) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!paUrl()) {
      const item = new vscode.TreeItem('Set atrium.paUrl to see agent jobs');
      item.iconPath = new vscode.ThemeIcon('gear');
      item.command = { command: 'workbench.action.openSettings', title: 'Open settings', arguments: ['atrium.paUrl'] };
      return [item];
    }
    try {
      const jobs = await paRequest<AgentJob[]>(this.session, '/agent/jobs?limit=30');
      if (!jobs.length) return [new vscode.TreeItem('No agent jobs yet')];
      return jobs.map((j) => new AgentJobItem(j));
    } catch (e) {
      const item = new vscode.TreeItem(e instanceof Error ? e.message : 'Could not load jobs');
      item.iconPath = new vscode.ThemeIcon('warning');
      return [item];
    }
  }
}

let channel: vscode.OutputChannel | undefined;

export async function showAgentJob(session: SessionStore, id: string): Promise<void> {
  channel ??= vscode.window.createOutputChannel('Atrium Agent Job');
  try {
    const job = await paRequest<AgentJob>(session, `/agent/jobs/${encodeURIComponent(id)}`);
    channel.clear();
    channel.appendLine(`${job.type} · ${job.issueKey ?? job.command ?? ''} · ${job.status}`);
    if (job.instruction) channel.appendLine(`Instruction: ${job.instruction}`);
    channel.appendLine('');
    for (const l of job.logs ?? []) channel.appendLine(`[${new Date(l.at).toLocaleTimeString()}] ${l.line}`);
    if (job.summary) channel.appendLine(`\nSummary:\n${job.summary}`);
    if (job.diffStat) channel.appendLine(`\nDiff:\n${job.diffStat}`);
    if (job.error) channel.appendLine(`\nError: ${job.error}`);
    channel.show(true);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not load job: ${e instanceof Error ? e.message : String(e)}`);
  }
}
