import { getConversation } from '../../Memory/conversationMemory';
import { SupportMessage } from '../../Models/SupportMessage';

export type ConversationContextBundle = {
  recentLines: string[];
  recentText: string;
  quotedText?: string;
  hasHistory: boolean;
};

export async function collectConversationContext(
  groupId: string,
  opts?: { quotedText?: string }
): Promise<ConversationContextBundle> {
  const [conv, supportMsgs] = await Promise.all([
    getConversation(groupId),
    SupportMessage.find({ groupId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const fromSupport = [...supportMsgs].reverse().map((m) => {
    const who =
      m.messageType === 'assistant'
        ? 'SupportEngineer'
        : m.senderName || m.senderPhone || 'Customer';
    return `${who}: ${String(m.message || '').slice(0, 300)}`;
  });

  const fromConv = (conv?.messages || []).slice(-16).map((m) => {
    const who = m.role === 'assistant' ? 'SupportEngineer' : 'Customer';
    return `${who}: ${m.content.slice(0, 300)}`;
  });

  const recentLines = fromSupport.length >= 4 ? fromSupport : fromConv;
  return {
    recentLines,
    recentText: recentLines.join('\n'),
    quotedText: opts?.quotedText,
    hasHistory: recentLines.length > 0,
  };
}
