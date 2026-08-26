// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÂN VIÊN ĐƯỢC SAI BOT — nguồn sự thật cho "UID này có phải nhân viên không".
//
// Thay env AI_AGENT_UID_NHANVIEN (spec 06/08/2026). Bug gốc: danh sách cứng
// trong env, sửa phải deploy → nhân viên mới (Trần Hưng) bị xử như KHÁCH, bot
// đi tư vấn SP thay vì báo cáo.
//
// KIẾN TRÚC — vì sao cache RAM + hàm ĐỒNG BỘ:
//   Cổng bảo mật `nhanDienLenhNhanVien` là hàm đồng bộ, gọi ở nhiều nơi trong
//   đường đi một tin. Async hoá nó = async hoá cả chuỗi + query DB mỗi tin.
//   Thay vào đó: nạp toàn bộ UID nhân viên per-org vào Set trong RAM, làm mới
//   ngầm mỗi 60s. Cổng đọc Set — vẫn đồng bộ, vẫn là ranh giới CODE (quy tắc 2).
//   Đổi giá: thêm nhân viên có độ trễ tối đa 60s — TRỪ KHI admin thao tác qua
//   API, lúc đó `xoaCache` cho hiệu lực tức thì.
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

interface MucCache {
  uids: Set<string>;
  hetHan: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, MucCache>();

/** UID nhân viên khai trong env — tương thích ngược, hợp nhất với DB. */
function uidEnv(): Set<string> {
  return new Set(
    (process.env.AI_AGENT_UID_NHANVIEN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Nạp UID nhân viên của một org từ DB vào cache. Lỗi DB → GIỮ cache cũ (nếu
 * có), không để nick nào mất quyền vì một blip DB.
 */
export async function napCache(orgId: string): Promise<void> {
  try {
    const rows = await prisma.agentOperator.findMany({
      where: { orgId, enabled: true },
      select: { zaloUid: true },
    });
    cache.set(orgId, {
      uids: new Set(rows.map((r) => r.zaloUid)),
      hetHan: Date.now() + TTL_MS,
    });
  } catch (err) {
    logger.warn({ err, orgId }, '[agent-operator] nạp cache lỗi — giữ cache cũ + fallback env');
    // Không set cache mới: lần gọi sau sẽ thử nạp lại; env vẫn bảo đảm quyền.
  }
}

/** Xoá cache một org — gọi sau khi admin thêm/sửa/xoá để có hiệu lực NGAY. */
/**
 * Đánh dấu cache CŨ — KHÔNG xoá (26/08).
 *
 * Ca thật 09:51:56 26/08: Minh Anh thêm chị Mỹ làm nhân viên → route gọi hàm
 * này → cache bị XOÁ SẠCH → tin kế tiếp của anh Quốc (09:52:29, nhân viên từ
 * 08/08) vào cổng đồng bộ thấy cache trống → nạp nền nhưng trả `false` ngay
 * → tin bị vứt IM LẶNG ("không qua cổng nhận lệnh"). Ghi chú cũ "chấp nhận lỡ
 * MỘT tin" hoá ra lỡ đúng tin người ta đang cần.
 *
 * Giữ danh sách cũ, chỉ đặt hết hạn = 0: cổng vẫn cho nhân viên cũ qua trong
 * lúc nạp lại; nhân viên MỚI thì route gọi `themUidVaoCache` để có ngay.
 */
export function xoaCache(orgId: string): void {
  const muc = cache.get(orgId);
  if (muc) muc.hetHan = 0;
}

/** Nhân viên vừa được thêm/bật → vào cache NGAY, khỏi đợi nạp nền. */
export function themUidVaoCache(orgId: string, uid: string): void {
  const muc = cache.get(orgId);
  if (muc) muc.uids.add(String(uid));
  else cache.set(orgId, { uids: new Set([String(uid)]), hetHan: 0 });
}

/** Nhân viên vừa bị tắt/xoá → ra khỏi cache NGAY (cổng bảo mật không được trễ 60s). */
export function boUidKhoiCache(orgId: string, uid: string): void {
  cache.get(orgId)?.uids.delete(String(uid));
}

/**
 * UID này có phải nhân viên của org không — ĐỒNG BỘ, cho cổng bảo mật.
 *
 * Trả về: (uid ∈ cache DB) HOẶC (uid ∈ env). Env là lớp tương thích ngược,
 * giữ tới khi bảng chạy ổn rồi gỡ.
 *
 * Cache miss/hết hạn → dùng env ngay (không chặn) + kích nạp nền cho lần sau.
 * Nghĩa là ngay sau khởi động, nhân viên CHỈ trong DB (không env) có thể lỡ
 * MỘT tin trong lúc nạp — chấp nhận được, và `napCacheLucKhoiDong` giảm cửa sổ đó.
 */
export function laNhanVienSync(orgId: string, uid: string | null | undefined): boolean {
  if (!uid) return false;
  const u = String(uid);
  if (uidEnv().has(u)) return true;

  const muc = cache.get(orgId);
  if (!muc || muc.hetHan <= Date.now()) {
    // Không có cache tươi → nạp nền, KHÔNG chặn cổng đồng bộ.
    void napCache(orgId);
    return muc?.uids.has(u) ?? false; // dùng cache cũ nếu còn, để đỡ hụt quyền
  }
  return muc.uids.has(u);
}

/** Nạp trước cache cho mọi org lúc khởi động — thu hẹp cửa sổ "lỡ tin đầu". */
export async function napCacheLucKhoiDong(): Promise<void> {
  try {
    const orgs = await prisma.agentOperator.findMany({
      where: { enabled: true },
      select: { orgId: true },
      distinct: ['orgId'],
    });
    await Promise.all(orgs.map((o) => napCache(o.orgId)));
    logger.info({ soOrg: orgs.length }, '[agent-operator] đã nạp cache khởi động');
  } catch (err) {
    logger.warn({ err }, '[agent-operator] nạp cache khởi động lỗi — sẽ nạp lazy khi có tin');
  }
}
