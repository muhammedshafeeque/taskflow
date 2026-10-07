#!/usr/bin/env node
import path from 'path';
import { Command } from 'commander';
import { heartbeat, nextJob, register } from './api';
import { configPath, loadConfig, saveConfig } from './config';
import { detectAi, executeJob } from './executor';
import { assertPathJail } from './security';

const program = new Command();
program.name('ivx').description('Remote PC agent for the PA server').version('0.1.0');

program
  .command('login')
  .description('Set PA API base URL')
  .argument('<url>', 'PA base URL e.g. https://pa.example.com')
  .action((url: string) => {
    const cfg = loadConfig();
    cfg.apiBase = url.replace(/\/$/, '');
    saveConfig(cfg);
    console.log(`API base set to ${cfg.apiBase}`);
    console.log(`Config: ${configPath()}`);
  });

program
  .command('pair')
  .description('Exchange pairing code for device token')
  .argument('<code>', 'One-time pairing code from Control Center')
  .option('-n, --name <name>', 'Device name')
  .action(async (code: string, opts: { name?: string }) => {
    const data = await register(code, opts.name);
    if (!data) throw new Error('Register failed');
    const cfg = loadConfig();
    cfg.deviceId = data.deviceId;
    cfg.deviceToken = data.deviceToken;
    if (opts.name) cfg.name = opts.name;
    saveConfig(cfg);
    console.log(`Paired as ${data.deviceId}`);
  });

const workspace = program
  .command('workspace')
  .description('Manage project → local path maps');

workspace
  .command('add')
  .requiredOption('--project <key>', 'Project key e.g. APP')
  .requiredOption('--path <abs>', 'Absolute local path')
  .option('--project-id <id>', 'Optional Atrium project id')
  .action((opts: { project: string; path: string; projectId?: string }) => {
    const cfg = loadConfig();
    if (!path.isAbsolute(opts.path)) {
      throw new Error('Workspace path must be absolute');
    }
    const localPath = assertPathJail(opts.path);
    const projectKey = opts.project.trim().toUpperCase();
    cfg.workspaces = [
      ...cfg.workspaces.filter(
        (w) => w.projectKey.toUpperCase() !== projectKey
      ),
      {
        projectKey,
        projectId: opts.projectId,
        localPath,
      },
    ];
    saveConfig(cfg);
    console.log(`Mapped ${projectKey} → ${localPath}`);
  });

workspace.command('list').action(() => {
  const cfg = loadConfig();
  console.log(JSON.stringify(cfg.workspaces, null, 2));
});

const allow = program
  .command('allow-command')
  .description('Manage allowlisted exact commands');

allow
  .command('add')
  .argument('<command...>', 'Exact command string')
  .action((parts: string[]) => {
    const cmd = parts.join(' ').trim();
    const cfg = loadConfig();
    if (!cfg.allowCommands.includes(cmd)) cfg.allowCommands.push(cmd);
    saveConfig(cfg);
    console.log(`Allowlisted: ${cmd}`);
  });

allow.command('list').action(() => {
  console.log(JSON.stringify(loadConfig().allowCommands, null, 2));
});

const ai = program.command('ai').description('AI CLI helpers');

ai.command('doctor').action(async () => {
  const d = await detectAi();
  console.log(`claude: ${d.claude ? 'found' : 'missing'}`);
  console.log(`gemini: ${d.gemini ? 'found' : 'missing'}`);
  console.log(`config: ${configPath()}`);
});

const agent = program.command('agent').description('Agent daemon');

agent
  .command('run')
  .option('--once', 'Process at most one job then exit')
  .action(async (opts: { once?: boolean }) => {
    const cfg = loadConfig();
    if (!cfg.deviceToken) {
      console.error(
        'Not paired. Create a pairing code in Control Center, then: ivx pair <code>'
      );
      process.exit(1);
    }
    console.log(`Agent running against ${cfg.apiBase} as ${cfg.deviceId}`);
    for (;;) {
      try {
        await heartbeat(cfg);
      } catch (err) {
        console.error('heartbeat failed', err);
      }
      try {
        const job = await nextJob(cfg, 25);
        if (!job) {
          if (opts.once) break;
          continue;
        }
        console.log(`Claimed job ${job.id} (${job.type})`);
        await executeJob(loadConfig(), job);
        if (opts.once) break;
      } catch (err) {
        console.error('poll/execute failed', err);
        await new Promise((r) => setTimeout(r, 2000));
        if (opts.once) break;
      }
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
