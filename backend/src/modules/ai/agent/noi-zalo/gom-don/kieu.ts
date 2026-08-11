// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểu của máy trạng thái gom đơn.
// Spec: docs/superpowers/specs/2026-08-07-luong-len-don-slot-design.md
//
// Vì sao tồn tại: 4 lần vá luồng lên đơn trong tối 07/08 mà bug vẫn đổi hình
// dạng (hỏi lại SL đã có, lặp y hệt câu hỏi). Quy trình lên đơn giờ do CODE
// quyết — LLM chỉ trích slot từ câu nói, không được quyết hỏi gì tiếp.
import type { KhachHang } from '../../../odoo/tools/tra-khach-hang.js';
import type { SanPham } from '../../../odoo/tools/tra-san-pham.js';

/** Một dòng hàng đang gom: từ khoá NV gõ → ứng viên → SP đã chốt. */
export interface DongGom {
  tuKhoa: string;
  sl: number | null;
  /**
   * Đơn giá NHÂN VIÊN BÁO trong câu ("10 cái NB x 170k" → 170000).
   *
   * Anh Quốc chốt 10/08: giá NV báo THẮNG giá hệ thống — họ đã chốt với khách
   * rồi, giá Odoo có thể cũ. Cũng là đường để SP chưa nhập giá vẫn lên đơn
   * được (bug demo 17:17: kẹt cứng vì SP giá 1đ).
   */
  donGia?: number;
  /**
   * Chiết khấu % nhân viên báo NGAY lúc lên đơn (0-100).
   *
   * Ca thật 03:23 11/08: "…giá 230k triết khấu 8%" — máy không có ô này nên
   * bỏ qua, ra 23.000.000đ; nhân viên phải nhắc lại một lượt nữa mới đúng
   * 21.160.000đ. Anh Quốc: "cái lên đơn chưa lên thêm được chiết khấu nữa".
   */
  chietKhau?: number;
  /**
   * Dòng HÀNG TẶNG: giá 0đ và tên dòng gắn "(tặng)".
   *
   * Đo trên Odoo prod 11/08: 34/597 dòng có giá 0đ — nhưng KHÔNG phải quà tặng
   * hết. Trong đó có dòng 428 con ốc, 107 sợi cáp: phụ kiện đi kèm, cũng 0đ.
   * Không dòng nào ghi chữ "tặng" nên báo cáo không tách nổi hai loại.
   *
   * Nên tặng kèm phải để lại DẤU trong tên dòng, không chỉ đặt giá 0.
   */
  tang?: boolean;
  daChot?: Pick<SanPham, 'id' | 'ten' | 'gia'>;
  /** >1 kết quả tra — chờ NV chọn. */
  ungVien?: SanPham[];
  /** Tra rồi mà 0 kết quả — báo NV gõ lại, đừng im. */
  khongThay?: boolean;
  /**
   * Các kho CÓ TỒN của SP này (đã tra). Rỗng/1 phần tử → không cần hỏi kho.
   *
   * Đo prod: 175/978 SP (18%) có tồn ở nhiều hơn một kho. 82% còn lại không có
   * gì để chọn — hỏi là làm phiền nhân viên mà không thêm thông tin nào.
   */
  khoCo?: Array<{ id: number; ten: string }>;
}

/**
 * Kho xuất hàng của đơn (sale.order.warehouse_id).
 *
 * Đo prod 11/08: 291/300 đơn gần nhất dùng TT, 9 đơn dùng HCM. Nên MẶC ĐỊNH là
 * không đặt gì — để Odoo tự lấy TT như xưa nay. Chỉ đặt khi nhân viên nói rõ,
 * hoặc khi máy hỏi vì hàng nằm nhiều kho.
 */
export const KHO: ReadonlyArray<{ id: number; ma: string; ten: string }> = [
  { id: 2, ma: 'TT', ten: 'Chi nhánh trung tâm' },
  { id: 3, ma: 'HCM', ten: 'Hồ Chí Minh' },
  { id: 4, ma: 'KB', ten: 'Kho B' },
];

/** Đơn nháp đang sửa (chế 'sua'). */
export interface DonSua {
  id: number;
  ma: string;
  tong: number;
}

