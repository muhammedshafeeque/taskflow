import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPathJail,
  commandToArgv,
  isCommandAllowed,
  mergeAllowCommands,
  redactLogLine,
  requireWorkspaceRoots,
} from '../security';
import { hashSecret, generatePairingCode } from '../models/AgentDevice';

describe('agent security', () => {
  it('allowCommands exact match only', () => {
    const allow = ['npm test', './scripts/deploy.sh'];
    assert.equal(isCommandAllowed('npm test', allow), true);
    assert.equal(isCommandAllowed('npm test --watch', allow), false);
    assert.equal(isCommandAllowed('npm  test', allow), false);
    assert.equal(isCommandAllowed('./scripts/deploy.sh', allow), true);
  });

  it('path jail rejects .. and relative', () => {
    assert.throws(() => assertPathJail('../etc/passwd'), /Path jail/);
    assert.throws(() => assertPathJail('rel/path'), /absolute/);
    const abs = '/tmp/workspaces/app';
    assert.equal(assertPathJail(abs), abs);
    assert.throws(
      () => assertPathJail('/tmp/other', ['/tmp/workspaces']),
      /outside/
    );
    assert.equal(
      assertPathJail('/tmp/workspaces/app', ['/tmp/workspaces']),
      '/tmp/workspaces/app'
    );
  });

  it('requires workspace roots in production', () => {
    assert.throws(
      () => requireWorkspaceRoots([], { NODE_ENV: 'production' }),
      /AGENT_WORKSPACE_ROOTS/
    );
    assert.doesNotThrow(() =>
      requireWorkspaceRoots(['/tmp'], { NODE_ENV: 'production' })
    );
    assert.doesNotThrow(() =>
      requireWorkspaceRoots([], { NODE_ENV: 'development' })
    );
  });

  it('mergeAllowCommands cannot widen after bootstrap', () => {
    assert.deepEqual(mergeAllowCommands([], ['npm test', 'rm -rf /']), [
      'npm test',
      'rm -rf /',
    ]);
    assert.deepEqual(
      mergeAllowCommands(['npm test'], ['npm test', 'rm -rf /']),
      ['npm test']
    );
    assert.deepEqual(mergeAllowCommands(['npm test', './deploy.sh'], ['npm test']), [
      'npm test',
    ]);
  });

  it('redacts secrets in logs', () => {
    const line = redactLogLine('export API_KEY=supersecret TOKEN: abc123');
    assert.match(line, /REDACTED/);
    assert.doesNotMatch(line, /supersecret/);
  });

  it('commandToArgv respects quotes', () => {
    assert.deepEqual(commandToArgv('echo "hello world"'), [
      'echo',
      'hello world',
    ]);
  });
});

describe('pairing hash', () => {
  it('hashes pairing codes consistently', () => {
    const code = generatePairingCode();
    assert.equal(code.length, 8);
    assert.equal(hashSecret(code), hashSecret(code));
    assert.notEqual(hashSecret(code), hashSecret(code.toLowerCase()));
  });
});
