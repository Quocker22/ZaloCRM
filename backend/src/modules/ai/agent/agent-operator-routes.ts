// SPDX-License-Identifier: AGPL-3.0-or-later
// REST API — quản lý NHÂN VIÊN ĐƯỢC SAI BOT (spec 06/08/2026).
//
// Mount prefix: /api/v1/agent-operators
//
//   GET    /            liệt kê nhân viên đã gán
//   GET    /cho-gan     nick lạ gần đây chưa gán (để admin bấm Gán)
//   POST   /            gán một nick làm nhân viên
//   PATCH  /:id         bật/tắt / đổi userId / đổi tên
//   DELETE /:id         gỡ nhân viên
//
// Mọi ghi → xoaCache(orgId) để hiệu lực NGAY (không chờ TTL 60s).
// Chỉ admin/owner được thao tác — đây là mở RANH GIỚI BẢO MẬT (ai vào bảng
// này là được ghi Odoo qua bot).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { xoaCache } from './agent-operator-service.js';

function laAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export async function registerAgentOperatorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Danh sách nhân viên đã gán ──────────────────────────────────────────
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const rows = await prisma.agentOperator.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, zaloUid: true, tenGoi: true, enabled: true, createdAt: true,
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ operators: rows });
  });

  // ── Nick lạ vừa nhắn, CHƯA được gán — nguồn cho luồng "nhắn thử → Gán" ───
  app.get('/cho-gan', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    // UID đã gán rồi thì loại khỏi danh sách chờ.
    const daGan = await prisma.agentOperator.findMany({
      where: { orgId: user.orgId }, select: { zaloUid: true },
    });
    const uidDaGan = new Set(daGan.map((r) => r.zaloUid));

    // Tin từ nick người khác (không phải nick shop) trong 7 ngày, mỗi UID lấy
    // tên + tin gần nhất. senderType='contact' = tin đến, không phải self.
    const bay = new Date(Date.now() - 7 * 86_400_000);
    const tin = await prisma.message.findMany({
      where: {
        conversation: { orgId: user.orgId },
        senderType: 'contact',
        senderUid: { not: null },
        sentAt: { gte: bay },
      },
      select: { senderUid: true, senderName: true, content: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
      take: 500,
    });

    // Gom theo UID, giữ tin mới nhất, bỏ UID đã gán.
    const theoUid = new Map<string, { zaloUid: string; ten: string; tinCuoi: string; luc: Date }>();
    for (const m of tin) {
      const uid = String(m.senderUid);
      if (uidDaGan.has(uid) || theoUid.has(uid)) continue;
      theoUid.set(uid, {
        zaloUid: uid,
        ten: m.senderName ?? '(chưa rõ tên)',
        tinCuoi: (m.content ?? '').slice(0, 80),
        luc: m.sentAt,
      });
    }
    return reply.send({ choGan: [...theoUid.values()].slice(0, 50) });
  });

  // ── Gán một nick làm nhân viên ──────────────────────────────────────────
  app.post('/', async (
    req: FastifyRequest<{ Body: { zaloUid?: string; userId?: string; tenGoi?: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const zaloUid = req.body.zaloUid?.trim();
    if (!zaloUid) return reply.code(400).send({ error: 'THIEU_ZALO_UID' });

    // userId (nếu có) phải thuộc cùng org — chống gán chéo tổ chức.
    if (req.body.userId) {
      const u = await prisma.user.findFirst({
        where: { id: req.body.userId, orgId: user.orgId }, select: { id: true, fullName: true },
      });
      if (!u) return reply.code(400).send({ error: 'USER_KHONG_HOP_LE' });
    }

    const tenGoi = req.body.tenGoi?.trim() || '(nhân viên)';
    try {
      const op = await prisma.agentOperator.create({
        data: {
          orgId: user.orgId, zaloUid, userId: req.body.userId || null,
          tenGoi, createdById: user.id,
        },
        select: { id: true, zaloUid: true, tenGoi: true, enabled: true },
      });
      xoaCache(user.orgId);
      return reply.code(201).send({ operator: op });
    } catch (err: unknown) {
      // Unique (orgId, zaloUid) vi phạm → nick đã được gán.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        return reply.code(409).send({ error: 'NICK_DA_DUOC_GAN' });
      }
      throw err;
    }
  });

  // ── Bật/tắt / đổi userId / đổi tên ──────────────────────────────────────
  app.patch('/:id', async (
    req: FastifyRequest<{ Params: { id: string }; Body: { enabled?: boolean; userId?: string | null; tenGoi?: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const op = await prisma.agentOperator.findFirst({
      where: { id: req.params.id, orgId: user.orgId }, select: { id: true },
    });
    if (!op) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });

    const data: Record<string, unknown> = {};
    if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
    if (req.body.userId !== undefined) data.userId = req.body.userId || null;
    if (req.body.tenGoi !== undefined) data.tenGoi = req.body.tenGoi.trim() || '(nhân viên)';

    const updated = await prisma.agentOperator.update({
      where: { id: op.id }, data,
      select: { id: true, zaloUid: true, tenGoi: true, enabled: true },
    });
    xoaCache(user.orgId);
    return reply.send({ operator: updated });
  });

  // ── Gỡ nhân viên ────────────────────────────────────────────────────────
  app.delete('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const op = await prisma.agentOperator.findFirst({
      where: { id: req.params.id, orgId: user.orgId }, select: { id: true },
    });
    if (!op) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });

    await prisma.agentOperator.delete({ where: { id: op.id } });
    xoaCache(user.orgId);
    return reply.send({ ok: true });
  });
}
