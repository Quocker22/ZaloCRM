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

  // Bỏ bước hỏi chốt (anh Quốc 11/08: "nếu mọi thứ đã rõ ràng thì lên đơn báo
  // giá luôn") — nhưng NỘI DUNG tóm tắt phải còn nguyên: nhân viên vẫn cần soát
  // bot hiểu đúng gì. Đổi THÌ, không đổi thông tin: câu hỏi thành lời thông báo.
  it('tom_tat_don: đủ khách + dòng + SL + tổng tiền, KHÔNG hỏi chốt nữa', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng',
      khachDaChot: { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567' },
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 } }],
    };
    const s = renderLoiNhan({ loai: 'tom_tat_don' }, p);
    expect(s).toContain('Hưng Cty A');
    expect(s).toContain('KH001017');
    expect(s).toContain('10 × Nguồn NB 12V100W');
    expect(s).toContain('1.850.000đ');
    expect(s).not.toContain('Em chốt lên đơn nhé?');
    expect(s).not.toContain('?');
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

// ═══════════════════════════════════════════════════════════════════════════
// Chế SỬA ĐƠN (spec 08/08)
describe('renderLoiNhan — chế sua', () => {
  const donA = { id: 26737, ma: 'S13820', tong: 1070000 };
  const donB = { id: 26738, ma: 'S13821', tong: 780000 };

  it('hoi_chon_don: liệt kê mã đơn + tổng tiền, đánh số', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donUngVien: [donA, donB], dong: [] };
    const s = renderLoiNhan({ loai: 'hoi_chon_don' }, p);
    expect(s).toContain('1) S13820 · 1.070.000đ');
    expect(s).toContain('2) S13821 · 780.000đ');
    expect(s.toLowerCase()).toContain('đơn nào');
  });

  it('khong_thay_don: nói rõ không có đơn nháp nào', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donKhongThay: true, dong: [] };
    const s = renderLoiNhan({ loai: 'khong_thay_don' }, p);
    expect(s.toLowerCase()).toContain('không thấy');
    expect(s.toLowerCase()).toContain('nháp');
  });

  it('hoi_thieu sp ở chế sửa: hỏi thêm/đổi hàng gì, có nhắc mã đơn', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donSua: donA, dong: [] };
    const s = renderLoiNhan({ loai: 'hoi_thieu', thieu: 'sp' }, p);
    expect(s).toContain('S13820');
  });
});
