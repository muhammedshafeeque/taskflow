import * as vscode from 'vscode';

export type BranchChoice = 'created' | 'current' | 'cancel';

export async function promptCreateBranch(defaultName: string): Promise<{ choice: BranchChoice; branchName: string }> {
  const branchName =
    (
      await vscode.window.showInputBox({
        title: 'Create branch for this issue?',
        prompt: 'Branch name (default = ticket id). Leave as-is or edit.',
        value: defaultName,
        ignoreFocusOut: true,
      })
    )?.trim() || defaultName;

  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Create & continue', description: `git checkout -b ${branchName}`, id: 'created' as const },
      { label: 'Stay on current branch', id: 'current' as const },
      { label: 'Cancel', id: 'cancel' as const },
    ],
    { title: `Branch for ${defaultName}`, ignoreFocusOut: true }
  );

  if (!pick || pick.id === 'cancel') return { choice: 'cancel', branchName };
  return { choice: pick.id, branchName };
}

export async function ensureBranch(branchName: string): Promise<string | undefined> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    vscode.window.showWarningMessage('Git extension not available; continuing without branch switch.');
    return undefined;
  }
  await gitExt.activate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (gitExt.exports as any).getAPI?.(1);
  const repo = api?.repositories?.[0];
  if (!repo) {
    vscode.window.showWarningMessage('No git repository in this workspace.');
    return undefined;
  }

  try {
    const refs: string[] = (await repo.getBranches?.(true))?.map((b: { name: string }) => b.name) ?? [];
    const exists = refs.includes(branchName) || refs.some((r) => r.endsWith(`/${branchName}`));
    if (exists) {
      await repo.checkout(branchName);
    } else {
      await repo.createBranch(branchName, true);
    }
    return branchName;
  } catch (e) {
    // Fallback: terminal commands
    const term = vscode.window.createTerminal('Atrium Git');
    term.show(true);
    term.sendText(`git checkout -B ${JSON.stringify(branchName).slice(1, -1)}`);
    vscode.window.showWarningMessage(
      `Tried to create/switch branch via terminal: ${e instanceof Error ? e.message : String(e)}`
    );
    return branchName;
  }
}
