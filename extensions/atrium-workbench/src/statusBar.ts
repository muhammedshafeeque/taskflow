import * as vscode from 'vscode';
import type { SessionStore } from './auth/session';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly session: SessionStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'atrium.signIn';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  async refresh(): Promise<void> {
    const url = this.session.getApiBaseUrl();
    if (!url) {
      this.item.text = '$(rocket) Atrium: Get Started';
      this.item.tooltip = 'Set server URL and sign in';
      this.item.command = 'atrium.getStarted';
      return;
    }
    if (!(await this.session.isSignedIn())) {
      this.item.text = '$(rocket) Atrium: Get Started';
      this.item.tooltip = `Sign in · ${url}`;
      this.item.command = 'atrium.getStarted';
      return;
    }
    const user = await this.session.getUser();
    this.item.text = `$(check) Atrium · ${user?.email || 'signed in'}`;
    this.item.tooltip = url;
    this.item.command = 'atrium.refreshIssues';
  }
}
