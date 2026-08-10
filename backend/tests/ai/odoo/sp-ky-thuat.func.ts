// SPDX-License-Identifier: AGPL-3.0-or-later
// SẢN PHẨM KỸ THUẬT (VAT, phí ship) — lọc khỏi SỐ LƯỢNG, GIỮ trong TIỀN.
//
// Phát hiện thật 10/08 trên Odoo prod: kế toán ghi thuế bằng cách tạo một SP
// giả `[SP000070] VAT 8%` đơn giá 1đ rồi đặt SỐ LƯỢNG = SỐ TIỀN thuế
// (qty=43.968.000 × 1đ = 43.968.000đ). Cách này ra ĐÚNG tiền — nên báo cáo
// theo tiền hoàn toàn chính xác, KHÔNG được đụng vào.
//
// Nhưng báo cáo theo SỐ LƯỢNG thì hỏng nặng. Đo kỳ 08/2026 (507 dòng):
//   số lượng kể cả SP kỹ thuật: 131.800.532
//   số lượng hàng THẬT        :     488.672
//   → sai 270 lần, rác đến từ 36 dòng VAT/phí ship.
//
// Vì sao KHÔNG lọc theo "giá ≤ 1đ": thử cách đó thì bắt nhầm 40 sản phẩm THẬT
// chưa nhập giá (Led 2 bóng 3609, Nguồn YL 24V400W…). Phải lọc theo TÊN.
import { describe, it, expect } from 'vitest';
import { laSanPhamKyThuat, locChoSoLuong } from '../../../src/modules/ai/odoo/sp-ky-thuat.js';

describe('laSanPhamKyThuat — nhận diện dòng không phải hàng thật', () => {
  const kyThuat = [
    '[SP000070] VAT 8%',
    'VAT 5%',
    'vat',
    'VAT',
    '[Phí vận chuyển] Phí vận chuyển',
    'phí vận chuyển',
    'Phí vận chuyển (chuyến)',
    'Chiết khấu đơn hàng',
    'Thuế GTGT 10%',
  ];
  for (const t of kyThuat) {
    it(`KỸ THUẬT: ${JSON.stringify(t)}`, () => expect(laSanPhamKyThuat(t)).toBe(true));
  }

  // Hàng THẬT — tuyệt đối không được lọc nhầm, mất hàng khỏi báo cáo còn tệ
  // hơn thừa rác vì không ai nhìn ra.
  const hangThat = [
    'Nguồn NB Ngoài Trời 12V300W (cái)',
    'Led 2 bóng 3609-5730 12V Xanh Dương (bóng)',
    'Nguồn YL Ngoài Trời 24V400W Đổ Keo( vỏ trắng) (cái)',
    'Cáp 16 sợi nhỏ (cuộn)',
    'Led F8 - 12mm Full IC 8208 12V ATX (bóng)',
    // Bẫy: có chữ "phi" trong tên hàng thật.
    'Led philips 12V',
    'Đèn pha LED 100W',
  ];
  for (const t of hangThat) {
    it(`HÀNG THẬT: ${JSON.stringify(t.slice(0, 40))}`, () => expect(laSanPhamKyThuat(t)).toBe(false));
  }

  it('tên rỗng/null → không phải kỹ thuật (thà giữ còn hơn mất hàng)', () => {
    expect(laSanPhamKyThuat('')).toBe(false);
    expect(laSanPhamKyThuat(null as never)).toBe(false);
  });
});

describe('locChoSoLuong — chỉ lọc khi ĐO SỐ LƯỢNG', () => {
  const dong = [
    { ten: 'Nguồn NB 12V300W', soLuong: 10, tien: 1260000 },
    { ten: '[SP000070] VAT 8%', soLuong: 624000, tien: 624000 },
    { ten: 'Phí vận chuyển', soLuong: 330, tien: 330000 },
  ];

  it('đo SỐ LƯỢNG → bỏ dòng kỹ thuật (rác 270 lần)', () => {
    const kq = locChoSoLuong(dong, 'so_luong', (d) => d.ten);
    expect(kq).toHaveLength(1);
    expect(kq[0].ten).toBe('Nguồn NB 12V300W');
  });

  it('đo TIỀN → GIỮ NGUYÊN, bỏ đi là báo thiếu doanh thu 131 triệu', () => {
    const kq = locChoSoLuong(dong, 'tong_tien', (d) => d.ten);
    expect(kq).toHaveLength(3);
  });

  it('đo CẢ HAI ("so_luong,tong_tien") → GIỮ, vì cột tiền vẫn phải đúng', () => {
    const kq = locChoSoLuong(dong, 'so_luong,tong_tien', (d) => d.ten);
    expect(kq).toHaveLength(3);
  });

  it('đo chỉ tiêu khác (so_don) → không đụng vào', () => {
    expect(locChoSoLuong(dong, 'so_don', (d) => d.ten)).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GỘP LUẬT (10/08): top-san-pham từng có regex RIÊNG
//   /\b(vat|thuế|chiết khấu|phí|phi ship|ship|discount|tax)\b/i
// và nó ĐÃ LỆCH với luật báo cáo: `\bphí\b` KHÔNG khớp "Phí vận chuyển" vì
// chữ "phí" dính liền "vận" (ranh giới từ \b không cắt ở đó). Hệ quả: phí ship
// vẫn lọt vào bảng "top bán chạy".
//
// Hai nơi tự viết luật riêng thì sớm muộn cũng lệch. Giờ cả hai dùng chung
// laSanPhamKyThuat — các ca dưới khoá đúng chỗ từng lệch.
describe('ca từng lệch giữa hai tool', () => {
  it('"Phí vận chuyển" — regex cũ của top-san-pham BỎ SÓT', () => {
    const regexCu = /\b(vat|thuế|thue|chiết khấu|chiet khau|phí|phi ship|ship|discount|tax)\b/i;
    expect(regexCu.test('Phí vận chuyển')).toBe(false);   // lỗi cũ
    expect(laSanPhamKyThuat('Phí vận chuyển')).toBe(true); // đã sửa
  });

  it('"Phí vận chuyển (chuyến)" cũng vậy', () => {
    expect(laSanPhamKyThuat('Phí vận chuyển (chuyến)')).toBe(true);
  });

  it('KHÔNG lọc nhầm hàng thật có chữ gần giống', () => {
    // Regex cũ có \bship\b — tên hàng thật chứa "ship" phải an toàn.
    expect(laSanPhamKyThuat('Đèn LED Shiplight 12V')).toBe(false);
    expect(laSanPhamKyThuat('Nguồn tổ ong 12V')).toBe(false);
  });
});
