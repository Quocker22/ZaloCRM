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
import { buildSummaryPrompt, formatGroupSummary, groupName } from './handoff-group.js';
import { resolveOrder, formatOrderLines, formatVnd, type KbLookup } from './order-checkout.js';
import { getQrConfig, buildTransferNote, renderVietQrImage } from './qr-image.js';
import { humanPace } from './human-pace.js';

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

    // IM LẶNG TRONG GROUP HANDOFF: nếu tin đến từ 1 GROUP mà bot đã tạo để chuyển sale,
    // bot KHÔNG tự trả lời — để sale nói với khách. CHỈ trả lời khi bot bị @tag.
    if (conv.threadType === 'group' && conv.externalThreadId) {
      const isHandoffGroup = await prisma.aiSuggestion.count({
        where: { orgId: ctx.orgId, type: 'handoff_group', content: conv.externalThreadId },
      });
      if (isHandoffGroup > 0) {
        // Bot chỉ nói khi được @tag. Lấy UID bot + mentions của tin để kiểm.
        const acct = conv.zaloAccountId
          ? await prisma.zaloAccount.findUnique({ where: { id: conv.zaloAccountId }, select: { zaloUid: true } })
          : null;
        const msg = await prisma.message.findUnique({ where: { id: ctx.messageId }, select: { mentions: true } });
        const botUid = acct?.zaloUid ?? '';
        const mentionsStr = msg?.mentions ? JSON.stringify(msg.mentions) : '';
        const botMentioned = botUid !== '' && mentionsStr.includes(botUid);
        if (!botMentioned) return; // không tag bot → im lặng, để sale xử lý
      }
    }

    // Báo group sale kèm ĐƠN + tổng + hình thức thanh toán (tái dùng cơ chế group handoff).
    const openHandoffGroupWithOrder = async (
      customerName: string,
      resolved: { items: unknown; total: number },
      payMethod: string,
      latestMsg: string,
    ): Promise<void> => {
      const saleUid = process.env.AI_HANDOFF_SALE_ZALO_UID?.trim();
      if (!saleUid || !conv.zaloAccountId || !conv.contactId) return;
      const contact = await prisma.contact.findUnique({
        where: { id: conv.contactId },
        select: { zaloUid: true },
      });
      if (!contact?.zaloUid) return;
      const { formatOrderLines: fmt } = await import('./order-checkout.js');
      const orderText =
        `🛒 ĐƠN KHÁCH CHỐT: ${customerName || 'khách'}\n` +
        `Hình thức: ${payMethod}\n` +
        fmt(resolved as Parameters<typeof fmt>[0]) +
        `\nTin gần nhất: ${latestMsg}\n— Bot tự động chuyển. Sale chuẩn bị hàng giúp ạ.`;
      try {
        const existing = await prisma.aiSuggestion.findFirst({
          where: { orgId: ctx.orgId, conversationId: conv.id, type: 'handoff_group' },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        });
        if (existing?.content) {
          await zaloOps.sendMessage(conv.zaloAccountId, existing.content, 1, { msg: orderText });
          return;
        }
        const grp = await zaloOps.createGroup(conv.zaloAccountId, {
          name: groupName(customerName),
          members: [saleUid, contact.zaloUid],
        });
        const groupId = (grp as { groupId?: string })?.groupId;
        if (!groupId) return;
        await zaloOps.sendMessage(conv.zaloAccountId, groupId, 1, { msg: orderText });
        await prisma.aiSuggestion.create({
          data: { orgId: ctx.orgId, conversationId: conv.id, messageId: ctx.messageId, type: 'handoff_group', content: groupId, confidence: 1 },
        });
      } catch (err) {
        logger.warn({ err }, '[ai/kb] báo group đơn hàng lỗi (bỏ qua)');
      }
    };

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
          await humanPace(text.length); // nhịp gõ người trước khi gửi (chống Zalo flag spam)
          await zaloOps.sendMessage(accountId, threadId, threadType, { msg: text });
        },
        sendProductImage: async (accountId, threadId, threadType, replyText) => {
          const imgPath = findImageForReply(replyText);
          if (!imgPath) return false;
          try {
            await humanPace(60); // giãn trước khi gửi ảnh (ảnh dồn dập dễ bị Zalo flag)
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
        openHandoffGroup: async (conversationId, latestCustomerMsg, decision) => {
          // Sale UID cấu hình qua env (hệ thống chưa map user→Zalo UID). Không có → bỏ qua.
          const saleUid = process.env.AI_HANDOFF_SALE_ZALO_UID?.trim();
          if (!saleUid) return;
          if (!conv.zaloAccountId || !conv.contactId) return;
          // Khách phải có zalo_uid mới add vào group được.
          const contact = await prisma.contact.findUnique({
            where: { id: conv.contactId },
            select: { zaloUid: true, fullName: true, crmName: true },
          });
          if (!contact?.zaloUid) return;
          // Chống tạo trùng: đã có group cho conversation này thì gửi tóm tắt vào group cũ.
          const existing = await prisma.aiSuggestion.findFirst({
            where: { orgId: ctx.orgId, conversationId, type: 'handoff_group' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          const customerName = contact.crmName || contact.fullName || '';
          // Tóm tắt vấn đề cho sale (LLM). Lỗi → tóm tắt tối giản.
          let summary = '';
          try {
            const rows = await prisma.message.findMany({
              where: { conversationId, contentType: 'text', isDeleted: false },
              select: { senderType: true, content: true },
              orderBy: { sentAt: 'desc' },
              take: 12,
            });
            const hist = rows
              .reverse()
              .filter((m) => m.content)
              .map((m) => ({ role: m.senderType === 'self' ? ('shop' as const) : ('customer' as const), content: m.content as string }));
            const { system, prompt } = buildSummaryPrompt(ctx.bizName, customerName, hist, latestCustomerMsg);
            summary = await generateText(cfg.provider, llmApiKey, cfg.model, system, prompt, 400, llmBaseUrl);
          } catch {
            summary = `Khách ${customerName || ''} cần sale hỗ trợ (${decision}). Tin gần nhất: ${latestCustomerMsg}`;
          }
          const text = formatGroupSummary(customerName, summary);
          try {
            if (existing?.content) {
              // đã có group → gửi tóm tắt cập nhật vào group cũ (content lưu groupId)
              await zaloOps.sendMessage(conv.zaloAccountId, existing.content, 1, { msg: text });
              return;
            }
            const grp = await zaloOps.createGroup(conv.zaloAccountId, {
              name: groupName(customerName),
              members: [saleUid, contact.zaloUid],
            });
            const groupId = (grp as { groupId?: string })?.groupId;
            if (!groupId) return;
            await zaloOps.sendMessage(conv.zaloAccountId, groupId, 1, { msg: text });
            // lưu groupId để chống tạo trùng lần sau (dùng bảng aiSuggestion sẵn có)
            await prisma.aiSuggestion.create({
              data: {
                orgId: ctx.orgId,
                conversationId,
                messageId: ctx.messageId,
                type: 'handoff_group',
                content: groupId,
                confidence: 1,
              },
            });
          } catch (err) {
            logger.warn({ err }, '[ai/kb] tạo group handoff lỗi (bỏ qua)');
          }
        },
        handleCheckout: async ({ order, stage, reply, latestCustomerMsg }) => {
          if (!conv.zaloAccountId || !conv.externalThreadId) return 'fallback';
          const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
          const kbLookup: KbLookup = (q) => searchKnowledge(kbDeps, ctx.orgId, q, 4, embedCfg);
          const contact = conv.contactId
            ? await prisma.contact.findUnique({ where: { id: conv.contactId }, select: { fullName: true, crmName: true } })
            : null;
          const customerName = contact?.crmName || contact?.fullName || '';

          // BƯỚC confirm: chỉ gửi reply đọc-lại-đơn + TỔNG do CODE tính (không LLM). Chờ khách duyệt.
          if (stage === 'confirm') {
            const resolved = await resolveOrder(order, kbLookup);
            let text = reply;
            if (!resolved.missingPrice) {
              // gắn bảng đơn + tổng (code tính) vào cuối reply cho rõ ràng
              text = `${reply}\n\n${formatOrderLines(resolved)}`;
            }
            try {
              await zaloOps.sendMessage(conv.zaloAccountId, conv.externalThreadId, threadType, { msg: text });
            } catch { /* gửi lỗi → coi như fallback */ return 'fallback'; }
            await prisma.aiSuggestion.create({
              data: { orgId: ctx.orgId, conversationId: conv.id, messageId: ctx.messageId, type: 'auto_reply_rag', content: text.slice(0, 2000), confidence: 1 },
            }).catch(() => {});
            return 'sent';
          }

          // BƯỚC thanh toán: tính lại đơn (nguồn sự thật). Thiếu giá → báo sale (fallback).
          const resolved = await resolveOrder(order, kbLookup);
          if (resolved.missingPrice || resolved.total <= 0) return 'fallback';

          if (stage === 'pay_cash') {
            // gửi reply xác nhận cho khách + báo group sale (đơn + tổng, tiền mặt).
            try { await zaloOps.sendMessage(conv.zaloAccountId, conv.externalThreadId, threadType, { msg: reply }); } catch { /* non-fatal */ }
            await openHandoffGroupWithOrder(customerName, resolved, 'Tiền mặt', latestCustomerMsg);
            return 'sent';
          }

          // stage === 'pay_qr': cần cấu hình TK. Chưa có → fallback báo sale.
          const qrCfg = getQrConfig();
          if (!qrCfg) return 'fallback';
          const hhmm = new Date().toISOString().slice(11, 16).replace(':', '');
          const note = buildTransferNote(customerName, hhmm);
          let imgPath: string | null = null;
          try {
            imgPath = await renderVietQrImage(qrCfg, resolved.total, note);
          } catch (err) {
            logger.warn({ err }, '[ai/kb] render VietQR lỗi → báo sale');
            return 'fallback';
          }
          // gửi reply + ảnh QR + dòng hướng dẫn cho khách.
          const bankLine = `Số tiền: ${formatVnd(resolved.total)} — Nội dung: ${note}` +
            (qrCfg.accountName ? `\nChủ TK: ${qrCfg.accountName}` : '');
          try {
            await zaloOps.sendMessage(conv.zaloAccountId, conv.externalThreadId, threadType, { msg: `${reply}\n\n${bankLine}` });
            await zaloOps.sendImage(conv.zaloAccountId, conv.externalThreadId, threadType, [imgPath]);
          } catch (err) {
            logger.warn({ err }, '[ai/kb] gửi QR lỗi');
          }
          await openHandoffGroupWithOrder(customerName, resolved, 'Chuyển khoản (đã gửi QR)', latestCustomerMsg);
          return 'sent';
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
