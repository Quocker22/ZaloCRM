// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: 3 tool BÁO CÁO (tổng quan / bán hàng / cảnh báo tồn kho).
//
// Trọng tâm:
//   1. KHÔNG rò rỉ giá vốn (`cost`, `inventory_value`)
//   2. KHÔNG tự tính tổng — chỉ đọc totals_row Odoo trả về
//   3. Rỗng thì nói rõ, KHÔNG trả chuỗi trống (model sẽ tự bịa)
//   4. Gọi Odoo đúng cách: args = [], tham số trong kwargs
import { describe, it, expect, vi } from 'vitest';
import {
  baoCaoTongQuan, dinhDangBaoCaoTongQuan, baoCaoTongQuanDefinition,
} from '../../../src/modules/ai/odoo/tools/bao-cao-tong-quan.js';
import {
  baoCaoBanHang, dinhDangBaoCaoBanHang, baoCaoBanHangDefinition,
} from '../../../src/modules/ai/odoo/tools/bao-cao-ban-hang.js';
import {
  canhBaoTonKho, dinhDangCanhBaoTonKho, canhBaoTonKhoDefinition,
} from '../../../src/modules/ai/odoo/tools/canh-bao-ton-kho.js';

const fake = (tra: unknown) => ({ execute: vi.fn(async () => tra) });

// ── Dữ liệu mẫu bám hình dạng THẬT của Odoo (đã kiểm bằng gọi thật) ────────
const KPI_MAU = {
  kpi: {
    invoice_count: 974, revenue: 5718613816,
    refund_count: 7, refund_amount: 78245000,
    delta_prev: -37.63, prev_revenue: 9168798461,
  },
  top_products: [{ label: 'Nguồn NB Ngoài Trời 12V400W', value: 463312000 }],
  top_customers: [{ label: 'LED - Chị Thư Led', value: 315643728 }],
  top_staff: [{ label: 'NV A', value: 100000 }],
  time_range: { df: '2026-07-01', dt: '2026-07-31', preset: 'this_month' },
  // Field CẤM — chứa giá vốn từng SP.
  inventory_value: { total_value: 13787288939, top_products: [{ cost: 111600 }] },
  low_stock_html: '<table>...</table>',
};

const BAN_HANG_MAU = {
  tabs: [
    {
      key: 'by_time',
      columns: [
        { key: 'bucket', label: 'Thời gian', type: 'text' },
        { key: 'n_orders', label: 'Số đơn', type: 'int' },
        { key: 'net_revenue', label: 'Doanh thu', type: 'money' },
      ],
      rows: [{ bucket: '01/07/2026', n_orders: 5, net_revenue: 1000000 }],
      totals_row: { bucket: 'TỔNG', n_orders: 974, net_revenue: 5718613816 },
    },
    {
      key: 'by_profit',
      columns: [
        { key: 'code', label: 'Mã', type: 'text' },
        { key: 'revenue', label: 'Doanh thu', type: 'money' },
        { key: 'cost', label: 'Giá vốn', type: 'money' },   // CẤM
        { key: 'profit', label: 'Lợi nhuận', type: 'money' },
      ],
      rows: [{ code: 'HD01', revenue: 1000000, cost: 737017060, profit: 262982940 }],
      totals_row: { code: 'TỔNG', revenue: 1208654068, cost: 737017060, profit: 471637008 },
    },
  ],
  time_range: { df: '2026-07-01', dt: '2026-07-31', preset: 'this_month' },
};

