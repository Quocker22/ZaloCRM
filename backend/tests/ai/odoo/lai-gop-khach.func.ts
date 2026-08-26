// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool lai_gop_khach — anh Quyết 26/08: web chỉ có lãi gộp theo SP, muốn bot
// tính lãi gộp TỪNG KHÁCH. Công thức phải là công thức của
// incokit_pos/wizards/profit_report.py: doanh thu = price_subtotal (chưa
// thuế), giá vốn = (purchase_price || standard_price hiện tại) × qty, đơn
// state sale/done theo date_order, lọc kho / NV bán.
import { describe, it, expect, vi } from 'vitest';
import {
  laiGopKhach, dinhDangLaiGopKhach, laiGopKhachDefinition, mocUtc, thangVn,
} from '../../../src/modules/ai/odoo/tools/lai-gop-khach.js';

const BAY_GIO = new Date('2026-08-26T07:00:00Z'); // 14:00 26/08/2026 VN

// Dữ liệu gợi từ prod: Duân ledway (1233), Vinh (1500). Đơn 903 tháng 7, còn lại tháng 8.
const DON: Record<number, { partner: [number, string]; date: string; wh: number; user: number }> = {
  901: { partner: [1233, 'Anh Duân ledway'], date: '2026-08-05 03:00:00', wh: 1, user: 8 },
  902: { partner: [1233, 'Anh Duân ledway'], date: '2026-08-20 09:00:00', wh: 2, user: 9 },
  903: { partner: [1233, 'Anh Duân ledway'], date: '2026-07-15 03:00:00', wh: 1, user: 8 },
  904: { partner: [1500, 'Anh Vinh - Led Vinh'], date: '2026-08-10 03:00:00', wh: 1, user: 8 },
  905: { partner: [1500, 'Anh Vinh - Led Vinh'], date: '2026-08-25 16:30:00', wh: 1, user: 8 }, // 23:30 VN 25/08 (tháng này = 01/08 → hôm nay 26/08)
};
const DONG = [
  { id: 1, order_id: 901, product_id: [976, 'Led 3 bóng 6011-A'], product_uom_qty: 10000, price_subtotal: 9_400_000, purchase_price: 820 },
  { id: 2, order_id: 901, product_id: [500, 'Nguồn NB 12V400W'], product_uom_qty: 10, price_subtotal: 1_320_000, purchase_price: 0 }, // KV cũ → standard_price
  { id: 3, order_id: 902, product_id: [976, 'Led 3 bóng 6011-A'], product_uom_qty: 5000, price_subtotal: 4_700_000, purchase_price: 820 },
  { id: 4, order_id: 902, product_id: [600, 'Ghi chú'], product_uom_qty: 0, price_subtotal: 0, purchase_price: 0, display_type: 'line_note' },
  { id: 5, order_id: 903, product_id: [976, 'Led 3 bóng 6011-A'], product_uom_qty: 20000, price_subtotal: 18_800_000, purchase_price: 800 },
  { id: 6, order_id: 904, product_id: [500, 'Nguồn NB 12V400W'], product_uom_qty: 100, price_subtotal: 13_200_000, purchase_price: 11_640 },
  { id: 7, order_id: 905, product_id: [700, 'SP không vốn'], product_uom_qty: 3, price_subtotal: 300_000, purchase_price: 0 },
];
const VON_HIEN_TAI: Record<number, number> = { 500: 11_640, 700: 0 };

function la(domain: unknown[]): Array<[string, string, unknown]> {
  return domain.filter((d): d is [string, string, unknown] => Array.isArray(d) && d.length === 3);
}

