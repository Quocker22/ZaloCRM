// SPDX-License-Identifier: AGPL-3.0-or-later
// CÔNG TẮC & CẤU HÌNH — toàn bộ biến môi trường của agent nằm ở ĐÚNG MỘT FILE.
//
// Quy tắc: file này chỉ chứa hàm THUẦN đọc env, không I/O, không import nặng.
// Muốn biết agent bật/tắt vì sao → đọc mỗi file này là đủ, khỏi grep cả module.
//
// Ba công tắc ĐỘC LẬP, mặc định TẮT — bật là hành động có chủ đích, không phải
// hiệu ứng phụ của một lần deploy:
//
//   ai_configs.agent_nhan_vien_enabled     nhân viên sai bot (tra cứu, lên đơn…)
//   ai_configs.agent_khach_enabled         khách nhắn thì agent trả lời thay RAG cũ
//   ai_configs.agent_khach_tu_chot_enabled khách chốt là bot GHI thẳng vào Odoo
//                                          (quyền ghi tách riêng khỏi tư vấn)
// (Từ 17/08/2026 nằm trong CRM, không còn là env — xem khối bên dưới.)

// ── CÔNG TẮC ĐỌC TỪ CRM (17/08/2026) ──────────────────────────────────────
// Trước: 3 công tắc là env AI_AGENT_NHANVIEN / _KHACH / _KHACH_TU_CHOT — đổi
// phải sửa Dokploy + deploy. Anh Quốc: "mấy cái này tôi handle trên zalocrm
// hết". Giờ nằm ở ai_configs (agent_*_enabled), sửa trên CRM là ăn sau ≤30s.
//
// Cache 30s theo org: các hàm bat* bị gọi ở đầu MỌI tin nhắn — query DB mỗi
// lần là tự bắn vào chân. DB lỗi → dùng cache cũ; chưa có cache → TẮT
// (fail-safe: không bao giờ tự bật agent vì DB sập).
//
// Giữ chữ ký ĐỒNG BỘ (boolean) cho caller cũ — đọc từ cache của org hiện tại;
// `napCongTacAgent(orgId)` PHẢI được gọi một lần đầu lượt (message-handler).
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

interface CongTacAgent { nhanVien: boolean; khach: boolean; khachTuChot: boolean; luc: number }
const cacheCongTac = new Map<string, CongTacAgent>();
const TTL_CONG_TAC_MS = 30_000;
let orgHienTai: string | null = null;

/** Nạp công tắc từ CRM cho org (cache 30s). Gọi ĐẦU lượt xử lý tin. */
export async function napCongTacAgent(orgId: string): Promise<CongTacAgent> {
  orgHienTai = orgId;
  const cu = cacheCongTac.get(orgId);
  if (cu && Date.now() - cu.luc < TTL_CONG_TAC_MS) return cu;
  try {
    const cfg = await prisma.aiConfig.findUnique({
      where: { orgId },
      select: { agentNhanVienEnabled: true, agentKhachEnabled: true, agentKhachTuChotEnabled: true },
    });
    const moi: CongTacAgent = {
      nhanVien: cfg?.agentNhanVienEnabled === true,
      khach: cfg?.agentKhachEnabled === true,
      khachTuChot: cfg?.agentKhachTuChotEnabled === true,
      luc: Date.now(),
    };
    cacheCongTac.set(orgId, moi);
    return moi;
  } catch (err) {
    logger.warn({ err, orgId }, '[cong-tac] đọc công tắc agent từ CRM lỗi — dùng cache cũ/tắt');
    return cu ?? { nhanVien: false, khach: false, khachTuChot: false, luc: 0 };
  }
}

/** Test/ops: xoá cache để đọc lại ngay. */
export function xoaCacheCongTac(): void { cacheCongTac.clear(); orgHienTai = null; }

const docCache = (): CongTacAgent | undefined => (orgHienTai ? cacheCongTac.get(orgHienTai) : undefined);

/**
 * LỐI TẮT CHO TEST/DEV: env AI_AGENT_* nếu CÓ đặt thì thắng (test set
 * process.env rồi gọi thẳng xuLyTin* không qua message-handler). Prod KHÔNG
 * đặt các env này (đã xoá khỏi Dokploy 17/08) → luôn đọc CRM.
 */
const envEp = (k: string): boolean | undefined =>
  process.env[k] === undefined ? undefined : process.env[k] === '1';

/** Luồng nhân viên: bot nhận lệnh tra cứu / lên đơn / báo cáo. */
export function batLuongNhanVien(): boolean {
  return envEp('AI_AGENT_NHANVIEN') ?? docCache()?.nhanVien === true;
}

/** Luồng khách: agent tư vấn thay luồng RAG cũ. */
export function batLuongKhach(): boolean {
  return envEp('AI_AGENT_KHACH') ?? docCache()?.khach === true;
}

/**
 * Cho khách tự chốt đơn (bot được GHI vào Odoo khi khách nhắn).
 *
 * Tách khỏi AI_AGENT_KHACH vì đây là mở RANH GIỚI BẢO MẬT: khách điều khiển
 * được câu chữ nên cũng điều khiển được thứ bot ghi. Hàng rào đi kèm nằm ở
 * code (trần tiền, chống trùng), không ở prompt — prompt lèo lái được.
 */
