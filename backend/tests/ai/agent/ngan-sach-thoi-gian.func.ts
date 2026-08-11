// SPDX-License-Identifier: AGPL-3.0-or-later
// NGÂN SÁCH THỜI GIAN — hết giờ thì TRẢ LỜI bằng dữ liệu đã tra, không báo lỗi.
//
// Bug thật, lặp đi lặp lại: nhân viên nhận "Bot gặp lỗi (lượt agent quá hạn
// 90000ms). Anh/chị xử lý giúp nhé." Anh Quốc: "sao cứ lỗi ... hoài vậy????"
// rồi "bỏ cái báo lỗi đó đi được không".
//
// CHẨN ĐOÁN (đo trên prod 11/08) — các con số KHÔNG KHỚP NHAU:
//   - mọi tool call     : < 700ms (không tool nào chậm)
//   - một lượt gọi model: ~2s với đủ prompt + 22 tool
//   - khoảng trống giữa hai vòng trong ca treo: 32-62s
//   - agent được lặp 8 vòng; mỗi vòng tự thử lại 4 lần với hạn chờ
//     12s→20s→30s→40s cộng nghỉ 1s→2s→4s = 109s cho MỘT vòng
//   → hạn tổng 90s mà một mắt xích được phép chạy 109s. Chỉ cần gateway chậm
//     MỘT lần trong 8 vòng là cả lượt chết, bất kể câu hỏi là gì.
//
// Hai việc sửa ở đây:
//   1. `hanConLai` — mỗi lần gọi provider chỉ được chờ trong phần còn lại của
//      ngân sách, không phải hạn cứng của riêng nó.
//   2. `chayCoHanGioMem` — hết giờ thì lấy kết quả dở dang (đã có tool chạy)
//      thay vì vứt hết và ném lỗi.
import { describe, it, expect, vi } from 'vitest';
import { hanConLai, chayCoHanGioMem, tomTatDoDang } from '../../../src/modules/ai/agent/noi-zalo/ngan-sach.js';

describe('hanConLai — không lần gọi nào được vượt ngân sách còn lại', () => {
  it('còn nhiều thời gian → dùng hạn mặc định của lần thử đó', () => {
    const batDau = 1_000_000;
    // Mới trôi 5s trong ngân sách 90s → còn 85s, hạn 12s dùng nguyên.
    expect(hanConLai({ batDau, nganSachMs: 90_000, bayGio: batDau + 5_000, hanMongMuon: 12_000 }))
      .toBe(12_000);
  });

  it('sắp hết ngân sách → CẮT hạn cho vừa (gốc bug 109s > 90s)', () => {
    const batDau = 1_000_000;
    // Đã trôi 75s trong 90s → còn 15s. Lần thử muốn 40s nhưng chỉ được 15s.
    expect(hanConLai({ batDau, nganSachMs: 90_000, bayGio: batDau + 75_000, hanMongMuon: 40_000 }))
      .toBe(15_000);
  });

  it('hết sạch ngân sách → trả 0, caller phải dừng chứ không gọi tiếp', () => {
    const batDau = 1_000_000;
    expect(hanConLai({ batDau, nganSachMs: 90_000, bayGio: batDau + 95_000, hanMongMuon: 12_000 }))
      .toBe(0);
  });

  it('luôn chừa tối thiểu để còn kịp soạn câu trả lời', () => {
    const batDau = 1_000_000;
    // Còn đúng 3s: không cắt xuống 0 (sẽ mất luôn cơ hội), nhưng không quá 3s.
    const h = hanConLai({ batDau, nganSachMs: 90_000, bayGio: batDau + 87_000, hanMongMuon: 30_000 });
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(3_000);
  });
});

describe('chayCoHanGioMem — hết giờ thì lấy cái đang có, KHÔNG báo lỗi', () => {
  it('việc xong trước hạn → trả kết quả bình thường', async () => {
    const kq = await chayCoHanGioMem({
      viec: Promise.resolve('xong rồi'),
      ms: 1_000,
      layDoDang: () => null,
    });
    expect(kq).toEqual({ trangThai: 'xong', giaTri: 'xong rồi' });
  });

  it('hết giờ NHƯNG đã có dữ liệu tool → trả DỞ DANG, không ném lỗi', async () => {
    const kq = await chayCoHanGioMem({
      viec: new Promise((r) => setTimeout(() => r('quá muộn'), 5_000)),
      ms: 50,
      layDoDang: () => 'Công nợ anh Vấn: 12.000.000đ (đang tra tiếp)',
    });
    expect(kq.trangThai).toBe('do_dang');
    if (kq.trangThai === 'do_dang') {
      expect(kq.giaTri).toContain('12.000.000');
    }
  });

  it('hết giờ và CHƯA có gì → trả rỗng để caller nhắn câu mềm', async () => {
    const kq = await chayCoHanGioMem({
      viec: new Promise((r) => setTimeout(() => r('quá muộn'), 5_000)),
      ms: 50,
      layDoDang: () => null,
    });
    expect(kq).toEqual({ trangThai: 'het_gio' });
  });

  it('việc NÉM lỗi thật → vẫn ném, đừng nuốt lỗi thành "hết giờ"', async () => {
    await expect(chayCoHanGioMem({
      viec: Promise.reject(new Error('Odoo sập')),
      ms: 1_000,
      layDoDang: () => null,
    })).rejects.toThrow('Odoo sập');
  });
});

describe('tomTatDoDang — hết giờ thì trả cái tool đã tra được', () => {
  it('lấy kết quả tool CUỐI (gần câu hỏi nhất, các tool trước là bước trung gian)', () => {
    expect(tomTatDoDang([
      { toolName: 'tra_khach_hang', output: 'Anh Vấn · KH000027', thanhCong: true },
      { toolName: 'xuat_cong_no', output: 'Công nợ anh Vấn: 12.000.000đ', thanhCong: true },
    ])).toBe('Công nợ anh Vấn: 12.000.000đ');
  });

  it('BỎ tool lỗi — đưa kết quả lỗi ra chỉ làm nhân viên rối', () => {
    expect(tomTatDoDang([
      { toolName: 'tra_khach_hang', output: 'Anh Vấn · KH000027', thanhCong: true },
      { toolName: 'xuat_cong_no', output: 'Odoo từ chối', thanhCong: false },
    ])).toBe('Anh Vấn · KH000027');
  });

  it('chưa tool nào chạy → null, caller nhắn câu mềm', () => {
    expect(tomTatDoDang([])).toBeNull();
  });

  it('tool chạy nhưng output rỗng → null, đừng gửi tin trống', () => {
    expect(tomTatDoDang([{ toolName: 'x', output: '   ', thanhCong: true }])).toBeNull();
  });

  it('output quá dài → cắt cho vừa một tin Zalo', () => {
    const kq = tomTatDoDang([{ toolName: 'x', output: 'a'.repeat(5000), thanhCong: true }]);
    expect(kq!.length).toBeLessThanOrEqual(1201);
    expect(kq!.endsWith('…')).toBe(true);
  });
});
