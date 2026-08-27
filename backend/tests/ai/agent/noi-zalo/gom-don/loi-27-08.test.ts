// SPDX-License-Identifier: AGPL-3.0-or-later
// 5 lỗi gốc từ log 27/08 sáng (nhóm Nelia-Đơn hàng + Dậy học cho AI):
//  1. khách cũ đã chốt dính sang đơn mới → hoá đơn sai người (S15336/INV028353, S15342)
//  2. "xuất đơn"/"huỷ đơn INV…" bị máy gom đơn nuốt → hỏi "khách nào", lên đơn trùng S15354
//  3. "30b … x 5200" → model lấy 5200 làm SL (S15339 = 27 triệu)
//  4. "sửa 30 bóng" trên đơn 1 dòng → đem "bóng" đi tra SP
//  5. tạo khách trùng "red sun" dù đã có "Anh Thuận - Red Sun"
import { describe, it, expect, vi } from 'vitest';
import {
  dapSlot, khachKhacNguoiDaChot, laLenhNgoaiGom, docCauSuaSl, cauNeuKhachKhac,
} from '../../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { suaSlGiaNhamX, apSlTuongMinh, apKhachTheoGachCheo, tachSlDinhDauSp, tachSlDauTenSp, chonUngVienTheoCau, apKhachTheoXungHo, type KetQuaTrich } from '../../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';
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

