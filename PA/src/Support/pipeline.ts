import type { Message } from 'whatsapp-web.js';
import type { AgentCallLog } from '../Ai/models';
import {
  craftFinalCustomerReply,
  runSupportEngineer,
} from './agents/supportEngineer';
import { runQaLead } from './agents/qaLead';
import { runReplyCritic } from './agents/replyCritic';
import { analyzeSupportMessage, isSpamAnalysis } from './chatAnalyzer';
import { collectConversationContext } from './context/conversationContext';
import {
  createServiceTicket,
  fetchProjectSupportContext,
  linkTicketComment,
  mapPriority,
} from './context/taskflowContext';
import {
  knownTicketKeys,
  withRankedTickets,
} from './context/ticketRetriever';
import { emitSupportEvent } from './events';
import { appendTurn } from '../Memory/conversationMemory';
import { AgentActivity } from '../Models/AgentActivity';
import {
  SupportConversation,
  type SupportConversationDoc,
} from '../Models/SupportConversation';
import { SupportMessage } from '../Models/SupportMessage';
import {
  normalizeGroupProjects,
  type WhatsappGroupDoc,
} from '../Models/WhatsappGroup';
import type { ReplyLang } from '../Media/lang';
import type { MediaSource } from '../Media/resolveMessageContent';
import { sendReply } from '../Whatsap/sendReply';
import { isOfficialSupportGroup } from './supportGroup';
import { lookupKbForSupport, tryEcosystemReply } from './intentRouter';
import { readDocsForQuestion } from './context/paInternalClient';
import { pushToDevices } from '../Push/expoPush';

export { isOfficialSupportGroup } from './supportGroup';

