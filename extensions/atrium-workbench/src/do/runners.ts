import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { updateIssue, type IssueRef } from '../api/issues';
import { findInProgressStatus } from '../util/status';
import { loadIssueWithStatuses } from '../views/issuesTree';
import { collectAndDownloadIssueMedia, ensureAtriumGitignored, type LocalAttachment } from './attachments';
import { ensureBranch, promptCreateBranch } from './branch';
import { detectCapabilities } from './capabilities';
import { writeActiveIssueMeta } from './clearContext';
import { buildIssuePacket } from './packet';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writePacketFile(packet: string): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder so the Issue Packet can be written.');
    return undefined;
  }
  await ensureAtriumGitignored();
  const dir = path.join(folder.uri.fsPath, '.atrium');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'current-issue.md');
  await fs.writeFile(file, packet, 'utf8');
  return vscode.Uri.file(file);
}

function workspaceRel(uri: vscode.Uri): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return uri.fsPath;
  return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
}

function buildCursorPrompt(
  packet: string,
  packetUri?: vscode.Uri,
  attachments: LocalAttachment[] = []
): string {
  const packetRel = packetUri ? workspaceRel(packetUri) : '.atrium/current-issue.md';
  const attachLines = attachments.map((a) => `- @${a.relPath}`).join('\n');
  const attachBlock = attachments.length
    ? `\nAlso read these issue attachments:\n${attachLines}\n`
    : '';

  return `Implement this Atrium issue in the current workspace.

Issue packet file: @${packetRel}
${attachBlock}
Follow the description and acceptance criteria. Use the attached PNG/JPEG screenshots for UI and bug context.
Ask before destructive changes. Do not push or force-push. Do not mark the issue Done unless I confirm.
When finished, summarize files changed and remaining risks.

---
${packet}
`;
}

async function tryExecute(command: string, ...args: unknown[]): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(command, ...args);
    return true;
  } catch {
    return false;
  }
}

async function attachFilesToComposer(files: vscode.Uri[]): Promise<void> {
  if (!files.length) return;
  await tryExecute('composer.addfilestonnewcomposer', files);
  await tryExecute('composer.addfilestocomposer', files);
  for (const f of files) {
    await tryExecute('composer.addfilestonnewcomposer', f);
    await tryExecute('composer.addfilestocomposer', f);
    await tryExecute('composer.addfilestonnewcomposer', [f]);
    await tryExecute('composer.addfilestocomposer', [f]);
  }
}

/** Prefer editor/pane composer — avoid Agents Window (blank right column). */
async function openComposerWithoutAgentsWindow(): Promise<boolean> {
  if (await tryExecute('composer.createNewComposerTab')) return true;
  if (await tryExecute('composer.openAsPane')) return true;
  if (await tryExecute('composer.openChatAsEditor')) return true;
  if (await tryExecute('composer.toggleChatAsEditor')) return true;
  if (await tryExecute('composer.openComposer')) return true;
  if (await tryExecute('composer.createNew')) return true;
  // Last resort — may open Agents Window
  if (await tryExecute('composer.newAgentChat')) return true;
  if (await tryExecute('aichat.newchataction')) return true;
  return false;
}

async function pasteAndSubmit(): Promise<void> {
  await tryExecute('composer.focusComposer');
  await sleep(80);
  const pasted =
    (await tryExecute('editor.action.clipboardPasteAction')) ||
    (await tryExecute('composer.paste'));
  if (!pasted) {
    await sleep(400);
    await tryExecute('composer.focusComposer');
    await tryExecute('editor.action.clipboardPasteAction');
  }
  await sleep(200);
  await tryExecute('composer.submitChat');
}

/**
 * Open Cursor composer (editor/pane preferred), inject prompt + files, auto-submit.
 */
