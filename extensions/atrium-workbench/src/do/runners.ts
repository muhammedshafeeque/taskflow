import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { updateIssue, type IssueRef } from '../api/issues';
import { findInProgressStatus } from '../util/status';
import { loadIssueWithStatuses } from '../views/issuesTree';
import { ensureBranch, promptCreateBranch } from './branch';
import { detectCapabilities } from './capabilities';
import { buildIssuePacket } from './packet';

async function writePacketFile(packet: string): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder so the Issue Packet can be written.');
    return undefined;
  }
  const dir = path.join(folder.uri.fsPath, '.atrium');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'current-issue.md');
  await fs.writeFile(file, packet, 'utf8');
  return vscode.Uri.file(file);
}

export async function runDoIssue(client: AtriumClient, issueInput: IssueRef): Promise<void> {
  const { issue, statuses } = await loadIssueWithStatuses(client, issueInput);
  const key = issue.key || issue._id.slice(-8);

  const { choice, branchName } = await promptCreateBranch(key);
  if (choice === 'cancel') return;

  let branch: string | undefined;
  if (choice === 'created') {
    branch = await ensureBranch(branchName);
  }

  const packet = buildIssuePacket(issue, branch);
  const packetUri = await writePacketFile(packet);

  const caps = await detectCapabilities();
  const items: Array<{ label: string; id: 'cursor' | 'claude' | 'copy' }> = [];
  if (caps.isCursor) items.push({ label: 'Do it (Cursor)', id: 'cursor' });
  if (caps.hasClaudeCli) items.push({ label: 'Do with Claude', id: 'claude' });
  items.push({ label: 'Copy prompt', id: 'copy' });

  const pick = await vscode.window.showQuickPick(items, {
    title: `Do ${key}`,
    ignoreFocusOut: true,
  });
  if (!pick) return;

  const inProgress = findInProgressStatus(statuses);
  if (inProgress && issue.status !== inProgress) {
    try {
      await updateIssue(client, issue._id, { status: inProgress });
    } catch {
      /* best-effort */
    }
  }

  if (pick.id === 'copy') {
    await vscode.env.clipboard.writeText(packet);
    vscode.window.showInformationMessage('Issue prompt copied to clipboard.');
    return;
  }

  if (pick.id === 'claude') {
    const term = vscode.window.createTerminal('Atrium · Claude');
    term.show(true);
    const fileHint = packetUri ? packetUri.fsPath : '';
    const cmd = fileHint
      ? `claude "Implement the Atrium issue described in ${fileHint}"`
      : `claude ${JSON.stringify(packet.slice(0, 4000))}`;
    term.sendText(cmd);
    vscode.window.showInformationMessage('Started Claude Code with the issue context.');
    return;
  }

  // Cursor: open packet and copy prompt; try composer command if present
  if (packetUri) {
    const doc = await vscode.workspace.openTextDocument(packetUri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }
  await vscode.env.clipboard.writeText(packet);
  const composerCommands = [
    'composer.newAgentChat',
    'cursor.composer.createNewComposerTab',
    'aichat.newchataction',
    'workbench.action.chat.open',
  ];
  for (const cmd of composerCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      break;
    } catch {
      /* try next */
    }
  }
  vscode.window.showInformationMessage(
    'Issue packet ready. Paste the prompt into Cursor Agent/Chat (copied to clipboard).'
  );
}
