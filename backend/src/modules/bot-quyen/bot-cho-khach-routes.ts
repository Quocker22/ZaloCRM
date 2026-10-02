// SPDX-License-Identifier: AGPL-3.0-or-later
// CHO KHÁCH (docs/79 T5) — REST. Hợp đồng bot ↔ CRM: docs/may-in/HOP-DONG-CHO-KHACH.md.
//
// QUẢN TRỊ (đăng ký BÊN TRONG registerBotQuyenRoutes ⇒ JWT + CHỈ owner/admin + requireActiveUser), prefix /api/v1/bot-quyen:
//   GET  /cho-khach/tai-lieu            → {danhMuc: {phienBan, luc} | null, taiLieu: TaiLieuView[], duyetNgoaiDanhMuc: string[]}
//   POST /cho-khach/tai-lieu/duyet      {taiLieu: [{id, noiDungBam}] (1..500), lyDo?} → {doi}  (id phải có trong danh mục; chưa có
//                                       ⇒ 409; băm khác danh mục / tài liệu rỗng ⇒ 409 TAI_LIEU_DA_DOI)
//   POST /cho-khach/tai-lieu/bo-duyet   {ids: string[1..500], lyDo?} → {doi}   (luôn được)
//   GET  /cho-khach/mo-ta               ?loc=co_mo_ta|da_duyet|doi_sau_duyet|tat_ca (mặc định co_mo_ta) → {danhMuc, sanPham, dem}
//   POST /cho-khach/mo-ta/duyet         {sanPham: [{productId, moTaBam}] (1..500), lyDo?} → {doi}  (băm khác danh mục ⇒ 409 MO_TA_DA_DOI)
//   POST /cho-khach/mo-ta/bo-duyet      {productIds: number[1..500], lyDo?} → {doi}  (luôn được)
// Mỗi mục đổi ghi một dòng nhật ký (doi_tuong tai_lieu_cho_khach | mo_ta_duyet).
//
// CÔNG KHAI cho bridge của bot (x-api-key — khoá chung `public_api_key` hoặc khoá riêng `bot_ban_do_tin_api_key`; org đã đặt
// khoá riêng ⇒ CHỈ khoá riêng, 403 CAN_KHOA_RIENG_BOT — như POST /api/public/ban-do-tin):
//   POST /api/public/cho-khach/danh-muc  {phien_ban, tai_lieu, san_pham} (≤ 8 MB) → {ok, phien_ban, so_tai_lieu, so_san_pham}
//   GET  /api/public/cho-khach/duyet     → {phien_ban, danh_muc_phien_ban, tai_lieu_cho_khach: [{id, noi_dung_bam}], mo_ta_da_duyet: [{product_id, mo_ta_bam}]}
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/utils/logger.js';
import { xacThucKhoa, canKhoaRiengNeuCo } from './bot-thong-bao-routes.js';
import { LoiChoKhach } from './bot-cho-khach-hop-dong.js';
import {
  luuDanhMuc, docDuyetChoBot, danhSachTaiLieu, duyetTaiLieu, boDuyetTaiLieu, danhSachMoTa, duyetMoTa, boDuyetMoTa,
} from './bot-cho-khach-service.js';

/** Thân POST danh mục tối đa — 5.000 tài liệu × ~1 KB + 20.000 SP (đa số không có mô tả). */
export const TRAN_THAN_DANH_MUC = 8 * 1024 * 1024;

function guiLoi(reply: FastifyReply, err: unknown) {
  if (err instanceof LoiChoKhach) return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

/** Gọi TRONG registerBotQuyenRoutes (hook owner/admin của plugin đó áp cho các route này). */
export function dangKyChoKhach(app: FastifyInstance): void {
  app.get('/cho-khach/tai-lieu', async (req: FastifyRequest) => danhSachTaiLieu(req.user!.orgId));

  app.post('/cho-khach/tai-lieu/duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await duyetTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/tai-lieu/bo-duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await boDuyetTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.get('/cho-khach/mo-ta', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await danhSachMoTa(req.user!.orgId, ((req.query ?? {}) as Record<string, unknown>).loc);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/mo-ta/duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await duyetMoTa(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/mo-ta/bo-duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await boDuyetMoTa(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });
}

type YeuCau = FastifyRequest & { orgId?: string; apiKeyId?: string };

export async function botChoKhachPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', xacThucKhoa);

  app.post('/api/public/cho-khach/danh-muc', { bodyLimit: TRAN_THAN_DANH_MUC, preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const r = request as YeuCau;
      return await luuDanhMuc(r.orgId!, request.body, r.apiKeyId ?? null);
    } catch (err) {
      if (err instanceof LoiChoKhach) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /cho-khach/danh-muc error:', err);
      return reply.status(500).send({ error: 'Failed to store customer catalogue' });
    }
  });

  app.get('/api/public/cho-khach/duyet', { preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await docDuyetChoBot((request as YeuCau).orgId!);
    } catch (err) {
      logger.error('[public-api] GET /cho-khach/duyet error:', err);
      return reply.status(500).send({ error: 'Failed to fetch customer approvals' });
    }
  });
}
