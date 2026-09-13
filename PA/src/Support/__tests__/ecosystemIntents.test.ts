import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectEcosystemIntent } from '../intentRouter';

function normalizePhoneDigits(raw: string): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

describe('ecosystem intent detection', () => {
  it('detects issue status by key', () => {
    const d = detectEcosystemIntent('what is the status of APP-12?');
    assert.equal(d.intent, 'issue_status');
    assert.equal(d.issueKey, 'APP-12');
  });

  it('detects ticket status digest', () => {
    assert.equal(detectEcosystemIntent('open tickets please').intent, 'ticket_status');
  });

  it('detects portal request', () => {
    assert.equal(
      detectEcosystemIntent('please raise a request for dark mode').intent,
      'portal_request'
    );
  });

  it('detects billing', () => {
    assert.equal(detectEcosystemIntent('what is our outstanding invoice?').intent, 'billing');
  });

  it('detects hrms leave', () => {
    assert.equal(detectEcosystemIntent('my leave balance').intent, 'hrms');
  });

  it('detects assets and procurement', () => {
    assert.equal(detectEcosystemIntent('where is laptop asset tag').intent, 'assets');
    assert.equal(detectEcosystemIntent('status of purchase order PO-1').intent, 'procurement');
  });

  it('detects FAQ/kb', () => {
    assert.equal(detectEcosystemIntent('how do I reset my password?').intent, 'kb');
  });
});

describe('phone normalize', () => {
  it('strips non-digits', () => {
    assert.equal(normalizePhoneDigits('+91 98765-43210'), '919876543210');
  });
});