export interface PhienGom {
  khachTuKhoa: string | null;
  khachDaChot?: Pick<KhachHang, 'id' | 'ten' | 'ma' | 'dienThoai'>;
  khachUngVien?: KhachHang[];
  /**
   * Danh sách ứng viên CHẠM TRẦN tra cứu — còn khách trùng ngoài danh sách.
   * Bug 16:15 11/08: "Anh Long Led" nằm ngoài 10 người đầu mà không ai biết.
   */
  khachUngVienConNua?: boolean;
  khachKhongThay?: boolean;
  /**
   * Thông tin khách MỚI nhân viên cung cấp khi tra không ra ("khách mới",
   * kèm tên + SĐT). Bug demo 17:08 10/08: máy chỉ biết TRA, không có đường
   * TẠO nên bot đáp 'hệ thống chưa cho phép tạo khách mới trong lượt này'.
   */
  khachMoi?: { ten: string; sdt?: string; diaChi?: string };
  dong: DongGom[];
  /** Đã hiện tóm tắt, đang chờ NV chốt — chặn tạo đơn khi chưa ai gật. */
  daHoiChot?: boolean;
  /**
   * Kho xuất hàng NV đã chốt cho đơn này (id trong KHO). Không đặt = để Odoo tự
   * lấy kho mặc định — đúng hành vi 291/300 đơn hiện nay.
   */
  khoId?: number;
  /**
   * Đã hỏi kho một lần rồi. Hỏi kho là hỏi THÊM một lượt, mà 82% SP chỉ nằm một
   * kho — hỏi tới lần thứ hai thì nhân viên chửi. Không trả lời được thì đi tiếp
   * bằng kho mặc định, đừng chặn đơn.
   */
  daHoiKho?: boolean;

  // ── Chế SỬA ĐƠN (spec 2026-08-08) ──────────────────────────────────────
  /**
   * Thiếu = 'len' — phiên cũ đang nằm trong DB đọc lên vẫn chạy đúng luồng
   * lên đơn, không cần migrate dữ liệu.
   */
  che?: 'len' | 'sua';
  /** Đơn đã chốt để sửa. */
  donSua?: DonSua;
  /** Nhiều đơn nháp trong hội thoại → chờ NV chọn. */
  donUngVien?: DonSua[];
  /** Tra rồi không có đơn nháp nào sửa được. */
  donKhongThay?: boolean;
  /** Số lần tạo đơn thất bại liên tiếp — 2 lần thì bỏ phiên (chống kẹt 10/08). */
  soLanLoi?: number;
  /**
   * Tin máy đã gửi GẦN NHẤT — guard chống lặp nguyên văn (bug 16:15 11/08:
   * NV gõ gì cũng nhận lại đúng một tường chữ danh sách). Trùng thì đổi lời.
   */
  tinCuoi?: string;
  /**
   * UID Zalo của người ĐANG được bot hỏi (người mở phiên).
   *
   * Bug thật 17:07-17:08 10/08 trong nhóm: anh Quyết tag bot "lên đơn cho anh
   * chiến", bot liệt kê 10 anh Chiến; anh trả lời "khách mới" — KHÔNG tag —
   * nên cổng batBuocTag vứt câu đó, bot không bao giờ thấy. Phiên treo, nhân
   * viên tưởng bot lỗi.
   *
   * Bot vừa hỏi thì câu kế của CHÍNH người được hỏi là câu trả lời, không cần
   * tag lại. Người KHÁC trong nhóm nói chen thì vẫn phải tag — nếu không, bot
   * bốc câu tán gẫu của người ngoài làm câu chọn.
   */
  hoiUid?: string | null;
}

/**
 * Hành động kế tiếp — code quyết, KHÔNG phải model.
 * Mỗi lượt tin đúng MỘT hành động gửi đi (trừ tra_cuu: chạy xong gọi lại
 * buocTiepTheo để ra hành động nói được).
 */
export type HanhDong =
  | { loai: 'tra_cuu'; khach?: string; sp: string[]; don?: boolean }
  | { loai: 'hoi_chon' }
  | { loai: 'hoi_chon_don' }
  | { loai: 'hoi_thieu'; thieu: 'khach' | 'sp' | 'sl' }
  /** SP chưa có giá trong Odoo và NV cũng chưa báo giá — hỏi ngay, đừng để kẹt. */
  | { loai: 'hoi_gia'; sp: string[] }
  /**
   * Hàng nằm ở NHIỀU kho mà NV chưa nói lấy kho nào → hỏi MỘT lần.
   * `chon` = các kho thật sự có tồn, không liệt kê kho trống cho có.
   */
  | { loai: 'hoi_kho'; chon: Array<{ id: number; ten: string }> }
  | { loai: 'khong_thay'; khach?: string; sp: string[] }
  | { loai: 'khong_thay_don' }
  /** Tra không ra khách nhưng NV đã cho tên → tạo khách mới rồi chạy tiếp. */
  | { loai: 'tao_khach' }
  | { loai: 'tom_tat_cho_chot' }
  | { loai: 'tao_don' }
  /** Chế 'sua': đủ rõ → ghi THẲNG Odoo, KHÔNG hỏi chốt (anh Quốc chốt 08/08). */
  | { loai: 'sua_don' };
