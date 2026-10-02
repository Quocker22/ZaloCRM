// SPDX-License-Identifier: AGPL-3.0-or-later
// THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — REST.
//
// QUẢN TRỊ (đăng ký BÊN TRONG registerBotQuyenRoutes ⇒ cùng preHandler: JWT + CHỈ owner/admin + requireActiveUser),
// prefix /api/v1/bot-quyen:
//   GET    /luat-thong-bao              — {luat, banDo: {phienBan, luc} | null}
//   POST   /luat-thong-bao              {loai, dich?, cheDo?, dieuKien?, gomGiay?, lich?, lyDo?} → 201 (mặc định cheDo=bong)
//   PUT    /luat-thong-bao/:id          {dich?, cheDo?, dieuKien?, gomGiay?, lich?, phienBan?, lyDo?}  (phienBan cũ ⇒ 409)
//   DELETE /luat-thong-bao/:id          {lyDo?}
//   GET    /ban-do-tin                  — ảnh chụp mới nhất (danh mục composer + số đếm) cho trang Bản đồ tin
// `dich` = [{kieu: chuc_nang|nv|nguoi_gay_ra, gia_tri}] — kiểm cứng ở bot-thong-bao-luat.ts.
//
// CÔNG KHAI cho bridge của bot (x-api-key — cùng cơ chế /api/public/bot-quyen):
//   GET  /api/public/bot-thong-bao/luat → {phien_ban, luat:[{loai, dich, che_do, dieu_kien, gom_giay, lich, phien_ban}], canh_bao}
//   POST /api/public/ban-do-tin         {phien_ban, composer:[…], dem:[…]} → {ok, phien_ban, so_composer}  (≤ 1 MB)
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { apiKeyAuth } from '../api/public-api-routes.js';
import { logger } from '../../shared/utils/logger.js';
import { LoiLuatThongBao } from './bot-thong-bao-luat.js';
import { danhSachLuat, docBanDo, taoLuat, suaLuat, xoaLuat, docLuatChoBot, luuAnhChup } from './bot-thong-bao-service.js';

/** Thân POST ảnh chụp tối đa — 300 composer × ~4 KB chữ + 5.000 dòng đếm. */
export const TRAN_THAN_ANH_CHUP = 1024 * 1024;

function guiLoi(reply: FastifyReply, err: unknown) {
  if (err instanceof LoiLuatThongBao) return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

type P<T> = { Params: T };

/** Gọi TRONG registerBotQuyenRoutes (hook owner/admin của plugin đó áp cho các route này). */
export function dangKyLuatThongBao(app: FastifyInstance): void {
  app.get('/luat-thong-bao', async (req: FastifyRequest) => danhSachLuat(req.user!.orgId));

  app.post('/luat-thong-bao', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.code(201).send({ luat: await taoLuat(req.user!.orgId, req.user!.id, req.body) });
    } catch (err) { return guiLoi(reply, err); }
  });

  app.put('/luat-thong-bao/:id', async (req: FastifyRequest<P<{ id: string }>>, reply: FastifyReply) => {
    try {
      return { luat: await suaLuat(req.user!.orgId, req.user!.id, req.params.id, req.body) };
    } catch (err) { return guiLoi(reply, err); }
  });

  app.delete('/luat-thong-bao/:id', async (req: FastifyRequest<P<{ id: string }>>, reply: FastifyReply) => {
    try {
      return await xoaLuat(req.user!.orgId, req.user!.id, req.params.id, req.body);
    } catch (err) { return guiLoi(reply, err); }
  });

  app.get('/ban-do-tin', async (req: FastifyRequest) => ({ banDo: await docBanDo(req.user!.orgId) }));
}

export async function botThongBaoPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', apiKeyAuth);

  app.get('/api/public/bot-thong-bao/luat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await docLuatChoBot((request as unknown as { orgId: string }).orgId);
    } catch (err) {
      logger.error('[public-api] GET /bot-thong-bao/luat error:', err);
      return reply.status(500).send({ error: 'Failed to fetch notification rules' });
    }
  });

  app.post('/api/public/ban-do-tin', { bodyLimit: TRAN_THAN_ANH_CHUP }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await luuAnhChup((request as unknown as { orgId: string }).orgId, request.body);
    } catch (err) {
      if (err instanceof LoiLuatThongBao) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /ban-do-tin error:', err);
      return reply.status(500).send({ error: 'Failed to store message map snapshot' });
    }
  });
}
