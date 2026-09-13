"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const security_1 = require("./security");
(0, node_test_1.describe)('ivx-cli security', () => {
    (0, node_test_1.it)('exact allowCommand match', () => {
        strict_1.default.equal((0, security_1.isCommandAllowed)('npm test', ['npm test']), true);
        strict_1.default.equal((0, security_1.isCommandAllowed)('npm test -a', ['npm test']), false);
    });
    (0, node_test_1.it)('path jail', () => {
        strict_1.default.throws(() => (0, security_1.assertPathJail)('relative/path'), /absolute/);
        strict_1.default.throws(() => (0, security_1.assertPathJail)('/tmp/foo/../bar'), /Path jail/);
    });
    (0, node_test_1.it)('redact', () => {
        strict_1.default.match((0, security_1.redactLogLine)('SECRET=xyz'), /REDACTED/);
    });
});
