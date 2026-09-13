import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfficialSupportGroup } from '../supportGroup';
import {
  emitSupportEvent,
  getRecentSupportEvents,
} from '../events';
import { mapPriority } from '../context/taskflowContext';
import { rankTicketsByRelevance } from '../context/ticketRetriever';
import {
  ChatAnalysisSchema,
  QaDecisionSchema,
  SupportEngineerDecisionSchema,
  extractJsonObject,
} from '../types';
import type { WhatsappGroupDoc } from '../../Models/WhatsappGroup';
import {
  seedSupportAnalysisForTests,
  shouldTrustSeedWithoutLlm,
} from '../chatAnalyzer';
import { softenEscalationOverride } from '../agents/supportEngineer';
import { criticLocalChecksForTests } from '../agents/replyCritic';
import {
  pendingQueueSizeForTests,
  resetBusyQueueForTests,
} from '../../Whatsap/handler';
import { fastChatModel, strongChatModel } from '../../Ai/models';

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

describe('triage skip LLM', () => {
  it('trusts high-conf greeting / status seed without LLM', () => {
    const greeting = seedSupportAnalysisForTests('Hello');
    assert.ok(greeting.confidence >= 0.85);
    assert.equal(shouldTrustSeedWithoutLlm(greeting), true);

    const status = seedSupportAnalysisForTests('Any status update on the ticket?');
    assert.equal(status.category, 'STATUS_REQUEST');
    assert.ok(shouldTrustSeedWithoutLlm(status));
  });

  it('does not skip LLM for bug reports', () => {
    const bug = seedSupportAnalysisForTests('Login is not working on mobile');
    assert.equal(shouldTrustSeedWithoutLlm(bug), false);
  });
});

describe('ticket retriever', () => {
  it('ranks matching tickets first', () => {
    const ranked = rankTicketsByRelevance(
      [
        {
          id: '1',
          key: 'APP-1',
          subject: 'Billing invoice PDF',
          description: 'invoice export',
        },
        {
          id: '2',
          key: 'APP-2',
          subject: 'Login crash on Android',
          description: 'crash after otp',
        },
        {
          id: '3',
          key: 'APP-3',
          subject: 'Dark mode request',
        },
      ],
      'Android login crash after OTP',
      ['login', 'android'],
      3
    );
    assert.equal(ranked[0]?.key, 'APP-2');
  });
});

describe('reply critic local checks', () => {
  it('rejects hallucinated ticket keys', () => {
    const r = criticLocalChecksForTests(
      'We opened ticket FAKE-999 for you.',
      ['REAL-1', 'APP-2']
    );
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.includes('FAKE-999')));
  });

  it('accepts known ticket keys', () => {
    const r = criticLocalChecksForTests(
      'Tracked under ticket APP-2.',
      ['APP-2']
    );
    assert.equal(r.ok, true);
  });
});

describe('soft escalation', () => {
  it('keeps SE REPLY when no strong repro signal', () => {
    const analysis = seedSupportAnalysisForTests('Can you add dark mode?');
    const out = softenEscalationOverride(
      {
        action: 'REPLY',
        customerReply: 'We can review that enhancement request.',
        state: 'COMPLETED',
      },
      { message: 'Can you add dark mode please?', analysis }
    );
    assert.equal(out.action, 'REPLY');
  });

  it('escalates empty reply when issue hinted', () => {
    const analysis = seedSupportAnalysisForTests('App crash on launch');
    const out = softenEscalationOverride(
      {
        action: 'REPLY',
        customerReply: '',
        state: 'COMPLETED',
      },
      { message: 'App crash on launch with stack trace', analysis }
    );
    assert.equal(out.action, 'ESCALATE_QA');
  });
});

describe('busy coalesce helpers', () => {
  it('starts empty', () => {
    resetBusyQueueForTests();
    assert.equal(pendingQueueSizeForTests(), 0);
  });
});

describe('model tiers', () => {
  it('resolves fast and strong defaults', () => {
    const prevFast = process.env.GROQ_FAST_MODEL;
    const prevStrong = process.env.GROQ_CHAT_MODEL;
    delete process.env.GROQ_FAST_MODEL;
    delete process.env.SUPPORT_FAST_MODEL;
    delete process.env.GROQ_CHAT_MODEL;
    delete process.env.SUPPORT_CHAT_MODEL;
    delete process.env.SUPPORT_STRONG_MODEL;
    delete process.env.GROQ_MODEL;
    assert.equal(fastChatModel(), 'llama-3.1-8b-instant');
    assert.equal(strongChatModel(), 'qwen/qwen3.8-27b');
    if (prevFast !== undefined) process.env.GROQ_FAST_MODEL = prevFast;
    if (prevStrong !== undefined) process.env.GROQ_CHAT_MODEL = prevStrong;
  });
});
