/**
 * read-tools.e2e.ts — E2E các tool ĐỌC, chạy với Odoo THẬT (không mock).
 *
 * Cần Odoo local chạy:
 *   cd ~/Documents/workspaces/lednelia/code && docker compose up -d
 *
 * Chạy:
 *   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
 *   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
 *     npx vitest run --config vitest.e2e.config.ts tests/ai/odoo/read-tools.e2e.ts
 *
 * File này CHỈ ĐỌC — không tạo, không sửa, không xoá gì trong Odoo. An toàn
 * chạy trên DB local có dữ liệu thật.
 *
 * Thiếu biến môi trường → test tự SKIP (không fail), để CI không có Odoo vẫn xanh.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OdooClient, OdooAuthError } from '../../../src/modules/ai/odoo/client.js';
import { traSanPham } from '../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import { traTonKho } from '../../../src/modules/ai/odoo/tools/tra-ton-kho.js';
import { traKhachHang } from '../../../src/modules/ai/odoo/tools/tra-khach-hang.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
const coDuCauHinh = Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD);

const odoo = coDuCauHinh
  ? new OdooClient({
      url: ODOO_URL!,
      db: ODOO_DB!,
      username: ODOO_USERNAME!,
      password: ODOO_PASSWORD!,
    })
  : (null as unknown as OdooClient);

/** id SP thật lấy được từ Odoo, dùng chung cho các test tồn kho. */
let spIdThat: number | null = null;

