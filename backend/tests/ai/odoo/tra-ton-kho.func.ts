// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_ton_kho.
// Trọng tâm: "còn bán được" phải TRỪ phần đã giữ chỗ — hứa hàng đã bán cho
// người khác là lỗi nghiệp vụ nặng nhất của tool này.
import { describe, it, expect, vi } from 'vitest';
import { traTonKho, dinhDangTonKho } from '../../../src/modules/ai/odoo/tools/tra-ton-kho.js';

const fakeOdoo = (rows: Record<string, unknown>[]) => ({
  searchRead: vi.fn(async () => rows),
  execute: vi.fn(),
});

const khoRow = (breakdown: unknown, name = 'Đèn LED P10') => ({
  id: 1,
  name,
  incokit_stock_breakdown: breakdown,
});

const BA_KHO = [
  { warehouse_id: 2, name: 'Chi nhánh trung tâm', on_hand: 100, reserved: 30, free: 70 },
  { warehouse_id: 3, name: 'Hồ Chí Minh', on_hand: 50, reserved: 0, free: 50 },
  { warehouse_id: 0, name: 'Tổng', on_hand: 150, reserved: 30, is_total: true },
];

describe('traTonKho — số còn bán được', () => {
  it('conBanDuoc = tồn - đã giữ chỗ (KHÔNG hứa hàng của đơn khác)', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(BA_KHO)]) }, { san_pham_id: 1 });

    const trungTam = kq!.theoKho.find((k) => k.khoId === 2)!;
    expect(trungTam.tonThucTe).toBe(100);
    expect(trungTam.daGiuCho).toBe(30);
    expect(trungTam.conBanDuoc).toBe(70);
  });

  it('TỰ TÍNH conBanDuoc, không tin field `free` của Odoo', async () => {
    // ARCHITECTURE.md của lednelia: "Đừng tin số stored cho tiền/kho/giao hàng".
    // Ở đây field free bị sai cố ý — ta phải cho ra số đúng.
    const saiLech = [{ warehouse_id: 2, name: 'Kho A', on_hand: 100, reserved: 30, free: 999 }];

    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(saiLech)]) }, { san_pham_id: 1 });

    expect(kq!.theoKho[0].conBanDuoc).toBe(70); // không phải 999
  });

  it('bỏ dòng "Tổng" của Odoo, tự cộng lại', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(BA_KHO)]) }, { san_pham_id: 1 });

    expect(kq!.theoKho).toHaveLength(2);          // 3 dòng - 1 dòng tổng
    expect(kq!.tongConBanDuoc).toBe(120);         // 70 + 50
  });

  it('hàng đã bị giữ chỗ HẾT → còn bán được = 0', async () => {
    const het = [{ warehouse_id: 2, name: 'Kho A', on_hand: 10, reserved: 10 }];

    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(het)]) }, { san_pham_id: 1 });

    expect(kq!.tongConBanDuoc).toBe(0);
  });
});

describe('traTonKho — dữ liệu bất thường', () => {
  it('breakdown là chuỗi JSON → parse được', async () => {
    const kq = await traTonKho(
      { odoo: fakeOdoo([khoRow(JSON.stringify(BA_KHO))]) },
      { san_pham_id: 1 },
    );
    expect(kq!.theoKho).toHaveLength(2);
  });

  it('JSON hỏng → theoKho rỗng, KHÔNG ném', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow('{hỏng')]) }, { san_pham_id: 1 });
    expect(kq!.theoKho).toEqual([]);
  });

  it('breakdown null → theoKho rỗng, KHÔNG ném', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(null)]) }, { san_pham_id: 1 });
    expect(kq!.theoKho).toEqual([]);
  });

  it('SP không tồn tại → null', async () => {
    expect(await traTonKho({ odoo: fakeOdoo([]) }, { san_pham_id: 999 })).toBeNull();
  });

  it('id không hợp lệ → null, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    expect(await traTonKho({ odoo }, { san_pham_id: -1 })).toBeNull();
    expect(await traTonKho({ odoo }, { san_pham_id: 0 })).toBeNull();
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });
});

describe('dinhDangTonKho', () => {
  it('nói rõ "còn bán được" để model không nhầm với tồn thực tế', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(BA_KHO)]) }, { san_pham_id: 1 });

    const s = dinhDangTonKho(kq);
    expect(s).toContain('còn bán được');
    expect(s).toContain('TỔNG CÒN BÁN ĐƯỢC: 120');
  });

  it('BỎ kho trống khỏi danh sách (giảm nhiễu, giảm token)', async () => {
    // Thực tế: SP hay chỉ nằm ở 1 kho, 2 kho còn lại trống. Liệt kê cả 3 là
    // nhiễu — và nhiễu đó bị tính tiền lại ở MỌI vòng lặp sau.
    const motKho = [
      { warehouse_id: 2, name: 'Chi nhánh trung tâm', on_hand: 100, reserved: 0 },
      { warehouse_id: 3, name: 'Hồ Chí Minh', on_hand: 0, reserved: 0 },
      { warehouse_id: 4, name: 'Kho B', on_hand: 0, reserved: 0 },
    ];
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(motKho)]) }, { san_pham_id: 1 });

    const s = dinhDangTonKho(kq);
    expect(s).toContain('Chi nhánh trung tâm');
    expect(s).not.toContain('Hồ Chí Minh');
    expect(s).toContain('2 kho khác hết hàng');   // vẫn cho biết có kho khác
  });

  it('hết hàng TẤT CẢ kho → một dòng gọn, không liệt kê từng kho', async () => {
    const het = [
      { warehouse_id: 2, name: 'A', on_hand: 0, reserved: 0 },
      { warehouse_id: 3, name: 'B', on_hand: 0, reserved: 0 },
    ];
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(het)]) }, { san_pham_id: 1 });

    const s = dinhDangTonKho(kq);
    expect(s).toContain('HẾT HÀNG');
    expect(s).not.toContain('còn bán được 0');
  });

  it('kho có hàng ĐANG BỊ GIỮ CHỖ vẫn hiện (nhân viên cần biết)', async () => {
    const giuHet = [{ warehouse_id: 2, name: 'Kho A', on_hand: 10, reserved: 10 }];
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(giuHet)]) }, { san_pham_id: 1 });

    const s = dinhDangTonKho(kq);
    expect(s).toContain('Kho A');
    expect(s).toContain('giữ chỗ 10');
  });

  it('không có dữ liệu kho → gợi ý chuyển sale, không đoán bừa', async () => {
    const kq = await traTonKho({ odoo: fakeOdoo([khoRow(null)]) }, { san_pham_id: 1 });
    expect(dinhDangTonKho(kq)).toContain('chuyển sale');
  });

  it('SP không tồn tại → hướng dẫn model tra lại id', () => {
    expect(dinhDangTonKho(null)).toContain('tra_san_pham');
  });
});
