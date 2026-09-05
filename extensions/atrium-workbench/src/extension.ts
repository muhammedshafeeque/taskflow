import * as vscode from 'vscode';
import { AtriumClient } from './api/client';
import type { IssueRef } from './api/issues';
import { selectAndSwitchOrganization } from './api/organizations';
import { refreshAtriumContext } from './auth/contextKeys';
import { signInWithEmail } from './auth/emailLogin';
import { runGetStarted } from './auth/getStarted';
import { configureApiUrl, registerIdeUriHandler, startBrowserSignIn } from './auth/ideLogin';
import { SessionStore } from './auth/session';
import { runDoIssue } from './do/runners';
import { StatusBarController } from './statusBar';
import { IssuePanel } from './views/issuePanel';
import { IssueTreeItem, IssuesTreeProvider } from './views/issuesTree';
import { clearFolderProjectCancel, pickAndSaveFolderProject } from './workspace/folderProject';

export function activate(context: vscode.ExtensionContext): void {
  const session = new SessionStore(context.secrets, context);
  const client = new AtriumClient(session);
  let tree!: IssuesTreeProvider;
  const status = new StatusBarController(session, () => tree.getBoundProject());
  tree = new IssuesTreeProvider(session, client, () => {
    void status.refresh();
  });

  async function afterAuthChange(): Promise<void> {
    await refreshAtriumContext(session);
    tree.refresh();
    await status.refresh();
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('atrium.issues', tree),
    status,
    vscode.commands.registerCommand('atrium.getStarted', async () => {
      await vscode.commands.executeCommand('atrium.issues.focus');
      const ok = await runGetStarted(session, client, context);
      if (ok && (await session.isSignedIn())) {
        await afterAuthChange();
        vscode.window.showInformationMessage('Atrium Workbench is ready. Open an issue from My Issues.');
      } else {
        await afterAuthChange();
      }
    }),
    vscode.commands.registerCommand('atrium.configureUrl', async () => {
      await configureApiUrl(session);
      await afterAuthChange();
    }),
    vscode.commands.registerCommand('atrium.signIn', async () => {
      try {
        if (!session.getApiBaseUrl()) {
          await vscode.commands.executeCommand('atrium.getStarted');
          return;
        }
        await startBrowserSignIn(session, client, context);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not start browser sign-in: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
    vscode.commands.registerCommand('atrium.signInEmail', async () => {
      if (!session.getApiBaseUrl()) {
        await vscode.commands.executeCommand('atrium.getStarted');
        return;
      }
      const ok = await signInWithEmail(session, client);
      if (ok) await afterAuthChange();
    }),
    vscode.commands.registerCommand('atrium.signOut', async () => {
      await session.clear();
      await afterAuthChange();
      vscode.window.showInformationMessage('Signed out of Atrium.');
    }),
    vscode.commands.registerCommand('atrium.refreshIssues', async () => {
      if (!(await session.isSignedIn())) {
        await vscode.commands.executeCommand('atrium.getStarted');
        return;
      }
      tree.refresh();
    }),
    vscode.commands.registerCommand('atrium.openIssue', async (issue?: IssueRef | IssueTreeItem) => {
      const ref = issue instanceof IssueTreeItem ? issue.issue : issue;
      if (!ref) return;
      IssuePanel.show(client, ref, (i) => void runDoIssue(client, i), () => tree.refresh());
    }),
    vscode.commands.registerCommand('atrium.doIssue', async (issue?: IssueRef | IssueTreeItem) => {
      const ref = issue instanceof IssueTreeItem ? issue.issue : issue;
      if (!ref) {
        vscode.window.showInformationMessage('Select an open issue first.');
        return;
      }
      await runDoIssue(client, ref);
      tree.refresh();
    }),
    vscode.commands.registerCommand('atrium.openInBrowser', async (issue?: IssueRef | IssueTreeItem) => {
      const ref = issue instanceof IssueTreeItem ? issue.issue : issue;
      const web = session.getWebBaseUrl();
      if (!web) {
        await vscode.commands.executeCommand('atrium.getStarted');
        return;
      }
      if (ref?._id) {
        await vscode.env.openExternal(vscode.Uri.parse(`${web}/issues/${ref._id}`));
      } else {
        await vscode.env.openExternal(vscode.Uri.parse(web));
      }
    }),
    vscode.commands.registerCommand('atrium.selectOrganization', async () => {
      if (!(await session.isSignedIn())) {
        await vscode.commands.executeCommand('atrium.getStarted');
        return;
      }
      try {
        await selectAndSwitchOrganization(session, client);
        await afterAuthChange();
      } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    }),
    vscode.commands.registerCommand('atrium.setProject', async () => {
      if (!(await session.isSignedIn())) {
        await vscode.commands.executeCommand('atrium.getStarted');
        return;
      }
      try {
        clearFolderProjectCancel();
        await pickAndSaveFolderProject(client, { force: true });
        tree.refresh();
        await status.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
      }
    })
  );

  registerIdeUriHandler(context, session, client, () => {
    void afterAuthChange();
  });

  void (async () => {
    await afterAuthChange();
    await vscode.commands.executeCommand('workbench.view.extension.atrium');

    if (!(await session.isSignedIn())) {
      // Open sidebar already; user can click Get Started in the tree.
      // Auto-run wizard once per install so it feels zero-friction.
      const seen = context.globalState.get<boolean>('atrium.autoStarted');
      if (!seen) {
        await context.globalState.update('atrium.autoStarted', true);
        await vscode.commands.executeCommand('atrium.getStarted');
      }
    } else {
      tree.refresh();
    }
  })();
}

export function deactivate(): void {}
