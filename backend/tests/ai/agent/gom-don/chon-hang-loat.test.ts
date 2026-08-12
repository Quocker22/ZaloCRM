// SPDX-License-Identifier: AGPL-3.0-or-later
// CHỌN HÀNG LOẠT — ca thật 22:54 12/08: bot hỏi NCC + 6 nhóm SP một lượt,
// anh Quốc gõ "1aaaaaa" rồi "1aaaaaa theo thứ tự từ trên xuống" — máy từ chối
// cả hai, còn đem câu sau đi tra nhà cung cấp. "Đã dồn nhiều câu hỏi vào một
// tin thì phải nhận được câu trả lời gộp."
import { describe, it, expect } from 'vitest';
import { apDungChon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const sp = (id: number, ten: string) => ({ id, ten, gia: 1000, ma: null, donVi: null });

/** Phiên đúng hình ca thật: NCC treo (2 lựa chọn) + 6 nhóm SP mỗi nhóm 3 ứng viên. */
function phienCaThat(): PhienGom {
  return {
    khachTuKhoa: 'Trung Quốc',
    khachUngVien: [
      { id: 314, ten: 'Trung Quốc', ma: 'NCC000001', dienThoai: null },
      { id: 21, ten: 'Trung Quốc- Kho Cô Lỳ', ma: 'NCC000290', dienThoai: null },
    ],
    dong: Array.from({ length: 6 }, (_, i) => ({
      tuKhoa: `nhóm ${i + 1}`, sl: 10,
      ungVien: [sp(i * 10 + 1, `SP ${i}-a`), sp(i * 10 + 2, `SP ${i}-b`), sp(i * 10 + 3, `SP ${i}-c`)],
    })),
    viecId: 1,
    che: 'nhap',
  } as never;
}

describe('apDungChon — "1aaaaaa" và họ hàng', () => {
  it('"1aaaaaa" → NCC số 1 + cả 6 nhóm chọn a', () => {
    const p = phienCaThat();

    expect(apDungChon(p, '1aaaaaa')).toBe(true);
    expect(p.khachDaChot?.ma).toBe('NCC000001');
    expect(p.dong.every((d) => d.daChot && !d.ungVien)).toBe(true);
    expect(p.dong.map((d) => d.daChot!.ten)).toEqual(
      ['SP 0-a', 'SP 1-a', 'SP 2-a', 'SP 3-a', 'SP 4-a', 'SP 5-a']);
  });

  it('"1 a a b a c a" tách rời cũng chạy, chọn đúng từng nhóm', () => {
    const p = phienCaThat();

    expect(apDungChon(p, '1 a a b a c a')).toBe(true);
    expect(p.dong.map((d) => d.daChot!.ten)).toEqual(
      ['SP 0-a', 'SP 1-a', 'SP 2-b', 'SP 3-a', 'SP 4-c', 'SP 5-a']);
  });

  it('"tất cả a" → mọi nhóm ăn a (NCC vẫn treo — chưa chọn số)', () => {
    const p = phienCaThat();

    expect(apDungChon(p, 'tất cả a')).toBe(true);
    expect(p.dong.every((d) => d.daChot?.ten.endsWith('-a'))).toBe(true);
    expect(p.khachUngVien?.length).toBe(2);
  });

  it('chữ VƯỢT PHẠM VI ("1aaaaad" — nhóm 6 không có d) → phần chữ vô hiệu, số vẫn ăn', () => {
    const p = phienCaThat();

    apDungChon(p, '1aaaaad');

    expect(p.khachDaChot?.ma).toBe('NCC000001');
    // Không nhóm nào bị chốt bừa bằng chuỗi lệch.
    expect(p.dong.every((d) => d.ungVien?.length === 3)).toBe(true);
  });

  it('REGRESSION 16:15 11/08: "anh long led" KHÔNG bị nuốt thành chuỗi chọn a/n/h...', () => {
    const p = phienCaThat();
    // "anh" có 'n','h' vượt phạm vi a-c → toàn câu không phải mẫu chọn,
    // apDungChon phải trả false để đường tra-tên phía sau xử lý.
    const kq = apDungChon(p, 'anh long led');

    expect(kq).toBe(false);
    expect(p.dong.every((d) => d.ungVien?.length === 3)).toBe(true);
  });

  it('"aaaaaaa" 7 chữ > 6 nhóm treo → không phải mẫu chọn, không nuốt', () => {
    const p = phienCaThat();

    expect(apDungChon(p, 'aaaaaaa')).toBe(false);
    expect(p.dong.every((d) => d.ungVien?.length === 3)).toBe(true);
  });
});
