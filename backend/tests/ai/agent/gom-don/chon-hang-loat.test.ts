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

describe('apChonDeXuat — kênh lựa chọn mềm của model, code validate', () => {
  it('đề xuất hợp lệ {khach:1, sp:[a,c]} → chốt đúng, NCC + 2 nhóm', async () => {
    const { apChonDeXuat } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js');
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 2);

    expect(apChonDeXuat(p, 1, ['a', 'c'])).toBe(true);
    expect(p.khachDaChot?.ma).toBe('NCC000001');
    expect(p.dong[0].daChot?.ten).toBe('SP 0-a');
    expect(p.dong[1].daChot?.ten).toBe('SP 1-c');
  });

  it('"?" giữ chỗ nhóm chưa chắc → nhóm đó còn treo, thứ tự các nhóm sau KHÔNG lệch', async () => {
    const { apChonDeXuat } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js');
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 3);

    apChonDeXuat(p, undefined, ['a', '?', 'b']);

    expect(p.dong[0].daChot?.ten).toBe('SP 0-a');
    expect(p.dong[1].ungVien?.length).toBe(3); // vẫn treo
    expect(p.dong[2].daChot?.ten).toBe('SP 2-b');
  });

  it('model bịa chữ ngoài phạm vi ("z") / số ngoài danh sách (9) → bỏ ô đó, không phá', async () => {
    const { apChonDeXuat } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js');
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 2);

    expect(apChonDeXuat(p, 9, ['z', 'b'])).toBe(true); // chỉ 'b' nhóm 2 ăn
    expect(p.khachUngVien?.length).toBe(2);
    expect(p.dong[0].ungVien?.length).toBe(3);
    expect(p.dong[1].daChot?.ten).toBe('SP 1-b');
  });
});

describe('lamSachTrich — ô chon_khach/chon_sp chống model bịa', () => {
  it('nhận số 1-99 + mảng chữ a-j/? — vứt hình dạng lạ', async () => {
    const { lamSachTrich } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js');

    expect(lamSachTrich({ chon_khach: 2, chon_sp: ['a', '?', 'b'] }))
      .toMatchObject({ chonKhach: 2, chonSp: ['a', '?', 'b'] });
    expect(lamSachTrich({ chon_khach: 0 }).chonKhach).toBeUndefined();
    expect(lamSachTrich({ chon_khach: 'một' }).chonKhach).toBeUndefined();
    // Một phần tử bẩn → vứt CẢ mảng (thứ tự nhóm mà lệch là chọn nhầm hàng).
    expect(lamSachTrich({ chon_sp: ['a', 'xyz'] }).chonSp).toBeUndefined();
  });
});

describe('suaGiaNhanBua — đơn 16 TỶ vì "x1700" thành 1,7 triệu (ca 19:54 12/08)', () => {
  it('"x1700" model trả 1700000 → sửa về 1700 (số trần trong câu, không hậu tố)', async () => {
    const { suaGiaNhanBua } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js');
    const trich = { dong: [{ sp: '3b 6214 trắng', sl: 9600, gia: 1700000 }] };

    suaGiaNhanBua('led Vũ Minh 9600 3b 6214 trắng x1700. 36 cái 12v400w ATX x250k', trich as never);

    expect(trich.dong[0].gia).toBe(1700);
  });

  it('"x250k" CÓ hậu tố → 250000 giữ nguyên, không bị chia ngược', async () => {
    const { suaGiaNhanBua } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js');
    const trich = { dong: [{ sp: 'nguồn ATX', sl: 36, gia: 250000 }] };

    suaGiaNhanBua('36 cái 12v400w ATX x250k', trich as never);

    expect(trich.dong[0].gia).toBe(250000);
  });

  it('câu ghi ĐẦY ĐỦ "1.700.000" → model dịch đúng, không đụng', async () => {
    const { suaGiaNhanBua } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js');
    const trich = { dong: [{ sp: 'x', gia: 1700000 }] };

    suaGiaNhanBua('giá 1.700.000 một bóng', trich as never);

    expect(trich.dong[0].gia).toBe(1700000);
  });

  it('"giá 1800đ" model lỡ trả 1800000 → về 1800', async () => {
    const { suaGiaNhanBua } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js');
    const trich = { dong: [{ sp: '3B 6214 trắng ấm', sl: 3000, gia: 1800000 }] };

    suaGiaNhanBua('3000 3B 6214 trắng ấm x 1800đ', trich as never);

    expect(trich.dong[0].gia).toBe(1800);
  });
});

