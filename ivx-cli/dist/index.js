#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const commander_1 = require("commander");
const api_1 = require("./api");
const config_1 = require("./config");
const executor_1 = require("./executor");
const security_1 = require("./security");
const program = new commander_1.Command();
program.name('ivx').description('Ivorix remote PC agent').version('0.1.0');
program
    .command('login')
    .description('Set PA API base URL')
    .argument('<url>', 'PA base URL e.g. https://pa.repod.online')
    .action((url) => {
    const cfg = (0, config_1.loadConfig)();
    cfg.apiBase = url.replace(/\/$/, '');
    (0, config_1.saveConfig)(cfg);
    console.log(`API base set to ${cfg.apiBase}`);
    console.log(`Config: ${(0, config_1.configPath)()}`);
});
program
    .command('pair')
    .description('Exchange pairing code for device token')
    .argument('<code>', 'One-time pairing code from Control Center')
    .option('-n, --name <name>', 'Device name')
    .action(async (code, opts) => {
    const data = await (0, api_1.register)(code, opts.name);
    if (!data)
        throw new Error('Register failed');
    const cfg = (0, config_1.loadConfig)();
    cfg.deviceId = data.deviceId;
    cfg.deviceToken = data.deviceToken;
    if (opts.name)
        cfg.name = opts.name;
    (0, config_1.saveConfig)(cfg);
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
    .action((opts) => {
    const cfg = (0, config_1.loadConfig)();
    if (!path_1.default.isAbsolute(opts.path)) {
        throw new Error('Workspace path must be absolute');
    }
    const localPath = (0, security_1.assertPathJail)(opts.path);
    const projectKey = opts.project.trim().toUpperCase();
    cfg.workspaces = [
        ...cfg.workspaces.filter((w) => w.projectKey.toUpperCase() !== projectKey),
        {
            projectKey,
            projectId: opts.projectId,
            localPath,
        },
    ];
    (0, config_1.saveConfig)(cfg);
    console.log(`Mapped ${projectKey} → ${localPath}`);
});
workspace.command('list').action(() => {
    const cfg = (0, config_1.loadConfig)();
    console.log(JSON.stringify(cfg.workspaces, null, 2));
});
const allow = program
    .command('allow-command')
    .description('Manage allowlisted exact commands');
allow
    .command('add')
    .argument('<command...>', 'Exact command string')
    .action((parts) => {
    const cmd = parts.join(' ').trim();
    const cfg = (0, config_1.loadConfig)();
    if (!cfg.allowCommands.includes(cmd))
        cfg.allowCommands.push(cmd);
    (0, config_1.saveConfig)(cfg);
    console.log(`Allowlisted: ${cmd}`);
});
allow.command('list').action(() => {
    console.log(JSON.stringify((0, config_1.loadConfig)().allowCommands, null, 2));
});
const ai = program.command('ai').description('AI CLI helpers');
ai.command('doctor').action(async () => {
    const d = await (0, executor_1.detectAi)();
    console.log(`claude: ${d.claude ? 'found' : 'missing'}`);
    console.log(`gemini: ${d.gemini ? 'found' : 'missing'}`);
    console.log(`config: ${(0, config_1.configPath)()}`);
});
const agent = program.command('agent').description('Agent daemon');
agent
    .command('run')
    .option('--once', 'Process at most one job then exit')
    .action(async (opts) => {
    const cfg = (0, config_1.loadConfig)();
    if (!cfg.deviceToken) {
        console.error('Not paired. Create a pairing code in Control Center, then: ivx pair <code>');
        process.exit(1);
    }
    console.log(`Agent running against ${cfg.apiBase} as ${cfg.deviceId}`);
    for (;;) {
        try {
            await (0, api_1.heartbeat)(cfg);
        }
        catch (err) {
            console.error('heartbeat failed', err);
        }
        try {
            const job = await (0, api_1.nextJob)(cfg, 25);
            if (!job) {
                if (opts.once)
                    break;
                continue;
            }
            console.log(`Claimed job ${job.id} (${job.type})`);
            await (0, executor_1.executeJob)((0, config_1.loadConfig)(), job);
            if (opts.once)
                break;
        }
        catch (err) {
            console.error('poll/execute failed', err);
            await new Promise((r) => setTimeout(r, 2000));
            if (opts.once)
                break;
        }
    }
});
program.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
