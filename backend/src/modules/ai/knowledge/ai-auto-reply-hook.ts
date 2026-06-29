// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildRagSystemPrompt, parseRagReply, decideAction, replyHasUnsupportedNumber, type HistoryTurn } from './rag-reply.js';
import { classifyIntent, intentHint, INTERNAL_REPLY, COMPLAINT_REPLY } from './intent.js';

export interface HookDeps {
  search(orgId: string, query: string, topK: number): Promise<Array<{ content: string }>>;
  /** Lịch sử hội thoại gần nhất (cũ → mới), KHÔNG gồm tin hiện tại. Giữ ngữ cảnh cho RAG. */
  getHistory(conversationId: string, limit: number): Promise<HistoryTurn[]>;
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
  cfg: {
    bizName: string;
    autoReplyEnabled: boolean;
    threshold: number;
    topK: number;
    tagOnHandoff: string;
    historyLimit: number;
    /**
     * Chế độ TEST: bỏ qua filter hasHandoffTag VÀ không tự gắn tag khi handoff.
     * Production = false (giữ nguyên: đã chuyển sale thì AI im, nhường người thật).
     * Bật khi test thật trên Zalo để bot không tự im sau lần handoff đầu.
     */
    skipHandoffTag?: boolean;
  };
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

  // 1. Filter. skipHandoffTag (chế độ test) → bỏ qua chốt chặn hasHandoffTag để bot
  // không tự im sau lần handoff đầu trong lúc test thật.
  if (message.isSelf || !message.content.trim()) return 'ignored';
  if (conv.isVirtual || (conv.hasHandoffTag && !cfg.skipHandoffTag)) return 'ignored';
  if (await deps.alreadyHandled(message.id)) return 'ignored';

  // deliver=true → vẫn GỬI câu cho khách trước khi handoff (vd "em chuyển sale báo giá sỉ
  // tốt nhất nhé"). Tránh để khách im lặng khi bot chủ động chuyển sale. CHỈ gửi khi có nội
  // dung thật + an toàn (không gửi khi content rỗng hoặc bị guard chặn số bịa).
  const handoff = async (
    rep: { content: string; confidence: number },
    decision: string,
    deliver = false,
  ) => {
    if (conv.contactId && !cfg.skipHandoffTag) {
      try {
        await deps.addTag(conv.contactId, cfg.tagOnHandoff);
      } catch {
        /* tag failure is non-fatal; still record */
      }
    }
    if (deliver && cfg.autoReplyEnabled && rep.content.trim() && conv.zaloAccountId && conv.externalThreadId) {
      const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
      try {
        await deps.sendReply(conv.zaloAccountId, conv.externalThreadId, threadType, rep.content);
      } catch {
        /* gửi lỗi → vẫn handoff (đã tag + record) */
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

  // send helper: gửi text qua Zalo + ghi log. Trả 'sent' hoặc 'skipped' (gửi lỗi → handoff).
  const send = async (text: string, confidence: number): Promise<'sent' | 'handoff'> => {
    if (!cfg.autoReplyEnabled) return handoff({ content: text, confidence }, 'handoff');
    if (!conv.zaloAccountId || !conv.externalThreadId) return handoff({ content: text, confidence }, 'skipped');
    const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
    try {
      await deps.sendReply(conv.zaloAccountId, conv.externalThreadId, threadType, text);
    } catch {
      // Do NOT retry blindly (avoid double-send). Fall back to handoff.
      return handoff({ content: text, confidence }, 'skipped');
    }
    await deps.recordSuggestion({ messageId: message.id, conversationId: conv.id, content: text, confidence, decision: 'sent' });
    return 'sent';
  };

  // 2. Intent router (deterministic, trước LLM). Câu nội bộ + khiếu nại → xử lý cố định
  // ở code, KHÔNG gọi LLM (an toàn trên tình huống nhạy cảm). Intent khác → hint cho LLM.
  const intent = classifyIntent(message.content);
  if (intent === 'internal') {
    return send(INTERNAL_REPLY, 1);
  }
  if (intent === 'complaint') {
    // Khiếu nại: gửi câu trấn an cố định + LUÔN gắn tag để sale vào xử lý (handoff).
    if (conv.contactId && !cfg.skipHandoffTag) {
      try { await deps.addTag(conv.contactId, cfg.tagOnHandoff); } catch { /* non-fatal */ }
    }
    if (cfg.autoReplyEnabled && conv.zaloAccountId && conv.externalThreadId) {
      const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
      try { await deps.sendReply(conv.zaloAccountId, conv.externalThreadId, threadType, COMPLAINT_REPLY); } catch { /* gửi lỗi → vẫn đã tag */ }
    }
    await deps.recordSuggestion({ messageId: message.id, conversationId: conv.id, content: COMPLAINT_REPLY, confidence: 1, decision: 'complaint' });
    return 'handoff';
  }
  const hint = intentHint(intent);

  // 3. Search KB (failure degrades to empty context → low confidence → handoff)
  let chunks: string[] = [];
  try {
    chunks = (await deps.search(input.orgId, message.content, cfg.topK)).map((h) => h.content);
  } catch {
    chunks = [];
  }

  // History for context (failure degrades to empty — không chặn trả lời).
  let history: HistoryTurn[] = [];
  try {
    history = await deps.getHistory(conv.id, cfg.historyLimit);
  } catch {
    history = [];
  }

  // 4. Generate (với intent hint)
  let rep;
  try {
    const system = buildRagSystemPrompt(cfg.bizName, chunks, history, hint);
    const raw = await deps.generate(system, message.content);
    rep = parseRagReply(raw);
  } catch {
    return handoff({ content: '', confidence: 0 }, 'skipped');
  }

  // 5. Decide (code, not LLM). numberSources = allowlist chống bot tự tính số (combo total,
  // tiền điện...): nếu reply chứa con số cỡ giá tiền KHÔNG có trong KB/lịch sử/tin khách → handoff.
  const numberSources = [...chunks, ...history.map((h) => h.content), message.content];
  const action = decideAction(rep, {
    autoReplyEnabled: cfg.autoReplyEnabled,
    threshold: cfg.threshold,
    numberSources,
  });
  if (action === 'handoff') {
    // Nếu handoff CHỈ vì needs_human (vd chốt đơn sỉ, đơn lớn) mà câu trả lời KHÔNG bịa số
    // và đủ tự tin → vẫn GỬI câu cho khách ("em chuyển sale báo giá sỉ nhé") để khách không
    // bị im lặng. Nếu handoff vì guard chặn số bịa hoặc confidence thấp → KHÔNG gửi (an toàn).
    const fabricated = replyHasUnsupportedNumber(rep.reply, numberSources);
    const deliver = !fabricated && rep.confidence >= cfg.threshold;
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'handoff', deliver);
  }
  return send(rep.reply, rep.confidence);
}