describe.skipIf(!coDuCauHinh)('E2E tool đọc — Odoo thật', () => {
  beforeAll(async () => {
    await odoo.authenticate();
    const sp = await odoo.searchRead<{ id: number }>(
      'product.product',
      [['sale_ok', '=', true]],
      ['id'],
      { limit: 1 },
    );
    spIdThat = sp[0]?.id ?? null;
  });

  it('đăng nhập được vào Odoo thật', async () => {
    expect(await odoo.authenticate()).toBeGreaterThan(0);
  });

  it('sai mật khẩu → OdooAuthError (không treo, không retry)', async () => {
    const sai = new OdooClient({
      url: ODOO_URL!,
      db: ODOO_DB!,
      username: ODOO_USERNAME!,
      password: 'mat-khau-sai-chac-chan',
    });
    await expect(sai.authenticate()).rejects.toThrow(OdooAuthError);
  });

  describe('traSanPham', () => {
    it('tra SP có thật → trả đủ id, tên, giá', async () => {
      const rows = await odoo.searchRead<{ name: string }>(
        'product.product',
        [['sale_ok', '=', true]],
        ['name'],
        { limit: 1 },
      );
      if (rows.length === 0) return; // DB rỗng, bỏ qua

      // Lấy từ ĐẦU TIÊN thuần chữ làm query.
      // KHÔNG dùng name.slice(0, N): tên thật hay có mã ("Cáp 16Pin 20cm"), cắt
      // ngang sinh ra mã cụt ("16Pi") và bộ lọc mã model loại sạch kết quả —
      // đúng như thiết kế, nhưng khiến test tự bắn vào chân mình.
      const tuThuanChu = rows[0].name.split(/\s+/).find((t) => /^[^\d]{3,}$/.test(t));
      if (!tuThuanChu) return; // tên toàn mã, bỏ qua ca này

      const kq = await traSanPham({ odoo }, { ten: tuThuanChu });

      expect(kq.length).toBeGreaterThan(0);
      expect(kq[0].id).toBeGreaterThan(0);
      expect(kq[0].ten).toBeTruthy();
      expect(typeof kq[0].gia).toBe('number');
    });

    it('tra theo mã model thật → chỉ trả SP chứa đúng mã đó', async () => {
      // Ca này mới là thứ bộ lọc mã model sinh ra để phục vụ.
      const kq = await traSanPham({ odoo }, { ten: 'COB', gioi_han: 5 });
      for (const sp of kq) {
        expect(sp.ten.toLowerCase()).toContain('cob');
      }
    });

    it('KHÔNG lộ giá vốn trong kết quả thật', async () => {
      const kq = await traSanPham({ odoo }, { ten: 'a', gioi_han: 5 });
      const s = JSON.stringify(kq);

      expect(s).not.toContain('standard_price');
      expect(s).not.toContain('purchase_price');
      expect(s).not.toContain('margin');
    });

    it('tên vô nghĩa → rỗng, không ném', async () => {
      // toHaveLength thay vì toEqual([]): mảng mang thêm thuộc tính tongKhop.
      expect(await traSanPham({ odoo }, { ten: 'zzzkhongcosanphamnay999' })).toHaveLength(0);
    });
  });

  describe('traTonKho', () => {
    it('tra tồn SP thật → conBanDuoc = tồn - giữ chỗ', async () => {
      if (!spIdThat) return;

      const kq = await traTonKho({ odoo }, { san_pham_id: spIdThat });

      expect(kq).not.toBeNull();
      for (const k of kq!.theoKho) {
        expect(k.conBanDuoc).toBe(k.tonThucTe - k.daGiuCho);
      }
    });

    it('ĐỐI CHIẾU với stock.quant — không tin field computed', async () => {
      // ARCHITECTURE.md của lednelia: "Đừng tin số stored cho tiền/kho/giao hàng
      // — tính lại từ nguồn gốc". Test của lednelia tự đối chiếu SUM(stock_quant);
      // ta làm y vậy qua ORM (XML-RPC không chạy SQL thô được).
      if (!spIdThat) return;

      const kq = await traTonKho({ odoo }, { san_pham_id: spIdThat });
      if (!kq || kq.theoKho.length === 0) return;

      const quants = await odoo.searchRead<{ quantity: number; reserved_quantity: number }>(
        'stock.quant',
        [
          ['product_id', '=', spIdThat],
          ['location_id.usage', '=', 'internal'],
        ],
        ['quantity', 'reserved_quantity'],
      );
      const tongQuant = quants.reduce((s, q) => s + Number(q.quantity ?? 0), 0);
      const tongTool = kq.theoKho.reduce((s, k) => s + k.tonThucTe, 0);

      // Sai số nhỏ chấp nhận được (kho nội bộ khác nhau giữa 2 cách đếm),
      // nhưng lệch lớn nghĩa là tool đọc sai nguồn.
      expect(Math.abs(tongQuant - tongTool)).toBeLessThan(Math.max(1, tongQuant * 0.01));
    });

    it('id không tồn tại → null', async () => {
      expect(await traTonKho({ odoo }, { san_pham_id: 999_999_999 })).toBeNull();
    });
  });

  describe('traKhachHang', () => {
    it('SĐT không có → khong_thay (KHÔNG tạo khách mới)', async () => {
      const kq = await traKhachHang({ odoo }, { sdt: '0900000001' });
      expect(kq.trangThai).toBe('khong_thay');
    });

    it('sau khi tra hụt, số lượng partner KHÔNG đổi (chốt chặn cuối)', async () => {
      // Đây là test quan trọng nhất của tool này: chứng minh trên DB THẬT rằng
      // tra hụt không sinh rác dữ liệu.
      const dem = async () =>
        (await odoo.searchRead<{ id: number }>('res.partner', [['customer_rank', '>', 0]], ['id']))
          .length;

      const truoc = await dem();
      await traKhachHang({ odoo }, { sdt: '0900000002' });
      await traKhachHang({ odoo }, { sdt: '0900000003' });

      expect(await dem()).toBe(truoc);
    });

    it('tra khách có thật → tim_thay, kèm id dùng được', async () => {
      const kh = await odoo.searchRead<{ phone: string | false; mobile: string | false }>(
        'res.partner',
        ['&', ['customer_rank', '>', 0], '|', ['phone', '!=', false], ['mobile', '!=', false]],
        ['phone', 'mobile'],
        { limit: 1 },
      );
      if (kh.length === 0) return; // không có khách nào có SĐT

      const sdt = kh[0].phone || kh[0].mobile;
      const kq = await traKhachHang({ odoo }, { sdt: String(sdt) });

      // tim_thay hoặc nhieu_ket_qua đều hợp lệ — miễn không phải khong_thay.
      expect(kq.trangThai).not.toBe('khong_thay');
    });
  });
});