describe('replay 27/08 — 4 luật thêm sau khi chạy lại 8 kịch bản', () => {
  it('SL tường minh thắng: "Lộc led 88 / 30b f30…" model lấy 88 → 30; "Red Sun : 2607 ấm 10000b" → 10000 và số đầu tên là mã, không phải SL', () => {
    const a: KetQuaTrich = { lenDon: true, khach: 'Lộc led', dong: [{ sp: 'f30 full 26803 đầu trong', sl: 88, gia: 5200 }] };
    apSlTuongMinh('Lộc led 88 / 30b f30 full 26803 đầu trong x 5200', a);
    expect(a.dong?.[0].sl).toBe(30);
    const b: KetQuaTrich = { lenDon: true, khach: 'Red Sun', dong: [{ sp: '2607 ấm 10000b' }] };
    tachSlDinhDauSp(b);
    expect(b.dong?.[0]).toMatchObject({ sp: '2607 ấm 10000b' }); // không tách 2607 thành SL
    apSlTuongMinh('Red Sun : 2607 ấm 10000b x 950₫', b);
    expect(b.dong?.[0].sl).toBe(10000);
  });
  it('SL tường minh KHÔNG áp khi: nhiều token (2 dòng), hoặc số nằm sau "x" (giá), hoặc dòng tặng', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: 'pha 50w trắng', sl: 4 }] };
    apSlTuongMinh('Qc T&T. 4 cái pha 50w trắng x 140k, 1 cái đồng hồ hẹn giờ x 120k', a);
    expect(a.dong?.[0].sl).toBe(4); // 2 token → không đụng
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: 'f30', sl: 30 }] };
    apSlTuongMinh('30b f30 x 5200m', b); // "5200m" đứng sau x → không phải SL
    expect(b.dong?.[0].sl).toBe(30);
  });
  it('khách theo dấu " / ": "Lộc led 88 / …" → khach "Lộc led 88" (model hay cắt mất 88); "Kiên định công / 4n…" → "Kiên định công"; câu không có " / " → giữ nguyên', () => {
    const a: KetQuaTrich = { lenDon: true, khach: 'Lộc led', dong: [{ sp: 'f30', sl: 30 }] };
    apKhachTheoGachCheo('Lộc led 88 / 30b f30 full 26803 đầu trong x 5200 @Tiểu Mã Nelia', a);
    expect(a.khach).toBe('Lộc led 88');
    const b: KetQuaTrich = { lenDon: true, khach: 'Kiên', dong: [] };
    apKhachTheoGachCheo('Kiên định công / 4n 24v600w x 260k', b);
    expect(b.khach).toBe('Kiên định công');
    const c: KetQuaTrich = { lenDon: true, khach: 'Qc T&T', dong: [] };
    apKhachTheoGachCheo('Qc T&T. 4 cái pha 50w trắng x 140k', c);
    expect(c.khach).toBe('Qc T&T');
  });
  it('câu nêu KHÁCH KHÁC ngay sau đơn vừa lên → không phải tham chiếu sửa', () => {
    expect(cauNeuKhachKhac('anh tùng triều khúc 10c 12v400w nb giá 150K', 'anh việt nguyễn xiển - 0911833666')).toBe(true);
    expect(cauNeuKhachKhac('Red Sun : 2607 ấm 10000b x 950₫', 'Anh Lộc Led Beco Thanh Hóa')).toBe(false); // không có " / " và không bắt đầu bằng xưng hô → để model
    expect(cauNeuKhachKhac('Lộc led 88 / 30b f30', 'Anh Lộc Led88')).toBe(false);
    expect(cauNeuKhachKhac('giá 9000k', 'Anh Long Led')).toBe(false);
    expect(cauNeuKhachKhac('a long led ,cáp 16PIN 140cm = 16 sợi', 'Anh Long Led')).toBe(false);
  });

  it('rào mảnh tên: "thanh toả 1m" không phải SL 1; "9600 3b 6214" vẫn tách 9600; câu có khối [Trả lời tin] chứa "/" không thành khách', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: 'Led thanh toả 1m ngoài trời Lixin màu Trắng' }] };
    apSlTuongMinh('160 Led thanh toả 1m ngoài trời Lixin màu Trắng', a);
    expect(a.dong?.[0].sl).toBeUndefined(); // "160" không có đơn vị, "1m" là tên → không đoán
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: '9600 3b 6214 trắng' }] };
    tachSlDinhDauSp(b);
    expect(b.dong?.[0]).toMatchObject({ sp: '3b 6214 trắng', sl: 9600 });
    const c: KetQuaTrich = { lenDon: true, khach: 'Trung Quốc', dong: [] };
    apKhachTheoGachCheo('[Trả lời tin: "P10 / P5 full out"] nhập hàng Trung Quốc', c);
    expect(c.khach).toBe('Trung Quốc');
  });

  it('model đã có SL → token giữa tên ("10 cáp 16 sợi nhỏ") không ghi đè; đầu vế ("/ 30b") và cuối câu ("10000b x 950₫") vẫn ghi đè', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: 'cáp 16 sợi nhỏ', sl: 10 }] };
    apSlTuongMinh('lên đơn cho khách mới Chiến Tàm Xá sdt 0969810330, 10 cáp 16 sợi nhỏ', a);
    expect(a.dong?.[0].sl).toBe(10);
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: 'cáp 16PIN 140cm', sl: 140 }] };
    apSlTuongMinh('a long led ,cáp 16PIN 140cm = 16 sợi', b);
    expect(b.dong?.[0].sl).toBe(16);
  });

  it('tên hàng dính SL ở đầu: "270b Fi50 full 26803 đầu đục" → sl 270, sp "Fi50 …"; "3b 6214 trắng" giữ nguyên; sl model khác số đầu → số đầu thắng', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: '270b Fi50 full 26803 đầu đục', gia: 7200 }] };
    tachSlDauTenSp(a);
    expect(a.dong?.[0]).toMatchObject({ sp: 'Fi50 full 26803 đầu đục', sl: 270 });
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: '3b 6214 trắng' }] };
    tachSlDauTenSp(b);
    expect(b.dong?.[0]).toMatchObject({ sp: '3b 6214 trắng' });
    const c: KetQuaTrich = { lenDon: true, dong: [{ sp: '30b f30 full', sl: 5200 }] };
    tachSlDauTenSp(c); // model lấy 5200 từ "x 5200" → SL tường minh đầu tên thắng
    expect(c.dong?.[0]).toMatchObject({ sp: 'f30 full', sl: 30 });
  });

  it('chọn SP theo câu gốc khi tên trích cụt: "… 26803 đầu trong" → F30 Trong; "4 bóng lixin 220v" không chọn Led dây Lixin; 2 loại đục hoà → hỏi', () => {
    const f30 = [
      { id: 1, ten: 'F30 full 26803 Đục 12V - ATX (bóng)' },
      { id: 2, ten: 'F30 Full 26803 Trong 12V - ATX (bóng)' },
      { id: 3, ten: 'led F30 Full đục DMX (bóng)' },
    ];
    expect(chonUngVienTheoCau('Lộc led 88 / 30b f30 full 26803 đầu trong x 5200', f30)?.id).toBe(2);
    expect(chonUngVienTheoCau('Lộc led 88 / 30b f30 full 26803 đầu đục x 5200', f30)?.id).toBe(1); // "26803" loại DMX ra
    expect(chonUngVienTheoCau('Lộc led 88 / 30b f30 full đầu đục x 5200', f30)).toBeNull(); // 2 loại đục hoà → hỏi
    expect(chonUngVienTheoCau('Lộc led 88 / 30b f30 full 26803 đầu trong x 5200', f30.slice(0, 2))?.id).toBe(2); // đúng ca prod (đường nới, 2 kq)
    const lixin = [
      { id: 1, ten: 'Led dây Lixin 12V-120b/m màu trung tính 4000K ip65 (20m/c) (mét)' },
      { id: 2, ten: 'Led 4 bóng 24V Trong Nhà Trung Tính 4000K (bóng)' },
      { id: 3, ten: 'Led 4 bóng 24V Ngoài Trời Trung Tính 4000K (bóng)' },
    ];
    expect(chonUngVienTheoCau('anh việt nguyễn xiển 400b 4 bóng lixin 220v 4000K giá 3200', lixin)).toBeNull();
    const fi50 = [
      { id: 1, ten: 'Led Fi50 Tự Nháy IC26803 24V fullcolor Đầu Đục (bóng)' },
      { id: 2, ten: 'Led Fi50 Tự Nháy IC 26803 24V fullcolor Đầu Trong' },
      { id: 3, ten: 'F30 full 26803 Đục 12V - ATX (bóng)' },
    ];
    expect(chonUngVienTheoCau('Led Trường An. 270b Fi50 full 26803 đầu đục giá 7200', fi50)).toBeNull(); // 2 loại đục, phủ thấp → hỏi
  });

  it('khách theo xưng hô: model trích "việt" → "anh việt nguyễn xiển"; "lên đơn cho chị phương ali 4 bóng…" → "chị phương ali"; model trích đủ/khác → giữ; khách mới → giữ', () => {
    const a: KetQuaTrich = { lenDon: true, khach: 'việt', dong: [{ sp: '4 bóng lixin 220v 4000K', sl: 400 }] };
    apKhachTheoXungHo('anh việt nguyễn xiển 400b 4 bóng lixin 220v 4000K giá 3200', a);
    expect(a.khach).toBe('anh việt nguyễn xiển');
    const b: KetQuaTrich = { lenDon: true, dong: [] };
    apKhachTheoXungHo('lên đơn cho chị phương ali 4 bóng lixin 4000k trung tính trong nhà 500 bóng giá 2800', b);
    expect(b.khach).toBe('chị phương ali');
    const c: KetQuaTrich = { lenDon: true, khach: 'Lộc led 88', dong: [] };
    apKhachTheoXungHo('Anh Lộc led 88. 30b f30', c);
    expect(c.khach).toBe('Lộc led 88');
    const d: KetQuaTrich = { lenDon: true, khach: 'Long', khachMoi: { ten: 'Anh Long Hà Nam' }, dong: [] };
    apKhachTheoXungHo('anh long hà nam 5 cái nguồn', d);
    expect(d.khach).toBe('Long');
    const e: KetQuaTrich = { lenDon: true, khach: 'a long led', dong: [] };
    apKhachTheoXungHo('a long led ,cáp 16PIN 140cm = 16 sợi', e);
    expect(e.khach).toBe('a long led');
  });
  it('phiên treo chọn khách + câu nêu khách KHÁC HẲN kèm hàng riêng → bỏ dòng khách cũ; cùng người viết khác → giữ dòng', () => {
    const p: PhienGom = { khachTuKhoa: 'anh việt nguyễn xiển', khachUngVien: [{ id: 1, ten: 'Anh Việt', ma: 'KH1', dienThoai: null }], dong: [{ tuKhoa: '4 bóng lixin 220v', sl: 400 }], che: 'len' };
    dapSlot(p, { lenDon: true, khach: 'anh tùng triều khúc', dong: [{ sp: '12v400w nb', sl: 10, gia: 150000 }] });
    expect(p.dong.map((d) => d.tuKhoa)).toEqual(['12v400w nb']);
    expect(p.khachTuKhoa).toBe('anh tùng triều khúc');
    const q: PhienGom = { khachTuKhoa: 'Anh Long Led', khachUngVien: [], dong: [{ tuKhoa: 'cáp 16pin 140cm', sl: 16 }], che: 'len' };
    dapSlot(q, { lenDon: true, khach: 'a Long', dong: [{ sp: 'cáp 16pin 120cm', sl: 64 }] });
    expect(q.dong.length).toBe(2);
  });
});
