// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * campaign-routes.ts — Endpoints for outreach campaigns.
 *
 * Phase 1 surface:
 *   POST /api/v1/campaigns/random-friend-request
 *     body: { zaloAccountId: string; message?: string }
 *     → pick a random eligible contact and send a friend request
 *       (discovery of has-Zalo happens as a side-effect of the attempt).
 *   GET  /api/v1/campaigns/contacts/:contactId/attempts
 *     → counts of attempts per state, for UI display on contact detail.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { resolveAccount, checkAccess, handleError } from '../zalo/zalo-route-helpers.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { executeRandomFriendRequest, attemptFriendRequest } from './campaign-service.js';
import { getBulkStats, runFriendBatch, getMessageStats, runMessageBatch, getSchedule, setSchedule, listCampaigns } from './bulk-campaign-service.js';

interface RandomFriendReqBody {
  zaloAccountId: string;
  message?: string;
}

interface ContactFriendReqBody {
  zaloAccountId: string;
  message?: string;
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  // Ảnh catalog là ảnh báo giá công khai (không nhạy cảm) — <img src> không gửi token được,
  // nên BỎ auth riêng cho route serve ảnh. Các route khác vẫn qua authMiddleware.
  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/v1/campaigns/catalog/img/')) return;
    return authMiddleware(request, reply);
  });

  // Send a friend request to ONE specific contact (the "Gửi kết bạn" button on the
  // Contacts list). Looks the contact's phone up on Zalo and sends the invite using
  // the chosen nick. Idempotency: a prior attempt for this (nick, contact) throws
  // P2002 → reported as already-attempted, not an error.
  app.post(
    '/api/v1/campaigns/contacts/:contactId/friend-request',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { contactId } = request.params as { contactId: string };
      const { zaloAccountId, message } = (request.body ?? {}) as ContactFriendReqBody;

      if (!zaloAccountId) {
        return reply.status(400).send({ error: 'zaloAccountId is required' });
      }
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;

      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true, phone: true, phoneNormalized: true, consentStatus: true },
      });
      if (!contact) return reply.status(404).send({ error: 'contact_not_found' });
      const phone = contact.phoneNormalized || contact.phone;
      if (!phone) return reply.status(422).send({ error: 'contact_has_no_phone' });
      if (contact.consentStatus === 'revoked') {
        return reply.status(409).send({ error: 'consent_revoked' });
      }

      try {
        await resolveAccount(zaloAccountId, user.orgId);
        const result = await attemptFriendRequest({
          orgId: user.orgId,
          zaloAccountId,
          contactId,
          phone,
          message: message || 'Xin chào! Mình muốn kết nối để trao đổi thông tin nhé.',
        });
        return reply.send(result);
      } catch (err: any) {
        // Already attempted for this nick+contact → not a hard error.
        if (err?.code === 'P2002') {
          return reply.status(409).send({ error: 'already_attempted' });
        }
        logger.error('[campaign] contact friend-request error:', err);
        return handleError(reply, err, 'contact-friend-request');
      }
    },
  );

  app.post(
    '/api/v1/campaigns/random-friend-request',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { zaloAccountId, message } = (request.body ?? {}) as RandomFriendReqBody;

      if (!zaloAccountId) {
        return reply.status(400).send({ error: 'zaloAccountId is required' });
      }
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;

      try {
        await resolveAccount(zaloAccountId, user.orgId);
        const result = await executeRandomFriendRequest({
          orgId: user.orgId,
          zaloAccountId,
          message,
        });
        return reply.send(result);
      } catch (err) {
        logger.error('[campaign] random-friend-request error:', err);
        return handleError(reply, err, 'random-friend-request');
      }
    },
  );

  app.get(
    '/api/v1/campaigns/contacts/:contactId/attempts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { contactId } = request.params as { contactId: string };

      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true },
      });
      if (!contact) return reply.status(404).send({ error: 'contact_not_found' });

      const grouped = await prisma.friendshipAttempt.groupBy({
        by: ['state'],
        where: { contactId },
        _count: true,
      });
      const counts = Object.fromEntries(grouped.map((g) => [g.state, g._count]));

      const attempts = await prisma.friendshipAttempt.findMany({
        where: { contactId },
        orderBy: { queuedAt: 'desc' },
        select: {
          id: true,
          state: true,
          zaloAccountId: true,
          zaloUidFound: true,
          errorCode: true,
          queuedAt: true,
          sentAt: true,
          decidedAt: true,
          zaloAccount: { select: { id: true, displayName: true, phone: true } },
        },
      });

      return { counts, attempts };
    },
  );

  // ─── LIST all campaigns (mỗi tệp = 1 chiến dịch) cho trang "Chiến dịch" ────
  app.get(
    '/api/v1/campaigns/bulk',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      let { zaloAccountId } = request.query as { zaloAccountId?: string };
      // Mặc định: nick đang kết nối đầu tiên của org.
      if (!zaloAccountId) {
        const nick = await prisma.zaloAccount.findFirst({
          where: { orgId: user.orgId, archivedAt: null },
          orderBy: { createdAt: 'asc' }, select: { id: true },
        });
        zaloAccountId = nick?.id;
      }
      if (!zaloAccountId) return { campaigns: [], zaloAccountId: null };
      const campaigns = await listCampaigns(user.orgId, zaloAccountId);
      return { campaigns, zaloAccountId };
    },
  );

  // ─── BULK over a CustomerList (Community "chiến dịch gửi hàng loạt") ───────
  // GET stats for (list × nick): eligible / attempted / accepted / pending / daily cap.
  app.get(
    '/api/v1/campaigns/bulk/:listId/stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId } = request.query as { zaloAccountId?: string };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      const stats = await getBulkStats(user.orgId, listId, zaloAccountId);
      if (!stats) return reply.status(404).send({ error: 'list_not_found' });
      return stats;
    },
  );

  // POST run one batch of friend-requests over the list. REAL sends — the FE must
  // have shown a confirm dialog. Respects the nick's daily cap. batchSize defaults 20.
  app.post(
    '/api/v1/campaigns/bulk/:listId/run-batch',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId, message, batchSize } = (request.body ?? {}) as {
        zaloAccountId?: string; message?: string; batchSize?: number;
      };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      try {
        await resolveAccount(zaloAccountId, user.orgId);
        const result = await runFriendBatch({
          orgId: user.orgId,
          listId,
          zaloAccountId,
          message: message || 'Xin chào! Mình muốn kết nối để trao đổi thông tin nhé.',
          batchSize: Math.min(Math.max(Number(batchSize) || 20, 1), 30),
        });
        return result;
      } catch (err: any) {
        if (err?.message === 'list_not_found') return reply.status(404).send({ error: 'list_not_found' });
        logger.error('[campaign] bulk run-batch error:', err);
        return handleError(reply, err, 'bulk-run-batch');
      }
    },
  );

  // ─── MESSAGE phase: bulk-message accepted friends in the list ──────────────
  app.get(
    '/api/v1/campaigns/bulk/:listId/message-stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId } = request.query as { zaloAccountId?: string };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      const stats = await getMessageStats(user.orgId, listId, zaloAccountId);
      if (!stats) return reply.status(404).send({ error: 'list_not_found' });
      return stats;
    },
  );

  app.post(
    '/api/v1/campaigns/bulk/:listId/run-message-batch',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId, message, batchSize, attachPriceList, includeSent } = (request.body ?? {}) as {
        zaloAccountId?: string; message?: string; batchSize?: number; attachPriceList?: boolean; includeSent?: boolean;
      };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (!message?.trim()) return reply.status(400).send({ error: 'message is required' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      try {
        await resolveAccount(zaloAccountId, user.orgId);
        const result = await runMessageBatch({
          orgId: user.orgId, listId, zaloAccountId, message,
          batchSize: Math.min(Math.max(Number(batchSize) || 30, 1), 100),
          attachPriceList: attachPriceList === true,
          includeSent: includeSent === true,
        });
        return result;
      } catch (err: any) {
        if (err?.message === 'list_not_found') return reply.status(404).send({ error: 'list_not_found' });
        logger.error('[campaign] bulk run-message-batch error:', err);
        return handleError(reply, err, 'bulk-run-message-batch');
      }
    },
  );

  // ─── CATALOG BÁO GIÁ: ghép SẴN + xem trước (gửi lúc chạy chỉ việc lấy file cache) ───
  // POST prepare → ghép catalog (cache 10p), trả danh sách URL ảnh để xem trước trên UI.
  app.post(
    '/api/v1/campaigns/catalog/prepare',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const { getCampaignCatalogs } = await import('./catalog-image.js');
        const { generateEmbedding } = await import('../ai/knowledge/embedding.js');
        const { searchKnowledge } = await import('../ai/knowledge/knowledge-service.js');
        const org = await prisma.organization.findUnique({ where: { id: user.orgId }, select: { name: true } });
        const shopName = process.env.AI_SHOP_NAME || org?.name || 'Shop';
        const deps = { prisma, embed: generateEmbedding } as Parameters<typeof searchKnowledge>[0];
        const lookup = (q: string) => searchKnowledge(deps, user.orgId, q, 6, { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' });
        const paths = await getCampaignCatalogs(user.orgId, shopName, lookup);
        // trả URL serve theo tên file (không lộ path tuyệt đối)
        const { basename } = await import('node:path');
        const urls = paths.map((p) => `/api/v1/campaigns/catalog/img/${basename(p)}`);
        return { count: urls.length, images: urls };
      } catch (err) {
        logger.error('[campaign] catalog prepare error:', err);
        return handleError(reply, err, 'catalog-prepare');
      }
    },
  );

  // GET serve 1 ảnh catalog theo tên file (chỉ file catalog-*.png trong tmpdir — chống path traversal).
  app.get(
    '/api/v1/campaigns/catalog/img/:file',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { file } = request.params as { file: string };
      if (!/^catalog-[\w.-]+\.png$/.test(file)) return reply.status(400).send({ error: 'bad file' });
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const { existsSync, readFileSync } = await import('node:fs');
      const full = join(tmpdir(), file);
      if (!existsSync(full)) return reply.status(404).send({ error: 'not found' });
      reply.header('Content-Type', 'image/png');
      return reply.send(readFileSync(full));
    },
  );

  // ─── AUTO-SEND schedule (tự động gửi 1 đợt/ngày) ───────────────────────────
  app.get(
    '/api/v1/campaigns/bulk/:listId/schedule',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId, mode = 'friend' } = request.query as { zaloAccountId?: string; mode?: string };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      const s = await getSchedule(user.orgId, listId, zaloAccountId, mode);
      return { schedule: s };
    },
  );

  app.post(
    '/api/v1/campaigns/bulk/:listId/schedule',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { listId } = request.params as { listId: string };
      const { zaloAccountId, mode = 'friend', enabled, message, perDay } = (request.body ?? {}) as {
        zaloAccountId?: string; mode?: string; enabled?: boolean; message?: string; perDay?: number;
      };
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId is required' });
      if (mode !== 'friend' && mode !== 'message') return reply.status(400).send({ error: 'invalid mode' });
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;
      const s = await setSchedule({
        orgId: user.orgId, listId, zaloAccountId, mode,
        enabled: enabled !== false,
        message: message || 'Xin chào! Mình muốn kết nối để trao đổi thông tin nhé.',
        perDay: Math.min(Math.max(Number(perDay) || 20, 1), mode === 'message' ? 300 : 30),
        userId: user.id,
      });
      return { schedule: s };
    },
  );
}