function odooGia() {
  const goi: Array<{ model: string; domain: unknown[] }> = [];
  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: string[], opts?: { limit?: number }) => {
    goi.push({ model, domain });
    const ds = la(domain);
    if (model === 'res.partner') {
      const id = ds.find((d) => d[0] === 'id')?.[2];
      const d = Object.values(DON).find((x) => x.partner[0] === id);
      return d ? [{ id, name: d.partner[1] }] : [];
    }
    if (model === 'stock.warehouse') {
      const ten = String(ds.find((d) => d[0] === 'name')?.[2] ?? '').toLowerCase();
      return [{ id: 1, name: 'Chi nhánh trung tâm' }, { id: 2, name: 'Hồ Chí Minh' }].filter((w) => w.name.toLowerCase().includes(ten));
    }
    if (model === 'res.users') {
      const ten = String(ds.find((d) => d[0] === 'name')?.[2] ?? '').toLowerCase();
      return [{ id: 8, name: 'Nguyễn Thanh Cảnh' }, { id: 9, name: 'Đinh Thị Minh Anh' }].filter((u) => u.name.toLowerCase().includes(ten));
    }
    if (model === 'product.product') {
      const ids = ds.find((d) => d[0] === 'id' && d[1] === 'in')?.[2] as number[];
      return ids.map((id) => ({ id, standard_price: VON_HIEN_TAI[id] ?? 0 }));
    }
    if (model === 'sale.order') {
      const ids = ds.find((d) => d[0] === 'id' && d[1] === 'in')?.[2] as number[];
      return ids.filter((id) => DON[id]).map((id) => ({ id, date_order: DON[id].date }));
    }
    if (model === 'sale.order.line') {
      const tu = String(ds.find((d) => d[0] === 'order_id.date_order' && d[1] === '>=')?.[2]);
      const den = String(ds.find((d) => d[0] === 'order_id.date_order' && d[1] === '<=')?.[2]);
      const wh = ds.find((d) => d[0] === 'order_id.warehouse_id')?.[2] as number[] | undefined;
      const user = ds.find((d) => d[0] === 'order_id.user_id')?.[2] as number[] | undefined;
      const partner = ds.find((d) => d[0] === 'order_partner_id')?.[2] as number | undefined;
      const r = DONG.filter((l) => {
        const d = DON[l.order_id];
        if (d.date < tu || d.date > den) return false;
        if (wh && !wh.includes(d.wh)) return false;
        if (user && !user.includes(d.user)) return false;
        if (partner != null && d.partner[0] !== partner) return false;
        if (l.display_type) return false; // ['display_type','=',false] — tool phải gửi điều kiện này
        return true;
      }).map((l) => ({
        ...l, order_id: [l.order_id, `S${l.order_id}`], order_partner_id: DON[l.order_id].partner, display_type: l.display_type ?? false,
      }));
      return r.slice(0, opts?.limit ?? r.length);
    }
    return [];
  });
  return { odoo: { searchRead }, goi };
}

describe('mốc kỳ theo giờ VN', () => {
  it('đầu ngày 01/08 VN = 31/07 17:00 UTC; cuối ngày 31/08 VN = 31/08 16:59:59 UTC', () => {
    expect(mocUtc('2026-08-01', false)).toBe('2026-07-31 17:00:00');
    expect(mocUtc('2026-08-31', true)).toBe('2026-08-31 16:59:59');
  });
  it('thangVn: 16:30 UTC 31/08 là 23:30 VN → tháng 08; 17:30 UTC 31/08 → tháng 09', () => {
    expect(thangVn('2026-08-31 16:30:00')).toBe('08/2026');
    expect(thangVn('2026-08-31 17:30:00')).toBe('09/2026');
  });
});

describe('laiGopKhach — một khách', () => {
  it('Duân ledway tháng này: DT/vốn/lãi đúng công thức web, purchase_price=0 rơi về standard_price, bỏ dòng ghi chú, không lẫn đơn tháng 7', async () => {
    const { odoo, goi } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, ten_khach: 'Duân ledway', ky: 'thang_nay' });
    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok' || kq.cheDo !== 'mot_khach') return;
    // dòng 1: 9.400.000 − 820×10.000 = 1.200.000 ; dòng 2: 1.320.000 − 11.640×10 = 1.203.600 ; dòng 3: 4.700.000 − 820×5.000 = 600.000
    expect(kq.tong.doanhThu).toBe(15_420_000);
    expect(kq.tong.giaVon).toBe(8_200_000 + 116_400 + 4_100_000);
    expect(kq.tong.lai).toBe(1_200_000 + 1_203_600 + 600_000);
    expect(kq.tong.soDon).toBe(2);
    expect(kq.thang).toHaveLength(1);
    expect(kq.thang[0]).toMatchObject({ nhan: '08/2026', soDon: 2 });
    // SP: 6011-A lãi 1.800.000 > Nguồn 1.203.600
    expect(kq.sanPham.map((s) => s.id)).toEqual([976, 500]);
    expect(kq.sanPham[0].soLuong).toBe(15_000);
    expect(kq.dongKhongVon).toBe(0);
    // domain gửi Odoo mang đủ 3 điều kiện của web
    const dm = JSON.stringify(goi.find((g) => g.model === 'sale.order.line')?.domain);
    expect(dm).toContain('"order_id.state","in",["sale","done"]');
    expect(dm).toContain('"display_type","=",false');
    expect(dm).toContain('"order_partner_id","=",1233');
  });

  it('kỳ 3 tháng → tách theo tháng 07 và 08, đúng thứ tự', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, ky: '3_thang_qua' });
    if (kq.trangThai !== 'ok' || kq.cheDo !== 'mot_khach') throw new Error('sai chế độ');
    expect(kq.thang.map((t) => t.nhan)).toEqual(['07/2026', '08/2026']);
    expect(kq.thang[0].lai).toBe(18_800_000 - 16_000_000);
    expect(kq.tong.soDon).toBe(3);
  });

  it('lọc kho "Hồ Chí Minh" → chỉ đơn 902', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, ky: 'thang_nay', kho: 'hồ chí minh' });
    if (kq.trangThai !== 'ok' || kq.cheDo !== 'mot_khach') throw new Error('sai chế độ');
    expect(kq.tong.soDon).toBe(1);
    expect(kq.tong.lai).toBe(600_000);
    expect(kq.boLoc.kho).toBe('Hồ Chí Minh');
  });

  it('kho không tồn tại → lỗi rõ, KHÔNG lặng lẽ tính tất cả kho', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, kho: 'Kho Mặt Trăng' });
    expect(kq.trangThai).toBe('loi');
  });

  it('id không khớp tên NV nhắc → lỗi, chỉ đường tra_khach_hang', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, ten_khach: 'anh Vinh' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_khach_hang');
  });
});

