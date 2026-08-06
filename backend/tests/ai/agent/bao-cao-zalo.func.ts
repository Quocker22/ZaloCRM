// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: bộ báo cáo qua Zalo (spec 06/08/2026) — 3 tool mới + Excel.
//
// Trọng tâm theo spec:
//   1. Whitelist của bao_cao_linh_hoat: giá trị lạ bị chặn KÈM danh sách hợp lệ.
//   2. Odoo cộng (read_group) — không kéo bản ghi thô.
//   3. Rỗng ≠ lỗi: nói "kỳ này không có dữ liệu", chống model đoán số.
//   4. Ngưỡng 15 dòng bật Excel đúng lúc.
//   5. BẢO MẬT: 3 tool mới KHÔNG có trong registry khách.
import { describe, it, expect, vi } from 'vitest';
import {
  baoCaoLinhHoat, dinhDangLinhHoat,
} from '../../../src/modules/ai/odoo/tools/bao-cao-linh-hoat.js';
import {
  donChoXacNhan, dinhDangDonCho, bangDonCho,
} from '../../../src/modules/ai/odoo/tools/don-cho-xac-nhan.js';
import { topSanPham } from '../../../src/modules/ai/odoo/tools/top-san-pham.js';
import { xuatExcel, tenFileBaoCao, NGUONG_DINH_KEM } from '../../../src/modules/ai/odoo/xuat-excel.js';
import { bangRaAnh } from '../../../src/modules/ai/odoo/anh-bang.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

/* ── bao_cao_linh_hoat — whitelist ──────────────────────────────────────── */

const odooRong = () => ({ execute: vi.fn(async () => []) });

