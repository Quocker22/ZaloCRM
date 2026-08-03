// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_khach_hang.
// Trọng tâm: TUYỆT ĐỐI không tạo res.partner. Khách trùng lặp là rác vĩnh viễn.
import { describe, it, expect, vi } from 'vitest';
import {
  traKhachHang,
  dinhDangKhachHang,
  bienTheSdt,
} from '../../../src/modules/ai/odoo/tools/tra-khach-hang.js';

const fakeOdoo = (rows: Record<string, unknown>[]) => ({
  searchRead: vi.fn(async () => rows),
});

const kh = (over: Record<string, unknown> = {}) => ({
  id: 10,
  name: 'Chị Lan',
  ref: 'KH00001',
  phone: '0912345678',
  mobile: false,
  incokit_receivable_balance: 0,
  ...over,
});

describe('bienTheSdt', () => {
  it('sinh đủ 3 dạng vì DB Odoo lưu tự do (không chuẩn hoá, không unique)', () => {
    const v = bienTheSdt('0912345678');
    expect(v).toContain('0912345678');
    expect(v).toContain('+84912345678');
    expect(v).toContain('84912345678');
  });

  it('nhập dạng nào cũng ra cùng bộ biến thể', () => {
    const a = [...bienTheSdt('0912345678')].sort();
    const b = [...bienTheSdt('+84912345678')].sort();
    const c = [...bienTheSdt('84912345678')].sort();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('SĐT không parse được → vẫn thử nguyên văn (biết đâu DB lưu đúng vậy)', () => {
    expect(bienTheSdt('123')).toEqual(['123']);
  });

  it('chuỗi rỗng → mảng rỗng', () => {
    expect(bienTheSdt('   ')).toEqual([]);
  });
});

describe('traKhachHang — ba trạng thái', () => {
  it('đúng 1 khách → tim_thay', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([kh()]) }, { sdt: '0912345678' });

    expect(kq.trangThai).toBe('tim_thay');
    if (kq.trangThai === 'tim_thay') {
      expect(kq.khach.id).toBe(10);
      expect(kq.khach.ma).toBe('KH00001');
    }
  });

  it('không có → khong_thay, kèm các SĐT đã thử (để người tra tay)', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    expect(kq.trangThai).toBe('khong_thay');
    if (kq.trangThai === 'khong_thay') {
      expect(kq.sdtDaTra).toContain('0912345678');
    }
  });

  it('nhiều khách trùng SĐT → nhieu_ket_qua, KHÔNG tự chọn', async () => {
    // Dữ liệu trùng có thật vì phone không unique. Bot đoán bừa là ghi nhầm đơn.
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ id: 10 }), kh({ id: 11, name: 'Chị Lan (cũ)' })]) },
      { sdt: '0912345678' },
    );

    expect(kq.trangThai).toBe('nhieu_ket_qua');
  });
});

describe('traKhachHang — TRA THEO TÊN', () => {
  // Bug thật 2026-07-29: nhân viên gõ "anh qc hoàng sơn mua 50 ..." — không có
  // SĐT. Tool chỉ nhận sdt nên bot phải chuyển sale, dù khách CÓ trong DB.

  it('tra theo tên → tìm được', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ name: 'qc hoàng sơn' })]) },
      { ten: 'qc hoàng sơn' },
    );
    expect(kq.trangThai).toBe('tim_thay');
  });

  it('tên nhiều từ → mỗi từ một AND (khớp dù thiếu từ ở giữa)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'hoàng sơn nam' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('"hoàng"');
    expect(d).toContain('"sơn"');
    expect(d).toContain('"nam"');
    expect(d).not.toContain('"hoàng sơn nam"');
  });

  it('có CẢ sdt lẫn ten → ưu tiên sdt (chính xác hơn)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678', ten: 'chị Lan' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('phone');
    expect(d).not.toContain('chị');
  });

  it('không có gì → khong_thay, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    const kq = await traKhachHang({ odoo }, {});

    expect(kq.trangThai).toBe('khong_thay');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('vẫn chỉ tìm KHÁCH (customer_rank > 0) khi tra theo tên', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { ten: 'hoàng sơn' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('customer_rank');
  });

  it('tra tên hụt → gợi ý model đã hết đường, phải chuyển sale', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { ten: 'không có ai' });

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('đã tra theo tên');
    expect(s).toContain('chuyen_sale');
  });

  it('tra SĐT hụt → gợi ý THỬ LẠI BẰNG TÊN trước khi bỏ cuộc', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    expect(dinhDangKhachHang(kq)).toContain('`ten`');
  });
});

describe('traKhachHang — CHỈ ĐỌC', () => {
  it('không tìm thấy → KHÔNG có đường tạo partner (deps chỉ có searchRead)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    // Kiểu TypeScript đã chặn ở compile-time; đây là chốt chặn runtime.
    expect(Object.keys(odoo)).toEqual(['searchRead']);
    expect((odoo as Record<string, unknown>).execute).toBeUndefined();
  });

  it('chỉ tìm partner là KHÁCH (customer_rank > 0), không lấy nhà cung cấp', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('customer_rank');
  });

  it('tìm cả phone lẫn mobile (Odoo có 2 field riêng)', async () => {
    const odoo = fakeOdoo([]);
    await traKhachHang({ odoo }, { sdt: '0912345678' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('phone');
    expect(domain).toContain('mobile');
  });

  it('khách chỉ có mobile → vẫn lấy được số', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ phone: false, mobile: '0912345678' })]) },
      { sdt: '0912345678' },
    );
    if (kq.trangThai === 'tim_thay') expect(kq.khach.dienThoai).toBe('0912345678');
  });

  it('SĐT rỗng → khong_thay, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    const kq = await traKhachHang({ odoo }, { sdt: '' });

    expect(kq.trangThai).toBe('khong_thay');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });
});

describe('dinhDangKhachHang — hướng dẫn model làm gì tiếp', () => {
  it('không thấy → NÓI RÕ cấm tự tạo + bảo dùng chuyen_sale', async () => {
    // Model đọc hướng dẫn trong tool result tốt hơn đọc quy tắc trong system prompt.
    const kq = await traKhachHang({ odoo: fakeOdoo([]) }, { sdt: '0912345678' });

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('KHÔNG được tự tạo');
    expect(s).toContain('chuyen_sale');
  });

  it('nhiều kết quả → cấm tự chọn + bảo dùng chuyen_sale', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ id: 10 }), kh({ id: 11 })]) },
      { sdt: '0912345678' },
    );

    const s = dinhDangKhachHang(kq);
    expect(s).toContain('KHÔNG tự chọn');
    expect(s).toContain('chuyen_sale');
  });

  it('có công nợ → hiện ra để sale biết trước khi chốt đơn', async () => {
    const kq = await traKhachHang(
      { odoo: fakeOdoo([kh({ incokit_receivable_balance: 5000000 })]) },
      { sdt: '0912345678' },
    );

    expect(dinhDangKhachHang(kq)).toContain('5.000.000đ');
  });

  it('không nợ → không nhắc công nợ cho gọn', async () => {
    const kq = await traKhachHang({ odoo: fakeOdoo([kh()]) }, { sdt: '0912345678' });
    expect(dinhDangKhachHang(kq)).not.toContain('nợ');
  });
});
