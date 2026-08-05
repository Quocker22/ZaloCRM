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

/** Số tin lịch sử nạp vào ngữ cảnh — đủ để hiểu "cái đó", không phình prompt. */
export const SO_TIN_LICH_SU = 10;
