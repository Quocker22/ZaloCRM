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
  daChot?: Pick<SanPham, 'id' | 'ten' | 'gia'>;
  /** >1 kết quả tra — chờ NV chọn. */
  ungVien?: SanPham[];
  /** Tra rồi mà 0 kết quả — báo NV gõ lại, đừng im. */
  khongThay?: boolean;
}

export interface PhienGom {
  khachTuKhoa: string | null;
  khachDaChot?: Pick<KhachHang, 'id' | 'ten' | 'ma' | 'dienThoai'>;
  khachUngVien?: KhachHang[];
  khachKhongThay?: boolean;
  dong: DongGom[];
  /** Đã hiện tóm tắt, đang chờ NV chốt — chặn tạo đơn khi chưa ai gật. */
  daHoiChot?: boolean;
}

/**
 * Hành động kế tiếp — code quyết, KHÔNG phải model.
 * Mỗi lượt tin đúng MỘT hành động gửi đi (trừ tra_cuu: chạy xong gọi lại
 * buocTiepTheo để ra hành động nói được).
 */
export type HanhDong =
  | { loai: 'tra_cuu'; khach?: string; sp: string[] }
  | { loai: 'hoi_chon' }
  | { loai: 'hoi_thieu'; thieu: 'khach' | 'sp' | 'sl' }
  | { loai: 'khong_thay'; khach?: string; sp: string[] }
  | { loai: 'tom_tat_cho_chot' }
  | { loai: 'tao_don' };
