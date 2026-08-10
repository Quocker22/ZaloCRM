// SPDX-License-Identifier: AGPL-3.0-or-later
// Câu DÀI nhưng chứa TÊN ĐẦY ĐỦ của ứng viên → chốt luôn.
//
// Bug thật 21:21:40 10/08 (nhóm). Bot hỏi chọn 3 loại nguồn NB, anh Quốc gõ:
//   "khách mới, Nguồn NB Ngoài Trời 12V100W 170k nhé"
// Bot vẫn hỏi lại y hệt a/b/c. Anh: "tôi cảm giác nó đang cứng ngắc à rõ ràng
// tôi đã nhắn Nguồn NB Ngoài Trời 12V100W 170k luôn rồi".
//
// Nguyên nhân: phép dò mảnh tên chỉ chạy với câu ≤4 từ (guard chống bug S13814
// 07/08 — câu dài "xuất hóa đơn LUÔN giúp tôi nhé" có chữ "hoà" khớp địa chỉ
// "hiệp hoà" của đúng một khách → chốt nhầm người). Câu trên 9 từ nên bị chặn,
// dù nó chứa NGUYÊN VĂN tên sản phẩm.
//
// Cách sửa: KHÔNG nới guard (mở lại lỗ S13814). Thêm phép khớp CHẶT HƠN chạy
// trước nó — câu chứa gần trọn tên một ứng viên thì chốt, bất kể câu dài. Khớp
// nguyên cụm tên là bằng chứng mạnh hơn hẳn một mảnh chữ lẻ.
import { describe, it, expect } from 'vitest';
import { apDungChon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const BA_NGUON = [
  { id: 1, ten: 'Nguồn NB Ngoài Trời 12V100W (cái)', gia: 78000 },
  { id: 2, ten: 'Nguồn NB Ngoài Trời 12V200W (cái)', gia: 107000 },
  { id: 3, ten: 'Nguồn NB Ngoài Trời 12V300W (cái)', gia: 126000 },
];

const phienSP = (): PhienGom => ({
  khachTuKhoa: 'thức', dong: [{ tuKhoa: 'nguồn NB', sl: 10, ungVien: [...BA_NGUON] }],
});

describe('câu dài chứa tên đầy đủ → chốt luôn (bug 21:21 10/08)', () => {
  it('kịch bản thật: "khách mới, Nguồn NB Ngoài Trời 12V100W 170k nhé"', () => {
    const p = phienSP();
    const map = apDungChon(p, 'khách mới, Nguồn NB Ngoài Trời 12V100W 170k nhé');
    expect(map).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(1);
  });

  it('gõ không dấu vẫn khớp', () => {
    const p = phienSP();
    apDungChon(p, 'lay con nguon nb ngoai troi 12v200w cho toi nhe');
    expect(p.dong[0].daChot?.id).toBe(2);
  });

  it('tên khớp NHIỀU ứng viên → KHÔNG tự chốt, để nhân viên chọn', () => {
    const p = phienSP();
    // "Nguồn NB Ngoài Trời 12V" là tiền tố chung của cả ba — mơ hồ.
    apDungChon(p, 'cho tôi Nguồn NB Ngoài Trời 12V nhé bao nhiêu tiền');
    expect(p.dong[0].daChot).toBeUndefined();
    expect(p.dong[0].ungVien).toHaveLength(3);
  });

  it('BẢO MẬT S13814: câu dài KHÔNG chứa tên đầy đủ → không chốt nhầm khách', () => {
    const p: PhienGom = {
      khachTuKhoa: 'tuấn', dong: [],
      khachUngVien: [
        { id: 10, ten: 'Anh Tuấn BG, hiệp hoà, Bắc giang', ma: 'KH1', dienThoai: null },
        { id: 11, ten: 'Anh Tuấn Hà Nội', ma: 'KH2', dienThoai: null },
      ],
    };
    // Đúng câu gây bug S13814 — chữ "hoà" trong "LUÔN...hoà" không được tính.
    const map = apDungChon(p, 'xuất hóa đơn LUÔN giúp tôi nhé');
    expect(map).toBe(false);
    expect(p.khachDaChot).toBeUndefined();
  });

  it('khớp tên khách đầy đủ trong câu dài cũng chốt được', () => {
    const p: PhienGom = {
      khachTuKhoa: 'thức', dong: [],
      khachUngVien: [
        { id: 20, ten: 'Anh Thức CNC', ma: 'KH002090', dienThoai: null },
        { id: 21, ten: 'Anh Thức- Nam Định', ma: 'KH002559AC', dienThoai: null },
      ],
    };
    apDungChon(p, 'lấy Anh Thức CNC nhé, 10 cái nguồn 100W');
    expect(p.khachDaChot?.id).toBe(20);
  });

  it('câu ngắn vẫn chạy đường cũ, không hồi quy', () => {
    const p = phienSP();
    apDungChon(p, '12V300W');
    expect(p.dong[0].daChot?.id).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Anh Quốc hỏi 10/08: "ví dụ tôi nói 12V100W 170k thì sao??" — cách gõ thật
// nhất: mã ngắn + giá, không ai gõ lại nguyên tên dài.
describe('gõ NGẮN: mã + giá ("12V100W 170k")', () => {
  it('"12V100W 170k" → chốt đúng loại 100W', () => {
    const p = phienSP();
    const map = apDungChon(p, '12V100W 170k');
    expect(map).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(1);
  });

  it('"100W 170k" (bỏ cả 12V) → vẫn chốt đúng', () => {
    const p = phienSP();
    apDungChon(p, '100W 170k');
    expect(p.dong[0].daChot?.id).toBe(1);
  });

  it('"lấy con 100W 170k nhé" — 5 từ, quá guard mảnh → KHÔNG được im, phải chốt', () => {
    const p = phienSP();
    const map = apDungChon(p, 'lấy con 100W 170k nhé');
    expect(map).toBe(true);
    expect(p.dong[0].daChot?.id).toBe(1);
  });

  it('mã khớp NHIỀU loại ("12V") → vẫn hỏi lại, không đoán bừa', () => {
    const p = phienSP();
    apDungChon(p, '12V 170k');
    expect(p.dong[0].daChot).toBeUndefined();
  });
});