const TON_KHO_MAU = [
  { product_id: 1057, ten: 'Led 2 bóng 2607 Vàng Ấm', ma: '2607-12V-WW',
    ton: 520, bq_ngay: 572.7, so_ngay_con: 0.9, muc_do: 'danger' },
  { product_id: 622, ten: 'Led 3 Bóng Ngoài Trời', ma: '3B-W',
    ton: 1000, bq_ngay: 90, so_ngay_con: 11.1, muc_do: 'warning' },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('CÁCH GỌI ODOO — args = [] chứ KHÔNG [[]]', () => {
  // Bug thật 2026-07-30: spec ghi [[]], gọi thật ném
  // "TypeError: got multiple values for argument 'time_preset'".
  // @api.model đã tự chèn recordset; [[]] đẩy thêm [] vào tham số vị trí đầu.

  it('bao_cao_tong_quan: args rỗng, tham số trong kwargs', async () => {
    const o = fake(KPI_MAU);
    await baoCaoTongQuan({ odoo: o }, { ky: 'this_month' });

    const [model, method, args, kwargs] = o.execute.mock.calls[0];
    expect(model).toBe('incokit.dashboard_overview');
    expect(method).toBe('get_dashboard_data');
    expect(args).toEqual([]);                       // KHÔNG [[]]
    expect(kwargs).toMatchObject({ time_preset: 'this_month' });
  });

  it('bao_cao_ban_hang: args rỗng', async () => {
    const o = fake(BAN_HANG_MAU);
    await baoCaoBanHang({ odoo: o }, {});
    expect(o.execute.mock.calls[0][2]).toEqual([]);
  });

  it('canh_bao_ton_kho: args rỗng, days_ahead trong kwargs', async () => {
    const o = fake(TON_KHO_MAU);
    await canhBaoTonKho({ odoo: o }, { so_ngay: 7 });

    expect(o.execute.mock.calls[0][2]).toEqual([]);
    expect(o.execute.mock.calls[0][3]).toMatchObject({ days_ahead: 7 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('HÀNG RÀO GIÁ VỐN — không bao giờ lộ', () => {
  it('bao_cao_tong_quan XOÁ inventory_value (chứa cost từng SP)', async () => {
    const kq = await baoCaoTongQuan({ odoo: fake(KPI_MAU) }, {});

    expect(JSON.stringify(kq)).not.toContain('inventory_value');
    expect(JSON.stringify(kq)).not.toContain('111600');
    expect(JSON.stringify(kq)).not.toContain('13787288939');
  });

  it('bao_cao_tong_quan XOÁ low_stock_html (HTML, dùng canh_bao_ton_kho thay)', async () => {
    const kq = await baoCaoTongQuan({ odoo: fake(KPI_MAU) }, {});
    expect(JSON.stringify(kq)).not.toContain('<table>');
  });

  it('bao_cao_ban_hang XOÁ cột cost khỏi metadata cột', async () => {
    const kq = await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {});
    const tabLoi = kq.tabs.find((t) => t.key === 'by_profit');

    expect(tabLoi?.cot.map((c) => c.key)).not.toContain('cost');
  });

  it('bao_cao_ban_hang XOÁ cost khỏi từng DÒNG dữ liệu', async () => {
    const kq = await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {});

    expect(JSON.stringify(kq)).not.toContain('737017060');   // giá trị cost
  });

  it('bao_cao_ban_hang XOÁ cost khỏi DÒNG TỔNG (chỗ dễ quên nhất)', async () => {
    const kq = await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {});
    const tabLoi = kq.tabs.find((t) => t.key === 'by_profit');

    expect(tabLoi?.tong).not.toHaveProperty('cost');
  });

  it('chuỗi cuối gửi cho LLM không chứa giá vốn', async () => {
    const s = dinhDangBaoCaoBanHang(await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {}));

    expect(s).not.toContain('737.017.060');
    expect(s.toLowerCase()).not.toContain('giá vốn');
  });

  it('GIỮ LẠI profit — lãi là số lãnh đạo cần, không suy ra được giá vốn từng SP', async () => {
    const kq = await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {});
    const tabLoi = kq.tabs.find((t) => t.key === 'by_profit');

    expect(tabLoi?.cot.map((c) => c.key)).toContain('profit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('bao_cao_tong_quan — đọc số', () => {
  it('đọc đúng KPI từ Odoo', async () => {
    const kq = await baoCaoTongQuan({ odoo: fake(KPI_MAU) }, {});

    expect(kq.kpi.soHoaDon).toBe(974);
    expect(kq.kpi.doanhThu).toBe(5718613816);
    expect(kq.kpi.soVoiKyTruoc).toBe(-37.63);
  });

  it('kỳ lạ → về this_month, KHÔNG truyền thẳng xuống Odoo', async () => {
    // Odoo nhận preset không nhận ra sẽ lặng lẽ trả kỳ khác → bot báo số kỳ sai.
    const o = fake(KPI_MAU);
    await baoCaoTongQuan({ odoo: o }, { ky: 'nam_ngoai' });

    expect(o.execute.mock.calls[0][3]).toMatchObject({ time_preset: 'this_month' });
  });

  it('format VND KHÔNG thập phân', () => {
    const s = dinhDangBaoCaoTongQuan({
      kpi: { soHoaDon: 1, doanhThu: 1234567, soPhieuTra: 0, tienTraHang: 0,
             soVoiKyTruoc: 0, doanhThuKyTruoc: 0 },
      topSanPham: [], topKhachHang: [], topNhanVien: [],
      tuNgay: '2026-07-01', denNgay: '2026-07-31', ky: 'this_month',
    });

    expect(s).toContain('1.234.567đ');
    expect(s).not.toContain('1,234,567');
    expect(s).not.toContain('.00');
  });

  it('LUÔN kèm nguồn + kỳ (chống lỗi "2 màn hình 2 số")', async () => {
    const s = dinhDangBaoCaoTongQuan(await baoCaoTongQuan({ odoo: fake(KPI_MAU) }, {}));

    expect(s).toContain('Nguồn:');
    expect(s).toContain('01/07/2026');
    expect(s).toContain('31/07/2026');
  });

  it('nói giảm khi delta âm', async () => {
    const s = dinhDangBaoCaoTongQuan(await baoCaoTongQuan({ odoo: fake(KPI_MAU) }, {}));

    expect(s).toContain('giảm 37.6%');
  });

  it('KHÔNG nói "tăng 0%" khi không có kỳ trước để so', () => {
    const s = dinhDangBaoCaoTongQuan({
      kpi: { soHoaDon: 5, doanhThu: 100, soPhieuTra: 0, tienTraHang: 0,
             soVoiKyTruoc: 0, doanhThuKyTruoc: 0 },
      topSanPham: [], topKhachHang: [], topNhanVien: [],
      tuNgay: '2026-07-01', denNgay: '2026-07-31', ky: 'this_month',
    });

    expect(s).not.toContain('So kỳ trước');
  });

  it('không có hoá đơn → nói rõ, KHÔNG trả chuỗi rỗng', () => {
    const s = dinhDangBaoCaoTongQuan({
      kpi: { soHoaDon: 0, doanhThu: 0, soPhieuTra: 0, tienTraHang: 0,
             soVoiKyTruoc: 0, doanhThuKyTruoc: 0 },
      topSanPham: [], topKhachHang: [], topNhanVien: [],
      tuNgay: '2026-07-01', denNgay: '2026-07-31', ky: 'this_month',
    });

    expect(s).toContain('chưa có hoá đơn');
    expect(s.length).toBeGreaterThan(20);
  });

  it('Odoo trả rỗng → không sập, trả số 0', async () => {
    const kq = await baoCaoTongQuan({ odoo: fake({}) }, {});
    expect(kq.kpi.doanhThu).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('bao_cao_ban_hang — KHÔNG tự tính tổng', () => {
  it('đọc totals_row của Odoo, KHÔNG cộng lại các dòng', async () => {
    // rows chỉ có 1 dòng 1.000.000đ nhưng totals_row là 5.718.613.816đ.
    // Nếu tool tự .reduce() thì ra 1 triệu — sai hoàn toàn.
    const s = dinhDangBaoCaoBanHang(await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, {}));

    expect(s).toContain('5.718.613.816đ');
  });

  it('lọc theo tab khi được chỉ định', async () => {
    const kq = await baoCaoBanHang({ odoo: fake(BAN_HANG_MAU) }, { tab: 'by_time' });

    expect(kq.tabs).toHaveLength(1);
    expect(kq.tabs[0].key).toBe('by_time');
  });

  it('vắng tab by_profit → coTabLoiNhuan = false', async () => {
    const chiTime = { ...BAN_HANG_MAU, tabs: [BAN_HANG_MAU.tabs[0]] };
    const kq = await baoCaoBanHang({ odoo: fake(chiTime) }, {});

    expect(kq.coTabLoiNhuan).toBe(false);
  });

  it('không có quyền xem lãi → BẢO model đừng đoán số', async () => {
    const chiTime = { ...BAN_HANG_MAU, tabs: [BAN_HANG_MAU.tabs[0]] };
    const s = dinhDangBaoCaoBanHang(await baoCaoBanHang({ odoo: fake(chiTime) }, {}));

    expect(s).toContain('không có quyền');
    expect(s).toContain('KHÔNG được đoán');
  });

  it('totals_row = false (tab rỗng) → không sập', async () => {
    const rong = {
      tabs: [{ key: 'by_time', columns: [], rows: [], totals_row: false }],
      time_range: { df: false, dt: false, preset: 'custom' },
    };
    const kq = await baoCaoBanHang({ odoo: fake(rong) }, {});

    expect(kq.tabs[0].tong).toBeNull();
    expect(dinhDangBaoCaoBanHang(kq)).toContain('không có dữ liệu');
  });

  it('cắt còn 10 dòng và NÓI RÕ đã cắt', async () => {
    const nhieu = {
      ...BAN_HANG_MAU,
      tabs: [{
        ...BAN_HANG_MAU.tabs[0],
        rows: Array.from({ length: 25 }, (_, i) => ({
          bucket: `${i}/07`, n_orders: 1, net_revenue: 1000,
        })),
      }],
    };
    const kq = await baoCaoBanHang({ odoo: fake(nhieu) }, {});

    expect(kq.tabs[0].dong).toHaveLength(10);
    expect(dinhDangBaoCaoBanHang(kq)).toContain('10/25');
  });

  it('tabs rỗng hoàn toàn → thông báo rõ ràng', () => {
    const s = dinhDangBaoCaoBanHang({
      tabs: [], tuNgay: '', denNgay: '', ky: 'this_month', coTabLoiNhuan: false,
    });

    expect(s).toContain('Không lấy được');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('canh_bao_ton_kho', () => {
  it('đọc đúng dữ liệu Odoo', async () => {
    const kq = await canhBaoTonKho({ odoo: fake(TON_KHO_MAU) }, {});

    expect(kq).toHaveLength(2);
    expect(kq[0].sanPhamId).toBe(1057);
    expect(kq[0].mucDo).toBe('danger');
  });

  it('sắp SP gấp nhất lên đầu', async () => {
    const daoNguoc = [TON_KHO_MAU[1], TON_KHO_MAU[0]];
    const kq = await canhBaoTonKho({ odoo: fake(daoNguoc) }, {});

    expect(kq[0].soNgayCon).toBeLessThan(kq[1].soNgayCon);
  });

  it('so_ngay bị chặn trong [1, 90]', async () => {
    const o = fake(TON_KHO_MAU);
    await canhBaoTonKho({ odoo: o }, { so_ngay: 9999 });
    expect(o.execute.mock.calls[0][3]).toMatchObject({ days_ahead: 90 });

    const o2 = fake(TON_KHO_MAU);
    await canhBaoTonKho({ odoo: o2 }, { so_ngay: 0 });
    expect(o2.execute.mock.calls[0][3]).toMatchObject({ days_ahead: 1 });
  });

  it('KHÔNG có SP sắp hết → nói rõ, KHÔNG trả chuỗi rỗng', async () => {
    // Chuỗi rỗng khiến model tự bịa nội dung.
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fake([]) }, {}));

    expect(s).toContain('Không có sản phẩm nào sắp hết');
    expect(s).toContain('Nguồn:');
  });

  it('đánh dấu GẤP cho mức danger', async () => {
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fake(TON_KHO_MAU) }, {}));

    expect(s).toContain('[GẤP]');
    expect(s).toContain('1 mức GẤP');
  });

  it('"dưới 1 ngày" thay vì "0 ngày" (0 gây hiểu nhầm là đã hết)', async () => {
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fake(TON_KHO_MAU) }, {}));

    expect(s).toContain('dưới 1 ngày');
    expect(s).not.toContain('hết sau ~0 ngày');
  });

  it('cắt còn 10 dòng và báo còn nữa', async () => {
    const nhieu = Array.from({ length: 25 }, (_, i) => ({
      ...TON_KHO_MAU[0], product_id: i, so_ngay_con: i,
    }));
    const kq = await canhBaoTonKho({ odoo: fake(nhieu) }, {});

    expect(kq).toHaveLength(10);
    expect(dinhDangCanhBaoTonKho(kq)).toContain('CÒN 15 SP nữa');
  });

  it('Odoo trả không phải mảng → không sập', async () => {
    const kq = await canhBaoTonKho({ odoo: fake(false) }, {});
    expect(kq).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Định nghĩa tool — mô tả phải nói KHI NÀO gọi', () => {
  const ds = [baoCaoTongQuanDefinition, baoCaoBanHangDefinition, canhBaoTonKhoDefinition];

  it('mô tả nào cũng có điều kiện kích hoạt', () => {
    for (const d of ds) {
      expect(d.description, `${d.name} thiếu "GỌI KHI"`).toContain('GỌI KHI');
    }
  });

  it('KHÔNG tool nào đánh dấu mutates (cả 3 chỉ ĐỌC)', () => {
    for (const d of ds) expect(d.mutates).toBeUndefined();
  });

  it('tên tool đúng quy ước snake_case tiếng Việt', () => {
    expect(ds.map((d) => d.name)).toEqual([
      'bao_cao_tong_quan', 'bao_cao_ban_hang', 'canh_bao_ton_kho',
    ]);
  });
});
