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
