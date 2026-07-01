// SPDX-License-Identifier: AGPL-3.0-or-later
// Dây nối luồng B: ráp HookDeps thật (prisma + generateText + zaloOps) cho
// onIncomingMessageHook. Logic quyết định nằm ở ai-auto-reply-hook (đã test);
// file này chỉ là wiring, gọi fire-and-forget từ message-handler.
import { prisma } from '../../../shared/database/prisma-client.js';
import { generateText, getProviderApiKey } from '../ai-service.js';
import { getProviderBaseUrl } from '../provider-registry.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { logger } from '../../../shared/utils/logger.js';
import { generateEmbedding } from './embedding.js';
import { searchKnowledge, type IngestDeps } from './knowledge-service.js';
import { onIncomingMessageHook } from './ai-auto-reply-hook.js';
import { findImageForReply } from './product-image.js';

const kbDeps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };

export interface AutoReplyContext {
  orgId: string;
  bizName: string;
  conversationId: string;
  messageId: string;
  messageContent: string;
}

/**
 * Run the RAG auto-reply for one inbound message. Fire-and-forget from the
 * message handler. Returns silently if AiConfig is missing or auto-reply is off.
 * Any failure is swallowed (logged) — must never break the inbound pipeline.
 */
export async function runAutoReplyForMessage(ctx: AutoReplyContext): Promise<void> {
  try {
    const cfg = await prisma.aiConfig.findUnique({ where: { orgId: ctx.orgId } });
    if (!cfg || !cfg.autoReplyEnabled) return;

    const conv = await prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { id: true, isVirtual: true, zaloAccountId: true, externalThreadId: true, threadType: true, contactId: true },
    });
    if (!conv) return;

    const tags = conv.contactId
      ? ((await prisma.contact.findUnique({ where: { id: conv.contactId }, select: { tags: true } }))?.tags as
          | string[]
          | undefined) ?? []
      : [];

    const llmApiKey = await getProviderApiKey(ctx.orgId, cfg.provider);
    const llmBaseUrl = await getProviderBaseUrl(ctx.orgId, cfg.provider);
    const embedCfg = {
      provider: cfg.embedProvider,
      model: cfg.embedModel,
      baseUrl: cfg.embedBaseUrl,
    };

    await onIncomingMessageHook(
      {
        search: (orgId, query, topK) => searchKnowledge(kbDeps, orgId, query, topK, embedCfg),
        getHistory: async (conversationId, limit) => {
          // N tin text gần nhất (KHÔNG gồm tin hiện tại — nó chưa được xử lý xong), cũ → mới.
          const rows = await prisma.message.findMany({
            where: { conversationId, contentType: 'text', isDeleted: false, id: { not: ctx.messageId } },
            select: { senderType: true, content: true },
            orderBy: { sentAt: 'desc' },
            take: limit,
          });
          return rows
            .reverse()
            .filter((m) => m.content)
            .map((m) => ({ role: m.senderType === 'self' ? ('shop' as const) : ('customer' as const), content: m.content as string }));
        },
        generate: (system, prompt) =>
          generateText(cfg.provider, llmApiKey, cfg.model, system, prompt, 800, llmBaseUrl),
        sendReply: async (accountId, threadId, threadType, text) => {
          await zaloOps.sendMessage(accountId, threadId, threadType, { msg: text });
        },
        sendProductImage: async (accountId, threadId, threadType, replyText) => {
          const imgPath = findImageForReply(replyText);
          if (!imgPath) return false;
          try {
            await zaloOps.sendImage(accountId, threadId, threadType, [imgPath]);
            return true;
          } catch (err) {
            logger.warn({ err }, '[ai/kb] gửi ảnh sản phẩm lỗi (bỏ qua)');
            return false;
          }
        },
        addTag: async (contactId, tag) => {
          const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { tags: true } });
          const cur = (c?.tags as string[] | undefined) ?? [];
          if (!cur.includes(tag)) {
            await prisma.contact.update({ where: { id: contactId }, data: { tags: [...cur, tag] } });
          }
        },
        alreadyHandled: async (messageId) => {
          const n = await prisma.aiSuggestion.count({ where: { orgId: ctx.orgId, messageId, type: 'auto_reply_rag' } });
          return n > 0;
        },
        recordSuggestion: async (rec) => {
          await prisma.aiSuggestion.create({
            data: {
              orgId: ctx.orgId,
              conversationId: rec.conversationId,
              messageId: rec.messageId,
              type: 'auto_reply_rag',
              content: rec.content.slice(0, 2000),
              confidence: rec.confidence,
            },
          });
        },
      },
      {
        orgId: ctx.orgId,
        conversation: {
          id: conv.id,
          isVirtual: conv.isVirtual ?? false,
          zaloAccountId: conv.zaloAccountId,
          externalThreadId: conv.externalThreadId,
          threadType: conv.threadType,
          contactId: conv.contactId,
          hasHandoffTag: tags.includes(cfg.autoReplyTagOnHandoff),
        },
        message: { id: ctx.messageId, content: ctx.messageContent, isSelf: false },
        cfg: {
          bizName: ctx.bizName,
          autoReplyEnabled: cfg.autoReplyEnabled,
          threshold: cfg.autoReplyConfidenceThreshold,
          topK: 6,
          tagOnHandoff: cfg.autoReplyTagOnHandoff,
          historyLimit: 8,
          // Chế độ test: đặt AI_AUTOREPLY_SKIP_HANDOFF_TAG=1 để bot không tự im sau handoff
          // (không gắn tag + bỏ qua filter tag). Mặc định production = không bật.
          skipHandoffTag: process.env.AI_AUTOREPLY_SKIP_HANDOFF_TAG === '1',
        },
      },
    );
  } catch (err) {
    logger.error({ err }, '[ai/kb] auto-reply wiring failed');
  }
}
