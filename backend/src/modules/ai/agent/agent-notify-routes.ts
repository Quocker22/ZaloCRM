// SPDX-License-Identifier: AGPL-3.0-or-later
// REST API — quản lý NƠI NHẬN THÔNG BÁO khi bot cần người hỗ trợ khách.
//
// Mount prefix: /api/v1/agent-notify-targets
//
//   GET    /             liệt kê nơi nhận đã cấu hình
//   GET    /goi-y        nhóm/nick gần đây để admin bấm thêm nhanh
//   POST   /             thêm một nơi nhận
//   PATCH  /:id          bật/tắt / đổi tên / đổi loại việc nhận
//   DELETE /:id          gỡ nơi nhận
//   POST   /:id/gui-thu  GỬI THỬ một tin để kiểm chứng đích có nhận được không
//
// Mọi ghi → xoaCacheDichBao(orgId) để hiệu lực NGAY (không chờ TTL 60s).
// Chỉ admin/owner được thao tác — ai vào bảng này là nhận được ngữ cảnh khách
// (tên, SĐT, nội dung khách nhắn), nên đây là ranh giới dữ liệu khách hàng.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { xoaCacheDichBao } from './noi-zalo/dich-bao.js';
import { guiTin } from './noi-zalo/gui-zalo.js';
import { logger } from '../../../shared/utils/logger.js';

function laAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** Chuẩn hoá loại đích — chỉ nhận hai giá trị, sai thì coi là nhóm. */
function chuanLoaiDich(v: unknown): 'nhom' | 'ca_nhan' {
  return v === 'ca_nhan' ? 'ca_nhan' : 'nhom';
}