describe('"1-b" có gạch — dấu ngăn lựa chọn (ca 19:53 12/08)', () => {
  it('"1-b" → khách 1 + nhóm đầu chọn b', () => {
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 1);

    expect(apDungChon(p, '1-b')).toBe(true);
    expect(p.khachDaChot?.ma).toBe('NCC000001');
    expect(p.dong[0].daChot?.ten).toBe('SP 0-b');
  });

  it('"NB-12V400W" khi đang treo KHÔNG bị nuốt thành chọn', () => {
    const p = phienCaThat();

    expect(apDungChon(p, 'NB-12V400W')).toBe(false);
    expect(p.dong.every((d) => d.ungVien?.length === 3)).toBe(true);
  });
});

describe('cặp SỐ-NHÓM "1-b"/"1b 2a" khi KHÔNG còn khách treo (ca 09:53 13/08)', () => {
  const phienKhongKhach = () => {
    const p = phienCaThat();
    delete (p as { khachUngVien?: unknown }).khachUngVien;
    p.khachDaChot = { id: 9, ma: 'KH1', ten: 'Led Vũ Minh', dienThoai: null } as never;
    p.dong = p.dong.slice(0, 2);
    return p;
  };

  it('"1-b" → NHÓM 1 chọn b, nhóm 2 GIỮ NGUYÊN (không lệch sang nhóm khác)', () => {
    const p = phienKhongKhach();

    expect(apDungChon(p, '1-b')).toBe(true);
    expect(p.dong[0].daChot?.ten).toBe('SP 0-b');
    expect(p.dong[1].ungVien?.length).toBe(3);
  });

  it('"1b 2a" → cả hai nhóm chốt đúng', () => {
    const p = phienKhongKhach();

    expect(apDungChon(p, '1b 2a')).toBe(true);
    expect(p.dong[0].daChot?.ten).toBe('SP 0-b');
    expect(p.dong[1].daChot?.ten).toBe('SP 1-a');
  });

  it('khách CÒN treo → "1-b" giữ quy ước cũ (số=khách, chữ=nhóm đầu)', () => {
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 2);

    expect(apDungChon(p, '1-b')).toBe(true);
    expect(p.khachDaChot?.ma).toBe('NCC000001');
    expect(p.dong[0].daChot?.ten).toBe('SP 0-b');
  });
});

describe('render đánh số nhóm khi ≥2 nhóm (đi cặp với parser)', () => {
  it('2 nhóm không khách → "1) ..." "2) ..." + vd "1b 2a"', async () => {
    const { renderLoiNhan } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js');
    const p = phienCaThat();
    delete (p as { khachUngVien?: unknown }).khachUngVien;
    p.dong = p.dong.slice(0, 2);

    const tin = renderLoiNhan({ loai: 'hoi_chon' } as never, p);

    expect(tin).toContain('1) "nhóm 1"');
    expect(tin).toContain('2) "nhóm 2"');
    expect(tin).toContain('vd: 1b 2a');
  });

  it('khách + nhóm → ví dụ "1 a a" (số cho khách), KHÔNG đánh số nhóm', async () => {
    const { renderLoiNhan } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js');
    const p = phienCaThat();
    p.dong = p.dong.slice(0, 2);

    const tin = renderLoiNhan({ loai: 'hoi_chon' } as never, p);

    expect(tin).toContain('vd: 1 a a');
    expect(tin).not.toContain('1) "nhóm 1"');
  });
});
