// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab "Cho khách" của trang Quyền bot (docs/79 T5) — hàm thuần: tìm/lọc tài liệu, cờ "có vẻ nội bộ", nhãn trạng thái mô tả.
import type { TaiLieuChoKhach, TrangThaiMoTa, TrangThaiTaiLieu } from '@/api/bot-cho-khach';
import { boDau } from './bot-quyen-nhom';

export type LocTaiLieu = 'tat_ca' | 'cho_khach' | 'chua' | 'doi_sau_duyet';

/** Tìm không dấu trong tiêu đề + mẫu nội dung, rồi lọc theo trạng thái. Giữ thứ tự danh mục. */
export function locTaiLieu(ds: readonly TaiLieuChoKhach[], tuKhoa: string, loc: LocTaiLieu): TaiLieuChoKhach[] {
  const k = boDau(tuKhoa ?? '').trim();
  return ds.filter((t) => {
    if (loc === 'cho_khach' && t.trangThai !== 'da_duyet') return false;
    if (loc === 'chua' && t.trangThai !== 'chua_duyet' && t.trangThai !== 'khong_noi_dung') return false;
    if (loc === 'doi_sau_duyet' && t.trangThai !== 'doi_sau_duyet') return false;
    if (!k) return true;
    return boDau(`${t.tieuDe} ${t.mauNoiDung ?? ''}`).includes(k);
  });
}

// Chữ hay gặp ở tài liệu KHÔNG được cho khách (docs/79: kho có thể lẫn tài liệu nội bộ/bảng giá). Chỉ để NHẮC — người duyệt quyết.
const CHU_NOI_BO = ['bang gia', 'gia von', 'gia dai ly', 'gia si', 'chiet khau', 'noi bo', 'cong no', 'hoa hong', 'bao gia'];
// Số tiền trong mẫu nội dung: "125.000đ", "1,2tr", "500k", "vnd".
const SO_TIEN = /\d[\d.,]*\s*(?:đ|vnđ|vnd|k\b|tr\b|triệu|nghìn|ngàn)/i;

/**
 * Backend gửi `dauHieuNoiBo` (xét TOÀN VĂN kho tri thức CRM) ⇒ dùng nó. Backend cũ (không có khoá) ⇒ xét tiêu đề + mẫu 300 ký tự
 * (chữ nội bộ + số tiền) — bảng giá ở trang sau thì không thấy.
 */
export function coVeNoiBo(t: Pick<TaiLieuChoKhach, 'tieuDe' | 'mauNoiDung' | 'dauHieuNoiBo'>): boolean {
  if (Array.isArray(t.dauHieuNoiBo)) return t.dauHieuNoiBo.length > 0;
  for (const chu of [t.tieuDe, t.mauNoiDung ?? '']) {
    if (!chu) continue;
    const k = ` ${boDau(chu).replace(/[^a-z0-9]+/g, ' ')} `;
    if (CHU_NOI_BO.some((c) => k.includes(` ${c}`))) return true;
    if (SO_TIEN.test(chu)) return true;
  }
  return false;
}

/** Backend nhận tối đa chừng này mục một lần duyệt / bỏ duyệt (TOI_DA_MOT_LO). */
export const LO_TOI_DA = 500;

export function chiaLo<T>(ds: readonly T[], n = LO_TOI_DA): T[][] {
  const kq: T[][] = [];
  for (let i = 0; i < ds.length; i += n) kq.push(ds.slice(i, i + n));
  return kq;
}

export interface KetQuaTheoLo<T> {
  doi: number;
  soLo: number;
  /** Lô hỏng (đánh số từ 1) — các lô khác vẫn chạy; `muc` để chọn lại đúng những mục chưa lưu. */
  loLoi: Array<{ lo: number; soMuc: number; chu: string; muc: T[] }>;
}

/**
 * "Chọn hết" > 500: gửi LẦN LƯỢT từng lô ≤ 500 (backend hỏng cả lô nếu một mục hỏng — lô khác không liên quan), báo tiến độ,
 * lô lỗi không chặn lô sau; trả tổng `doi` + danh sách lô lỗi.
 */
export async function chayTheoLo<T>(
  ds: readonly T[], goi: (lo: T[]) => Promise<{ doi: number }>, docLoi: (e: unknown) => string,
  baoTienDo?: (xong: number, tong: number) => void,
): Promise<KetQuaTheoLo<T>> {
  const lo = chiaLo(ds);
  const kq: KetQuaTheoLo<T> = { doi: 0, soLo: lo.length, loLoi: [] };
  for (let i = 0; i < lo.length; i++) {
    try {
      kq.doi += (await goi(lo[i])).doi;
    } catch (e) {
      kq.loLoi.push({ lo: i + 1, soMuc: lo[i].length, chu: docLoi(e), muc: lo[i] });
    }
    baoTienDo?.(i + 1, lo.length);
  }
  return kq;
}

export function nhanTrangThaiTaiLieu(t: TrangThaiTaiLieu): { chu: string; mau: 'xanh' | 'vang' | 'xam' | 'rong' } {
  switch (t) {
    case 'da_duyet': return { chu: 'Khách xem được', mau: 'xanh' };
    case 'doi_sau_duyet': return { chu: 'Tài liệu đã đổi — cần duyệt lại', mau: 'vang' };
    case 'chua_duyet': return { chu: 'Chưa cho khách', mau: 'xam' };
    default: return { chu: 'Không có nội dung', mau: 'rong' };
  }
}

export function nhanTrangThaiMoTa(t: TrangThaiMoTa): { chu: string; mau: 'xanh' | 'vang' | 'xam' | 'rong' } {
  switch (t) {
    case 'da_duyet': return { chu: 'Đã duyệt', mau: 'xanh' };
    case 'doi_sau_duyet': return { chu: 'Mô tả đã đổi — cần duyệt lại', mau: 'vang' };
    case 'chua_duyet': return { chu: 'Chưa duyệt', mau: 'xam' };
    default: return { chu: 'Không có mô tả', mau: 'rong' };
  }
}
