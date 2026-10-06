import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectHandover } from '../handoverDetector';

describe('handover detector', () => {
  it('detects explicit requests for a person', () => {
    assert.equal(detectHandover('Can I talk to a human please'), 'asked_for_human');
    assert.equal(detectHandover('are you a bot?'), 'asked_for_human');
    assert.equal(detectHandover('please call me back'), 'asked_for_human');
    assert.equal(detectHandover('manager ine vilikku'), 'asked_for_human');
    assert.equal(detectHandover('ആളെ വേണം'), 'asked_for_human');
  });

  it('detects frustration', () => {
    assert.equal(detectHandover('this is useless'), 'frustrated');
    assert.equal(detectHandover('I want a refund'), 'frustrated');
    assert.equal(detectHandover('WHY IS THIS NOT FIXED YET!!!'), 'frustrated');
    assert.equal(detectHandover('ningal thattippu aanu'), 'frustrated');
  });

  it('leaves normal messages to the bot', () => {
    assert.equal(detectHandover('Hi, I need a website for my shop'), null);
    assert.equal(detectHandover('What is the price for an app?'), null);
    assert.equal(detectHandover('OK'), null);
    assert.equal(detectHandover('We need an app for human resources'), null);
    assert.equal(detectHandover(''), null);
  });
});
