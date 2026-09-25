// SPDX-License-Identifier: AGPL-3.0-or-later
// Test nguồn nhãn máy in — hợp đồng nhật ký máy in v2 (24/09/2026) §1 + §3.3.
import { describe, it, expect } from 'vitest';
import { MA_SU_CO, MA_SU_KIEN, nhanCua, mucDoCua, kieuMucDo } from './may-in-nhan';

describe('nhanCua — mã → nhãn tiếng Việt', () => {
  it('mã §1 ra đúng nhãn hợp đồng', () => {
    expect(nhanCua('het_giay')).toBe('Hết giấy');
    expect(nhanCua('ket_giay')).toBe('Kẹt giấy');
    expect(nhanCua('khong_xac_nhan')).toBe('Đã gửi máy in nhưng không xác nhận được đã in');
  });
  it('mã §3.3 có nhãn tiếng Việt, không trả lại mã', () => {
    for (const ma of Object.keys(MA_SU_KIEN)) {
      expect(nhanCua(ma)).not.toBe(ma);
      expect(nhanCua(ma).length).toBeGreaterThan(0);
    }
    expect(nhanCua('da_in')).toBe('Đã in');
  });
  it('mã hàng đợi/huỷ (v5.1 §8.8) — "bỏ theo dõi" KHÔNG bao giờ là "đã huỷ"', () => {
    expect(nhanCua('da_huy')).toBe('Đã huỷ lệnh in');
    expect(nhanCua('huy_that_bai')).toBe('Không huỷ được lệnh in');
    expect(nhanCua('bo_theo_doi')).toBe('Bỏ theo dõi lệnh in');
    expect(nhanCua('bo_theo_doi')).not.toMatch(/huỷ/i);
  });
  it('mã lạ → hiện NGUYÊN mã (không nuốt)', () => {
    expect(nhanCua('ma_moi_chua_biet')).toBe('ma_moi_chua_biet');
  });
  it('rỗng/null → "—"', () => {
    expect(nhanCua('')).toBe('—');
    expect(nhanCua(null)).toBe('—');
    expect(nhanCua(undefined)).toBe('—');
  });
  it('tên thuộc tính của Object không lọt thành nhãn', () => {
    expect(nhanCua('constructor')).toBe('constructor');
    expect(nhanCua('__proto__')).toBe('__proto__');
    expect(mucDoCua('toString')).toBeNull();
  });
});

describe('mucDoCua — mức theo hợp đồng', () => {
  it('đủ 12 mã §1 và 20 mã §3.3 (13 cũ + 4 của cầu dao/mất kết nối lâu + 3 của hàng đợi/huỷ), không trùng khoá giữa hai bảng', () => {
    expect(Object.keys(MA_SU_CO)).toHaveLength(12);
    expect(Object.keys(MA_SU_KIEN)).toHaveLength(20);
    const trung = Object.keys(MA_SU_CO).filter((k) => k in MA_SU_KIEN);
    expect(trung).toEqual([]);
  });
  it('§1: chỉ het_muc là cảnh báo, binh_thuong là thông tin, còn lại là lỗi', () => {
    for (const [ma, mt] of Object.entries(MA_SU_CO)) {
      const mong = ma === 'het_muc' ? 'canh_bao' : ma === 'binh_thuong' ? 'thong_tin' : 'loi';
      expect(mt.mucDo, ma).toBe(mong);
    }
  });
  it('§3.3: mức khớp bảng hợp đồng', () => {
    const mong: Record<string, string> = {
      nhan_job: 'thong_tin', gui_may_in: 'thong_tin', da_in: 'thong_tin',
      loi_thu_lai: 'canh_bao', app_offline_thu_lai: 'canh_bao', loi_odoo: 'canh_bao',
      khong_co_may_in: 'loi', that_bai: 'loi', khong_ro: 'loi', het_gio_cho: 'loi',
      ket_qua_tre: 'thong_tin', app_ket_noi: 'thong_tin', app_mat_ket_noi: 'thong_tin',
      app_offline_lau: 'canh_bao', tam_giu: 'canh_bao', cho_may_in: 'thong_tin', tiep_tuc_in: 'thong_tin',
      da_huy: 'thong_tin', huy_that_bai: 'canh_bao', bo_theo_doi: 'canh_bao',
    };
    for (const [ma, muc] of Object.entries(mong)) expect(mucDoCua(ma), ma).toBe(muc);
  });
  it('mã lạ → null', () => {
    expect(mucDoCua('xyz')).toBeNull();
    expect(mucDoCua(null)).toBeNull();
  });
});

describe('kieuMucDo — màu chip', () => {
  it('lỗi đỏ, cảnh báo vàng, thông tin xanh', () => {
    expect(kieuMucDo('loi')).toMatchObject({ nhan: 'Lỗi', mau: 'error' });
    expect(kieuMucDo('canh_bao')).toMatchObject({ nhan: 'Cảnh báo', mau: 'warning' });
    expect(kieuMucDo('thong_tin')).toMatchObject({ nhan: 'Thông tin', mau: 'info' });
  });
  it('mức lạ → xám, nhãn là chính nó; rỗng → "—"', () => {
    expect(kieuMucDo('nghiem_trong')).toMatchObject({ nhan: 'nghiem_trong', mau: 'grey' });
    expect(kieuMucDo(null).nhan).toBe('—');
  });
});
