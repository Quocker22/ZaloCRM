// SPDX-License-Identifier: AGPL-3.0-or-later
// Route API gợi ý @khách / #sản-phẩm cho ô soạn tin.
//
// Logic tra nằm ở `goi-y-tra.ts` (thuần Odoo, test được không cần Prisma).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { odooClientFromEnv, type OdooClient } from './odoo/client.js';
import { logger } from '../../shared/utils/logger.js';
import { timKhachGoiY, timSanPhamGoiY } from './goi-y-tra.js';

export type { GoiYKhach, GoiYSanPham } from './goi-y-tra.js';

export async function goiYRoutes(app: FastifyInstance): Promise<void> {
  // Odoo client dùng chung cho mọi request — tạo một lần, nhớ uid.
  // Thiếu cấu hình thì route trả 503 thay vì làm sập cả app lúc khởi động.
  let odoo: OdooClient | null = null;
  try {
    odoo = odooClientFromEnv();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      'Thiếu cấu hình Odoo — API gợi ý @khách/#sản-phẩm sẽ trả 503',
    );
  }

  const chay = async <T>(
    reply: FastifyReply,
    q: unknown,
    fn: (o: OdooClient, tu: string) => Promise<T[]>,
  ) => {
    if (!odoo) return reply.status(503).send({ error: 'Chưa cấu hình Odoo' });
    const tu = typeof q === 'string' ? q : '';
    try {
      return reply.send({ items: await fn(odoo, tu) });
    } catch (err) {
      // Gợi ý hỏng KHÔNG được làm hỏng ô chat: trả mảng rỗng, nhân viên gõ tay
      // như trước. Ném lỗi ra UI sẽ chặn họ nhắn tin.
      logger.error({ err, q: tu }, 'Lỗi tra gợi ý');
      return reply.send({ items: [], loi: 'Không tra được, hãy gõ tay' });
    }
  };

  app.get(
    '/api/goi-y/khach',
    { preHandler: authMiddleware },
    async (req: FastifyRequest, reply: FastifyReply) =>
      chay(reply, (req.query as Record<string, unknown>)?.q, timKhachGoiY),
  );

  app.get(
    '/api/goi-y/san-pham',
    { preHandler: authMiddleware },
    async (req: FastifyRequest, reply: FastifyReply) =>
      chay(reply, (req.query as Record<string, unknown>)?.q, timSanPhamGoiY),
  );
}
