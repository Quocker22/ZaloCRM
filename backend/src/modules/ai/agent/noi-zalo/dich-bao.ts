// SPDX-License-Identifier: AGPL-3.0-or-later
// NƠI NHẬN THÔNG BÁO — bot cần người hỗ trợ khách thì báo cho AI.
//
// Bug gốc (11/08/2026, anh Quốc): việc báo nhân viên đi qua ĐÚNG MỘT biến
// môi trường AI_AGENT_THREAD_BAO_SALE — một nhóm Zalo cố định. Muốn đổi người
// nhận phải sửa env trên server rồi restart, và không phân được ai nhận việc
// gì. Bảng agent_notify_targets đưa việc đó lên giao diện.
//
// ═══ THỨ TỰ ƯU TIÊN (quan trọng — đọc kỹ trước khi sửa) ════════════════════
//   1. CÓ ít nhất một đích enabled trong DB hợp loại việc → DÙNG DB, BỎ env.
//   2. DB rỗng (chưa ai cấu hình gì) → RƠI VỀ env AI_AGENT_THREAD_BAO_SALE.
//   3. DB lỗi → cũng rơi về env. Một blip DB không được nuốt mất tin báo.
//   4. Không có cả hai → mảng rỗng, caller chỉ còn log để dò.
//
// KHÔNG cộng dồn DB + env: cộng dồn thì ngày anh Quốc thêm đích trên giao diện,
// nhóm cũ trong env vẫn nhận tin — không có cách nào tắt nó ngoài sửa server,
// đúng cái vấn đề đang đi chữa.
//
// Cache RAM 60s cùng lý do với agent-operator-service: mỗi tin khách là một lần
// hỏi đích, không đáng một round-trip DB. Admin sửa qua API thì `xoaCacheDichBao`
// cho hiệu lực TỨC THÌ, không phải chờ hết TTL.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * Loại việc bot báo. Giá trị ghi thẳng vào DB/khoá cache nên KHÔNG đổi tuỳ tiện.
 *
 * Tách hai loại vì hai người khác nhau quan tâm:
 *   khach_can_ho_tro  người TRỰC KHÁCH cần biết — khách gửi ảnh/voice/file/
 *                     link/danh thiếp, khách bực/chửi, bot xin chuyển sale.
 *   bot_su_co         người KỸ THUẬT cần biết — bot bí không trả lời được, lỗi
 *                     sau khi gọi tool, khách vượt giới hạn tin.
 * Một đích có thể bật cả hai (mặc định), nên ai muốn nhận tất thì không phải
 * làm gì thêm.
 */
export const LOAI_VIEC = {
  KHACH_CAN_HO_TRO: 'khach_can_ho_tro',
  BOT_SU_CO: 'bot_su_co',
} as const;

export type LoaiViec = (typeof LOAI_VIEC)[keyof typeof LOAI_VIEC];

/** Một nơi nhận tin báo, đã quy về dạng gửi Zalo hiểu được. */
export interface DichBao {
  threadId: string;
  threadType: 0 | 1;
  /** Tên gọi để log/giao diện đọc được là đang gửi cho ai. */
  tenGoi: string;
}

const TTL_MS = 60_000;
interface MucCache { dich: DichBao[]; hetHan: number }
const cache = new Map<string, MucCache>();

/** Khoá cache gồm CẢ loại việc — hai loại lọc khác nhau, kết quả khác nhau. */
function khoa(orgId: string, loaiViec: LoaiViec): string {
  return `${orgId}::${loaiViec}`;
}

/** Đích khai trong env — lớp tương thích ngược, giữ tới khi bảng chạy ổn. */
function dichEnv(): DichBao[] {
  const threadId = process.env.AI_AGENT_THREAD_BAO_SALE;
  if (!threadId) return [];
  return [{
    threadId,
    threadType: process.env.AI_AGENT_THREAD_BAO_SALE_LOAI === '0' ? 0 : 1,
    tenGoi: 'env AI_AGENT_THREAD_BAO_SALE',
  }];
}

/**
 * Xoá cache đích của một org (mọi loại việc) — gọi sau khi admin thêm/sửa/xoá.
 * Không truyền orgId → xoá sạch (dùng trong test).
 */
export function xoaCacheDichBao(orgId?: string): void {
  if (!orgId) { cache.clear(); return; }
  for (const k of cache.keys()) {
    if (k.startsWith(`${orgId}::`)) cache.delete(k);
  }
}

/**
 * Danh sách nơi nhận tin báo cho một org + một loại việc.
 *
 * KHÔNG BAO GIỜ ném: báo hỏng không được làm vỡ luồng trả khách. Mọi đường lỗi
 * đều rơi về env rồi về mảng rỗng.
 */
export async function layDichBao(orgId: string, loaiViec: LoaiViec): Promise<DichBao[]> {
  // Caller cũ chưa truyền orgId → không tra DB được, dùng thẳng env.
  if (!orgId) return dichEnv();

  const k = khoa(orgId, loaiViec);
  const muc = cache.get(k);
  if (muc && muc.hetHan > Date.now()) return muc.dich;

  let dich: DichBao[];
  try {
    const rows = await prisma.agentNotifyTarget.findMany({
      where: {
        orgId,
        enabled: true,
        // Lọc theo loại việc NGAY trong truy vấn: đích không nhận loại này thì
        // không được lọt ra rồi lọc ở RAM — dễ quên, dễ rò.
        ...(loaiViec === LOAI_VIEC.BOT_SU_CO
          ? { nhanBotSuCo: true }
          : { nhanKhachCanHoTro: true }),
      },
      select: { id: true, tenGoi: true, loaiDich: true, threadId: true },
      orderBy: { createdAt: 'asc' },
    });
    dich = rows.map((r) => ({
      threadId: r.threadId,
      threadType: r.loaiDich === 'ca_nhan' ? (0 as const) : (1 as const),
      tenGoi: r.tenGoi,
    }));
    // DB rỗng → chưa ai cấu hình gì → giữ nguyên hành vi cũ bằng env.
    if (dich.length === 0) dich = dichEnv();
  } catch (err) {
    logger.warn({ err, orgId, loaiViec }, '[dich-bao] đọc DB lỗi — rơi về env AI_AGENT_THREAD_BAO_SALE');
    // KHÔNG cache đường lỗi: lần sau phải thử lại DB.
    return dichEnv();
  }

  cache.set(k, { dich, hetHan: Date.now() + TTL_MS });
  return dich;
}
