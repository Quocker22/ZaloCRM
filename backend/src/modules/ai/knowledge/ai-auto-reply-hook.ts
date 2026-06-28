// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildRagSystemPrompt, parseRagReply, decideAction } from './rag-reply.js';

export interface HookDeps {
  search(orgId: string, query: string, topK: number): Promise<Array<{ content: string }>>;
  generate(system: string, prompt: string): Promise<string>;
  sendReply(accountId: string, threadId: string, threadType: 0 | 1, text: string): Promise<void>;
  addTag(contactId: string, tag: string): Promise<void>;
  alreadyHandled(messageId: string): Promise<boolean>;
  recordSuggestion(rec: {
    messageId: string;
    conversationId: string;
    content: string;
    confidence: number;
    decision: string;
  }): Promise<void>;
}

export interface HookInput {
  orgId: string;
  conversation: {
    id: string;
    isVirtual: boolean;
    zaloAccountId: string | null;
    externalThreadId: string | null;
    threadType: string;
    contactId: string | null;
    hasHandoffTag: boolean;
  };
  message: { id: string; content: string; isSelf: boolean };
  cfg: { bizName: string; autoReplyEnabled: boolean; threshold: number; topK: number; tagOnHandoff: string };
}

/**
 * Auto-reply orchestrator (flow B). The send/handoff decision lives here in code,
 * never in the LLM. Any error after filtering results in a silent handoff — the
 * bot never sends garbage to the customer.
 */
export async function onIncomingMessageHook(
  deps: HookDeps,
  input: HookInput,
): Promise<'sent' | 'handoff' | 'ignored'> {
  const { conversation: conv, message, cfg } = input;

  // 1. Filter
  if (message.isSelf || !message.content.trim()) return 'ignored';
  if (conv.isVirtual || conv.hasHandoffTag) return 'ignored';
  if (await deps.alreadyHandled(message.id)) return 'ignored';

  const handoff = async (rep: { content: string; confidence: number }, decision: string) => {
    if (conv.contactId) {
      try {
        await deps.addTag(conv.contactId, cfg.tagOnHandoff);
      } catch {
        /* tag failure is non-fatal; still record */
      }
    }
    await deps.recordSuggestion({
      messageId: message.id,
      conversationId: conv.id,
      content: rep.content,
      confidence: rep.confidence,
      decision,
    });
    return 'handoff' as const;
  };

  // 2. Search KB (failure degrades to empty context → low confidence → handoff)
  let chunks: string[] = [];
  try {
    chunks = (await deps.search(input.orgId, message.content, cfg.topK)).map((h) => h.content);
  } catch {
    chunks = [];
  }

  // 3. Generate
  let rep;
  try {
    const system = buildRagSystemPrompt(cfg.bizName, chunks);
    const raw = await deps.generate(system, message.content);
    rep = parseRagReply(raw);
  } catch {
    return handoff({ content: '', confidence: 0 }, 'skipped');
  }

  // 4. Decide (code, not LLM)
  const action = decideAction(rep, { autoReplyEnabled: cfg.autoReplyEnabled, threshold: cfg.threshold });
  if (action === 'handoff') {
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'handoff');
  }

  // action === 'send'
  if (!conv.zaloAccountId || !conv.externalThreadId) {
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'skipped');
  }
  const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
  try {
    await deps.sendReply(conv.zaloAccountId, conv.externalThreadId, threadType, rep.reply);
  } catch {
    // Do NOT retry blindly (avoid double-send). Fall back to handoff.
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'skipped');
  }
  await deps.recordSuggestion({
    messageId: message.id,
    conversationId: conv.id,
    content: rep.reply,
    confidence: rep.confidence,
    decision: 'sent',
  });
  return 'sent';
}
