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

export function coVeNoiBo(t: Pick<TaiLieuChoKhach, 'tieuDe' | 'mauNoiDung'>): boolean {
  const ten = ` ${boDau(t.tieuDe)} `;
  if (CHU_NOI_BO.some((c) => ten.includes(` ${c}`))) return true;
  return !!t.mauNoiDung && SO_TIEN.test(t.mauNoiDung);
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
