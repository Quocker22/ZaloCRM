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
//   DELETE /nhom/:conversationId              {lyDo}           — bỏ xếp tường minh ⇒ về MẶC ĐỊNH (docs/77 §8; không có
//                                                               mặc định ⇒ chưa xếp loại, bot im)
//   POST   /nhom/:conversationId/doc-lai                      — xếp hàng đọc lại danh sách thành viên (mặc định)
//   GET    /nguoi-da-nhan                     ?tuKhoa=&trang=&moiTrang=&lamMoi=1 — người đã nhắn cho shop, chưa gán
//   GET    /nhan-vien
//   POST   /nhan-vien                         {zaloUid, zaloUids?, tenGoi, vai, trangThai?, userId?, ghiChu?, lyDo?}
//                                             (zaloUids = uid cùng người ở nick khác; máy tự thêm uid nhận ra được — §8b)
//   PUT    /nhan-vien/:id                     {tenGoi?, vai?, trangThai?, userId?, ghiChu?, lyDo?}
//   POST   /nhan-vien/:id/uid                 {zaloUid? | zaloUids?, lyDo} — thêm uid của CÙNG người ở nick khác (§8b);
//                                             lyDo BẮT BUỘC; uid phải đã thấy trong tin, không là nick CRM (§8b-an-toàn)
//   DELETE /nhan-vien/:id/uid/:uid            {lyDo} — GỠ uid (không gỡ uid chính) + ghi từ chối (máy không nối lại)
//   POST   /nhan-vien/:id/de-xuat/:uid/noi    {lyDo?} — chủ xác nhận đề xuất ⇒ uid nguon chu_xac_nhan
//   POST   /nhan-vien/:id/de-xuat/:uid/tu-choi {lyDo?} — "Không phải" ⇒ xoá đề xuất + ghi từ chối
//   POST   /nhom/:conversationId/nick-crm     {zaloUid, nickId, lyDo?} — "Đây là nick CRM …" (uid nhìn từ nick của nhóm)
//   DELETE /nhom/:conversationId/nick-crm/:zaloUid {lyDo} — gỡ (máy không nhận lại)
//   GET    /nhat-ky                           ?limit= (mặc định 100, tối đa 500)
//
// Lỗi: {error: <câu tiếng Việt cho người dùng>, code: <MÃ>} — mã ở bot-quyen-service.ts.
// Bot áp thay đổi trong ~1 phút (bridge poll GET /api/public/bot-quyen).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, requireActiveUser } from '../auth/auth-middleware.js';
import {
  LoiBotQuyen, danhSachNhom, datChucNangNhom, boXepLoaiNhom,
  danhSachNhanVien, themNhanVien, suaNhanVien, themUidNhanVien, goUidNhanVien, noiDeXuat, tuChoiDeXuat, docNhatKy,
} from './bot-quyen-service.js';
import { danhDauNickCrm, goNickCrm, LoiNickCrm } from './bot-quyen-nick-crm.js';
import { logger } from '../../shared/utils/logger.js';
import { layThanhVienNhom, docThanhVienZaloMacDinh, type DocThanhVienZalo } from './bot-quyen-thanh-vien.js';
import { yeuCauDocLai, ghiNhanDoiMacDinh } from './bot-quyen-danh-sach.js';
import { danhSachNguoiDaNhan } from './bot-quyen-nguoi-da-nhan.js';
import { buildPrivacyContext } from '../privacy/redact.js';

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
  if (err instanceof LoiBotQuyen || err instanceof LoiNickCrm) return reply.code(err.status).send({ error: err.message, code: err.code });
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
      const kq = await boXepLoaiNhom(req.user!.orgId, req.user!.id, req.params.conversationId, req.body);
      // Về mặc định ⇒ cần bản đọc danh sách tươi (nhóm chưa từng đọc / bản cũ lỗi).
      if (kq.doi) await yeuCauDocLai(req.user!.orgId, req.params.conversationId).catch(() => false);
      return kq;
    } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/nhom/:conversationId/doc-lai', async (req: FastifyRequest<P<{ conversationId: string }>>, reply: FastifyReply) => {
    const ok = await yeuCauDocLai(req.user!.orgId, req.params.conversationId);
    if (!ok) return reply.code(404).send({ error: 'Không tìm thấy hội thoại nhóm này', code: 'KHONG_TIM_THAY_NHOM' });
    return { ok: true };
  });

  // ── Người đã nhắn cho shop (chờ gán) ──────────────────────────────────────

  // Có tên + tin cuối của khách ⇒ nick Riêng tư che theo người xem (review P1-3); `contentClass` để privacy-leak-guard
  // quét response này.
  app.get('/nguoi-da-nhan', { config: { contentClass: 'mixed' } }, async (
    req: FastifyRequest<{ Querystring: { tuKhoa?: string; trang?: string; moiTrang?: string; lamMoi?: string } }>,
  ) => {
    const q = req.query;
    const so = (x: string | undefined) => (x === undefined ? undefined : Number.parseInt(x, 10));
    return danhSachNguoiDaNhan(req.user!.orgId, {
      ctx: await buildPrivacyContext(req),
      tuKhoa: typeof q.tuKhoa === 'string' ? q.tuKhoa.slice(0, 100) : undefined,
      trang: so(q.trang),
      moiTrang: so(q.moiTrang),
      lamMoi: q.lamMoi === '1' || q.lamMoi === 'true',
    });
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

  app.post('/nhan-vien/:id/uid', async (req: FastifyRequest<P<{ id: string }>>, reply: FastifyReply) => {
    try {
      return await themUidNhanVien(req.user!.orgId, req.user!.id, req.params.id, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.delete('/nhan-vien/:id/uid/:uid', async (req: FastifyRequest<P<{ id: string; uid: string }>>, reply: FastifyReply) => {
    try {
      return await goUidNhanVien(req.user!.orgId, req.user!.id, req.params.id, req.params.uid, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/nhan-vien/:id/de-xuat/:uid/noi', async (req: FastifyRequest<P<{ id: string; uid: string }>>, reply: FastifyReply) => {
    try {
      return await noiDeXuat(req.user!.orgId, req.user!.id, req.params.id, req.params.uid, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/nhan-vien/:id/de-xuat/:uid/tu-choi', async (req: FastifyRequest<P<{ id: string; uid: string }>>, reply: FastifyReply) => {
    try {
      return await tuChoiDeXuat(req.user!.orgId, req.user!.id, req.params.id, req.params.uid, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  // ── Nick CRM nhìn từ nick khác (§8b-an-toàn) ──────────────────────────────

  app.post('/nhom/:conversationId/nick-crm', async (req: FastifyRequest<P<{ conversationId: string }>>, reply: FastifyReply) => {
    try {
      const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const chu = (x: unknown, ten: string) => {
        if (typeof x !== 'string' || !x.trim() || x.length > 64) throw new LoiNickCrm(400, 'DU_LIEU_KHONG_HOP_LE', `${ten} không hợp lệ`);
        return x.trim();
      };
      const lyDo = typeof b.lyDo === 'string' && b.lyDo.trim() ? b.lyDo.trim().slice(0, 500) : null;
      const kq = await danhDauNickCrm(req.user!.orgId, req.user!.id, req.params.conversationId, chu(b.zaloUid, 'zaloUid'), chu(b.nickId, 'nickId'), lyDo);
      if (kq.doi) await ghiNhanDoiMacDinh(req.user!.orgId).catch((e) => logger.warn('[bot-quyen] ghi nhận mặc định lỗi:', e));
      return kq;
    } catch (err) { return guiLoi(reply, err); }
  });

  app.delete('/nhom/:conversationId/nick-crm/:zaloUid', async (
    req: FastifyRequest<P<{ conversationId: string; zaloUid: string }>>, reply: FastifyReply,
  ) => {
    try {
      const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const lyDo = typeof b.lyDo === 'string' ? b.lyDo.trim().slice(0, 500) : '';
      if (!lyDo) throw new LoiNickCrm(400, 'THIEU_LY_DO', 'Cần ghi lý do khi gỡ nick CRM');
      const kq = await goNickCrm(req.user!.orgId, req.user!.id, req.params.conversationId, req.params.zaloUid, lyDo);
      if (kq.doi) await ghiNhanDoiMacDinh(req.user!.orgId).catch((e) => logger.warn('[bot-quyen] ghi nhận mặc định lỗi:', e));
      return kq;
    } catch (err) { return guiLoi(reply, err); }
  });

  // ── Nhật ký ───────────────────────────────────────────────────────────────

  app.get('/nhat-ky', async (req: FastifyRequest<{ Querystring: { limit?: string } }>) => (
    { nhatKy: await docNhatKy(req.user!.orgId, req.query.limit) }
  ));
}
