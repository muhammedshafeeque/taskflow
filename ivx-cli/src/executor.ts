import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { appendLogs, type AgentJob } from './api';
import type { IvxConfig } from './config';
import {
  assertPathJail,
  commandToArgv,
  isCommandAllowed,
  redactLogLine,
} from './security';

function which(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [
      bin,
    ]);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function detectAi(): Promise<{
  claude: boolean;
  gemini: boolean;
}> {
  const [claude, gemini] = await Promise.all([
    which('claude'),
    which('gemini'),
  ]);
  return { claude, gemini };
}

function resolveWorkspace(
  job: AgentJob,
  cfg: IvxConfig
): string {
  const maps = job.workspaces?.length ? job.workspaces : cfg.workspaces;
  const key = (job.projectKey || job.issueKey?.split('-')[0] || '')
    .trim()
    .toUpperCase();
  let hit = maps.find(
    (w) => w.projectKey.toUpperCase() === key || w.projectId === job.projectId
  );
  if (!hit && maps.length === 1) hit = maps[0];
  if (!hit) {
    throw new Error(
      `No workspace mapped for project ${key || job.projectId || '?'}`
    );
  }
  return assertPathJail(hit.localPath);
}

function buildAiPrompt(job: AgentJob): string {
  const issue = job.issueContext;
  const parts = [
    'You are fixing a software issue in this repository.',
    'Make minimal, correct changes. Do not commit unless asked.',
    '',
  ];
  if (issue) {
    parts.push(`Issue: ${issue.key || job.issueKey}`);
    parts.push(`Title: ${issue.title || ''}`);
    parts.push(`Status: ${issue.status || ''}`);
    if (issue.priority) parts.push(`Priority: ${issue.priority}`);
    if (issue.type) parts.push(`Type: ${issue.type}`);
    parts.push('');
  } else if (job.issueKey) {
    parts.push(`Issue key: ${job.issueKey}`, '');
  }
  if (job.instruction) {
    parts.push('Instructions:', job.instruction, '');
  }
  if (job.type === 'follow_up') {
    parts.push(
      'This is a follow-up. Continue from prior work on this issue.',
      ''
    );
  }
  parts.push('When done, briefly summarize what you changed.');
  return parts.join('\n');
}

async function runProcess(
  argv: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = argv;
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      shell: false,
    });
    let stdout = '';
    const handle = (buf: Buffer) => {
      const text = buf.toString('utf8');
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (line) onLine(redactLogLine(line));
      }
    };
    child.stdout?.on('data', handle);
    child.stderr?.on('data', handle);
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: stdout.slice(0, 100_000) })
    );
  });
}

async function gitDiffStat(cwd: string): Promise<{
  stat: string;
  patch: string;
}> {
  const run = (args: string[]) =>
    new Promise<string>((resolve) => {
      const child = spawn('git', args, { cwd, shell: false });
      let out = '';
      child.stdout?.on('data', (b) => {
        out += b.toString('utf8');
      });
      child.on('close', () => resolve(out.trim()));
      child.on('error', () => resolve(''));
    });
  const stat = await run(['diff', '--stat']);
  const patch = (await run(['diff'])).slice(0, 20_000);
  return { stat, patch };
}

async function pickAi(cfg: IvxConfig, job: AgentJob): Promise<string> {
  const detected = await detectAi();
  const preferred = cfg.preferredAi;
  const providers = job.aiProviders?.length
    ? job.aiProviders
    : cfg.aiProviders;
  const order = preferred
    ? [preferred, ...providers.filter((p) => p !== preferred)]
    : providers;
  for (const p of order) {
    if (p === 'claude' && detected.claude) return 'claude';
    if (p === 'gemini' && detected.gemini) return 'gemini';
  }
  throw new Error(
    'No AI CLI found on PATH (install claude or gemini). Run: ivx ai doctor'
  );
}

function aiArgv(provider: string, prompt: string): string[] {
  // Non-interactive best-effort flags; tools vary by version.
  if (provider === 'claude') {
    return ['claude', '-p', prompt, '--permission-mode', 'acceptEdits'];
  }
  return ['gemini', '-p', prompt, '--yolo'];
}

export async function executeJob(
  cfg: IvxConfig,
  job: AgentJob
): Promise<void> {
  const logBuf: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = async () => {
    if (!logBuf.length) return;
    const chunk = logBuf.splice(0, logBuf.length);
    try {
      await appendLogs(cfg, job.id, chunk);
    } catch (err) {
      console.error('log upload failed', err);
    }
  };

  const log = (line: string) => {
    const safe = redactLogLine(line);
    console.log(safe);
    logBuf.push(safe);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, 400);
    }
  };

  try {
    if (job.type === 'run_command' || job.type === 'deploy') {
      const cmd = (job.command || '').trim();
      const allow = job.allowCommands?.length
        ? job.allowCommands
        : cfg.allowCommands;
      if (!isCommandAllowed(cmd, allow)) {
        throw new Error(`Command not allowlisted: ${cmd}`);
      }
      const cwd = resolveWorkspace(job, cfg);
      const argv = commandToArgv(cmd);
      if (!argv.length) throw new Error('Empty command');
      log(`$ ${cmd}`);
      const { code, stdout } = await runProcess(argv, cwd, log);
      await flush();
      if (code !== 0) {
        const { fail } = await import('./api');
        await fail(cfg, job.id, `Command exited ${code}`);
        return;
      }
      const { complete } = await import('./api');
      await complete(cfg, job.id, {
        summary: stdout.slice(0, 4000) || `Command OK: ${cmd}`,
      });
      return;
    }

    // fix_issue / follow_up
    const cwd = resolveWorkspace(job, cfg);
    if (!fs.existsSync(cwd)) {
      throw new Error(`Workspace missing: ${cwd}`);
    }
    const provider = await pickAi(cfg, job);
    const prompt = buildAiPrompt(job);
    log(`AI provider: ${provider}`);
    log(`cwd: ${cwd}`);
    const argv = aiArgv(provider, prompt);
    const { code, stdout } = await runProcess(argv, cwd, log);
    const { stat, patch } = await gitDiffStat(cwd);
    await flush();
    const { needsReview, fail } = await import('./api');
    if (code !== 0 && !stat) {
      await fail(cfg, job.id, `${provider} exited ${code}`);
      return;
    }
    await needsReview(cfg, job.id, {
      summary: stdout.slice(-6000) || `${provider} finished (exit ${code})`,
      diffStat: stat,
      artifacts: patch
        ? [{ type: 'patch', content: patch, path: path.join(cwd, '.patch') }]
        : [],
    });
  } catch (err) {
    await flush();
    const { fail } = await import('./api');
    await fail(
      cfg,
      job.id,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
  }
}
