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
  daChot?: Pick<SanPham, 'id' | 'ten' | 'gia'>;
  /** >1 kết quả tra — chờ NV chọn. */
  ungVien?: SanPham[];
  /** Tra rồi mà 0 kết quả — báo NV gõ lại, đừng im. */
  khongThay?: boolean;
}

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
  | { loai: 'khong_thay'; khach?: string; sp: string[] }
  | { loai: 'khong_thay_don' }
  /** Tra không ra khách nhưng NV đã cho tên → tạo khách mới rồi chạy tiếp. */
  | { loai: 'tao_khach' }
  | { loai: 'tom_tat_cho_chot' }
  | { loai: 'tao_don' }
  /** Chế 'sua': đủ rõ → ghi THẲNG Odoo, KHÔNG hỏi chốt (anh Quốc chốt 08/08). */
  | { loai: 'sua_don' };