export async function registerAgentNotifyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Danh sách nơi nhận đã cấu hình ──────────────────────────────────────
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const rows = await prisma.agentNotifyTarget.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, tenGoi: true, loaiDich: true, threadId: true,
        nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    // Cho giao diện biết còn đang chạy bằng env hay không — anh Quốc nhìn là
    // hiểu ngay vì sao tin vẫn về nhóm cũ dù bảng trống.
    return reply.send({
      targets: rows,
      dangDungEnv: rows.length === 0 && Boolean(process.env.AI_AGENT_THREAD_BAO_SALE),
      threadEnv: rows.length === 0 ? (process.env.AI_AGENT_THREAD_BAO_SALE ?? null) : null,
    });
  });

  // ── Gợi ý: nhóm/hội thoại gần đây, CHƯA được khai làm nơi nhận ──────────
  app.get('/goi-y', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const daKhai = await prisma.agentNotifyTarget.findMany({
      where: { orgId: user.orgId }, select: { threadId: true },
    });
    const idDaKhai = new Set(daKhai.map((r) => r.threadId));

    // Hội thoại có hoạt động trong 30 ngày — nguồn để bấm thêm nhanh, khỏi
    // bắt anh Quốc đi đâu đó copy id nhóm bằng tay.
    const bamuoi = new Date(Date.now() - 30 * 86_400_000);
    const hoiThoai = await prisma.conversation.findMany({
      where: { orgId: user.orgId, lastMessageAt: { gte: bamuoi } },
      select: {
        externalThreadId: true, threadType: true, lastMessageAt: true,
        contact: { select: { zaloUid: true, fullName: true, crmName: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });

    const goiY: { threadId: string; ten: string; loaiDich: 'nhom' | 'ca_nhan' }[] = [];
    const daThay = new Set<string>();
    for (const c of hoiThoai) {
      const laNhom = c.threadType === 'group';
      const threadId = c.externalThreadId ?? c.contact?.zaloUid;
      if (!threadId || idDaKhai.has(threadId) || daThay.has(threadId)) continue;
      daThay.add(threadId);
      goiY.push({
        threadId,
        ten: c.contact?.crmName || c.contact?.fullName || (laNhom ? '(nhóm chưa rõ tên)' : '(chưa rõ tên)'),
        loaiDich: laNhom ? 'nhom' : 'ca_nhan',
      });
      if (goiY.length >= 50) break;
    }
    return reply.send({ goiY });
  });

  // ── Thêm một nơi nhận ───────────────────────────────────────────────────
  app.post('/', async (
    req: FastifyRequest<{ Body: {
      threadId?: string; tenGoi?: string; loaiDich?: string;
      nhanKhachCanHoTro?: boolean; nhanBotSuCo?: boolean;
    } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const threadId = req.body.threadId?.trim();
    if (!threadId) return reply.code(400).send({ error: 'THIEU_THREAD_ID' });

    // Không nhận loại việc nào thì đích này vô nghĩa — chặn ngay, đừng để anh
    // Quốc tạo xong rồi ngồi đợi tin không bao giờ tới.
    const nhanKhach = req.body.nhanKhachCanHoTro ?? true;
    const nhanSuCo = req.body.nhanBotSuCo ?? true;
    if (!nhanKhach && !nhanSuCo) return reply.code(400).send({ error: 'PHAI_CHON_IT_NHAT_MOT_LOAI_VIEC' });

    try {
      const t = await prisma.agentNotifyTarget.create({
        data: {
          orgId: user.orgId,
          threadId,
          tenGoi: req.body.tenGoi?.trim() || '(nơi nhận)',
          loaiDich: chuanLoaiDich(req.body.loaiDich),
          nhanKhachCanHoTro: nhanKhach,
          nhanBotSuCo: nhanSuCo,
          createdById: user.id,
        },
        select: {
          id: true, tenGoi: true, loaiDich: true, threadId: true,
          nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: true,
        },
      });
      xoaCacheDichBao(user.orgId);
      return reply.code(201).send({ target: t });
    } catch (err: unknown) {
      // Unique (orgId, threadId) vi phạm → đích đã khai rồi.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        return reply.code(409).send({ error: 'DICH_DA_KHAI' });
      }
      throw err;
    }
  });

  // ── Bật/tắt / đổi tên / đổi loại việc nhận ──────────────────────────────
  app.patch('/:id', async (
    req: FastifyRequest<{ Params: { id: string }; Body: {
      enabled?: boolean; tenGoi?: string; loaiDich?: string;
      nhanKhachCanHoTro?: boolean; nhanBotSuCo?: boolean;
    } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const t = await prisma.agentNotifyTarget.findFirst({
      where: { id: req.params.id, orgId: user.orgId },
      select: { id: true, nhanKhachCanHoTro: true, nhanBotSuCo: true },
    });
    if (!t) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });

    const data: Record<string, unknown> = {};
    if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
    if (req.body.tenGoi !== undefined) data.tenGoi = req.body.tenGoi.trim() || '(nơi nhận)';
    if (req.body.loaiDich !== undefined) data.loaiDich = chuanLoaiDich(req.body.loaiDich);
    if (typeof req.body.nhanKhachCanHoTro === 'boolean') data.nhanKhachCanHoTro = req.body.nhanKhachCanHoTro;
    if (typeof req.body.nhanBotSuCo === 'boolean') data.nhanBotSuCo = req.body.nhanBotSuCo;

    // Tắt cả hai loại việc = đích chết lặng. Chặn như lúc tạo.
    const khachSau = (data.nhanKhachCanHoTro as boolean | undefined) ?? t.nhanKhachCanHoTro;
    const suCoSau = (data.nhanBotSuCo as boolean | undefined) ?? t.nhanBotSuCo;
    if (!khachSau && !suCoSau) return reply.code(400).send({ error: 'PHAI_CHON_IT_NHAT_MOT_LOAI_VIEC' });

    const updated = await prisma.agentNotifyTarget.update({
      where: { id: t.id }, data,
      select: {
        id: true, tenGoi: true, loaiDich: true, threadId: true,
        nhanKhachCanHoTro: true, nhanBotSuCo: true, enabled: true,
      },
    });
    xoaCacheDichBao(user.orgId);
    return reply.send({ target: updated });
  });

  // ── Gỡ nơi nhận ─────────────────────────────────────────────────────────
  app.delete('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const t = await prisma.agentNotifyTarget.findFirst({
      where: { id: req.params.id, orgId: user.orgId }, select: { id: true },
    });
    if (!t) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });

    await prisma.agentNotifyTarget.delete({ where: { id: t.id } });
    xoaCacheDichBao(user.orgId);
    return reply.send({ ok: true });
  });

  // ── GỬI THỬ — kiểm chứng thay vì đoán ───────────────────────────────────
  //
  // Vì sao cần: cấu hình đúng threadId hay không, không nhìn bằng mắt được. Bấm
  // nút này thì hoặc có tin về Zalo (đúng), hoặc trả lỗi ngay tại giao diện
  // (sai) — không phải chờ tới lúc có khách thật mới biết hỏng.
  app.post('/:id/gui-thu', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = req.user!;
    if (!laAdmin(user.role)) return reply.code(403).send({ error: 'CHI_ADMIN' });

    const t = await prisma.agentNotifyTarget.findFirst({
      where: { id: req.params.id, orgId: user.orgId },
      select: { id: true, tenGoi: true, loaiDich: true, threadId: true },
    });
    if (!t) return reply.code(404).send({ error: 'KHONG_TIM_THAY' });

    // Gửi từ một nick Zalo đang kết nối của org — bot báo bằng chính nick tiếp
    // khách, nên thử cũng phải đi bằng đường đó mới có giá trị kiểm chứng.
    const acc = await prisma.zaloAccount.findFirst({
      where: { orgId: user.orgId, status: 'connected' },
      select: { id: true },
    });
    if (!acc) return reply.code(400).send({ error: 'KHONG_CO_NICK_ZALO_KET_NOI' });

    const noiDung = [
      '[GỬI THỬ] Đây là tin kiểm tra từ CRM.',
      `Nơi nhận: ${t.tenGoi}`,
      'Nhận được tin này nghĩa là cấu hình ĐÚNG — khi bot cần người, tin báo sẽ về đây.',
    ].join('\n');

    try {
      await guiTin(
        {
          accountId: acc.id,
          threadId: t.threadId,
          threadType: t.loaiDich === 'ca_nhan' ? 0 : 1,
          zaloUid: null, tenKhach: null, sdtKhach: null,
        },
        noiDung,
        false, // không giả nhịp người — đây là tin kiểm tra, bấm là phải thấy
      );
      return reply.send({ ok: true });
    } catch (err) {
      logger.warn({ err, targetId: t.id, orgId: user.orgId }, '[agent-notify] gửi thử LỖI');
      return reply.code(502).send({
        error: 'GUI_THU_THAT_BAI',
        chiTiet: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
