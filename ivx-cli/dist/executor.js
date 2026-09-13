"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAi = detectAi;
exports.executeJob = executeJob;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const api_1 = require("./api");
const security_1 = require("./security");
function which(bin) {
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(process.platform === 'win32' ? 'where' : 'which', [
            bin,
        ]);
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
    });
}
async function detectAi() {
    const [claude, gemini] = await Promise.all([
        which('claude'),
        which('gemini'),
    ]);
    return { claude, gemini };
}
function resolveWorkspace(job, cfg) {
    const maps = job.workspaces?.length ? job.workspaces : cfg.workspaces;
    const key = (job.projectKey || job.issueKey?.split('-')[0] || '')
        .trim()
        .toUpperCase();
    let hit = maps.find((w) => w.projectKey.toUpperCase() === key || w.projectId === job.projectId);
    if (!hit && maps.length === 1)
        hit = maps[0];
    if (!hit) {
        throw new Error(`No workspace mapped for project ${key || job.projectId || '?'}`);
    }
    return (0, security_1.assertPathJail)(hit.localPath);
}
function buildAiPrompt(job) {
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
        if (issue.priority)
            parts.push(`Priority: ${issue.priority}`);
        if (issue.type)
            parts.push(`Type: ${issue.type}`);
        parts.push('');
    }
    else if (job.issueKey) {
        parts.push(`Issue key: ${job.issueKey}`, '');
    }
    if (job.instruction) {
        parts.push('Instructions:', job.instruction, '');
    }
    if (job.type === 'follow_up') {
        parts.push('This is a follow-up. Continue from prior work on this issue.', '');
    }
    parts.push('When done, briefly summarize what you changed.');
    return parts.join('\n');
}
async function runProcess(argv, cwd, onLine) {
    return new Promise((resolve, reject) => {
        const [bin, ...args] = argv;
        const child = (0, child_process_1.spawn)(bin, args, {
            cwd,
            env: process.env,
            shell: false,
        });
        let stdout = '';
        const handle = (buf) => {
            const text = buf.toString('utf8');
            stdout += text;
            for (const line of text.split(/\r?\n/)) {
                if (line)
                    onLine((0, security_1.redactLogLine)(line));
            }
        };
        child.stdout?.on('data', handle);
        child.stderr?.on('data', handle);
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? 1, stdout: stdout.slice(0, 100_000) }));
    });
}
async function gitDiffStat(cwd) {
    const run = (args) => new Promise((resolve) => {
        const child = (0, child_process_1.spawn)('git', args, { cwd, shell: false });
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
async function pickAi(cfg, job) {
    const detected = await detectAi();
    const preferred = cfg.preferredAi;
    const providers = job.aiProviders?.length
        ? job.aiProviders
        : cfg.aiProviders;
    const order = preferred
        ? [preferred, ...providers.filter((p) => p !== preferred)]
        : providers;
    for (const p of order) {
        if (p === 'claude' && detected.claude)
            return 'claude';
        if (p === 'gemini' && detected.gemini)
            return 'gemini';
    }
    throw new Error('No AI CLI found on PATH (install claude or gemini). Run: ivx ai doctor');
}
function aiArgv(provider, prompt) {
    // Non-interactive best-effort flags; tools vary by version.
    if (provider === 'claude') {
        return ['claude', '-p', prompt, '--permission-mode', 'acceptEdits'];
    }
    return ['gemini', '-p', prompt, '--yolo'];
}
async function executeJob(cfg, job) {
    const logBuf = [];
    let flushTimer = null;
    const flush = async () => {
        if (!logBuf.length)
            return;
        const chunk = logBuf.splice(0, logBuf.length);
        try {
            await (0, api_1.appendLogs)(cfg, job.id, chunk);
        }
        catch (err) {
            console.error('log upload failed', err);
        }
    };
    const log = (line) => {
        const safe = (0, security_1.redactLogLine)(line);
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
            if (!(0, security_1.isCommandAllowed)(cmd, allow)) {
                throw new Error(`Command not allowlisted: ${cmd}`);
            }
            const cwd = resolveWorkspace(job, cfg);
            const argv = (0, security_1.commandToArgv)(cmd);
            if (!argv.length)
                throw new Error('Empty command');
            log(`$ ${cmd}`);
            const { code, stdout } = await runProcess(argv, cwd, log);
            await flush();
            if (code !== 0) {
                const { fail } = await Promise.resolve().then(() => __importStar(require('./api')));
                await fail(cfg, job.id, `Command exited ${code}`);
                return;
            }
            const { complete } = await Promise.resolve().then(() => __importStar(require('./api')));
            await complete(cfg, job.id, {
                summary: stdout.slice(0, 4000) || `Command OK: ${cmd}`,
            });
            return;
        }
        // fix_issue / follow_up
        const cwd = resolveWorkspace(job, cfg);
        if (!fs_1.default.existsSync(cwd)) {
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
        const { needsReview, fail } = await Promise.resolve().then(() => __importStar(require('./api')));
        if (code !== 0 && !stat) {
            await fail(cfg, job.id, `${provider} exited ${code}`);
            return;
        }
        await needsReview(cfg, job.id, {
            summary: stdout.slice(-6000) || `${provider} finished (exit ${code})`,
            diffStat: stat,
            artifacts: patch
                ? [{ type: 'patch', content: patch, path: path_1.default.join(cwd, '.patch') }]
                : [],
        });
    }
    catch (err) {
        await flush();
        const { fail } = await Promise.resolve().then(() => __importStar(require('./api')));
        await fail(cfg, job.id, err instanceof Error ? err.message : String(err));
    }
    finally {
        if (flushTimer)
            clearTimeout(flushTimer);
        await flush();
    }
}
