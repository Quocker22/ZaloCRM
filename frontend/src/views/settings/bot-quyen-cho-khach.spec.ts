// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab "Cho khách" (docs/79 T5) — hàm thuần: tìm tài liệu (bỏ dấu), cờ "có vẻ nội bộ", nhãn trạng thái mô tả.
import { describe, it, expect } from 'vitest';
import type { TaiLieuChoKhach } from '@/api/bot-cho-khach';
import { locTaiLieu, coVeNoiBo, nhanTrangThaiMoTa } from './bot-quyen-cho-khach';

const tl = (id: string, tieuDe: string, them: Partial<TaiLieuChoKhach> = {}): TaiLieuChoKhach => ({
  id, tieuDe, loai: 'pdf', nguon: 'file-zalo', soDoan: 2, capNhatLuc: null, mauNoiDung: null, choKhach: false,
  duyetBoi: null, duyetLuc: null, ...them,
});

describe('locTaiLieu', () => {
  const ds = [tl('a', 'Datasheet Đèn LED P10', { choKhach: true }), tl('b', 'Bảng giá đại lý'), tl('c', 'Hướng dẫn lắp', { mauNoiDung: 'module p10' })];
  it('tìm không dấu, không phân biệt hoa thường, cả tiêu đề lẫn mẫu nội dung', () => {
    expect(locTaiLieu(ds, 'den led', 'tat_ca').map((t) => t.id)).toEqual(['a']);
    expect(locTaiLieu(ds, 'P10', 'tat_ca').map((t) => t.id)).toEqual(['a', 'c']);
    expect(locTaiLieu(ds, '  ', 'tat_ca')).toHaveLength(3);
  });
  it('lọc theo trạng thái', () => {
    expect(locTaiLieu(ds, '', 'cho_khach').map((t) => t.id)).toEqual(['a']);
    expect(locTaiLieu(ds, '', 'chua').map((t) => t.id)).toEqual(['b', 'c']);
  });
});

describe('coVeNoiBo — nhắc người duyệt (KHÔNG chặn)', () => {
  it.each([
    ['Bảng giá đại lý 2026', true], ['bang gia', true], ['Chiết khấu Q3', true], ['Tài liệu NỘI BỘ', true], ['Công nợ khách', true],
    ['Giá vốn', true], ['Datasheet P10', false], ['Hướng dẫn lắp đặt', false],
  ])('%s ⇒ %s', (tieuDe, ky) => {
    expect(coVeNoiBo(tl('x', tieuDe))).toBe(ky);
  });
  it('mẫu nội dung có số tiền ⇒ cũng nhắc', () => {
    expect(coVeNoiBo(tl('x', 'Catalogue', { mauNoiDung: 'Led dây 12V giá 125.000đ/m' }))).toBe(true);
    expect(coVeNoiBo(tl('x', 'Catalogue', { mauNoiDung: 'Led dây 12V 60 bóng/m' }))).toBe(false);
  });
});

describe('nhanTrangThaiMoTa', () => {
  it('mỗi trạng thái một chữ + màu; "đã đổi" nói rõ cần duyệt lại', () => {
    expect(nhanTrangThaiMoTa('da_duyet')).toEqual({ chu: 'Đã duyệt', mau: 'xanh' });
    expect(nhanTrangThaiMoTa('doi_sau_duyet')).toEqual({ chu: 'Mô tả đã đổi — cần duyệt lại', mau: 'vang' });
    expect(nhanTrangThaiMoTa('chua_duyet')).toEqual({ chu: 'Chưa duyệt', mau: 'xam' });
    expect(nhanTrangThaiMoTa('khong_mo_ta')).toEqual({ chu: 'Không có mô tả', mau: 'rong' });
  });
});