export function batKhachTuChotDon(): boolean {
  return envEp('AI_AGENT_KHACH_TU_CHOT') ?? docCache()?.khachTuChot === true;
}

/**
 * Có đủ cấu hình Odoo để chạy agent không. Thiếu → cả hai luồng im lặng và
 * luồng RAG cũ chạy tiếp như chưa từng có agent.
 *
 * KHÔNG kiểm LLM ở đây: key/model lấy từ DB per-org lúc chạy (xem llm.ts) —
 * cùng nguồn luồng RAG cũ, đổi trên giao diện là cả hai luồng đổi theo.
 */
export function duCauHinh(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ODOO_URL && env.ODOO_DB && env.ODOO_USERNAME && env.ODOO_PASSWORD);
}

/**
 * Trần tiền một đơn KHÁCH tự chốt. Vượt → chuyển sale thay vì tạo đơn.
 *
 * Đo thật 2026-08-04: khách gõ "lấy tôi 1000 cuộn" và bot tính ra 500.000.000đ
 * — không ai duyệt. Mặc định 20 triệu: đủ đơn buôn thường ngày, chặn bất thường.
 * Nhân viên KHÔNG có trần — họ chịu trách nhiệm cho đơn mình lên.
 */
export function tranTienKhach(): number {
  return Number(process.env.AI_AGENT_TRAN_TIEN_KHACH ?? 20_000_000);
}

/**
 * Số tin lịch sử nạp vào ngữ cảnh.
 *
 * 10 → 50 (10/08, anh Quốc chốt): 10 tin quá ngắn — bot quên việc đang dở chỉ
 * sau vài lượt, nhân viên phải nhắc lại từ đầu. Model 1 triệu token thì 50 tin
 * (~8k token) không đáng gì về chỗ chứa, và ~15.000đ/tháng vẫn trong ngân sách.
 *
 * KHÔNG lấy "hết" dù cửa sổ cho phép: bug thật 20:06 10/08 là bot bốc mã
 * KH001409 của khách CŨ trong lịch sử rồi tra công nợ nhầm người — CHỈ với 10
 * tin. Lịch sử càng dài, cơ hội bốc nhầm càng nhiều. Nâng dần và đo, đừng nhảy
 * thẳng lên "toàn bộ" rồi không biết bug mới từ đâu ra.
 *
 * Chỉnh bằng env AI_AGENT_SO_TIN_LICH_SU — không cần deploy khi muốn thử ngưỡng
 * khác. Trần 200 để một hội thoại dài bất thường không nuốt hết ngữ cảnh.
 */
export function soTinLichSu(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AI_AGENT_SO_TIN_LICH_SU ?? 50);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}

/** @deprecated Dùng soTinLichSu() — giữ tên cũ cho code/test chưa đổi. */
export const SO_TIN_LICH_SU = 50;

/**
 * Chặn tạo đơn thứ hai trong CÙNG hội thoại nếu cách đơn trước dưới N giây.
 *
 * Bug thật 05/08/2026: nhân viên lên đơn S13797 (1 cái) rồi nhắn "10 cái mà"
 * để SỬA. Bot tạo hẳn đơn S13798 cho khách khác, 780.000đ. Không ai biết cho
 * tới khi dò Odoo — vì lượt đó còn dính lỗi text rỗng nên nhân viên chỉ thấy
 * dòng báo lỗi.
 *
 * 90 giây: người ta không lên hai đơn THẬT cách nhau ngần ấy trong một hội
 * thoại, nhưng RẤT hay sửa đơn vừa lên. Đặt 0 để tắt.
 */
export function chanDonLienKeGiay(): number {
  return Number(process.env.AI_AGENT_CHAN_DON_LIEN_KE_GIAY ?? 90);
}

/**
 * URL Odoo để NGƯỜI bấm vào (link xử lý đơn trong tin Zalo).
 *
 * Bug thật 06/08/2026: link hoá đơn ra "http://incokit_nginx_prod/web#..." —
 * ODOO_URL là hostname NỘI BỘ Docker, chỉ container thấy được; nhân viên bấm
 * là chết. Bot gọi XML-RPC vẫn phải dùng ODOO_URL nội bộ (nhanh, không qua
 * tunnel) — nên cần biến RIÊNG cho link người dùng:
 *
 *   ODOO_PUBLIC_URL=https://led.incokit.com
 *
 * Chưa đặt thì rơi về ODOO_URL — ít nhất không tệ hơn trước.
 */
export function odooUrlCongKhai(): string | undefined {
  return process.env.ODOO_PUBLIC_URL || process.env.ODOO_URL;
}

/**
 * Thread Zalo nhận báo "bot bí" — nhóm sale hoặc UID một nhân viên.
 *
 *   AI_AGENT_THREAD_BAO_SALE       threadId nhận báo (bắt buộc để bật tính năng)
 *   AI_AGENT_THREAD_BAO_SALE_LOAI  '0' = chat 1-1, mặc định '1' = nhóm
 *
 * Không đặt → bot vẫn giữ chân khách nhưng KHÔNG báo được ai — chỉ còn log.
 */
export function threadBaoSale(): { threadId: string; threadType: 0 | 1 } | null {
  const threadId = process.env.AI_AGENT_THREAD_BAO_SALE;
  if (!threadId) return null;
  return { threadId, threadType: process.env.AI_AGENT_THREAD_BAO_SALE_LOAI === '0' ? 0 : 1 };
}