async function ensureConversation(
  groupId: string,
  groupName: string,
  projectIds: string[]
): Promise<SupportConversationDoc> {
  const existing = await SupportConversation.findOne({
    groupId,
    status: { $in: ['open', 'waiting_qa', 'ticketed'] },
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (existing) {
    await SupportConversation.updateOne(
      { _id: existing._id },
      {
        $set: {
          groupName,
          projectIds,
          updatedAt: new Date(),
        },
      }
    );
    return existing as SupportConversationDoc;
  }
  const created = await SupportConversation.create({
    groupId,
    groupName,
    projectIds,
    status: 'open',
    ticketIds: [],
  });
  return created.toObject() as SupportConversationDoc;
}

/**
 * Full support pipeline for official project support groups.
 */
export async function runSupportPipeline(input: {
  msg: Message;
  group: WhatsappGroupDoc;
  text: string;
  lang: ReplyLang;
  source: MediaSource;
  sender: { phone?: string; contactName?: string };
}): Promise<void> {
  const { msg, group, text, lang, source, sender } = input;
  const groupId = msg.from;
  const projects = normalizeGroupProjects(group);
  const projectIds = projects.map((p) => p.id);
  const groupName = group.name || groupId;
  const agentCalls: AgentCallLog[] = [];

  const whatsappMessageId = msg.id?._serialized || String(msg.id || '');

  // Independent lookups run together: quote, support thread, ecosystem intents.
  const [quoted, conversation, eco] = await Promise.all([
    msg.hasQuotedMsg
      ? msg.getQuotedMessage().catch(() => null)
      : Promise.resolve(null),
    ensureConversation(groupId, groupName, projectIds),
    // Capability-gated intents (ticket status, billing, KB FAQ, etc.)
    tryEcosystemReply({
      text,
      group,
      lang,
      senderPhone: sender.phone,
    }),
  ]);
  const quotedText = quoted
    ? String(quoted.body || '').slice(0, 500)
    : undefined;
  const replyToMessageId = quoted?.id?._serialized;

  if (eco.handled && eco.reply) {
    await sendReply(msg, eco.reply, source, lang);
    await appendTurn(groupId, text, eco.reply, {
      lastType: 'support',
      lastLang: lang,
    });
    emitSupportEvent({
      type: 'SUPPORT_REPLY_SENT',
      groupId,
      groupName,
      projectId: projectIds[0],
      projectName: projects[0]?.name,
      summary: eco.reply.slice(0, 120),
      agent: 'SUPPORT_ENGINEER',
      payload: { ecosystemIntent: eco.intent },
    });
    return;
  }

  const [userMsg, convCtx, taskflowRaw] = await Promise.all([
    SupportMessage.create({
      conversationId: conversation._id,
      groupId,
      whatsappMessageId,
      senderId: msg.author || msg.from,
      senderName: sender.contactName,
      senderPhone: sender.phone,
      message: text,
      messageType: 'user',
      replyToMessageId,
    }),
    // Current message is passed separately — keep it out of history.
    collectConversationContext(groupId, {
      quotedText,
      excludeMessageId: whatsappMessageId,
    }),
    fetchProjectSupportContext(projectIds),
  ]);

  const [analysisActivity, analysis] = await Promise.all([
    AgentActivity.create({
      agentType: 'CHAT_ANALYZER',
      conversationId: conversation._id,
      messageId: userMsg._id,
      groupId,
      projectId: projectIds[0],
      action: 'analyze',
      status: 'ANALYZING',
      input: { text: text.slice(0, 500) },
    }),
    analyzeSupportMessage(text, {
      isReply: Boolean(quotedText),
      hasHistory: convCtx.hasHistory,
      recentContext: convCtx.recentText,
      projectLabels: projects.map((p) => p.name),
      agentCalls,
    }),
  ]);

  // Rank tickets once we have entities/summary from analysis
  const taskflow = withRankedTickets(
    taskflowRaw,
    `${text} ${analysis.summary} ${analysis.possibleIssue}`,
    analysis.entities,
    10
  );
  const ticketKeys = knownTicketKeys(taskflow.tickets);

  await Promise.all([
    AgentActivity.updateOne(
      { _id: analysisActivity._id },
      {
        $set: {
          status: 'COMPLETED',
          output: { analysis, agentCalls: agentCalls.slice() },
        },
      }
    ),
    SupportMessage.updateOne({ _id: userMsg._id }, { $set: { analysis } }),
  ]);

  if (isSpamAnalysis(analysis)) {
    console.log('Support pipeline skip spam', { groupId, agentCalls });
    return;
  }

  // Project docs the agents read before answering (full page text, best-effort).
  const projectDocs =
    analysis.category === 'GENERAL_CONVERSATION'
      ? []
      : await readDocsForQuestion(groupId, text, sender.phone);

  // KB before tickets for questions / support (not clear bugs) — when no project doc covers it
  if (
    group.kbEnabled &&
    !projectDocs.length &&
    !analysis.isIssue &&
    (analysis.category === 'GENERAL_QUESTION' ||
      analysis.category === 'SUPPORT_REQUEST' ||
      analysis.category === 'GENERAL_CONVERSATION')
  ) {
    const kb = await lookupKbForSupport(text, true, {
      chatId: groupId,
      senderPhone: sender.phone,
    });
    if (kb.hit && kb.reply) {
      await sendReply(msg, kb.reply, source, lang);
      await Promise.all([
        appendTurn(groupId, text, kb.reply, {
          lastType: 'support',
          lastLang: lang,
        }),
        SupportMessage.create({
          conversationId: conversation._id,
          groupId,
          message: kb.reply,
          messageType: 'assistant',
          agentOutputs: { kbTitle: kb.title },
        }),
      ]);
      emitSupportEvent({
        type: 'SUPPORT_REPLY_SENT',
        groupId,
        groupName,
        projectId: projectIds[0],
        projectName: projects[0]?.name,
        summary: kb.reply.slice(0, 120),
        agent: 'SUPPORT_ENGINEER',
        payload: { kbTitle: kb.title, agentCalls },
      });
      return;
    }
  }

  const [seActivity, seDecision] = await Promise.all([
    AgentActivity.create({
      agentType: 'SUPPORT_ENGINEER',
      conversationId: conversation._id,
      messageId: userMsg._id,
      groupId,
      projectId: projectIds[0],
      action: 'decide',
      status: 'ANALYZING',
      input: { analysis },
    }),
    runSupportEngineer({
      message: text,
      analysis,
      projects,
      conversation: convCtx,
      taskflow,
      projectDocs,
      langHint: lang,
      agentCalls,
    }),
  ]);

  let customerReply = seDecision.customerReply.trim();
  let ticketId: string | undefined;
  let qaStatus: string | undefined;
  let escalated = false;

  if (seDecision.action === 'ESCALATE_QA') {
    escalated = true;
    void pushToDevices('escalation', {
      title: `🚨 Support escalated · ${groupName || 'WhatsApp group'}`,
      body: (seDecision.escalateReason || analysis.summary || text).slice(0, 180),
      data: { groupId, screen: 'support' },
    });
    emitSupportEvent({
      type: 'NEW_ISSUE_DETECTED',
      groupId,
      groupName,
      projectId: projectIds[0],
      projectName: projects[0]?.name,
      summary: analysis.possibleIssue || analysis.summary || text.slice(0, 120),
      agent: 'SUPPORT_ENGINEER',
      payload: { agentCalls: agentCalls.slice() },
    });
    emitSupportEvent({
      type: 'ISSUE_SENT_TO_QA',
      groupId,
      groupName,
      projectId: projectIds[0],
      projectName: projects[0]?.name,
      summary: seDecision.escalateReason || analysis.summary,
      agent: 'SUPPORT_ENGINEER',
    });

    await Promise.all([
      AgentActivity.updateOne(
        { _id: seActivity._id },
        {
          $set: {
            status: 'ESCALATED_TO_QA',
            output: { ...seDecision, agentCalls: agentCalls.slice() },
          },
        }
      ),
      SupportConversation.updateOne(
        { _id: conversation._id },
        { $set: { status: 'waiting_qa', updatedAt: new Date() } }
      ),
    ]);

    emitSupportEvent({
      type: 'QA_VERIFICATION_STARTED',
      groupId,
      groupName,
      projectId: projectIds[0],
      projectName: projects[0]?.name,
      agent: 'QA_LEAD',
    });

    const [qaActivity, qa] = await Promise.all([
      AgentActivity.create({
        agentType: 'QA_LEAD',
        conversationId: conversation._id,
        messageId: userMsg._id,
        groupId,
        projectId: projectIds[0],
        action: 'investigate',
        status: 'INVESTIGATING',
        input: { escalateReason: seDecision.escalateReason },
      }),
      runQaLead({
        message: text,
        analysis,
        escalateReason: seDecision.escalateReason,
        projects,
        conversation: convCtx,
        taskflow,
        projectDocs,
        agentCalls,
      }),
    ]);

    qaStatus = qa.classification;
    emitSupportEvent({
      type: 'QA_VERIFICATION_COMPLETED',
      groupId,
      groupName,
      projectId: projectIds[0],
      projectName: projects[0]?.name,
      qaStatus: qa.classification,
      summary: qa.reason,
      agent: 'QA_LEAD',
      priority: qa.issue?.priority,
      payload: { agentCalls: agentCalls.slice() },
    });

    if (qa.isDuplicate && qa.duplicateTicketId) {
      const linked = await linkTicketComment({
        ticketId: qa.duplicateTicketId,
        body: `WhatsApp follow-up from ${groupName}:\n${text}`,
        whatsappMessageId,
        whatsappGroupId: groupId,
      });
      const displayKey =
        linked.key ||
        taskflow.tickets.find(
          (t) =>
            t.id === qa.duplicateTicketId ||
            t.key === qa.duplicateTicketId ||
            t.issueKey === qa.duplicateTicketId
        )?.key ||
        qa.duplicateTicketId;
      ticketId = linked.id || qa.duplicateTicketId;
      if (displayKey && !ticketKeys.includes(displayKey)) {
        ticketKeys.push(displayKey);
      }
      customerReply = await craftFinalCustomerReply({
        message: text,
        analysis,
        projects,
        conversation: convCtx,
        ticketId,
        issueKey: displayKey,
        duplicate: true,
        langHint: lang,
        agentCalls,
      });
      await AgentActivity.updateOne(
        { _id: qaActivity._id },
        { $set: { status: 'DUPLICATE', output: { ...qa, displayKey } } }
      );
      emitSupportEvent({
        type: 'DUPLICATE_ISSUE_FOUND',
        groupId,
        groupName,
        projectId: projectIds[0],
        projectName: projects[0]?.name,
        ticketId: displayKey,
        summary: qa.reason,
        agent: 'QA_LEAD',
      });
      emitSupportEvent({
        type: 'TICKET_UPDATED',
        groupId,
        groupName,
        ticketId: displayKey,
        projectId: projectIds[0],
        projectName: projects[0]?.name,
        summary: 'Linked WhatsApp message to existing ticket',
      });
    } else if (qa.isIssue && qa.issue) {
      const projectId = qa.issue.projectId || projectIds[0];
      const created = await createServiceTicket({
        projectId,
        subject: qa.issue.title,
        description: [
          qa.issue.description || text,
          '',
          '---',
          `Expected: ${qa.issue.expectedBehavior || 'n/a'}`,
          `Actual: ${qa.issue.actualBehavior || 'n/a'}`,
          `Steps: ${(qa.issue.stepsToReproduce || []).join(' | ') || 'n/a'}`,
          `WhatsApp group: ${groupName} (${groupId})`,
          `Sender: ${sender.contactName || ''} ${sender.phone || ''}`,
        ].join('\n'),
        priority: mapPriority(qa.issue.priority),
        whatsappGroupId: groupId,
        whatsappMessageId,
        supportConversationId: String(conversation._id),
        aiAnalysis: analysis,
        qaAnalysis: qa,
        workClassification:
          qa.issue.type === 'BUG' ? 'fix' : 'billable_change',
      });

      if (created) {
        ticketId = created.id;
        if (created.linkedIssueKey && !ticketKeys.includes(created.linkedIssueKey)) {
          ticketKeys.push(created.linkedIssueKey);
        }
        customerReply = await craftFinalCustomerReply({
          message: text,
          analysis,
          projects,
          conversation: convCtx,
          ticketId: created.id,
          issueKey: created.linkedIssueKey,
          langHint: lang,
          agentCalls,
        });
        await SupportConversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              status: 'ticketed',
              lastQaStatus: qa.classification,
              lastPriority: qa.issue.priority,
              updatedAt: new Date(),
            },
            $addToSet: { ticketIds: created.id },
          }
        );
        await AgentActivity.updateOne(
          { _id: qaActivity._id },
          {
            $set: {
              status: 'TICKET_CREATED',
              output: {
                qa,
                ticketId,
                linkedIssueId: created.linkedIssueId,
                linkedIssueKey: created.linkedIssueKey,
              },
            },
          }
        );
        emitSupportEvent({
          type: 'TICKET_CREATED',
          groupId,
          groupName,
          projectId,
          projectName: projects.find((p) => p.id === projectId)?.name,
          ticketId: created.linkedIssueKey || created.id,
          priority: qa.issue.priority,
          summary: created.subject,
          qaStatus: qa.classification,
          agent: 'QA_LEAD',
          payload: {
            serviceTicketId: created.id,
            linkedIssueId: created.linkedIssueId,
            linkedIssueKey: created.linkedIssueKey,
            agentCalls: agentCalls.slice(),
          },
        });
      } else {
        customerReply =
          customerReply ||
          (await craftFinalCustomerReply({
            message: text,
            analysis,
            projects,
            conversation: convCtx,
            qaRecommendedResponse:
              'We logged your report internally and will follow up shortly.',
            langHint: lang,
            agentCalls,
          }));
        await AgentActivity.updateOne(
          { _id: qaActivity._id },
          { $set: { status: 'CONFIRMED_ISSUE', output: qa } }
        );
      }
    } else {
      customerReply = await craftFinalCustomerReply({
        message: text,
        analysis,
        projects,
        conversation: convCtx,
        qaRecommendedResponse: qa.recommendedResponse,
        langHint: lang,
        agentCalls,
      });
      await AgentActivity.updateOne(
        { _id: qaActivity._id },
        { $set: { status: 'NOT_AN_ISSUE', output: qa } }
      );
      await SupportConversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            status: 'open',
            lastQaStatus: qa.classification,
            updatedAt: new Date(),
          },
        }
      );
    }
  } else {
    await AgentActivity.updateOne(
      { _id: seActivity._id },
      {
        $set: {
          status: 'COMPLETED',
          output: { ...seDecision, agentCalls: agentCalls.slice() },
        },
      }
    );
  }

  if (!customerReply.trim()) {
    customerReply =
      lang === 'ml'
        ? 'നന്ദി. ഞങ്ങൾ നോക്കുകയാണ് — കൂടുതൽ വിവരം ഉണ്ടെങ്കിൽ പങ്കിടൂ.'
        : 'Thanks — we are looking into this. Please share any extra detail if you have it.';
  }

  const [criticActivity, critic] = await Promise.all([
    AgentActivity.create({
      agentType: 'REPLY_CRITIC',
      conversationId: conversation._id,
      messageId: userMsg._id,
      groupId,
      projectId: projectIds[0],
      action: 'critique',
      status: 'ANALYZING',
      input: { replyPreview: customerReply.slice(0, 200) },
    }),
    runReplyCritic({
      reply: customerReply,
      message: text,
      knownTicketKeys: ticketKeys,
      escalated,
      analysisConfidence: analysis.confidence,
      langHint: lang,
      agentCalls,
    }),
  ]);
  customerReply = critic.reply;

  // Customer first — bookkeeping writes happen after the reply is out.
  await sendReply(msg, customerReply, source, lang);
  await Promise.all([
    AgentActivity.updateOne(
      { _id: criticActivity._id },
      {
        $set: {
          status: 'COMPLETED',
          output: {
            ok: critic.ok,
            issues: critic.issues,
            skipped: critic.skipped,
            agentCalls: agentCalls.slice(),
          },
        },
      }
    ),
    appendTurn(groupId, text, customerReply, {
      lastType: 'support',
      lastLang: lang,
    }),
    SupportMessage.create({
      conversationId: conversation._id,
      groupId,
      message: customerReply,
      messageType: 'assistant',
      ticketId,
      agentOutputs: { seDecision, qaStatus, agentCalls },
    }),
  ]);

  emitSupportEvent({
    type: 'SUPPORT_REPLY_SENT',
    groupId,
    groupName,
    projectId: projectIds[0],
    projectName: projects[0]?.name,
    ticketId,
    summary: customerReply.slice(0, 120),
    agent: 'SUPPORT_ENGINEER',
    qaStatus,
    payload: {
      agentCalls,
      modelTiers: agentCalls.map((c) => c.tier),
    },
  });
}
