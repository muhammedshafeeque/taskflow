import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface DoCapabilities {
  isCursor: boolean;
  hasClaudeCli: boolean;
}

export async function detectCapabilities(): Promise<DoCapabilities> {
  const appName = (vscode.env.appName || '').toLowerCase();
  const isCursor = appName.includes('cursor');
  let hasClaudeCli = false;
  try {
    await execFileAsync('claude', ['--version'], { timeout: 3000 });
    hasClaudeCli = true;
  } catch {
    hasClaudeCli = false;
  }
  return { isCursor, hasClaudeCli };
}
