import crypto from 'crypto';
import { extractIssueKeys, verifyGithubSignature } from './githubWebhook.service';

describe('github webhook helpers', () => {
  it('finds issue keys for the project only', () => {
    expect(extractIssueKeys('APP-12: fix login (refs app-13, WEB-4)', 'APP')).toEqual(['APP-12', 'APP-13']);
    expect(extractIssueKeys('feature/APP-7-dark-mode', 'APP')).toEqual(['APP-7']);
    expect(extractIssueKeys('no keys here', 'APP')).toEqual([]);
  });

  it('verifies X-Hub-Signature-256', () => {
    const body = Buffer.from('{"zen":"ok"}');
    const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
    expect(verifyGithubSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyGithubSignature(body, sig, 'other')).toBe(false);
    expect(verifyGithubSignature(body, undefined, 's3cret')).toBe(false);
  });
});
