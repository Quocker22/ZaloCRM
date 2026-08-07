// SPDX-License-Identifier: AGPL-3.0-or-later
// Lời gửi nhân viên là template tất định — không LLM, không bịa, không lặp lú.
import { describe, it, expect } from 'vitest';
import { renderLoiNhan } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const pChon: PhienGom = {
  khachTuKhoa: 'Hưng',
  khachUngVien: [
    { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567', congNo: 0 },
    { id: 8, ten: 'Trần Hưng', ma: 'KH000022', dienThoai: '0987654321', congNo: 0 },
  ],
  dong: [{
    tuKhoa: 'nguồn NB', sl: 10,
    ungVien: [
      { id: 3, ten: 'Nguồn NB 12V100W', ma: null, gia: 185000, donVi: null },
      { id: 4, ten: 'Nguồn NB 24V200W', ma: null, gia: 320000, donVi: null },
    ],
  }],
};

describe('renderLoiNhan', () => {
  it('hoi_chon: MỘT tin gộp khách (1..n kèm mã+SĐT) và SP (a.. kèm giá), hướng dẫn "1a"', () => {
    const s = renderLoiNhan({ loai: 'hoi_chon' }, pChon);
    expect(s).toContain('1) Hưng Cty A · KH001017 · 0901234567');
    expect(s).toContain('2) Trần Hưng · KH000022 · 0987654321');
    expect(s).toContain('a) Nguồn NB 12V100W · 185.000đ');
    expect(s).toContain('b) Nguồn NB 24V200W · 320.000đ');
    expect(s.toLowerCase()).toContain('vd: 1a');
    expect(s).not.toContain('undefined');
    expect(s).not.toContain('bao nhiêu'); // cấm hỏi lại SL đã có
  });

  it('hoi_chon chỉ còn SP (khách đã chốt) → không in mục khách', () => {
    const p: PhienGom = {
      ...pChon,
      khachUngVien: undefined,
      khachDaChot: { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567' },
    };
    const s = renderLoiNhan({ loai: 'hoi_chon' }, p);
    expect(s).not.toContain('1) Hưng Cty A');
    expect(s).toContain('a) Nguồn NB 12V100W · 185.000đ');
  });

  it('tom_tat_cho_chot: đủ khách + dòng + SL + tổng tiền, có chữ chốt', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng',
      khachDaChot: { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567' },
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 } }],
    };
    const s = renderLoiNhan({ loai: 'tom_tat_cho_chot' }, p);
    expect(s).toContain('Hưng Cty A');
    expect(s).toContain('10 × Nguồn NB 12V100W');
    expect(s).toContain('1.850.000đ');
    expect(s.toLowerCase()).toContain('chốt');
  });

  it('hoi_thieu sl: nêu đúng tên SP còn thiếu SL', () => {
    const p: PhienGom = {
      khachTuKhoa: null,
      dong: [{ tuKhoa: 'nguồn NB', sl: null, daChot: { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 } }],
    };
    const s = renderLoiNhan({ loai: 'hoi_thieu', thieu: 'sl' }, p);
    expect(s).toContain('Nguồn NB 12V100W');
  });

  it('hoi_thieu khach / sp có câu hỏi rõ ràng', () => {
    const p: PhienGom = { khachTuKhoa: null, dong: [] };
    expect(renderLoiNhan({ loai: 'hoi_thieu', thieu: 'khach' }, p)).toMatch(/khách nào/i);
    expect(renderLoiNhan({ loai: 'hoi_thieu', thieu: 'sp' }, p)).toMatch(/sản phẩm|hàng/i);
  });

  it('khong_thay: nêu đúng thứ không thấy, gợi ý gõ lại', () => {
    const s = renderLoiNhan(
      { loai: 'khong_thay', khach: 'Hưngg', sp: ['abc xyz'] },
      { khachTuKhoa: 'Hưngg', khachKhongThay: true, dong: [] },
    );
    expect(s).toContain('Hưngg');
    expect(s).toContain('abc xyz');
  });
});
