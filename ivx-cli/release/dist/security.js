"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactLogLine = redactLogLine;
exports.isCommandAllowed = isCommandAllowed;
exports.assertPathJail = assertPathJail;
exports.commandToArgv = commandToArgv;
const path_1 = __importDefault(require("path"));
const SECRET_RE = /(SECRET|TOKEN|API[_-]?KEY|PASSWORD|BEARER)/i;
function redactLogLine(line) {
    if (!SECRET_RE.test(line))
        return line.slice(0, 4000);
    return line
        .replace(/(SECRET|TOKEN|API[_-]?KEY|PASSWORD|BEARER)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
        .slice(0, 4000);
}
function isCommandAllowed(command, allowCommands) {
    const c = command.trim();
    return allowCommands.some((a) => a.trim() === c);
}
function assertPathJail(localPath, roots = []) {
    if (!path_1.default.isAbsolute(localPath)) {
        throw new Error('Path jail: workspace path must be absolute');
    }
    if (localPath.split(/[/\\]/).includes('..') || localPath.includes('..')) {
        throw new Error('Path jail: .. not allowed');
    }
    const resolved = path_1.default.resolve(localPath);
    if (roots.length) {
        const ok = roots.some((root) => {
            const r = path_1.default.resolve(root);
            return resolved === r || resolved.startsWith(r + path_1.default.sep);
        });
        if (!ok)
            throw new Error('Path jail: workspace outside allowed roots');
    }
    return resolved;
}
function commandToArgv(command) {
    const parts = [];
    let cur = '';
    let quote = null;
    for (const ch of command.trim()) {
        if (quote) {
            if (ch === quote)
                quote = null;
            else
                cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (cur) {
                parts.push(cur);
                cur = '';
            }
            continue;
        }
        cur += ch;
    }
    if (cur)
        parts.push(cur);
    return parts;
}
