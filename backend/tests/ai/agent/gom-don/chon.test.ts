// SPDX-License-Identifier: AGPL-3.0-or-later
// Map câu chọn của NV lên ứng viên — code tất định, không LLM.
import { describe, it, expect } from 'vitest';
import { apDungChon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const h1 = { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901234567', congNo: 0 };
const h2 = { id: 8, ten: 'Trần Hưng', ma: 'KH000022', dienThoai: '0987654321', congNo: 0 };
const nb1 = { id: 3, ten: 'Nguồn NB 12V100W', ma: null, gia: 185000, donVi: null };
const nb2 = { id: 4, ten: 'Nguồn NB 24V200W', ma: null, gia: 320000, donVi: null };
const phien = (): PhienGom => ({
  khachTuKhoa: 'Hưng', khachUngVien: [h1, h2],
  dong: [{ tuKhoa: 'nguồn NB', sl: 10, ungVien: [nb1, nb2] }],
});

describe('apDungChon', () => {
  it('"1a" chốt khách 1 + SP a trong một câu', () => {
    const p = phien();
    expect(apDungChon(p, '1a')).toBe(true);
    expect(p.khachDaChot?.id).toBe(7);
    expect(p.dong[0].daChot?.id).toBe(3);
    expect(p.khachUngVien).toBeUndefined();
    expect(p.dong[0].ungVien).toBeUndefined();
  });

  it('"2" chỉ chốt khách, SP vẫn chờ; "b" sau đó chốt SP', () => {
    const p = phien();
    expect(apDungChon(p, '2')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
    expect(p.dong[0].ungVien).toHaveLength(2);
    expect(apDungChon(p, 'b')).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(4);
  });

  it('"KH000022" chốt đúng khách theo mã (không phân biệt hoa thường)', () => {
    const p = phien();
    expect(apDungChon(p, 'kh000022')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
  });

  it('SĐT (kể cả +84) chốt khách; "cái 24V" chốt SP theo mảnh tên duy nhất', () => {
    const p = phien();
    expect(apDungChon(p, '+84987654321')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
    expect(apDungChon(p, 'cái 24V')).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(4);
  });

  it('mảnh tên khớp NHIỀU ứng viên → không chốt bừa', () => {
    const p = phien();
    // "Hưng" khớp cả h1 lẫn h2 → giữ nguyên chờ chọn rõ hơn
    expect(apDungChon(p, 'Hưng')).toBe(false);
    expect(p.khachUngVien).toHaveLength(2);
  });

  it('câu không map được → false, phiên NGUYÊN VẸN', () => {
    const p = phien();
    expect(apDungChon(p, 'tồn kho còn nhiêu?')).toBe(false);
    expect(p.khachUngVien).toHaveLength(2);
    expect(p.dong[0].ungVien).toHaveLength(2);
  });

  it('"Trần Hưng" (khớp duy nhất h2 nhờ mảnh "tran") chốt được', () => {
    const p = phien();
    expect(apDungChon(p, 'Trần Hưng')).toBe(true);
    expect(p.khachDaChot?.id).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 23:16 07/08: "xuất hóa đơn luôn giúp tôi nhé" — chữ "hoà" khớp
// địa chỉ "hiệp hoà, Bắc giang" của khách #9 → chốt NHẦM khách → đơn S13814
// sai người. Câu DÀI không bao giờ là câu chọn.
describe('câu dài không phải câu chọn — không dò mảnh tên', () => {
  const tuanBG = {
    id: 9, ten: 'Anh Tuấn  BG   Tuấn qc cổng trường cấp 3 số 1 thị trấn thắng, hiệp hoà, Bắc giang: Sđt 0906488187',
    ma: 'KH001409', dienThoai: null, congNo: 0,
  };
  const tuan5 = { id: 5, ten: 'Anh Nguyễn - Tuấn', ma: 'KH002262', dienThoai: null, congNo: 0 };

  it('"xuất hóa đơn luôn giúp tôi nhé" → false, KHÔNG chốt khách hiệp hoà (replay S13814)', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Tuấn', khachUngVien: [tuan5, tuanBG],
      dong: [{ tuKhoa: 'cáp 16 sợi nhỏ', sl: 10, daChot: { id: 1051, ten: 'cáp 16 sợi nhỏ (cuộn)', gia: 170000 } }],
    };
    expect(apDungChon(p, 'xuất hóa đơn luôn giúp tôi nhé')).toBe(false);
    expect(p.khachDaChot).toBeUndefined();
    expect(p.khachUngVien).toHaveLength(2);
  });

  it('câu chọn NGẮN vẫn chạy: "Nguyễn" chốt đúng khách 5', () => {
    const p: PhienGom = { khachTuKhoa: 'Tuấn', khachUngVien: [tuan5, tuanBG], dong: [] };
    expect(apDungChon(p, 'Nguyễn')).toBe(true);
    expect(p.khachDaChot?.id).toBe(5);
  });
});
