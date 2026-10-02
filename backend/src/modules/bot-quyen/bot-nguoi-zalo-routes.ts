// SPDX-License-Identifier: AGPL-3.0-or-later
// XƯNG HÔ NGƯỜI ZALO (docs/79 T1) — route CÔNG KHAI cho bot (đường khách, docs/79 T4):
//
//   GET /api/public/nguoi-zalo/goi?nick_uid=<uid của nick CRM nhìn>&uid=<uid người đó theo nick ấy>   (header x-api-key)
//     → 200 {goi: 'anh' | 'chi' | null, nguon: 'khoa_tay' | null}
//         anh/chi CHỈ khi Contact của (nick, uid) có giới tính NV đã XÁC NHẬN (contacts.gioi_tinh_xac_nhan_luc) — giới Zalo
//         tự điền và khoá cũ không dấu (genderLocked) KHÔNG được trả (Zalo có thể trả "Nam" mặc định cho người lạ). Nick lạ /
//         không có Contact / mâu thuẫn ⇒ null ⇒ bot xưng "mình".
//     → 400 THAM_SO_KHONG_HOP_LE   thiếu / sai dạng nick_uid, uid (chuỗi 1–64 ký tự [A-Za-z0-9_-])
//     → 401 thiếu / sai khoá · 403 CAN_KHOA_RIENG_BOT khi org đã đặt khoá riêng của bot mà gọi bằng khoá chung
//
// KHOÁ: như POST /api/public/ban-do-tin/doi-soat-echo — `public_api_key` hoặc khoá riêng `bot_ban_do_tin_api_key`; org lấy TỪ
// KHOÁ (không bao giờ từ tham số) ⇒ không đọc chéo org. Org đã đặt khoá riêng ⇒ chỉ khoá riêng (giới tính là dữ liệu cá nhân).
// KHÔNG trả gì khác: không tên, không id Contact, không giới gốc. Giới hạn 600 lần/phút (bot hỏi theo tin khách).
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { xacThucKhoa, canKhoaRiengNeuCo } from './bot-thong-bao-routes.js';
import { docGoiNguoiZalo } from './bot-quyen-goi.js';

const DANG_UID = /^[A-Za-z0-9_-]{1,64}$/;

export async function botNguoiZaloPublicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', xacThucKhoa);

  app.get('/api/public/nguoi-zalo/goi', {
    preHandler: canKhoaRiengNeuCo,
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const nickUid = q.nick_uid;
    const uid = q.uid;
    if (typeof nickUid !== 'string' || typeof uid !== 'string' || !DANG_UID.test(nickUid) || !DANG_UID.test(uid)) {
      return reply.status(400).send({ error: 'nick_uid và uid là chuỗi 1–64 ký tự [A-Za-z0-9_-]', code: 'THAM_SO_KHONG_HOP_LE' });
    }
    try {
      const orgId = (request as FastifyRequest & { orgId?: string }).orgId!;
      return await withTenant(orgId, () => docGoiNguoiZalo(orgId, nickUid, uid));
    } catch (err) {
      logger.error('[public-api] GET /nguoi-zalo/goi error:', err);
      return reply.status(500).send({ error: 'Failed to read form of address' });
    }
  });
}