describe('laiGopKhach — xếp hạng', () => {
  it('tháng này: Vinh (12.036.000 + 300.000 dòng không vốn) trên Duân (3.003.600), đếm dòng không vốn, tổng shop = cộng cả hai', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { ky: 'thang_nay' });
    if (kq.trangThai !== 'ok' || kq.cheDo !== 'xep_hang') throw new Error('sai chế độ');
    expect(kq.khach.map((k) => k.ten)).toEqual(['Anh Vinh - Led Vinh', 'Anh Duân ledway']);
    expect(kq.khach[0].lai).toBe(13_200_000 - 1_164_000 + 300_000);
    expect(kq.khach[0].soLuong).toBe(2); // 2 đơn — đơn 905 lúc 23:30 VN 25/08 (16:30 UTC) vẫn trong kỳ
    expect(kq.khach[1].lai).toBe(3_003_600);
    expect(kq.tong.soKhach).toBe(2);
    expect(kq.tong.lai).toBe(3_003_600 + 12_036_000 + 300_000);
    expect(kq.dongKhongVon).toBe(1);
  });

  it('top=1 → chỉ 1 khách; lọc NV bán "Minh Anh" → chỉ đơn 902', async () => {
    const { odoo } = odooGia();
    const a = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { ky: 'thang_nay', top: 1 });
    if (a.trangThai !== 'ok' || a.cheDo !== 'xep_hang') throw new Error('sai chế độ');
    expect(a.khach).toHaveLength(1);
    const b = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { ky: 'thang_nay', nv_ban: 'minh anh' });
    if (b.trangThai !== 'ok' || b.cheDo !== 'xep_hang') throw new Error('sai chế độ');
    expect(b.tong.soDon).toBe(1);
    expect(b.boLoc.nvBan).toBe('Đinh Thị Minh Anh');
  });
});

describe('thiếu quyền đọc standard_price (prod 26/08: bot_zalo bị Odoo chặn)', () => {
  it('product.product ném lỗi quyền → vẫn ra số bằng purchase_price, dòng thiếu vốn đếm + text nêu cần cấp quyền', async () => {
    const { odoo } = odooGia();
    const goc = odoo.searchRead.getMockImplementation()!;
    odoo.searchRead.mockImplementation(async (model: string, ...rest: unknown[]) => {
      if (model === 'product.product') throw new Error("- standard_price (được phép cho nhóm 'Incokit POS / LEDNELIA / Quản lý')");
      return goc(model, ...(rest as [unknown[], string[], { limit?: number }]));
    });
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { khach_hang_id: 1233, ky: 'thang_nay' });
    if (kq.trangThai !== 'ok' || kq.cheDo !== 'mot_khach') throw new Error('phải ra số, không được chết');
    expect(kq.tong.giaVon).toBe(8_200_000 + 4_100_000); // dòng Nguồn (pp=0) vốn 0
    expect(kq.dongKhongVon).toBe(1);
    expect(kq.khongDocDuocVon).toBe(true);
    expect(dinhDangLaiGopKhach(kq, false)).toContain('bot_zalo');
  });
});

describe('dinhDangLaiGopKhach + định nghĩa', () => {
  it('text nêu chú thích chưa trừ vận chuyển, cảnh báo dòng không vốn, nhắc ảnh khi có', async () => {
    const { odoo } = odooGia();
    const kq = await laiGopKhach({ odoo: odoo as never, bayGio: BAY_GIO }, { ky: 'thang_nay' });
    const s = dinhDangLaiGopKhach(kq, true);
    expect(s).toContain('vận chuyển');
    expect(s).toContain('chưa có giá vốn');
    expect(s).toContain('ẢNH BIỂU ĐỒ');
    expect(s).toContain('Anh Duân ledway');
  });
  it('tool tên lai_gop_khach, không tham số bắt buộc, mô tả nêu hai chế độ và tra_khach_hang', () => {
    expect(laiGopKhachDefinition.name).toBe('lai_gop_khach');
    expect(laiGopKhachDefinition.inputSchema.required ?? []).toHaveLength(0);
    expect(laiGopKhachDefinition.description).toContain('tra_khach_hang');
    expect(laiGopKhachDefinition.description).toMatch(/XẾP HẠNG/);
  });
});
