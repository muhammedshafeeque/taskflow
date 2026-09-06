import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfficialSupportGroup } from '../supportGroup';
import {
  emitSupportEvent,
  getRecentSupportEvents,
} from '../events';
import { mapPriority } from '../context/taskflowContext';
import {
  ChatAnalysisSchema,
  QaDecisionSchema,
  SupportEngineerDecisionSchema,
  extractJsonObject,
} from '../types';
import type { WhatsappGroupDoc } from '../../Models/WhatsappGroup';
import { seedSupportAnalysisForTests } from '../chatAnalyzer';

describe('support group gate', () => {
  it('treats enabled group with projects as official support', () => {
    const group: WhatsappGroupDoc = {
      chatId: '1@g.us',
      autoReplyEnabled: true,
      atriumProjects: [{ id: 'p1', name: 'TEST', key: 'T' }],
    };
    assert.equal(isOfficialSupportGroup(group), true);
  });

  it('is not official without projects', () => {
    const group: WhatsappGroupDoc = {
      chatId: '1@g.us',
      autoReplyEnabled: true,
      atriumProjects: [],
    };
    assert.equal(isOfficialSupportGroup(group), false);
  });
});

describe('chat analyzer seed', () => {
  it('classifies greeting as general conversation', () => {
    const a = seedSupportAnalysisForTests('Hello');
    assert.equal(a.category, 'GENERAL_CONVERSATION');
    assert.equal(a.isIssue, false);
  });

  it('classifies login failure as bug/issue signal', () => {
    const a = seedSupportAnalysisForTests('Login is not working on mobile');
    assert.ok(a.isIssue || a.category === 'BUG_REPORT' || a.category === 'SUPPORT_REQUEST');
  });

  it('classifies feature asks', () => {
    const a = seedSupportAnalysisForTests('Can you add a dark mode feature?');
    assert.equal(a.category, 'FEATURE_REQUEST');
  });

  it('classifies follow-ups', () => {
    const a = seedSupportAnalysisForTests('Still happening again', {
      hasHistory: true,
    });
    assert.ok(a.isFollowUp || a.category === 'FOLLOW_UP');
  });
});

describe('schemas and helpers', () => {
  it('parses support engineer decision', () => {
    const d = SupportEngineerDecisionSchema.parse({
      action: 'REPLY',
      customerReply: 'Hi there',
      state: 'COMPLETED',
    });
    assert.equal(d.action, 'REPLY');
  });

  it('parses QA not-an-issue decision', () => {
    const d = QaDecisionSchema.parse({
      isIssue: false,
      classification: 'NOT_AN_ISSUE',
      reason: 'expected behavior',
      recommendedResponse: 'Explain the workflow',
    });
    assert.equal(d.isIssue, false);
  });

  it('parses QA confirmed bug', () => {
    const d = QaDecisionSchema.parse({
      isIssue: true,
      classification: 'BUG',
      reason: 'crash',
      issue: {
        title: 'App crash',
        type: 'BUG',
        priority: 'HIGH',
        severity: 'HIGH',
        description: 'crashes on login',
      },
    });
    assert.equal(d.issue?.type, 'BUG');
  });

  it('extracts JSON from fenced LLM output', () => {
    const raw = '```json\n{"intent":"help","category":"GENERAL_QUESTION","confidence":0.9}\n```';
    const parsed = extractJsonObject(raw) as { category: string };
    assert.equal(parsed.category, 'GENERAL_QUESTION');
    const analysis = ChatAnalysisSchema.parse({
      ...parsed,
      summary: 'q',
    });
    assert.equal(analysis.category, 'GENERAL_QUESTION');
  });

  it('maps priority', () => {
    assert.equal(mapPriority('HIGH'), 'high');
    assert.equal(mapPriority('URGENT'), 'urgent');
    assert.equal(mapPriority(), 'medium');
  });
});

describe('support events', () => {
  it('emits and buffers ticket created', () => {
    const e = emitSupportEvent({
      type: 'TICKET_CREATED',
      groupId: 'g@g.us',
      groupName: 'Test',
      ticketId: 'abc',
      summary: 'Login bug',
      priority: 'HIGH',
    });
    assert.equal(e.type, 'TICKET_CREATED');
    const recent = getRecentSupportEvents(5);
    assert.ok(recent.some((x) => x.id === e.id));
  });
});
