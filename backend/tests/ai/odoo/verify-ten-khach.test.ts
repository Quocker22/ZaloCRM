// SPDX-License-Identifier: AGPL-3.0-or-later
// HÀNG RÀO XÁC MINH TÊN cho các tool TRA CỨU khách.
//
// Bug thật 20:06 10/08: nhân viên hỏi công nợ "anh Vấn", model bốc mã KH001409
// (anh Tuấn BG) từ danh sách trong lịch sử chat cũ rồi tra theo mã đó → bot
// báo công nợ của NGƯỜI KHÁC, nói rành mạch như thật.
//
// Cùng kiểu bug với S13810 (07/08, đơn sai khách). Lúc đó chỉ vá tao_don_nhap;
// các tool TRA CỨU vẫn hở — nên lỗ hổng còn nguyên, chỉ đổi chỗ lộ ra.
import { describe, it, expect } from 'vitest';
import { tenKhopKhach } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';

describe('tenKhopKhach — dùng lại cho tool tra cứu', () => {
  it('CHẶN: hỏi "Vấn" mà ra "Anh Tuấn BG …" (bug thật 20:06 10/08)', () => {
    expect(tenKhopKhach('Vấn', 'Anh Tuấn  BG   Tuấn qc cổng trường cấp 3 số 1 thị trấn thắng, hiệp hoà, Bắc giang')).toBe(false);
  });

  it('CHO QUA: hỏi "Vấn" ra "Anh Vấn Đà Nẵng 0934.786.998"', () => {
    expect(tenKhopKhach('Vấn', 'Anh Vấn Đà Nẵng 0934.786.998')).toBe(true);
  });

  it('CHO QUA: bỏ dấu, xưng hô — "anh vấn" vs "Anh Vấn Đà Nẵng"', () => {
    expect(tenKhopKhach('anh vấn', 'Anh Vấn Đà Nẵng 0934.786.998')).toBe(true);
  });

  // 'Hưng' bỏ dấu = 'hung', nằm trong 'huy chung' → hàm CHO QUA. Đây là giới
  // hạn đã biết của khớp-chuỗi-con; ca S13810 được chặn nhờ tầng khác (model
  // buộc phải truyền ten_khach và id lấy từ tra_khach_hang).
  it('giới hạn đã biết: chuỗi con vẫn lọt (Hưng ⊂ Huy Chung)', () => {
    expect(tenKhopKhach('Hưng', 'Huy Chung')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
import { describe as d2, it as i2, expect as e2, vi } from 'vitest';
import { xuatCongNo, xuatCongNoDefinition } from '../../../src/modules/ai/odoo/tools/xuat-cong-no.js';

d2('xuat_cong_no — chặn tra nhầm khách', () => {
  const fakeOdoo = () => ({
    searchRead: vi.fn(async (model: string) =>
      (model === 'res.partner'
        ? [{ id: 2160, name: 'Anh Tuấn  BG   Tuấn qc cổng trường cấp 3', ref: 'KH001409', phone: '0906488187', incokit_receivable_balance: 0 }]
        : [])),
    execute: vi.fn(async () => 0),
  });

  i2('tra bằng khach_id mà nhân viên hỏi "Vấn" → CHẶN (bug 20:06 10/08)', async () => {
    const odoo = fakeOdoo();
    const kq = await xuatCongNo({ odoo } as never, { khach_id: 2160, ten_nhac: 'Vấn' });
    e2(kq.loai).toBe('sai_khach');
    if (kq.loai === 'sai_khach') e2(kq.lyDo).toContain('Vấn');
  });

  i2('tên khớp → chạy bình thường', async () => {
    const odoo = fakeOdoo();
    const kq = await xuatCongNo({ odoo } as never, { khach_id: 2160, ten_nhac: 'Tuấn BG' });
    e2(kq.loai).not.toBe('sai_khach');
  });

  i2('không khai ten_nhac → vẫn chạy (tương thích ngược)', async () => {
    const odoo = fakeOdoo();
    const kq = await xuatCongNo({ odoo } as never, { khach_id: 2160 });
    e2(kq.loai).not.toBe('sai_khach');
  });

  i2('mô tả tool BẮT model khai tên khách', () => {
    e2(xuatCongNoDefinition.description).toContain('ten_nhac');
    e2(xuatCongNoDefinition.description).not.toContain('từ lượt trước');
  });
});
