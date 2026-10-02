// SPDX-License-Identifier: AGPL-3.0-or-later
// CHO KHÁCH (docs/79 T5) — REST. Hợp đồng bot ↔ CRM: docs/may-in/HOP-DONG-CHO-KHACH.md.
//
// QUẢN TRỊ (đăng ký BÊN TRONG registerBotQuyenRoutes ⇒ JWT + CHỈ owner/admin + requireActiveUser), prefix /api/v1/bot-quyen:
//   GET  /cho-khach/tai-lieu            → {kho: {soTaiLieu, luc}, taiLieu: TaiLieuView[], duyetNgoaiDanhMuc: string[]} — tài liệu
//                                       = KHO TRI THỨC CRM (knowledge_documents), băm §3b CRM tự tính, dauHieuNoiBo xét toàn văn
//   GET  /cho-khach/tai-lieu/:id/toan-van → {id, tieuDe, nguon, noiDungBam, doan: string[], dauHieuNoiBo}  (404 KHONG_CO_TAI_LIEU)
//   POST /cho-khach/tai-lieu/duyet      {taiLieu: [{id, noiDungBam}] (1..500), lyDo?} → {doi}  (id phải có trong kho ⇒ 409
//                                       KHONG_CO_TRONG_DANH_MUC; băm khác kho hiện tại / tài liệu rỗng ⇒ 409 TAI_LIEU_DA_DOI)
//   POST /cho-khach/tai-lieu/bo-duyet   {ids: string[1..500], lyDo?} → {doi}   (luôn được) — duyệt KHÔNG còn quyết đường khách
//   POST /cho-khach/tai-lieu/loai-tru   {ids: string[1..500], lyDo?} → {doi}  (chủ chốt 02/10 tối: khách dùng MỌI tài liệu TRỪ loại
//                                       trừ; id không còn trong kho ⇒ 409 KHONG_CO_TRONG_DANH_MUC, cả lô hỏng)
//   POST /cho-khach/tai-lieu/bo-loai-tru {ids: string[1..500], lyDo?} → {doi} (luôn được)
//   GET  /cho-khach/mo-ta               ?loc=co_mo_ta|da_duyet|doi_sau_duyet|tat_ca (mặc định co_mo_ta) → {danhMuc, sanPham, dem}
//   POST /cho-khach/mo-ta/duyet         {sanPham: [{productId, moTaBam}] (1..500), lyDo?} → {doi}  (băm khác danh mục ⇒ 409 MO_TA_DA_DOI)
//   POST /cho-khach/mo-ta/bo-duyet      {productIds: number[1..500], lyDo?} → {doi}  (luôn được)
// Mỗi mục đổi ghi một dòng nhật ký (doi_tuong tai_lieu_cho_khach | tai_lieu_loai_tru | mo_ta_duyet).
//
// CÔNG KHAI cho bridge của bot (x-api-key — khoá chung `public_api_key` hoặc khoá riêng `bot_ban_do_tin_api_key`; org đã đặt
// khoá riêng ⇒ CHỈ khoá riêng, 403 CAN_KHOA_RIENG_BOT — như POST /api/public/ban-do-tin):
//   POST /api/public/cho-khach/danh-muc  {phien_ban, tai_lieu?, san_pham} (≤ 8 MB) → {ok, phien_ban, so_tai_lieu, so_san_pham}
//   POST /api/public/cho-khach/tim       {truy_van, so_doan?≤5, san_pham?: {ten, ma, neo?}} → {ket_qua: [{tai_lieu_id, tieu_de,
//                                        noi_dung, diem}]} — MỌI tài liệu của org TRỪ tài liệu loại trừ (đường KHÁCH)
//   POST /api/public/tai-lieu-ky-thuat/tim  cùng thân/kết quả — MỌI tài liệu của org (đường NHÂN VIÊN)
//   GET  /api/public/cho-khach/duyet     → {phien_ban, danh_muc_phien_ban, tai_lieu_cho_khach: [{id, noi_dung_bam}], mo_ta_da_duyet: [{product_id, mo_ta_bam}]}
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/utils/logger.js';
import { xacThucKhoa, canKhoaRiengNeuCo } from './bot-thong-bao-routes.js';
import { LoiChoKhach } from './bot-cho-khach-hop-dong.js';
import {
  luuDanhMuc, docDuyetChoBot, danhSachTaiLieu, duyetTaiLieu, boDuyetTaiLieu, loaiTruTaiLieu, boLoaiTruTaiLieu, danhSachMoTa, duyetMoTa, boDuyetMoTa, toanVanTaiLieu,
} from './bot-cho-khach-service.js';
import { timChoKhach, timNoiBo } from './bot-cho-khach-kho.js';

/** Thân POST tìm — vài trăm byte là đủ. */
const TRAN_THAN_TIM = 16 * 1024;

/** Thân POST danh mục tối đa — 5.000 tài liệu × ~1 KB + 20.000 SP (đa số không có mô tả). */
export const TRAN_THAN_DANH_MUC = 8 * 1024 * 1024;

function guiLoi(reply: FastifyReply, err: unknown) {
  if (err instanceof LoiChoKhach) return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

/** Gọi TRONG registerBotQuyenRoutes (hook owner/admin của plugin đó áp cho các route này). */
export function dangKyChoKhach(app: FastifyInstance): void {
  app.get('/cho-khach/tai-lieu', async (req: FastifyRequest) => danhSachTaiLieu(req.user!.orgId));

  app.get('/cho-khach/tai-lieu/:id/toan-van', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await toanVanTaiLieu(req.user!.orgId, String((req.params as { id?: string }).id ?? '')); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/tai-lieu/duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await duyetTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/tai-lieu/bo-duyet', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await boDuyetTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/tai-lieu/loai-tru', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await loaiTruTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
  });

  app.post('/cho-khach/tai-lieu/bo-loai-tru', async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await boLoaiTruTaiLieu(req.user!.orgId, req.user!.id, req.body); } catch (err) { return guiLoi(reply, err); }
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

  // KHÔNG log truy_van (chữ khách/NV gõ).
  app.post('/api/public/cho-khach/tim', { bodyLimit: TRAN_THAN_TIM, preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await timChoKhach((request as YeuCau).orgId!, request.body);
    } catch (err) {
      if (err instanceof LoiChoKhach) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /cho-khach/tim error:', err);
      return reply.status(500).send({ error: 'Failed to search customer documents' });
    }
  });

  app.post('/api/public/tai-lieu-ky-thuat/tim', { bodyLimit: TRAN_THAN_TIM, preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await timNoiBo((request as YeuCau).orgId!, request.body);
    } catch (err) {
      if (err instanceof LoiChoKhach) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /tai-lieu-ky-thuat/tim error:', err);
      return reply.status(500).send({ error: 'Failed to search technical documents' });
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
