// SPDX-License-Identifier: AGPL-3.0-or-later
// CÔNG TẮC & CẤU HÌNH — toàn bộ biến môi trường của agent nằm ở ĐÚNG MỘT FILE.
//
// Quy tắc: file này chỉ chứa hàm THUẦN đọc env, không I/O, không import nặng.
// Muốn biết agent bật/tắt vì sao → đọc mỗi file này là đủ, khỏi grep cả module.
//
// Ba công tắc ĐỘC LẬP, mặc định TẮT — bật là hành động có chủ đích, không phải
// hiệu ứng phụ của một lần deploy:
//
//   AI_AGENT_NHANVIEN=1     nhân viên sai bot (tra cứu, lên đơn, báo cáo)
//   AI_AGENT_KHACH=1        khách nhắn thì agent trả lời THAY luồng RAG cũ
//   AI_AGENT_KHACH_TU_CHOT=1  khách chốt là bot GHI thẳng vào Odoo (quyền ghi
//                             tách riêng — bật tư vấn không kéo theo quyền ghi)

/** Luồng nhân viên: bot nhận lệnh tra cứu / lên đơn / báo cáo. */
export function batLuongNhanVien(): boolean {
  return process.env.AI_AGENT_NHANVIEN === '1';
}

/** Luồng khách: agent tư vấn thay luồng RAG cũ. */
export function batLuongKhach(): boolean {
  return process.env.AI_AGENT_KHACH === '1';
}

/**
 * Cho khách tự chốt đơn (bot được GHI vào Odoo khi khách nhắn).
 *
 * Tách khỏi AI_AGENT_KHACH vì đây là mở RANH GIỚI BẢO MẬT: khách điều khiển
 * được câu chữ nên cũng điều khiển được thứ bot ghi. Hàng rào đi kèm nằm ở
 * code (trần tiền, chống trùng), không ở prompt — prompt lèo lái được.
 */
export function batKhachTuChotDon(): boolean {
  return process.env.AI_AGENT_KHACH_TU_CHOT === '1';
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
