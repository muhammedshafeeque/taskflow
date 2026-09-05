import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { listProjects } from '../api/issues';
import { ensureAtriumGitignored } from '../do/attachments';

export interface FolderProjectBinding {
  projectId: string;
  projectKey?: string;
  projectName?: string;
}

const FILE_NAME = 'project.json';

/** Folders where the user cancelled the first-time picker this session. */
const cancelledFolders = new Set<string>();

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const matched = vscode.workspace.getWorkspaceFolder(active);
    if (matched) return matched;
  }
  return folders[0];
}

function projectFilePath(folder: vscode.WorkspaceFolder): string {
  return path.join(folder.uri.fsPath, '.atrium', FILE_NAME);
}

export async function readFolderProject(
  folder?: vscode.WorkspaceFolder
): Promise<FolderProjectBinding | undefined> {
  const f = folder ?? getWorkspaceFolder();
  if (!f) return undefined;
  try {
    const raw = await fs.readFile(projectFilePath(f), 'utf8');
    const parsed = JSON.parse(raw) as FolderProjectBinding;
    if (!parsed?.projectId || typeof parsed.projectId !== 'string') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeFolderProject(
  folder: vscode.WorkspaceFolder,
  binding: FolderProjectBinding
): Promise<void> {
  await ensureAtriumGitignored();
  const dir = path.join(folder.uri.fsPath, '.atrium');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(projectFilePath(folder), JSON.stringify(binding, null, 2) + '\n', 'utf8');
  cancelledFolders.delete(folder.uri.fsPath);
}

/**
 * QuickPick projects assigned to the user and save to `.atrium/project.json`.
 * Pass `force: true` to re-pick even when a binding already exists.
 */
export async function pickAndSaveFolderProject(
  client: AtriumClient,
  opts?: { force?: boolean }
): Promise<FolderProjectBinding | undefined> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to bind an Atrium project.');
    return undefined;
  }

  if (!opts?.force) {
    const existing = await readFolderProject(folder);
    if (existing) return existing;
  }

  let projects: Array<{ _id: string; name: string; key?: string }>;
  try {
    const page = await listProjects(client);
    projects = (page.data || []).map((p) => ({
      _id: p._id,
      name: p.name,
      key: p.key,
    }));
  } catch (e) {
    vscode.window.showErrorMessage(
      `Could not load projects: ${e instanceof Error ? e.message : String(e)}`
    );
    return undefined;
  }

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No Atrium projects are assigned to you in this organization.');
    return undefined;
  }

  const current = await readFolderProject(folder);
  const picked = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: p.name,
      description: p.key || p._id,
      detail: current?.projectId === p._id ? 'Current for this folder' : undefined,
      project: p,
    })),
    {
      title: 'Select Atrium project for this folder',
      placeHolder: 'Issues in My Issues will be filtered to this project',
      ignoreFocusOut: true,
    }
  );

  if (!picked) {
    cancelledFolders.add(folder.uri.fsPath);
    return undefined;
  }

  const binding: FolderProjectBinding = {
    projectId: picked.project._id,
    projectKey: picked.project.key,
    projectName: picked.project.name,
  };
  await writeFolderProject(folder, binding);
  vscode.window.showInformationMessage(
    `Atrium project set to ${binding.projectKey || binding.projectName} for this folder.`
  );
  return binding;
}

/**
 * Return saved binding, or prompt to pick one when missing (unless user cancelled this session).
 */
export async function ensureFolderProject(
  client: AtriumClient
): Promise<FolderProjectBinding | undefined> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to bind an Atrium project.');
    return undefined;
  }

  const existing = await readFolderProject(folder);
  if (existing) return existing;

  if (cancelledFolders.has(folder.uri.fsPath)) {
    return undefined;
  }

  return pickAndSaveFolderProject(client, { force: false });
}

export function clearFolderProjectCancel(folder?: vscode.WorkspaceFolder): void {
  const f = folder ?? getWorkspaceFolder();
  if (f) cancelledFolders.delete(f.uri.fsPath);
}
