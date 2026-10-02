// SPDX-License-Identifier: AGPL-3.0-or-later
// THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — REST.
//
// QUẢN TRỊ (đăng ký BÊN TRONG registerBotQuyenRoutes ⇒ cùng preHandler: JWT + CHỈ owner/admin + requireActiveUser),
// prefix /api/v1/bot-quyen:
//   GET    /luat-thong-bao              — {luat, banDo: {phienBan, luc} | null, canhBao} (canhBao = đúng cảnh báo bot nhận)
//   POST   /luat-thong-bao              {loai, dich?, cheDo?, dieuKien?, gomGiay?, lich?, lyDo?} → 201 (mặc định cheDo=bong)
//   PUT    /luat-thong-bao/:id          {phienBan, dich?, cheDo?, dieuKien?, gomGiay?, lich?, lyDo?}  (thiếu phienBan ⇒ 400, cũ ⇒ 409)
//   DELETE /luat-thong-bao/:id          {lyDo?}
//   GET    /ban-do-tin                  — ảnh chụp mới nhất (danh mục composer + số đếm) cho trang Bản đồ tin
// `dich` = [{kieu: chuc_nang|nv|nguoi_gay_ra, gia_tri}] — kiểm cứng ở bot-thong-bao-luat.ts. Đích nv/nguoi_gay_ra bot KIỂM LẠI
// quyền + tạm im của người nhận lúc gửi (CRM chỉ kiểm lúc lưu).
//
// CÔNG KHAI cho bridge của bot (x-api-key):
//   GET  /api/public/bot-thong-bao/luat → {phien_ban, luat:[{id, loai, dich, che_do, dieu_kien, gom_giay, lich, phien_ban}], canh_bao}
//   POST /api/public/ban-do-tin         {phien_ban, composer:[…], nguon?:[…], dem:[…]} → {ok, phien_ban, so_composer}  (≤ 1 MB;
//                                       hợp đồng docs/78 hop-dong-ban-do-tin.md; gỡ nhạy cảm/mở khoá composer đã biết ⇒ 409
//                                       NHAY_CAM_DINH; nhật ký ban_do_tin). dem[].luat_id = id luật (GET trả `id`); `loai` còn
//                                       nhận MỘT bản ⇒ CRM đổi sang id lúc lưu.
//   POST /api/public/ban-do-tin/doi-soat-echo {echo_ids: string[≤200]} → {co, that_bai, khong} — CHỈ ĐỌC: echo nào đã có tin
//                                       gửi đi (messages.client_echo_id) trong org; that_bai = tin lưu với sendStatus failed.
//                                       Cùng luật khoá như POST ảnh chụp (có khoá riêng ⇒ chỉ khoá riêng).
// KHOÁ (Codex v1 #1 — ảnh chụp quyết rào nhạy cảm): nhận `public_api_key` (chung mọi tích hợp) HOẶC `bot_ban_do_tin_api_key`
// (khoá RIÊNG của bot, app_settings). Org đã đặt khoá riêng ⇒ POST ảnh chụp CHỈ nhận khoá riêng (khoá chung ⇒ 403
// CAN_KHOA_RIENG_BOT); GET luật nhận cả hai. Ảnh chụp ĐẦU TIÊN được tin — nên đặt khoá riêng TRƯỚC lần đẩy đầu.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { LoiLuatThongBao } from './bot-thong-bao-luat.js';
import { danhSachLuat, docBanDo, taoLuat, suaLuat, xoaLuat, docLuatChoBot, luuAnhChup, doiSoatEcho } from './bot-thong-bao-service.js';

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

/** app_settings.setting_key của khoá riêng bot (đẩy ảnh chụp bản đồ tin). */
export const KHOA_RIENG_BOT = 'bot_ban_do_tin_api_key';

type YeuCauCoKhoa = FastifyRequest & { orgId?: string; apiKeyId?: string; khoaRieng?: boolean };

/** Xác thực x-api-key: khoá chung `public_api_key` hoặc khoá riêng của bot. Gắn orgId, apiKeyId, khoaRieng. */
async function xacThucKhoa(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey !== 'string' || !apiKey) return reply.status(401).send({ error: 'API key required' });
  const setting = await prisma.appSetting.findFirst({
    where: { settingKey: { in: ['public_api_key', KHOA_RIENG_BOT] }, valuePlain: apiKey },
    select: { id: true, orgId: true, settingKey: true },
  });
  if (!setting) return reply.status(401).send({ error: 'Invalid API key' });
  const r = request as YeuCauCoKhoa;
  r.orgId = setting.orgId;
  r.apiKeyId = setting.id;
  r.khoaRieng = setting.settingKey === KHOA_RIENG_BOT;
}

/** POST ảnh chụp: org đã có khoá riêng của bot ⇒ chỉ nhận khoá đó. */
async function canKhoaRiengNeuCo(request: FastifyRequest, reply: FastifyReply) {
  const r = request as YeuCauCoKhoa;
  if (r.khoaRieng) return;
  const co = await prisma.appSetting.findFirst({ where: { orgId: r.orgId!, settingKey: KHOA_RIENG_BOT }, select: { id: true } });
  if (co) {
    return reply.status(403).send({
      error: 'Tổ chức này đã đặt khoá riêng cho bot (bot_ban_do_tin_api_key) — ảnh chụp bản đồ tin phải gửi bằng khoá đó',
      code: 'CAN_KHOA_RIENG_BOT',
    });
  }
}

export async function botThongBaoPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', xacThucKhoa);

  app.get('/api/public/bot-thong-bao/luat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await docLuatChoBot((request as unknown as { orgId: string }).orgId);
    } catch (err) {
      logger.error('[public-api] GET /bot-thong-bao/luat error:', err);
      return reply.status(500).send({ error: 'Failed to fetch notification rules' });
    }
  });

  app.post('/api/public/ban-do-tin', { bodyLimit: TRAN_THAN_ANH_CHUP, preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const r = request as unknown as { orgId: string; apiKeyId?: string };
      return await luuAnhChup(r.orgId, request.body, r.apiKeyId ?? null);
    } catch (err) {
      if (err instanceof LoiLuatThongBao) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /ban-do-tin error:', err);
      return reply.status(500).send({ error: 'Failed to store message map snapshot' });
    }
  });

  app.post('/api/public/ban-do-tin/doi-soat-echo', { preHandler: canKhoaRiengNeuCo }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await doiSoatEcho((request as unknown as { orgId: string }).orgId, request.body);
    } catch (err) {
      if (err instanceof LoiLuatThongBao) return reply.code(err.status).send({ error: err.message, code: err.code });
      logger.error('[public-api] POST /ban-do-tin/doi-soat-echo error:', err);
      return reply.status(500).send({ error: 'Failed to reconcile echo ids' });
    }
  });
}
