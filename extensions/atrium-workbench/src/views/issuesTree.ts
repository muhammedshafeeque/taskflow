import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { getIssue, getProject, listMyIssues, type IssueRef } from '../api/issues';
import type { SessionStore } from '../auth/session';
import { isClosedStatus } from '../util/status';
import { ensureFolderProject, type FolderProjectBinding } from '../workspace/folderProject';

export type AtriumTreeNode = IssueTreeItem | ActionTreeItem;

export class ActionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    commandId: string,
    description?: string,
    icon?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = 'atriumAction';
    this.iconPath = new vscode.ThemeIcon(icon || 'arrow-right');
    this.command = { command: commandId, title: label };
  }
}

export class IssueTreeItem extends vscode.TreeItem {
  constructor(readonly issue: IssueRef, readonly isOpen: boolean) {
    const key = issue.key || issue._id.slice(-6);
    super(`${key} · ${issue.title}`, vscode.TreeItemCollapsibleState.None);
    this.description = issue.status;
    this.tooltip = `${key}\n${issue.title}\n${issue.status}`;
    this.contextValue = isOpen ? 'atriumIssueOpen' : 'atriumIssue';
    this.iconPath = new vscode.ThemeIcon(isOpen ? 'circle-outline' : 'pass');
    this.command = {
      command: 'atrium.openIssue',
      title: 'Open Issue',
      arguments: [issue],
    };
  }
}

export class IssuesTreeProvider implements vscode.TreeDataProvider<AtriumTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AtriumTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache: IssueTreeItem[] = [];
  private boundProject: FolderProjectBinding | undefined;
  private promptingProject = false;

  constructor(
    private readonly session: SessionStore,
    private readonly client: AtriumClient,
    private readonly onBindingChanged?: () => void
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getBoundProject(): FolderProjectBinding | undefined {
    return this.boundProject;
  }

  getTreeItem(element: AtriumTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AtriumTreeNode[]> {
    // Empty tree so package.json viewsWelcome can show for no-URL / signed-out.
    if (!this.session.getApiBaseUrl()) {
      this.boundProject = undefined;
      this.onBindingChanged?.();
      return [];
    }

    if (!(await this.session.isSignedIn())) {
      this.boundProject = undefined;
      this.onBindingChanged?.();
      return [];
    }

    try {
      const user = await this.session.getUser();
      if (!user?.id) {
        this.boundProject = undefined;
        this.onBindingChanged?.();
        return [];
      }

      let binding: FolderProjectBinding | undefined;
      if (!this.promptingProject) {
        this.promptingProject = true;
        try {
          binding = await ensureFolderProject(this.client);
        } finally {
          this.promptingProject = false;
        }
      }
      this.boundProject = binding;
      this.onBindingChanged?.();

      if (!binding) {
        return [
          new ActionTreeItem(
            'Set Project for this Folder',
            'atrium.setProject',
            'Choose which Atrium project belongs to this workspace',
            'folder'
          ),
        ];
      }

      const page = await listMyIssues(this.client, user.id, { projectId: binding.projectId });
      const items: IssueTreeItem[] = [];
      const projectStatusCache = new Map<string, Array<{ name: string; isClosed?: boolean }>>();

      for (const issue of page.data) {
        let statuses = issue.project?.statuses;
        const projectId = issue.project?._id || binding.projectId;
        if ((!statuses || statuses.length === 0) && projectId) {
          if (!projectStatusCache.has(projectId)) {
            try {
              const project = await getProject(this.client, projectId);
              projectStatusCache.set(projectId, project.statuses ?? []);
            } catch {
              projectStatusCache.set(projectId, []);
            }
          }
          statuses = projectStatusCache.get(projectId);
        }
        const open = !isClosedStatus(issue.status, statuses);
        items.push(new IssueTreeItem(issue, open));
      }

      items.sort((a, b) => Number(b.isOpen) - Number(a.isOpen));
      this.cache = items;

      if (items.length === 0) {
        const label = binding.projectKey || binding.projectName || 'this project';
        return [
          new ActionTreeItem(
            `No issues in ${label}`,
            'atrium.refreshIssues',
            'Assign yourself an issue in this project, then refresh',
            'info'
          ),
        ];
      }
      return items;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return [
        new ActionTreeItem('Retry loading issues', 'atrium.refreshIssues', msg, 'warning'),
        new ActionTreeItem('Sign in again', 'atrium.getStarted', undefined, 'sign-in'),
      ];
    }
  }

  getCached(): IssueTreeItem[] {
    return this.cache;
  }
}

export async function loadIssueWithStatuses(client: AtriumClient, issueOrId: IssueRef | string): Promise<{
  issue: IssueRef;
  statuses: Array<{ name: string; isClosed?: boolean }>;
}> {
  const issue = typeof issueOrId === 'string' ? await getIssue(client, issueOrId) : await getIssue(client, issueOrId._id);
  let statuses = issue.project?.statuses ?? [];
  if ((!statuses || statuses.length === 0) && issue.project?._id) {
    try {
      const project = await getProject(client, issue.project._id);
      statuses = project.statuses ?? [];
    } catch {
      statuses = [];
    }
  }
  return { issue, statuses };
}
