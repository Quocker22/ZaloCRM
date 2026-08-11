// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: phanh `lam_odoo` chỉ mở khi NGƯỜI THẬT gật — đi qua ĐÚNG
// registry nhân viên, không gọi tắt vào hàm lamOdoo.
//
// ── VÌ SAO PHẢI TEST Ở TẦNG REGISTRY ──────────────────────────────────────
// Lỗ hổng 11/08 nằm ở CHỖ NỐI: `lam.ts` có phanh, nhưng registry ép
// `input as never` nên cờ `xac_nhan` model bịa ra lọt thẳng vào tham số. Test
// riêng `lam.ts` không bắt được lỗi ghép nối này — phải dựng registry thật.
//
// Đường đi được kiểm: model gọi lam_odoo → nhận "cần xác nhận" → gọi LẠI với
// xac_nhan:true trong CÙNG lượt → phải bị CHẶN. Rồi người thật gật ở lượt SAU
// → phải CHO QUA (đừng làm hỏng tính năng).
import { describe, it, expect, vi } from 'vitest';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';

/** Odoo giả: `search_count` trả số bản ghi khớp, các lệnh ghi chỉ ghi nhận. */
function fakeOdoo(soKhop: number) {
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  const searchRead = vi.fn(async () =>
    Array.from({ length: Math.min(soKhop, 1000) }, (_, i) => ({ id: i + 1 })));
  return { execute, searchRead } as never;
}

function dungRegistry(odoo: ReturnType<typeof fakeOdoo>, xacNhanTuNguoi: boolean) {
  return buildStaffRegistry({
    odoo,
    conversationId: 'hoi-thoai-test',
    seq: 1,
    xacNhanTuNguoi,
    ghiNhanChuyenSale: async () => {},
  });
}

/** Lệnh xoá 300 đơn nháp — đúng ca đã đo được trong lỗ hổng. */
const XOA_300 = {
  bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
  loc: [['state', '=', 'draft']],
};

const daGoi = (odoo: { execute: { mock: { calls: unknown[][] } } }, m: string) =>
  odoo.execute.mock.calls.some((c) => c[1] === m);

describe('lam_odoo qua registry — model tự gật KHÔNG vượt được phanh', () => {
  it('LƯỢT 1: model gọi lệnh xoá → registry trả câu xin xác nhận, KHÔNG xoá', async () => {
    const odoo = fakeOdoo(300);
    const r = dungRegistry(odoo, false); // chưa ai gật
    const chay = r.executor();

    const kq = await chay({ id: '1', name: 'lam_odoo', input: XOA_300 });

    expect(kq.content).toMatch(/xác nhận|đồng ý/i);
    expect(kq.content).toContain('300');
    expect(daGoi(odoo, 'unlink')).toBe(false);
  });

  it('LƯỢT 1 (tiếp): model tự điền xac_nhan:true trong CÙNG lượt → VẪN CHẶN', async () => {
    const odoo = fakeOdoo(300);
    // `xacNhanTuNguoi: false` = chưa có tin gật nào của người trong lượt này.
    const r = dungRegistry(odoo, false);
    const chay = r.executor();

    await chay({ id: '1', name: 'lam_odoo', input: XOA_300 });
    // Model đọc câu cảnh báo rồi tự gật — đây là JSON thuần, không mang Symbol.
    const lan2 = await chay({
      id: '2', name: 'lam_odoo', input: { ...XOA_300, xac_nhan: true },
    });

    expect(lan2.content).toMatch(/xác nhận|đồng ý/i);
    // 300 đơn vẫn còn nguyên.
    expect(daGoi(odoo, 'unlink')).toBe(false);
  });

  it('LƯỢT SAU: người thật gật → registry gắn chìa khoá, lệnh CHẠY', async () => {
    const odoo = fakeOdoo(300);
    // Code đã đối chiếu tin thật của nhân viên ("đồng ý") ở lượt sau.
    const r = dungRegistry(odoo, true);
    const chay = r.executor();

    const kq = await chay({ id: '1', name: 'lam_odoo', input: XOA_300 });

    expect(kq.content).toMatch(/Đã/);
    expect(daGoi(odoo, 'unlink')).toBe(true);
  });

  it('người gật KHÔNG biến lệnh thường thành lệnh lạ — ghi thường vẫn chạy như cũ', async () => {
    const odoo = fakeOdoo(1);
    const r = dungRegistry(odoo, false);
    const chay = r.executor();

    const kq = await chay({
      id: '1', name: 'lam_odoo',
      input: { bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['name', '=', 'S13823']] },
    });

    expect(kq.content).toMatch(/Đã/);
    expect(daGoi(odoo, 'action_confirm')).toBe(true);
  });

  it('phanh HÀNG LOẠT: model tự gật sửa 1.257 SP → chặn; người gật → chạy', async () => {
    const lenh = {
      bang: 'product.product', viec: 'sua',
      loc: [['id', '>', 0]], du_lieu: { list_price: 1 }, xac_nhan: true,
    };

    const odooA = fakeOdoo(1257);
    const kqA = await dungRegistry(odooA, false).executor()(
      { id: '1', name: 'lam_odoo', input: lenh },
    );
    expect(kqA.content).toMatch(/xác nhận|đồng ý/i);
    expect(daGoi(odooA, 'write')).toBe(false);

    const odooB = fakeOdoo(1257);
    const kqB = await dungRegistry(odooB, true).executor()(
      { id: '1', name: 'lam_odoo', input: lenh },
    );
    expect(kqB.content).toMatch(/Đã/);
    expect(daGoi(odooB, 'write')).toBe(true);
  });

  it('người vừa nói DỪNG thì phanh cũ vẫn nguyên (hai hàng rào không đá nhau)', async () => {
    const odoo = fakeOdoo(1);
    const r = dungRegistry(odoo, false);
    // `executor(true)` = người vừa nói dừng/huỷ (y-dinh-dung.ts).
    const kq = await r.executor(true)({
      id: '1', name: 'tao_khach_hang', input: { ten: 'Khách X' },
    });
    expect(kq.isError).toBe(true);
    expect(daGoi(odoo, 'create')).toBe(false);
  });
});
