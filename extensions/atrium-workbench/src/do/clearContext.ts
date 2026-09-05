import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const ACTIVE_META = 'active-issue.json';
const PACKET = 'current-issue.md';
const ATTACH_DIR = 'attachments';

function atriumRoot(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, '.atrium');
}

export interface ActiveIssueMeta {
  issueId: string;
  key?: string;
}

export async function writeActiveIssueMeta(meta: ActiveIssueMeta): Promise<void> {
  const root = atriumRoot();
  if (!root) return;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, ACTIVE_META), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export async function readActiveIssueMeta(): Promise<ActiveIssueMeta | undefined> {
  const root = atriumRoot();
  if (!root) return undefined;
  try {
    const raw = await fs.readFile(path.join(root, ACTIVE_META), 'utf8');
    const parsed = JSON.parse(raw) as ActiveIssueMeta;
    if (!parsed?.issueId) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Remove Do context files (packet, attachments, active meta). Keeps project.json.
 */
export async function clearIssueContext(): Promise<void> {
  const root = atriumRoot();
  if (!root) return;

  const remove = async (rel: string) => {
    try {
      await fs.rm(path.join(root, rel), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  await remove(PACKET);
  await remove(ACTIVE_META);
  await remove(ATTACH_DIR);
}

/**
 * If the workspace Do context is for this issue, clear it (e.g. after marking Done).
 */
export async function clearIssueContextIfActive(issueId: string, issueKey?: string): Promise<boolean> {
  const meta = await readActiveIssueMeta();
  if (meta) {
    if (meta.issueId !== issueId && !(issueKey && meta.key && meta.key === issueKey)) {
      return false;
    }
  } else {
    // Fallback: inspect packet header if meta missing (older packets)
    const root = atriumRoot();
    if (!root) return false;
    try {
      const packet = await fs.readFile(path.join(root, PACKET), 'utf8');
      const keyOk = issueKey ? packet.includes(`Atrium issue ${issueKey}`) : false;
      const idOk = packet.includes(issueId);
      if (!keyOk && !idOk) return false;
    } catch {
      return false;
    }
  }

  await clearIssueContext();
  return true;
}
