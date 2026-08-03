// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E: 3 tool báo cáo chạy trên Odoo THẬT qua XML-RPC.
//
// VÌ SAO CẦN E2E (không mock được): hai lỗi chặn đường của đợt này chỉ lộ ra
// khi gọi thật, đọc code không thấy —
//   1. `None` trong phản hồi → "cannot marshal None unless allow_none is
//      enabled". UI dùng JSON-RPC (cho phép null) nên chạy tốt hằng ngày; chỉ
//      XML-RPC mới chết.
//   2. `args = [[]]` → "got multiple values for argument". Trông rất hợp lý.
//
// Test này CHỈ ĐỌC — không tạo/sửa/xoá gì trong Odoo.
import { describe, it, expect, beforeAll } from 'vitest';
import { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import { baoCaoTongQuan, dinhDangBaoCaoTongQuan, KY_HOP_LE } from '../../../src/modules/ai/odoo/tools/bao-cao-tong-quan.js';
import { baoCaoBanHang, dinhDangBaoCaoBanHang } from '../../../src/modules/ai/odoo/tools/bao-cao-ban-hang.js';
import { canhBaoTonKho, dinhDangCanhBaoTonKho } from '../../../src/modules/ai/odoo/tools/canh-bao-ton-kho.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
const duCauHinh = Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD);

const odoo = duCauHinh
  ? new OdooClient({
      url: ODOO_URL!, db: ODOO_DB!, username: ODOO_USERNAME!, password: ODOO_PASSWORD!,
    })
  : (null as unknown as OdooClient);

describe.skipIf(!duCauHinh)('E2E báo cáo — Odoo thật', () => {
  beforeAll(async () => {
    await odoo.authenticate();
  });

  // ── Lỗi 1: marshal None ───────────────────────────────────────────────
  describe('MỌI preset gọi được qua XML-RPC (chống lỗi marshal None)', () => {
    for (const ky of KY_HOP_LE) {
      it(`bao_cao_tong_quan · ${ky}`, async () => {
        const kq = await baoCaoTongQuan({ odoo }, { ky });

        expect(kq.ky).toBeTruthy();
        expect(typeof kq.kpi.doanhThu).toBe('number');
      });

      it(`bao_cao_ban_hang · ${ky}`, async () => {
        const kq = await baoCaoBanHang({ odoo }, { ky });

        expect(Array.isArray(kq.tabs)).toBe(true);
      });
    }
  });

  // ── Lỗi 2: args = [] ──────────────────────────────────────────────────
  it('canh_bao_ton_kho gọi được (method mới thêm 2026-07-30)', async () => {
    const kq = await canhBaoTonKho({ odoo }, {});

    expect(Array.isArray(kq)).toBe(true);
    for (const sp of kq) {
      expect(sp.sanPhamId).toBeGreaterThan(0);
      expect(sp.ten).toBeTruthy();
      expect(['danger', 'warning']).toContain(sp.mucDo);
    }
  });

  it('canh_bao_ton_kho: ngưỡng nhỏ hơn → không nhiều SP hơn', async () => {
    const r7 = await canhBaoTonKho({ odoo }, { so_ngay: 7 });
    const r30 = await canhBaoTonKho({ odoo }, { so_ngay: 30 });

    expect((r7.tongKhop ?? 0)).toBeLessThanOrEqual(r30.tongKhop ?? 0);
  });

  // ── Hàng rào bảo mật trên dữ liệu THẬT ────────────────────────────────
  describe('KHÔNG rò rỉ giá vốn trên dữ liệu thật', () => {
    it('bao_cao_tong_quan không mang theo inventory_value', async () => {
      const kq = await baoCaoTongQuan({ odoo }, { ky: 'this_month' });

      expect(JSON.stringify(kq)).not.toContain('inventory_value');
      expect(JSON.stringify(kq)).not.toContain('standard_price');
    });

    it('bao_cao_ban_hang không mang theo cột cost', async () => {
      const kq = await baoCaoBanHang({ odoo }, { ky: 'this_month' });

      for (const t of kq.tabs) {
        expect(t.cot.map((c) => c.key)).not.toContain('cost');
        expect(t.tong ?? {}).not.toHaveProperty('cost');
      }
    });

    it('chuỗi gửi LLM không chứa chữ "giá vốn"', async () => {
      const s = dinhDangBaoCaoBanHang(await baoCaoBanHang({ odoo }, { ky: 'this_month' }));

      expect(s.toLowerCase()).not.toContain('giá vốn');
    });
  });

  // ── Chống 2 nguồn sự thật ─────────────────────────────────────────────
  it('SỐ TỔNG trùng khớp giữa hai tool (cùng nguồn Odoo)', async () => {
    const tq = await baoCaoTongQuan({ odoo }, { ky: 'this_month' });
    const bh = await baoCaoBanHang({ odoo }, { ky: 'this_month', tab: 'by_time' });

    const tongBh = Number(bh.tabs[0]?.tong?.net_revenue ?? 0);
    // Cùng đọc từ Odoo nên phải bằng nhau tuyệt đối. Lệch = có nơi tự tính.
    expect(tongBh).toBe(tq.kpi.doanhThu);
  });

  // ── Định dạng đầu ra ──────────────────────────────────────────────────
  it('đầu ra luôn kèm NGUỒN + KỲ', async () => {
    const s = dinhDangBaoCaoTongQuan(await baoCaoTongQuan({ odoo }, { ky: 'this_month' }));

    expect(s).toContain('Nguồn:');
    expect(s).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('tiền VND không có phần thập phân', async () => {
    const s = dinhDangBaoCaoTongQuan(await baoCaoTongQuan({ odoo }, { ky: 'this_month' }));

    expect(s).not.toMatch(/\d,\d{3}/);      // không dùng dấu phẩy kiểu Mỹ
    expect(s).not.toMatch(/\d\.\d{2}đ/);    // không có ,00đ
  });

  it('cảnh báo tồn kho rỗng vẫn nói rõ, không trả chuỗi trống', async () => {
    // Ngưỡng 1 ngày: gần như chắc chắn rỗng trên DB thật.
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo }, { so_ngay: 1 }));

    expect(s.length).toBeGreaterThan(20);
    expect(s).toContain('Nguồn:');
  });
});