async function sendPromptToCursorAgent(
  prompt: string,
  contextFiles: vscode.Uri[]
): Promise<boolean> {
  // Native commands that accept a prompt (best case — then attach + submit)
  const withPrompt: Array<[string, unknown[]]> = [
    ['composer.startComposerPrompt', [prompt]],
    ['composer.startComposerPrompt2', [prompt]],
    ['composer.createNewComposerTab', [prompt]],
    ['workbench.action.chat.open', [prompt]],
    ['workbench.action.chat.open', [{ query: prompt }]],
  ];
  for (const [cmd, args] of withPrompt) {
    if (await tryExecute(cmd, ...args)) {
      await sleep(200);
      await attachFilesToComposer(contextFiles);
      await tryExecute('composer.focusComposer');
      await sleep(100);
      await tryExecute('composer.submitChat');
      return true;
    }
  }

  const previousClipboard = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(prompt);

  const opened = await openComposerWithoutAgentsWindow();
  if (!opened) {
    return false;
  }

  await sleep(350);
  await tryExecute('composer.focusComposer');
  await attachFilesToComposer(contextFiles);
  await sleep(100);
  await pasteAndSubmit();

  void (async () => {
    await sleep(4000);
    try {
      const current = await vscode.env.clipboard.readText();
      if (current === prompt) {
        await vscode.env.clipboard.writeText(previousClipboard);
      }
    } catch {
      /* ignore */
    }
  })();

  return true;
}

type RunnerId = 'cursor' | 'claude' | 'copy';

/** Auto-pick runner: Cursor if in Cursor; else Claude CLI; else Copy. */
function pickRunner(caps: { isCursor: boolean; hasClaudeCli: boolean }): RunnerId {
  if (caps.isCursor) return 'cursor';
  if (caps.hasClaudeCli) return 'claude';
  return 'copy';
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

  const attachments = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Atrium: preparing ${key} context…`,
      cancellable: false,
    },
    async () => collectAndDownloadIssueMedia(client, issue)
  );

  const packet = buildIssuePacket(issue, branch, attachments);
  const packetUri = await writePacketFile(packet);
  await writeActiveIssueMeta({ issueId: issue._id, key: issue.key });
  const contextFiles = [
    ...(packetUri ? [packetUri] : []),
    ...attachments.map((a) => a.uri),
  ];

  const caps = await detectCapabilities();
  const runner = pickRunner(caps);

  const inProgress = findInProgressStatus(statuses);
  if (inProgress && issue.status !== inProgress) {
    try {
      await updateIssue(client, issue._id, { status: inProgress });
    } catch {
      /* best-effort */
    }
  }

  const prompt = buildCursorPrompt(packet, packetUri, attachments);

  if (runner === 'copy') {
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage(
      attachments.length
        ? `Issue prompt copied (${attachments.length} attachment file(s) under .atrium/attachments/).`
        : 'Issue prompt copied to clipboard.'
    );
    return;
  }

  if (runner === 'claude') {
    const term = vscode.window.createTerminal('Atrium · Claude');
    term.show(true);
    const paths = [
      ...(packetUri ? [packetUri.fsPath] : []),
      ...attachments.map((a) => a.absPath),
    ];
    const pathList = paths.map((p) => JSON.stringify(p)).join(' ');
    const instruction = attachments.length
      ? `Implement the Atrium issue. Read the packet and all attachment files: ${pathList}`
      : packetUri
        ? `Implement the Atrium issue described in ${JSON.stringify(packetUri.fsPath)}`
        : `Implement this Atrium issue:\n${packet.slice(0, 3500)}`;
    term.sendText(`claude ${JSON.stringify(instruction)}`);
    vscode.window.showInformationMessage(
      attachments.length
        ? `Started Claude Code with issue + ${attachments.length} attachment(s).`
        : 'Started Claude Code with the issue context.'
    );
    return;
  }

  // Cursor: inject + auto-submit; do not open current-issue.md (steals focus / clutter)
  const ok = await sendPromptToCursorAgent(prompt, contextFiles);

  if (ok) {
    const attachNote = attachments.length ? ` · ${attachments.length} attachment(s)` : '';
    vscode.window.showInformationMessage(`${key} started in Cursor Agent${attachNote}.`);
  } else {
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showWarningMessage(
      `Could not start Agent automatically. Prompt is on the clipboard — paste into Agent (Ctrl/Cmd+V). Attachments are in .atrium/attachments/.`
    );
  }
}
