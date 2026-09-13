"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.heartbeat = heartbeat;
exports.nextJob = nextJob;
exports.appendLogs = appendLogs;
exports.needsReview = needsReview;
exports.complete = complete;
exports.fail = fail;
exports.setApiBase = setApiBase;
const undici_1 = require("undici");
const config_1 = require("./config");
async function api(cfg, method, path, body, auth = true) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (auth) {
        if (!cfg.deviceToken)
            throw new Error('Not paired — run: ivx pair <code>');
        headers.Authorization = `Bearer ${cfg.deviceToken}`;
    }
    const res = await (0, undici_1.request)(`${cfg.apiBase}${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
    });
    if (res.statusCode === 204)
        return null;
    const json = (await res.body.json());
    if (res.statusCode >= 400 || json.success === false) {
        throw new Error(json.error || `HTTP ${res.statusCode}`);
    }
    return json.data;
}
async function register(pairingCode, name) {
    const cfg = (0, config_1.loadConfig)();
    return api(cfg, 'POST', '/api/agent/device/register', { pairingCode, name }, false);
}
async function heartbeat(cfg) {
    return api(cfg, 'POST', '/api/agent/device/heartbeat', {
        name: cfg.name,
        workspaces: cfg.workspaces,
        allowCommands: cfg.allowCommands,
        aiProviders: cfg.aiProviders,
    });
}
async function nextJob(cfg, waitSec = 25) {
    return api(cfg, 'GET', `/api/agent/device/jobs/next?wait=${waitSec}`);
}
async function appendLogs(cfg, jobId, lines) {
    return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/logs`, { lines });
}
async function needsReview(cfg, jobId, body) {
    return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/needs-review`, body);
}
async function complete(cfg, jobId, body) {
    return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/complete`, body);
}
async function fail(cfg, jobId, error) {
    return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/fail`, { error });
}
function setApiBase(url) {
    const cfg = (0, config_1.loadConfig)();
    cfg.apiBase = url.replace(/\/$/, '');
    return cfg;
}
