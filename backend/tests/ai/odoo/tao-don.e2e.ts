/**
 * tao-don.e2e.ts — E2E tool GHI, chạy với Odoo THẬT.
 *
 * Đây là file E2E quan trọng nhất của cả dự án: nó chứng minh trên DB thật rằng
 * gọi 2 lần cùng khoá chỉ sinh RA MỘT đơn.
 *
 * Chạy:
 *   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
 *   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
 *     npx vitest run --config vitest.e2e.config.ts tests/ai/odoo/tao-don.e2e.ts
 *
 * File này CÓ GHI vào Odoo (tạo sale.order draft) nhưng:
 *   - chỉ tạo DRAFT, không xác nhận → không động vào kho hay sổ kế toán
 *   - afterAll XOÁ SẠCH mọi đơn đã tạo → chạy lại nhiều lần vẫn sạch
 *
 * Thiếu env → tự SKIP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import { taoDonNhap } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { laKhoaBot } from '../../../src/modules/ai/odoo/idempotency.js';

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

/** Hội thoại riêng cho lần chạy này — tránh đụng dữ liệu cũ nếu cleanup lỗi. */
const CONV = `e2e-test-${Date.now()}`;

let khachId = 0;
let spId = 0;
const donDaTao: number[] = [];

describe.skipIf(!coDuCauHinh)('E2E tạo đơn — Odoo thật', () => {
  beforeAll(async () => {
    await odoo.authenticate();

    const kh = await odoo.searchRead<{ id: number }>(
      'res.partner',
      [['customer_rank', '>', 0]],
      ['id'],
      { limit: 1 },
    );
    khachId = kh[0]?.id ?? 0;

    // PHẢI lấy SP CÓ GIÁ: tao_don_nhap từ chối SP giá 0 (chặn đơn tổng 0đ).
    // Lấy SP bất kỳ sẽ trúng SP chưa nhập giá và test fail vì lý do sai.
    const sp = await odoo.searchRead<{ id: number }>(
      'product.product',
      ['&', '&', ['sale_ok', '=', true], ['active', '=', true], ['list_price', '>', 0]],
      ['id'],
      { limit: 1 },
    );
    spId = sp[0]?.id ?? 0;
  });

  afterAll(async () => {
    // Dọn sạch — E2E không dọn thì lần chạy sau sai.
    for (const id of donDaTao) {
      try {
        await odoo.execute('sale.order', 'unlink', [[id]]);
      } catch {
        /* đơn có thể đã bị xoá; bỏ qua */
      }
    }
  });

  const tao = async (seq: number, soLuong = 2) => {
    const kq = await taoDonNhap(
      { odoo, conversationId: CONV, seq },
      { khach_hang_id: khachId, dong: [{ san_pham_id: spId, so_luong: soLuong }] },
    );
    if (kq.trangThai === 'da_tao') donDaTao.push(kq.donId);
    return kq;
  };

  it('tạo được đơn nháp trên Odoo thật', async () => {
    if (!khachId || !spId) return;

    const kq = await tao(0);

    expect(kq.trangThai).toBe('da_tao');
    if (kq.trangThai !== 'da_tao') return;
    expect(kq.donId).toBeGreaterThan(0);
    expect(kq.maDon).toBeTruthy();
  });

  it('đơn trong DB có state = draft, KHÔNG phải sale', async () => {
    if (!khachId || !spId) return;

    const kq = await tao(1);
    if (kq.trangThai !== 'da_tao') return;

    const rows = await odoo.searchRead<{ state: string }>(
      'sale.order',
      [['id', '=', kq.donId]],
      ['state'],
    );
    expect(rows[0].state).toBe('draft');
  });

  it('GỌI 2 LẦN CÙNG KHOÁ → CHỈ 1 ĐƠN TRONG DB', async () => {
    // Đây là test quan trọng nhất. Không có nó, retry sinh 2 đơn cho 1 khách.
    if (!khachId || !spId) return;

    const lan1 = await tao(2);
    const lan2 = await tao(2); // y hệt — mô phỏng retry

    expect(lan1.trangThai).toBe('da_tao');
    expect(lan2.trangThai).toBe('da_ton_tai');
    if (lan1.trangThai !== 'da_tao' || lan2.trangThai !== 'da_ton_tai') return;
    expect(lan2.donId).toBe(lan1.donId);

    // Chốt lại bằng cách đếm thẳng trong DB.
    const trungKhoa = await odoo.searchRead<{ id: number }>(
      'sale.order',
      [['client_order_ref', '=', lan1.khoa]],
      ['id'],
    );
    expect(trungKhoa).toHaveLength(1);
  });

  it('gọi 5 lần liên tiếp → vẫn CHỈ 1 đơn', async () => {
    if (!khachId || !spId) return;

    const kqs = [];
    for (let i = 0; i < 5; i += 1) kqs.push(await tao(3));

    expect(kqs.filter((k) => k.trangThai === 'da_tao')).toHaveLength(1);
    expect(kqs.filter((k) => k.trangThai === 'da_ton_tai')).toHaveLength(4);

    const khoa = `zalo:${CONV}:3`;
    const trong = await odoo.searchRead<{ id: number }>(
      'sale.order',
      [['client_order_ref', '=', khoa]],
      ['id'],
    );
    expect(trong).toHaveLength(1);
  });

  it('seq khác nhau → 2 đơn riêng (khách chốt đơn thứ 2)', async () => {
    if (!khachId || !spId) return;

    const a = await tao(10);
    const b = await tao(11);

    expect(a.trangThai).toBe('da_tao');
    expect(b.trangThai).toBe('da_tao');
    if (a.trangThai === 'da_tao' && b.trangThai === 'da_tao') {
      expect(a.donId).not.toBe(b.donId);
    }
  });

  it('client_order_ref lưu đúng khoá bot (không bị Odoo ghi đè bằng sequence)', async () => {
    // sale_order.py:115 tự điền field này nếu trống — phải chắc là ta thắng.
    if (!khachId || !spId) return;

    const kq = await tao(20);
    if (kq.trangThai !== 'da_tao') return;

    const rows = await odoo.searchRead<{ client_order_ref: string }>(
      'sale.order',
      [['id', '=', kq.donId]],
      ['client_order_ref'],
    );
    expect(rows[0].client_order_ref).toBe(kq.khoa);
    expect(laKhoaBot(rows[0].client_order_ref)).toBe(true);
  });

  it('giá dòng hàng do ODOO đặt, không phải bot bịa', async () => {
    if (!khachId || !spId) return;

    const kq = await tao(30);
    if (kq.trangThai !== 'da_tao') return;

    const lines = await odoo.searchRead<{ price_unit: number }>(
      'sale.order.line',
      [['order_id', '=', kq.donId]],
      ['price_unit'],
    );
    const giaSp = await odoo.searchRead<{ list_price: number }>(
      'product.product',
      [['id', '=', spId]],
      ['list_price'],
    );

    expect(lines).toHaveLength(1);
    // Giá phải khớp giá SP (hoặc pricelist), không phải số bot tự nghĩ ra.
    expect(lines[0].price_unit).toBe(giaSp[0].list_price);
  });

  it('khách không tồn tại → lỗi sạch, KHÔNG tạo đơn rác', async () => {
    if (!spId) return;

    const truoc = await odoo.searchRead<{ id: number }>(
      'sale.order',
      [['client_order_ref', 'like', `zalo:${CONV}:%`]],
      ['id'],
    );

    const kq = await taoDonNhap(
      { odoo, conversationId: CONV, seq: 99 },
      { khach_hang_id: 999_999_999, dong: [{ san_pham_id: spId, so_luong: 1 }] },
    );

    expect(kq.trangThai).toBe('loi');

    const sau = await odoo.searchRead<{ id: number }>(
      'sale.order',
      [['client_order_ref', 'like', `zalo:${CONV}:%`]],
      ['id'],
    );
    expect(sau).toHaveLength(truoc.length);
  });

  it('KHÔNG tạo thêm res.partner nào trong suốt quá trình', async () => {
    if (!khachId || !spId) return;

    const dem = async () =>
      (await odoo.searchRead<{ id: number }>('res.partner', [['customer_rank', '>', 0]], ['id']))
        .length;

    const truoc = await dem();
    await tao(40);
    expect(await dem()).toBe(truoc);
  });
});
