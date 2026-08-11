// SPDX-License-Identifier: AGPL-3.0-or-later
// HÀNG RÀO GIÁ BẤT THƯỜNG — bug thật nhóm Test-AI 10:09:33 ngày 11/08/2026.
//
// Nhân viên nói "card thu triết khấu 8%". Model đọc "8%" rồi nhét số 8 vào ô
// ĐƠN GIÁ, thành: "100 × Card thu BX-V7512 (cái) = 800đ (giá anh/chị báo 8đ,
// hệ thống 230.000đ)". Tool tra_san_pham trả đúng 230.000đ cả 4 lần gọi — số 8
// là model tự bịa. Đơn 46 triệu tụt còn 800đ.
//
// Điểm chết người: bot IN CẢ HAI con số cạnh nhau, lệch 28.750 lần, rồi vẫn
// hỏi "Em chốt lên đơn nhé?". Nhân viên gõ "ok" là đơn sai vào hệ thống.
//
// Test này khoá HAI phía của hàng rào:
//   - lệch vô lý  → PHẢI hỏi lại, KHÔNG được cho chốt
//   - lệch hợp lý → PHẢI cho qua (luật "giá NV báo thắng giá hệ thống", 10/08)
import { describe, it, expect } from 'vitest';
import { buocTiepTheo } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/buoc-tiep-theo.js';
import { renderLoiNhan } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js';
import { lechVoLy } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/gia-bat-thuong.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const khach = { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901' };
/** Đúng SP trong ca thật: tra_san_pham trả 230.000đ/Cái ở cả 4 lần gọi. */
const cardThu = { id: 1234, ten: 'Card thu BX-V7512 (cái)', gia: 230000 };

describe('lechVoLy — ngưỡng đo từ Odoo prod', () => {
  // Số đo prod 11/08/2026 (5.781 dòng đơn 2026 có price_unit>0, SP có giá
  // niêm yết thật): p0.1 = 0,40 · p1 = 0,61 · p50 = 1,00 · p99 = 1,65 ·
  // p99.9 = 2,33. Thấp nhất TOÀN BỘ lịch sử là r = 0,133 (đúng 1 dòng).
  // KHÔNG dòng nào r < 0,1. Chỉ 2 dòng r > 10, cả hai cùng một SP giá niêm
  // yết cũ 300đ. Nên r<0,1 hoặc r>10 chưa từng xảy ra trong việc bán thật.
  it('ca thật 10:09:33 11/08 — báo 8đ khi hệ thống 230.000đ là vô lý', () => {
    expect(lechVoLy(8, 230000)).toBe(true); // r = 0,0000348 — thấp hơn 3.800 lần ca thấp nhất từng có
  });

  it('nhân viên giảm giá THẬT (20-30%, nằm giữa phân bố) → KHÔNG chặn', () => {
    expect(lechVoLy(184000, 230000)).toBe(false); // giảm 20% — r=0,80 ≈ p3
    expect(lechVoLy(161000, 230000)).toBe(false); // giảm 30% — r=0,70 ≈ p1.7
    expect(lechVoLy(100000, 250000)).toBe(false); // ca THẬT prod: đồng hồ hẹn giờ, r=0,40
    expect(lechVoLy(300, 2250)).toBe(false);      // ca THẬT prod thấp nhất, r=0,133
  });

  it('nhân viên tăng giá thật → KHÔNG chặn', () => {
    expect(lechVoLy(300000, 132000)).toBe(false); // ca THẬT prod: nguồn NB, r=2,27
    expect(lechVoLy(540000, 105000)).toBe(false); // ca THẬT prod: nguồn ngoài trời, r=5,14
  });

  it('gõ nhầm đơn vị (thiếu/thừa số 0) → chặn', () => {
    // Hai biên đều CHO QUA (so sánh là < và >, không phải ≤ / ≥): nghi ngờ thì
    // nghiêng về phía nhân viên, đúng tinh thần "giá NV báo thắng".
    expect(lechVoLy(23000, 230000)).toBe(false);   // r=0,1  — đúng biên dưới
    expect(lechVoLy(2300000, 230000)).toBe(false); // r=10   — đúng biên trên
    expect(lechVoLy(2300, 230000)).toBe(true);     // r=0,01 — thiếu 2 số 0
    expect(lechVoLy(23000000, 230000)).toBe(true); // r=100  — thừa 2 số 0
  });

  it('SP chưa có giá (hệ thống 0đ/1đ) → KHÔNG so sánh, để NV báo giá tự do', () => {
    // Đây là ĐƯỜNG ĐÃ CÓ CHỦ ĐÍCH (10/08): SP chưa nhập giá vẫn lên đơn được
    // nhờ giá NV báo. Lấy 1đ làm mẫu số thì mọi giá thật đều "vô lý" → phá
    // đúng cái đường vừa mở.
    expect(lechVoLy(13000, 1)).toBe(false);
    expect(lechVoLy(13000, 0)).toBe(false);
  });
});

// Bước hỏi chốt đã bỏ (anh Quốc 11/08) — hàng rào giá GIỮ NGUYÊN và giờ là
// cổng người-gác DUY NHẤT còn lại trên đường lên đơn. Hai thứ khác nhau: bước
// chốt hỏi khi mọi thứ BÌNH THƯỜNG, hàng rào này chỉ hỏi khi phát hiện BẤT
// THƯỜNG (ca thật: lệch 28.750 lần). Bỏ nốt nó thì con số model bịa đi thẳng
// vào Odoo không ai chặn.
describe('buocTiepTheo — chặn trước khi tạo đơn', () => {
  it('CA THẬT 10:09:33: giá lệch vô lý → hoi_gia_lech, KHÔNG tao_don', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'card thu', sl: 100, donGia: 8, daChot: cardThu }],
    };
    // TRƯỚC khi có hàng rào: đi thẳng lên đơn 800đ (46 triệu tụt còn 800đ).
    expect(buocTiepTheo(p)).toEqual({
      loai: 'hoi_gia_lech',
      lech: [{ ten: cardThu.ten, giaNv: 8, giaHt: 230000 }],
    });
  });

  it('chỉ ĐÚNG câu trả lời cho chính con số đó mới mở cổng, không phải gật chung', () => {
    // giaLechDaXacNhan bị xoá mỗi khi NV báo giá MỚI (xem dapSlot) — nên nó
    // luôn là cái gật cho ĐÚNG con số đang bị hỏi.
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'card thu', sl: 100, donGia: 8, daChot: cardThu }],
    };
    expect(buocTiepTheo(p).loai).toBe('hoi_gia_lech');
    expect(buocTiepTheo({ ...p, giaLechDaXacNhan: true }).loai).toBe('tao_don');
  });

  it('nhân viên XÁC NHẬN lại giá đó → cho qua, lên đơn theo họ (luật 10/08)', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach, giaLechDaXacNhan: true,
      dong: [{ tuKhoa: 'card thu', sl: 100, donGia: 8, daChot: cardThu }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don' });
  });

  it('giảm 20% (lệch HỢP LÝ) → lên đơn thẳng, KHÔNG hỏi gì thêm', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'card thu', sl: 100, donGia: 184000, daChot: cardThu }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don' });
  });

  it('SP chưa có giá + NV báo giá → lên đơn bình thường (không phá đường 10/08)', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'thanh led', sl: 300, donGia: 13000, daChot: { id: 9, ten: 'Thanh LED tỏa', gia: 1 } }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don' });
  });

  it('dòng TẶNG (0đ) không bị coi là lệch giá', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [
        { tuKhoa: 'card thu', sl: 100, donGia: 230000, daChot: cardThu },
        { tuKhoa: 'card thu', sl: 1, tang: true, daChot: cardThu },
      ],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don' });
  });
});

describe('renderLoiNhan — câu hỏi lại nhân viên', () => {
  it('nêu ĐỦ cả hai con số và hỏi giá đúng là bao nhiêu', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'card thu', sl: 100, donGia: 8, daChot: cardThu }],
    };
    const tin = renderLoiNhan(buocTiepTheo(p), p);
    expect(tin).toContain('8đ');
    expect(tin).toContain('230.000đ');
    expect(tin).toContain('Card thu BX-V7512');
    // Phải HỎI, không được tự sửa số và không được im lặng bỏ qua
    expect(tin).toMatch(/xác nhận|đúng là bao nhiêu/i);
    // Tuyệt đối KHÔNG rủ chốt đơn trong chính tin cảnh báo này
    expect(tin).not.toContain('Em chốt lên đơn nhé?');
  });
});
