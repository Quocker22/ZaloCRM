// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §3.2) — REST quản trị cho trang Cài đặt › Hệ thống › "Quyền bot".
//
// Mount prefix: /api/v1/bot-quyen — JWT, CHỈ owner/admin CRM (mọi route, kể cả đọc: ai là admin
// với bot, nhóm nào được hỏi lãi… là thông tin nhạy cảm). Kiểm role như agent-operator-routes.ts,
// cộng requireActiveUser (user bị khoá hết quyền ngay, không đợi token hết hạn).
//
//   GET    /nhom                              ?zaloAccountId=  — mọi hội thoại nhóm + chức năng
//   GET    /nhom/:conversationId/thanh-vien   ?lamMoi=1        — thành viên + nhãn NV / nick / người ngoài
//   PUT    /nhom/:conversationId              {chucNang, tenDangKy?, ghiChu?, lyDo?}
//   DELETE /nhom/:conversationId              {lyDo}           — bỏ xếp loại (bot im)
//   GET    /nhan-vien
//   POST   /nhan-vien                         {zaloUid, tenGoi, vai, trangThai?, userId?, ghiChu?, lyDo?}
//   PUT    /nhan-vien/:id                     {tenGoi?, vai?, trangThai?, userId?, ghiChu?, lyDo?}
//   GET    /nhat-ky                           ?limit= (mặc định 100, tối đa 500)
//
// Lỗi: {error: <câu tiếng Việt cho người dùng>, code: <MÃ>} — mã ở bot-quyen-service.ts.
// Bot áp thay đổi trong ~1 phút (bridge poll GET /api/public/bot-quyen).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, requireActiveUser } from '../auth/auth-middleware.js';
import {
  LoiBotQuyen, danhSachNhom, datChucNangNhom, boXepLoaiNhom,
  danhSachNhanVien, themNhanVien, suaNhanVien, docNhatKy,
} from './bot-quyen-service.js';
import { layThanhVienNhom, docThanhVienZaloMacDinh, type DocThanhVienZalo } from './bot-quyen-thanh-vien.js';

export interface BotQuyenRoutesOpts {
  /** Đọc thành viên nhóm trực tiếp từ Zalo — mặc định qua zaloOps; test tiêm hàm giả. */
  docThanhVienZalo?: DocThanhVienZalo;
  /** Hạn giờ gọi Zalo (ms) — mặc định HET_GIO_ZALO_MS (10 s); test đặt ngắn. */
  hetGioZaloMs?: number;
}

function laAdmin(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

async function chiOwnerAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!laAdmin(req.user?.role)) {
    return reply.code(403).send({ error: 'Chỉ owner/admin được quản lý quyền bot', code: 'CHI_ADMIN' });
  }
}

function guiLoi(reply: FastifyReply, err: unknown) {
  if (err instanceof LoiBotQuyen) return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

type P<T> = { Params: T };

export async function registerBotQuyenRoutes(app: FastifyInstance, opts: BotQuyenRoutesOpts = {}): Promise<void> {
  const docZalo = opts.docThanhVienZalo ?? docThanhVienZaloMacDinh;
  const hetGioMs = opts.hetGioZaloMs;

  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', chiOwnerAdmin);
  app.addHook('preHandler', requireActiveUser);

  // ── Nhóm ──────────────────────────────────────────────────────────────────

  app.get('/nhom', async (req: FastifyRequest<{ Querystring: { zaloAccountId?: string } }>) => {
    const zaloAccountId = typeof req.query.zaloAccountId === 'string' && req.query.zaloAccountId
      ? req.query.zaloAccountId : undefined;
    return { nhom: await danhSachNhom(req.user!.orgId, { zaloAccountId }) };
  });

  app.get('/nhom/:conversationId/thanh-vien', async (
    req: FastifyRequest<P<{ conversationId: string }> & { Querystring: { lamMoi?: string } }>,
    reply: FastifyReply,
  ) => {
    const lamMoi = req.query.lamMoi === '1' || req.query.lamMoi === 'true';
    const kq = await layThanhVienNhom(req.user!.orgId, req.params.conversationId, { lamMoi, docZalo, hetGioMs });
    if (!kq) return reply.code(404).send({ error: 'Không tìm thấy hội thoại nhóm này', code: 'KHONG_TIM_THAY_NHOM' });
    return kq;
  });

  app.put('/nhom/:conversationId', async (req: FastifyRequest<P<{ conversationId: string }>>, reply: FastifyReply) => {
    try {
      return await datChucNangNhom(req.user!.orgId, req.user!.id, req.params.conversationId, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.delete('/nhom/:conversationId', async (req: FastifyRequest<P<{ conversationId: string }>>, reply: FastifyReply) => {
    try {
      return await boXepLoaiNhom(req.user!.orgId, req.user!.id, req.params.conversationId, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  // ── Nhân viên ─────────────────────────────────────────────────────────────

  app.get('/nhan-vien', async (req: FastifyRequest) => ({ nhanVien: await danhSachNhanVien(req.user!.orgId) }));

  app.post('/nhan-vien', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const nhanVien = await themNhanVien(req.user!.orgId, req.user!.id, req.body);
      return reply.code(201).send({ nhanVien });
    } catch (err) { return guiLoi(reply, err); }
  });

  app.put('/nhan-vien/:id', async (req: FastifyRequest<P<{ id: string }>>, reply: FastifyReply) => {
    try {
      return await suaNhanVien(req.user!.orgId, req.user!.id, req.params.id, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  // ── Nhật ký ───────────────────────────────────────────────────────────────

  app.get('/nhat-ky', async (req: FastifyRequest<{ Querystring: { limit?: string } }>) => (
    { nhatKy: await docNhatKy(req.user!.orgId, req.query.limit) }
  ));
}
