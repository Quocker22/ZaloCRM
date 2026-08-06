// SPDX-License-Identifier: AGPL-3.0-or-later
// NỐI AGENT VÀO ZALO — điểm vào duy nhất cho message-handler.
//
// File này chỉ RE-EXPORT. Ruột nằm trong `noi-zalo/`, mỗi file một mối quan tâm:
//
//   noi-zalo/cong-tac.ts        công tắc env + trần tiền (hàm thuần, không I/O)
//   noi-zalo/llm.ts             dựng hàm gọi LLM từ cấu hình per-org
//   noi-zalo/du-lieu.ts         Odoo client, lịch sử, tri thức, khoá chống trùng
//   noi-zalo/gui-zalo.ts        mọi thứ GỬI RA Zalo: tin, ảnh, hoá đơn, QR
//   noi-zalo/dung.ts            helper dừng-có-log — cấm cổng im lặng
//   noi-zalo/luong-nhan-vien.ts luồng nhân viên sai bot
//   noi-zalo/luong-khach.ts     luồng khách (thay luồng RAG cũ khi bật)
//
// Sơ đồ luồng + quy tắc thiết kế: docs/KIEN-TRUC-AGENT.md
//
// VÌ SAO KHÔNG SỬA auto-reply-wiring.ts (luồng RAG cũ): nó đang phục vụ khách
// thật. Agent đứng cạnh, bật/tắt bằng env — hỏng thì tắt biến là về nguyên
// trạng, không cần deploy lại.
export {
  batLuongNhanVien,
  batLuongKhach,
  batKhachTuChotDon,
  duCauHinh,
} from './noi-zalo/cong-tac.js';
export { duongDanChat } from './noi-zalo/llm.js';
export { seqTuMessageId } from './noi-zalo/du-lieu.js';
export type { NgữCanhTin } from './noi-zalo/types.js';
export { laLenhNhanVien, xuLyTinNhanVien } from './noi-zalo/luong-nhan-vien.js';
export { xuLyTinKhach } from './noi-zalo/luong-khach.js';
export { xuLyTinMedia, chiCoEmoji } from './noi-zalo/luong-media.js';
export { bocMention } from './noi-zalo/boc-mention.js';
