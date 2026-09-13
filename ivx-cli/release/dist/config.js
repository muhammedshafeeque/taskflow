"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPath = configPath;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const DIR = path_1.default.join(os_1.default.homedir(), '.ivx');
const FILE = path_1.default.join(DIR, 'config.json');
function configPath() {
    return FILE;
}
function loadConfig() {
    if (!fs_1.default.existsSync(FILE)) {
        return {
            apiBase: 'https://pa.repod.online',
            workspaces: [],
            allowCommands: [],
            aiProviders: ['claude', 'gemini'],
        };
    }
    const raw = JSON.parse(fs_1.default.readFileSync(FILE, 'utf8'));
    return {
        apiBase: (raw.apiBase || 'https://pa.repod.online').replace(/\/$/, ''),
        deviceId: raw.deviceId,
        deviceToken: raw.deviceToken,
        name: raw.name,
        workspaces: raw.workspaces || [],
        allowCommands: raw.allowCommands || [],
        aiProviders: raw.aiProviders || ['claude', 'gemini'],
        preferredAi: raw.preferredAi,
    };
}
function saveConfig(cfg) {
    fs_1.default.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs_1.default.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
