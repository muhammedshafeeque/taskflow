import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPathJail,
  isCommandAllowed,
  redactLogLine,
} from './security';

describe('ivx-cli security', () => {
  it('exact allowCommand match', () => {
    assert.equal(isCommandAllowed('npm test', ['npm test']), true);
    assert.equal(isCommandAllowed('npm test -a', ['npm test']), false);
  });

  it('path jail', () => {
    assert.throws(() => assertPathJail('relative/path'), /absolute/);
    assert.throws(() => assertPathJail('/tmp/foo/../bar'), /Path jail/);
  });

  it('redact', () => {
    assert.match(redactLogLine('SECRET=xyz'), /REDACTED/);
  });
});
