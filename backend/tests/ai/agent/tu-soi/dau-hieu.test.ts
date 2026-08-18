// SPDX-License-Identifier: AGPL-3.0-or-later
// 18/08 — bot tự soi hội thoại. Tầng CODE chấm dấu hiệu (rẻ, tất định) phải
// bắt được đúng các ca THẬT đã xảy ra, và KHÔNG kêu oan ca trơn tru.
import { describe, it, expect } from 'vitest';
import { chamDauHieu, type TinSoi } from '../../../../src/modules/ai/agent/tu-soi/dau-hieu.js';

const tin = (ds: Array<[('nguoi' | 'bot'), string]>): TinSoi[] =>
  ds.map(([vai, noiDung], i) => ({ id: `m${i}`, vai, noiDung, luc: new Date(Date.now() + i * 1000) }));

describe('chamDauHieu — bắt ca thật', () => {
  it('ca 22:27 17/08 (bot bảo không có QR, NV không hài lòng) → điểm thấp, soi kỹ', () => {
    const kq = chamDauHieu(tin([
      ['nguoi', 'cho tôi QR của ngân hàng đi'],
      ['bot', 'Anh/chị ơi, bên em không có thông tin số tài khoản hay mã QR ngân hàng của shop trong hệ thống đâu ạ. Anh/chị nhờ kế toán cung cấp giúp em.'],
      ['nguoi', 'đang không trả được QR ngân hàng này'],
    ]));
    expect(kq.dauHieu).toContain('bot_bo_tay_x1');
    expect(kq.diem).toBeLessThanOrEqual(9);
  });

  it('ca 06:21 13/08 (NV gắt "6214 trắng ấm mà ???") → nguoi_gat, soi kỹ', () => {
    const kq = chamDauHieu(tin([
      ['nguoi', 'khách hàng mới, a dương quảng ninh, 3000 3B 6214 trắng ấm x1800'],
      ['bot', 'Đơn cho Dương: 3000 × 3 bóng 6214 trắng (thanh)…'],
      ['nguoi', '6214 trắng ấm mà ??? sai rồi'],
    ]));
    expect(kq.dauHieu.some((d) => d.startsWith('nguoi_gat'))).toBe(true);
    expect(kq.dangSoiKy).toBe(true);
  });

  it('ca 09:54 17/08 (bot nhả bảng cột) → rác kỹ thuật, trừ nặng', () => {
    const kq = chamDauHieu(tin([
      ['nguoi', 'thêm mới các sản phẩm đó luôn'],
      ['bot', 'Các cột dùng được: - account_tag_ids (many2many) — Account Tags - active (boolean)…'],
    ]));
    expect(kq.dauHieu).toContain('rac_ky_thuat');
    expect(kq.diem).toBeLessThanOrEqual(6);
    expect(kq.dangSoiKy).toBe(true);
  });

  it('hội thoại TRƠN TRU → 10 điểm, KHÔNG soi kỹ (không tốn model)', () => {
    const kq = chamDauHieu(tin([
      ['nguoi', 'lên đơn cho Anh Tiến 10 cái nguồn DF-12V400W giá 180k'],
      ['bot', 'Đơn cho Anh Tiến (KH000028): 10 × Nguồn DF-12V400W = 1.800.000đ. Em đã lên đơn nháp S14710 ạ.'],
      ['nguoi', 'ok'],
    ]));
    expect(kq.diem).toBe(10);
    expect(kq.dangSoiKy).toBe(false);
    expect(kq.dauHieu).toEqual([]);
  });

  it('bot lặp NGUYÊN VĂN một tin dài → bắt được', () => {
    const dai = 'Có 2 nhà cung cấp tên "Trung Quốc": 1) Trung Quốc · NCC000001 2) Trung Quốc- Kho Cô Lỳ · NCC000290. Anh/chị chọn giúp em ạ.';
    const kq = chamDauHieu(tin([['nguoi', 'tạo phiếu nhập'], ['bot', dai], ['nguoi', '1'], ['bot', dai]]));
    expect(kq.dauHieu).toContain('bot_lap_nguyen_van');
  });
});

// ── Khoá hợp đồng "biết đoạn mới" (anh Quốc hỏi 18/08) ─────────────────────
// Không test được vòng chạy thật ở đây (cần DB), nhưng khoá được HÌNH DẠNG:
// mốc soi là TIN CUỐI, nên hội thoại chạy tiếp là khoá đổi → có đoạn mới.
describe('mốc soi = tin cuối → nhận biết đoạn mới', () => {
  it('cùng một đoạn, chấm hai lần ra kết quả GIỐNG NHAU (idempotent)', () => {
    const doan = tin([
      ['nguoi', 'lên đơn cho anh Hà 5 cái nguồn NB'],
      ['bot', 'Đơn cho Anh Hà: 5 × Nguồn NB. Em đã lên đơn nháp S1 ạ.'],
    ]);
    expect(chamDauHieu(doan)).toEqual(chamDauHieu(doan));
  });

  it('đoạn nối thêm tin GẮT → điểm tụt so với đoạn cũ (đáng soi lại)', () => {
    const cu = tin([
      ['nguoi', 'lên đơn cho anh Hà 5 cái nguồn NB'],
      ['bot', 'Đơn cho Anh Hà: 5 × Nguồn NB xanh. Em đã lên đơn nháp S1 ạ.'],
    ]);
    const moi = [...cu, ...tin([['nguoi', 'sai rồi, nguồn NB đỏ mà']])];
    expect(chamDauHieu(moi).diem).toBeLessThan(chamDauHieu(cu).diem);
    expect(chamDauHieu(moi).dangSoiKy).toBe(true);
  });
});
