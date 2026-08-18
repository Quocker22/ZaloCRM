// SPDX-License-Identifier: AGPL-3.0-or-later
// API nhật ký TỰ SOI + đường GỠ khi bot học sai.
//
// Anh Quốc chọn "tự áp ngay, có nhật ký" — nên đường gỡ phải rẻ và chắc:
// một lời gọi tắt luật bot vừa học (soft-disable, giữ dấu vết), và ghi rõ ai
// gỡ lúc nào. Không gỡ được dễ dàng thì "tự áp ngay" là canh bạc.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { chayLuotTuSoi } from './chay-tu-soi.js';

export async function registerTuSoiRoutes(app: FastifyInstance): Promise<void> {
  /** Nhật ký soi gần nhất (mặc định 50). */
  app.get('/api/v1/tu-soi', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as { limit?: string; chiCoVanDe?: string };
      const rows = await prisma.tuSoiHoiThoai.findMany({
        where: {
          orgId: request.user!.orgId,
          ...(q.chiCoVanDe === '1' ? { diem: { lte: 7 } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(q.limit ?? 50) || 50, 200),
      });
      return { rows };
    } catch (err) {
      logger.error({ err }, '[tu-soi] đọc nhật ký lỗi');
      return reply.status(500).send({ error: 'Không đọc được nhật ký tự soi' });
    }
  });

  /** GỠ bài học của một lần soi: tắt các luật bot đã tự ghi từ ca đó. */
  app.post('/api/v1/tu-soi/:id/go', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const row = await prisma.tuSoiHoiThoai.findFirst({ where: { id, orgId: request.user!.orgId } });
      if (!row) return reply.status(404).send({ error: 'Không thấy bản ghi' });
      if (row.luatDaGhi.length) {
        await prisma.aiGuideline.updateMany({
          where: { orgId: row.orgId, ten: { in: row.luatDaGhi }, nguon: 'tu_hoc' },
          data: { enabled: false },
        });
      }
      await prisma.tuSoiHoiThoai.update({
        where: { id },
        data: { goBoiUserId: request.user!.id ?? null, goLuc: new Date() },
      });
      logger.info({ id, luat: row.luatDaGhi }, '[tu-soi] đã gỡ bài học tự học');
      return { ok: true, daGo: row.luatDaGhi.length };
    } catch (err) {
      logger.error({ err }, '[tu-soi] gỡ bài học lỗi');
      return reply.status(500).send({ error: 'Không gỡ được' });
    }
  });

  /** Chạy tay một lượt soi (anh gõ "soi lại đi" / bấm nút trên CRM). */
  app.post('/api/v1/tu-soi/chay', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await chayLuotTuSoi();
    } catch (err) {
      logger.error({ err }, '[tu-soi] chạy tay lỗi');
      return reply.status(500).send({ error: 'Không chạy được lượt soi' });
    }
  });
}
