// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — route CÔNG KHAI cho bridge của bot:
//
//   GET /api/public/bot-quyen   (header x-api-key — cùng khoá + cùng cơ chế /api/public/conversations)
//     → 200 {phien_ban, nhom:[{conversation_id, external_thread_id, nick_uid, chuc_nang, ten_dang_ky}],
//            nhan_vien:[{zalo_uid, ten_goi, vai, trang_thai}]}
//     → 401 thiếu/sai khoá
//
// Chỉ đọc. Hình JSON là hợp đồng — xem bot-quyen-cong-khai.ts.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { apiKeyAuth } from '../api/public-api-routes.js';
import { logger } from '../../shared/utils/logger.js';
import { docCauHinhCongKhai } from './bot-quyen-cong-khai.js';

export async function botQuyenPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);

  app.get('/api/public/bot-quyen', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as unknown as { orgId: string }).orgId;
      return await docCauHinhCongKhai(orgId);
    } catch (err) {
      logger.error('[public-api] GET /bot-quyen error:', err);
      return reply.status(500).send({ error: 'Failed to fetch bot permissions' });
    }
  });
}
