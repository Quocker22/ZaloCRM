// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab "Cho khách" (docs/79 T5) — hàm thuần: tìm tài liệu (bỏ dấu), cờ "có vẻ nội bộ", nhãn trạng thái mô tả.
import { describe, it, expect } from 'vitest';
import type { TaiLieuChoKhach } from '@/api/bot-cho-khach';
import { locTaiLieu, coVeNoiBo, nhanTrangThaiMoTa, nhanTrangThaiTaiLieu, chiaLo, chayTheoLo, LO_TOI_DA } from './bot-quyen-cho-khach';

const tl = (id: string, tieuDe: string, them: Partial<TaiLieuChoKhach> = {}): TaiLieuChoKhach => ({
  id, tieuDe, loai: 'pdf', nguon: 'file-zalo', soDoan: 2, capNhatLuc: null, mauNoiDung: null, noiDungBam: 'a'.repeat(64),
  trangThai: 'chua_duyet', noiDungBamDaDuyet: null, choKhach: false, duyetBoi: null, duyetLuc: null, ...them,
});

describe('locTaiLieu', () => {
  const ds = [
    tl('a', 'Datasheet Đèn LED P10', { choKhach: true, trangThai: 'da_duyet' }), tl('b', 'Bảng giá đại lý'),
    tl('c', 'Hướng dẫn lắp', { mauNoiDung: 'module p10' }),
    tl('d', 'Catalogue', { trangThai: 'doi_sau_duyet', noiDungBamDaDuyet: 'b'.repeat(64) }),
    tl('e', 'Ảnh chưa OCR', { trangThai: 'khong_noi_dung', noiDungBam: null }),
  ];
  it('tìm không dấu, không phân biệt hoa thường, cả tiêu đề lẫn mẫu nội dung', () => {
    expect(locTaiLieu(ds, 'den led', 'tat_ca').map((t) => t.id)).toEqual(['a']);
    expect(locTaiLieu(ds, 'P10', 'tat_ca').map((t) => t.id)).toEqual(['a', 'c']);
    expect(locTaiLieu(ds, '  ', 'tat_ca')).toHaveLength(5);
  });
  it('lọc theo trạng thái: "đã đổi sau duyệt" tách riêng, không lẫn vào "khách xem được" hay "chưa"', () => {
    expect(locTaiLieu(ds, '', 'cho_khach').map((t) => t.id)).toEqual(['a']);
    expect(locTaiLieu(ds, '', 'chua').map((t) => t.id)).toEqual(['b', 'c', 'e']);
    expect(locTaiLieu(ds, '', 'doi_sau_duyet').map((t) => t.id)).toEqual(['d']);
  });
});

describe('coVeNoiBo — backend gửi dauHieuNoiBo (xét toàn văn) thì dùng nó', () => {
  it('có lý do ⇒ true; mảng rỗng ⇒ false dù tiêu đề có chữ "bảng giá"', () => {
    expect(coVeNoiBo(tl('x', 'Datasheet', { dauHieuNoiBo: ['2 dòng có giá/tiền'] }))).toBe(true);
    expect(coVeNoiBo(tl('x', 'Bảng giá', { dauHieuNoiBo: [] }))).toBe(false);
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
  it('xét CẢ tiêu đề lẫn mẫu: chữ nội bộ trong mẫu, số tiền trong tiêu đề', () => {
    expect(coVeNoiBo(tl('x', 'Catalogue', { mauNoiDung: 'Áp dụng chiết khấu 5% cho đại lý' }))).toBe(true);
    expect(coVeNoiBo(tl('x', 'Catalogue', { mauNoiDung: 'Tài liệu nội bộ — không gửi khách' }))).toBe(true);
    expect(coVeNoiBo(tl('x', 'Led dây 125.000đ'))).toBe(true);
    expect(coVeNoiBo(tl('x', 'Catalogue', { mauNoiDung: 'Hướng dẫn đấu nối nguồn 12V' }))).toBe(false);
  });
});

describe('nhanTrangThaiTaiLieu', () => {
  it('mỗi trạng thái một chữ + màu; nội dung đổi nói rõ cần duyệt lại', () => {
    expect(nhanTrangThaiTaiLieu('da_duyet')).toEqual({ chu: 'Khách xem được', mau: 'xanh' });
    expect(nhanTrangThaiTaiLieu('doi_sau_duyet')).toEqual({ chu: 'Tài liệu đã đổi — cần duyệt lại', mau: 'vang' });
    expect(nhanTrangThaiTaiLieu('chua_duyet')).toEqual({ chu: 'Chưa cho khách', mau: 'xam' });
    expect(nhanTrangThaiTaiLieu('khong_noi_dung')).toEqual({ chu: 'Không có nội dung', mau: 'rong' });
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

describe('chiaLo / chayTheoLo — "Chọn hết" > 500 mục (backend nhận tối đa 500 mỗi lần)', () => {
  it('chia theo 500, giữ thứ tự; rỗng ⇒ không lô nào', () => {
    expect(LO_TOI_DA).toBe(500);
    const ds = Array.from({ length: 1201 }, (_, i) => i);
    const lo = chiaLo(ds);
    expect(lo.map((l) => l.length)).toEqual([500, 500, 201]);
    expect(lo.flat()).toEqual(ds);
    expect(chiaLo([])).toEqual([]);
  });

  it('chạy LẦN LƯỢT từng lô, báo tiến độ; lô lỗi KHÔNG chặn lô sau; báo lại lô nào lỗi + số mục', async () => {
    const goi: number[][] = [];
    const tienDo: Array<[number, number]> = [];
    const kq = await chayTheoLo(
      Array.from({ length: 1201 }, (_, i) => i),
      async (lo) => {
        goi.push(lo);
        if (goi.length === 2) throw new Error('409 Tài liệu đã đổi');
        return { doi: lo.length };
      },
      (e) => (e as Error).message,
      (xong, tong) => tienDo.push([xong, tong]),
    );
    expect(goi.map((l) => l.length)).toEqual([500, 500, 201]);
    expect(tienDo).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(kq).toEqual({
      doi: 701, soLo: 3, loLoi: [{ lo: 2, soMuc: 500, chu: '409 Tài liệu đã đổi', muc: goi[1] }],
    });
  });
});
