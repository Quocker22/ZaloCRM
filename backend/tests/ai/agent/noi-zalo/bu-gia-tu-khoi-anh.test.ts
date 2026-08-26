// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 16:23 26/08: ảnh hoá đơn ghi giá 9.000/12.000, model đọc ảnh chép
// đúng, nhưng lượt trích slot thật bỏ `gia` → đơn S15326 lên giá hệ thống.
import { describe, it, expect } from 'vitest';
import { boSungGiaTuKhoiAnh, type KetQuaTrich } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';

const KHOI = `[Khách gửi ảnh — ĐÂY LÀ NỘI DUNG THẬT ĐỌC ĐƯỢC TỪ ẢNH, coi như chính người gửi vừa gõ ra:
**HÓA ĐƠN BÁN HÀNG**
- Khách hàng: QC Hoàng Nguyễn - 0989271275
- Vỏ Neon 6mm Xanh Ngọc (50cm/1m): 30 Mét, giá 9.000 đ
- Led Dây chữ S 6mm 120 Led 1M xanh ngọc (m): 30 Mét, giá 12.000 đ
- Tổng cộng: 60, 630.000 đ]
lên đơn như này nhưng số lượng 20m mỗi loại, Led đơn nhé, khách trong hình luôn`;

describe('boSungGiaTuKhoiAnh', () => {
  it('ca thật: trích thiếu giá → bù 9.000 và 12.000 từ khối ảnh, giữ SL 20 của NV', () => {
    const trich: KetQuaTrich = { lenDon: true, khach: 'QC Hoàng Nguyễn', dong: [
      { sp: 'Vỏ Neon 6mm Xanh Ngọc', sl: 20 },
      { sp: 'Led Dây chữ S 6mm 120 Led 1m xanh ngọc', sl: 20 },
    ] };
    boSungGiaTuKhoiAnh(KHOI, trich);
    expect(trich.dong?.map((d) => d.gia)).toEqual([9000, 12000]);
    expect(trich.dong?.map((d) => d.sl)).toEqual([20, 20]);
  });

  it('KHÔNG đè giá model đã trích (NV báo giá mới trong caption), không đụng dòng tặng', () => {
    const trich: KetQuaTrich = { lenDon: true, dong: [
      { sp: 'Vỏ Neon 6mm Xanh Ngọc', sl: 20, gia: 8500 },
      { sp: 'Led Dây chữ S 6mm 120 Led 1m xanh ngọc', sl: 1, tang: true },
    ] };
    boSungGiaTuKhoiAnh(KHOI, trich);
    expect(trich.dong?.[0].gia).toBe(8500);
    expect(trich.dong?.[1].gia).toBeUndefined();
  });

  it('không có khối ảnh → không đổi gì; tên mơ hồ khớp 2 dòng ảnh → để nguyên cho máy hỏi', () => {
    const a: KetQuaTrich = { lenDon: true, dong: [{ sp: 'Vỏ Neon 6mm Xanh Ngọc', sl: 20 }] };
    boSungGiaTuKhoiAnh('lên đơn 20m vỏ neon xanh ngọc', a);
    expect(a.dong?.[0].gia).toBeUndefined();
    const khoi2 = '[Khách gửi ảnh: x\n- Vỏ Neon 6mm Xanh Ngọc 50m: 30 m, giá 9.000 đ\n- Vỏ Neon 6mm Xanh Ngọc 100m: 30 m, giá 12.000 đ]\nlên đơn';
    const b: KetQuaTrich = { lenDon: true, dong: [{ sp: 'Vỏ Neon 6mm Xanh Ngọc', sl: 20 }] };
    boSungGiaTuKhoiAnh(khoi2, b);
    expect(b.dong?.[0].gia).toBeUndefined();
  });

  it('hậu tố k/tr đổi ra đồng ("giá 170k" → 170000)', () => {
    const t: KetQuaTrich = { lenDon: true, dong: [{ sp: 'nguồn NB 12V400W', sl: 5 }] };
    boSungGiaTuKhoiAnh('[Khách gửi ảnh: danh sách\n- Nguồn NB 12V400W: 10 cái, giá 170k]\nlên đơn như này', t);
    expect(t.dong?.[0].gia).toBe(170000);
  });
});