describe('bao_cao_linh_hoat — whitelist chặn TỪNG giá trị lạ, kèm danh sách hợp lệ', () => {
  it('bang lạ → lỗi kèm các bảng hợp lệ', async () => {
    const kq = await baoCaoLinhHoat({ odoo: odooRong() } as never, { bang: 'bang_luong', do: 'tong_tien', nhom_theo: 'ngay' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('don_hang');
  });

  it('do không hợp với bảng → lỗi nêu các phép đo của ĐÚNG bảng đó', async () => {
    const kq = await baoCaoLinhHoat({ odoo: odooRong() } as never, { bang: 'ton_kho', do: 'tong_tien', nhom_theo: 'san_pham' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('so_luong');
  });

  it('nhom_theo san_pham với don_hang → lỗi (chỉ dong_don/ton_kho có)', async () => {
    const kq = await baoCaoLinhHoat({ odoo: odooRong() } as never, { bang: 'don_hang', do: 'tong_tien', nhom_theo: 'san_pham' });
    expect(kq.trangThai).toBe('loi');
  });

  it('ngày rác không lọt xuống Odoo', async () => {
    const odoo = odooRong();
    const kq = await baoCaoLinhHoat({ odoo } as never, {
      bang: 'don_hang', do: 'tong_tien', nhom_theo: 'ngay', tu_ngay: 'hôm qua',
    });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('nguong_tien với ton_kho → lỗi rõ ràng', async () => {
    const kq = await baoCaoLinhHoat({ odoo: odooRong() } as never, {
      bang: 'ton_kho', do: 'so_luong', nhom_theo: 'san_pham', nguong_tien: 500,
    });
    expect(kq.trangThai).toBe('loi');
  });
});

describe('bao_cao_linh_hoat — Odoo cộng, bộ lọc nền, rỗng ≠ lỗi', () => {
  it('gọi read_group (Odoo cộng), KHÔNG search_read bản ghi thô', async () => {
    const odoo = odooRong();
    await baoCaoLinhHoat({ odoo } as never, { bang: 'don_hang', do: 'tong_tien', nhom_theo: 'nhan_vien' });

    expect(odoo.execute).toHaveBeenCalledTimes(1);
    const [model, method] = odoo.execute.mock.calls[0] as [string, string];
    expect(model).toBe('sale.order');
    expect(method).toBe('read_group');
  });

  it('bộ lọc nền: không truyền trang_thai → domain tự loại đơn huỷ', async () => {
    const odoo = odooRong();
    await baoCaoLinhHoat({ odoo } as never, { bang: 'don_hang', do: 'so_don', nhom_theo: 'thang' });

    const domain = JSON.stringify((odoo.execute.mock.calls[0] as unknown[])[2]);
    expect(domain).toContain('"state","!=","cancel"');
  });

  it('hỏi rõ đơn huỷ → lọc nền được THAY, không chồng nhau', async () => {
    const odoo = odooRong();
    await baoCaoLinhHoat({ odoo } as never, {
      bang: 'don_hang', do: 'so_don', nhom_theo: 'thang', trang_thai: 'huy',
    });

    const domain = JSON.stringify((odoo.execute.mock.calls[0] as unknown[])[2]);
    expect(domain).toContain('"state","=","cancel"');
    expect(domain).not.toContain('"!="');
  });

  it('kết quả rỗng → câu nói RÕ "không có dữ liệu", chống model đoán', async () => {
    const kq = await baoCaoLinhHoat({ odoo: odooRong() } as never, {
      bang: 'don_hang', do: 'tong_tien', nhom_theo: 'ngay', tu_ngay: '2026-01-01', den_ngay: '2026-01-02',
    });
    expect(kq.trangThai).toBe('ok');
    expect(dinhDangLinhHoat(kq).toLowerCase()).toContain('không có dữ liệu');
  });

  it('đọc đúng nhóm m2o [id, tên] + tổng do code cộng từ số Odoo trả', async () => {
    const odoo = {
      execute: vi.fn(async () => [
        { user_id: [5, 'Quốc'], amount_total: 1_000_000 },
        { user_id: [7, 'Tuấn'], amount_total: 500_000 },
      ]),
    };
    const kq = await baoCaoLinhHoat({ odoo } as never, { bang: 'don_hang', do: 'tong_tien', nhom_theo: 'nhan_vien' });

    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    expect(kq.danhSach[0]).toEqual({ nhan: 'Quốc', giaTri: 1_000_000 });
    expect(kq.tong).toBe(1_500_000);
  });
});

/* ── don_cho_xac_nhan ───────────────────────────────────────────────────── */

describe('don_cho_xac_nhan', () => {
  it('rỗng → "không có đơn nháp" kèm nguồn, không phải lỗi', async () => {
    const kq = await donChoXacNhan({ odoo: { searchRead: vi.fn(async () => []) } as never });
    expect(dinhDangDonCho(kq)).toContain('Không có đơn nháp');
    expect(dinhDangDonCho(kq)).toContain('draft');
  });

  it('đơn GIÀ nhất lên đầu (create_date asc) — đó là đơn bị quên', async () => {
    const odoo = { searchRead: vi.fn(async () => []) };
    await donChoXacNhan({ odoo: odoo as never });
    const opts = odoo.searchRead.mock.calls[0][3] as { order?: string };
    expect(opts.order).toContain('asc');
  });

  it('Odoo ném → trangThai loi, không nổ', async () => {
    const kq = await donChoXacNhan({
      odoo: { searchRead: vi.fn(async () => { throw new Error('sập'); }) } as never,
    });
    expect(kq.trangThai).toBe('loi');
  });
});

/* ── Excel ──────────────────────────────────────────────────────────────── */

describe('xuất Excel', () => {
  it('buffer .xlsx hợp lệ (magic PK) và có kỳ + thời điểm xuất', async () => {
    const buf = await xuatExcel({
      tieuDe: 'Thử', ky: '01/08 – 06/08', cot: ['A', 'B'], dong: [['x', 1]], tongCong: ['TỔNG', 1],
    });
    // .xlsx là zip — 2 byte đầu luôn là "PK".
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('tên file bỏ dấu, kèm ngày, đuôi .xlsx', () => {
    const ten = tenFileBaoCao('Đơn nháp chờ xác nhận');
    expect(ten).toMatch(/^don-nhap-cho-xac-nhan-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('ngưỡng đính kèm là 15 — khớp con số trong spec', () => {
    expect(NGUONG_DINH_KEM).toBe(15);
  });

  it('bảng → ẢNH PNG (phương án lùi 06/08: zca-js gửi .xlsx hay rớt)', async () => {
    // .png magic bytes: 89 50 4E 47.
    const png = await bangRaAnh({
      tieuDe: 'Hàng ế', ky: '30 ngày', cot: ['SP', 'Tồn'],
      dong: Array.from({ length: 20 }, (_, i) => [`SP ${i}`, i * 10]),
      tongCong: ['TỔNG', 190],
    });
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(png.length).toBeGreaterThan(2000);
  });

  it('ảnh chịu được tên SP có ký tự XML (&, <, ") — không vỡ SVG', async () => {
    const png = await bangRaAnh({
      tieuDe: 'Thử', cot: ['SP'], dong: [['Đèn <A&B> "3 bóng"']],
    });
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('bảng đơn chờ dựng đủ cột và hàng tổng', () => {
    const bang = bangDonCho({
      trangThai: 'ok',
      danhSach: [{ id: 1, maDon: 'S1', tenKhach: 'A', tongTien: 100, tuoiGio: 2 }],
      tongTien: 100,
    });
    expect(bang.cot).toHaveLength(4);
    expect(bang.tongCong?.[0]).toBe('TỔNG');
  });
});

/* ── BẢO MẬT — ranh giới registry ───────────────────────────────────────── */

describe('BẢO MẬT: tool báo cáo KHÔNG lọt vào registry khách', () => {
  it('registry khách không có 3 tool mới', () => {
    const r = buildCustomerRegistry({
      odoo: {} as OdooClient,
      ghiNhanChuyenSale: async () => {},
    });
    for (const cam of ['don_cho_xac_nhan', 'top_san_pham', 'bao_cao_linh_hoat']) {
      expect(r.has(cam), `khách KHÔNG được thấy ${cam}`).toBe(false);
    }
  });

  it('registry nhân viên CÓ đủ 3 tool mới', () => {
    const r = buildStaffRegistry({
      odoo: {} as OdooClient, conversationId: 'c', seq: 0,
      ghiNhanChuyenSale: async () => {},
    });
    for (const t of ['don_cho_xac_nhan', 'top_san_pham', 'bao_cao_linh_hoat']) {
      expect(r.has(t)).toBe(true);
    }
  });
});

/* ── top_san_pham — định nghĩa Ế ────────────────────────────────────────── */

describe('top_san_pham — Ế = còn tồn nhưng 0 bán trong kỳ', () => {
  it('SP có bán trong kỳ KHÔNG được tính là ế, dù bán ít', async () => {
    const odoo = {
      searchRead: vi.fn(async () => []),
      execute: vi.fn(async (model: string) =>
        model === 'sale.order.line'
          ? [{ product_id: [1, 'Bán ít nhưng CÓ bán'], product_uom_qty: 1, price_total: 78000 }]
          : [
              { product_id: [1, 'Bán ít nhưng CÓ bán'], quantity: 50 },
              { product_id: [2, 'Tồn mà không ai mua'], quantity: 30 },
            ],
      ),
    };
    const kq = await topSanPham({ odoo: odoo as never }, { kieu: 'e' });

    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    expect(kq.danhSach.map((d) => d.ten)).toEqual(['Tồn mà không ai mua']);
  });

  it('kieu lạ → mặc định ban_chay, không nổ', async () => {
    const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => []) };
    const kq = await topSanPham({ odoo: odoo as never }, { kieu: 'xyz' });
    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai === 'ok') expect(kq.kieu).toBe('ban_chay');
  });
});

describe('top_san_pham — LOẠI dòng rác (VAT/thuế/phí), bug thật 06/08', () => {
  it('"VAT 8%" đứng đầu doanh số vẫn KHÔNG lọt vào top sản phẩm', async () => {
    const odoo = {
      searchRead: vi.fn(async () => []),
      execute: vi.fn(async (model: string) =>
        model === 'sale.order.line'
          ? [
              { product_id: [70, '[SP000070] VAT 8%'], product_uom_qty: 503306453, price_total: 503306453 },
              { product_id: [1039, 'Nguồn NB 12V100W'], product_uom_qty: 120, price_total: 9360000 },
              { product_id: [717, 'Chiết khấu đơn'], product_uom_qty: 5, price_total: -100000 },
            ]
          : [],
      ),
    };
    const kq = await topSanPham({ odoo } as never, { kieu: 'ban_chay' });

    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    const ten = kq.danhSach.map((d) => d.ten);
    expect(ten).not.toContain('[SP000070] VAT 8%');
    expect(ten.some((t) => t.includes('Chiết khấu'))).toBe(false);
    expect(ten).toContain('Nguồn NB 12V100W');
  });

  it('domain gửi Odoo có loại display_type + service', async () => {
    const odoo = { searchRead: vi.fn(async () => []), execute: vi.fn(async () => []) };
    await topSanPham({ odoo } as never, { kieu: 'ban_chay' });

    const domain = JSON.stringify((odoo.execute.mock.calls[0] as unknown[])[2]);
    expect(domain).toContain('display_type');
    expect(domain).toContain('service');
  });
});
