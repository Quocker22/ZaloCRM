// SPDX-License-Identifier: AGPL-3.0-or-later
// 5 lỗi gốc từ log 27/08 sáng (nhóm Nelia-Đơn hàng + Dậy học cho AI):
//  1. khách cũ đã chốt dính sang đơn mới → hoá đơn sai người (S15336/INV028353, S15342)
//  2. "xuất đơn"/"huỷ đơn INV…" bị máy gom đơn nuốt → hỏi "khách nào", lên đơn trùng S15354
//  3. "30b … x 5200" → model lấy 5200 làm SL (S15339 = 27 triệu)
//  4. "sửa 30 bóng" trên đơn 1 dòng → đem "bóng" đi tra SP
//  5. tạo khách trùng "red sun" dù đã có "Anh Thuận - Red Sun"
import { describe, it, expect, vi } from 'vitest';
import {
  dapSlot, khachKhacNguoiDaChot, laLenhNgoaiGom, docCauSuaSl,
} from '../../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { suaSlGiaNhamX, type KetQuaTrich } from '../../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';
import { taoKhachHang } from '../../../../../src/modules/ai/odoo/tools/tao-khach-hang.js';
import type { PhienGom } from '../../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const phienDaChot = (ten: string): PhienGom => ({
  khachTuKhoa: 'việt nguyễn xiển', khachDaChot: { id: 2532, ten, ma: 'KH001033', dienThoai: null }, dong: [], che: 'len',
});

describe('1. NV nêu khách KHÁC khách đã chốt', () => {
  it('ca 06:41: phiên chốt "anh việt nguyễn xiển", câu mới "anh tùng triều khúc 10c…" → làm lại phần khách, không dính người cũ', () => {
    const p = phienDaChot('anh việt nguyễn xiển - 0911833666');
    expect(khachKhacNguoiDaChot(p, 'anh tùng triều khúc')).toBe(true);
    const doi = dapSlot(p, { lenDon: true, khach: 'anh tùng triều khúc', dong: [{ sp: '12v400w nb', sl: 10, gia: 150000 }] });
    expect(doi).toBe(true);
    expect(p.khachDaChot).toBeUndefined();
    expect(p.khachTuKhoa).toBe('anh tùng triều khúc');
  });
  it('ca 07:02: khách tự chốt "Anh Lộc Led Beco Thanh Hóa" ≠ "Red Sun" → bỏ; cùng người viết khác ("a Long" ~ "Anh Long Led") → giữ', () => {
    expect(khachKhacNguoiDaChot(phienDaChot('Anh Lộc Led Beco Thanh Hóa'), 'Red Sun')).toBe(true);
    const p = phienDaChot('Anh Long Led');
    expect(khachKhacNguoiDaChot(p, 'a Long')).toBe(false);
    dapSlot(p, { lenDon: true, khach: 'a Long' });
    expect(p.khachDaChot?.ten).toBe('Anh Long Led');
  });
  it('chế SỬA không đụng khách', () => {
    const p = phienDaChot('Anh Long Led'); p.che = 'sua';
    expect(khachKhacNguoiDaChot(p, 'Red Sun')).toBe(false);
  });
});

describe('2. lệnh ngoài việc gom đơn', () => {
  it.each(['xuất đơn', 'xuất đơn nhé', 'Xuất đơn chính thức anh lộc led 88', 'in đơn', 'in lại đơn anh Long', 'hủy đơn này INV/2026/028353', 'huỷ đơn S15339', 'xoá đơn S15342'])
    ('nhường agent thường: %s', (c) => expect(laLenhNgoaiGom(c)).toBe(true));
  it.each(['lên đơn cho anh Long 5 cái nguồn', 'sửa đơn số lượng 30b', 'huỷ đơn này', 'huỷ', 'A lộc 88. 30b full đầu trong 26803 x5200đ. lên đơn', '2'])
    ('vẫn là việc gom đơn: %s', (c) => expect(laLenhNgoaiGom(c)).toBe(false));
});

describe('3. "x 5200" là GIÁ, không phải số lượng', () => {
  it('ca 06:51: "Lộc led 88 / 30b f30 full 26803 đầu trong x 5200" mà model trả sl=5200 không giá → sl=30, gia=5200', () => {
    const t: KetQuaTrich = { lenDon: true, khach: 'Lộc led 88', dong: [{ sp: 'f30 full 26803 đầu trong', sl: 5200 }] };
    suaSlGiaNhamX('Lộc led 88 / 30b f30 full 26803 đầu trong x 5200 @Tiểu Mã Nelia', t);
    expect(t.dong?.[0]).toMatchObject({ sl: 30, gia: 5200 });
  });
  it('model trích đúng → không đụng; "10n" không phải đơn vị → không đoán; không có "x" → không đụng', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: 'f30', sl: 30, gia: 5200 }] };
    suaSlGiaNhamX('30b f30 x 5200', a); expect(a.dong?.[0]).toMatchObject({ sl: 30, gia: 5200 });
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: '12v400w nb', sl: 150 }] };
    suaSlGiaNhamX('Tùng triều khúc / 10n 12v400w nb x 150k', b); expect(b.dong?.[0]).toMatchObject({ sl: 150 });
    const c: KetQuaTrich = { lenDon: true, dong: [{ sp: 'nguồn', sl: 5200 }] };
    suaSlGiaNhamX('5200 nguồn cho anh A', c); expect(c.dong?.[0].gia).toBeUndefined();
  });
});

describe('4. sửa số lượng đơn một dòng', () => {
  it.each([['sua 30 bong', 30], ['doi so luong. khach chi lay 30 bong thoi', 30], ['sua don so luong 30b', 30], ['sua don anh loc led88 tu 5200 bong thanh 30 bong', null], ['sua gia nguon 175k', null], ['30', 30]])
    ('%s → %s', (cau, kq) => expect(docCauSuaSl(cau)).toBe(kq));
});

describe('5. tạo khách: tên gần giống khách cũ → không tạo', () => {
  it('"red sun" khi đã có "Anh Thuận - Red Sun" → lỗi liệt kê, KHÔNG execute create', async () => {
    const searchRead = vi.fn(async (_m: string, domain: unknown[][]) => {
      const dk = JSON.stringify(domain);
      if (dk.includes('"ilike"')) return [{ id: 344, name: 'Anh Thuận - Red Sun', ref: 'KH003011AC' }, { id: 767, name: 'Cty Red Sun - Đông Anh', ref: 'KH002657 AC' }];
      return [];
    });
    const execute = vi.fn(async () => 999);
    const kq = await taoKhachHang({ odoo: { searchRead, execute } as never }, { ten: 'red sun' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('Anh Thuận - Red Sun');
    expect(execute).not.toHaveBeenCalled();
  });
});
