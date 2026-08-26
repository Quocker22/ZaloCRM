// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 10:36 + 10:40-10:49 26/08 (giờ VN):
//   NV "in đơn QC bách phát không in giá" → model gọi in_hoa_don(ma_don=S15274)
//   — S15274 là đơn của TẤN ANH - BÌNH ĐỊNH (đoán mã từ hội thoại cũ). Tool in
//   thật, bot còn bịa "đã in đơn QC Bách Phát". Đơn thật của QC Bách Phát là S15281.
//   NV "in đơn anh Linh Hà Tĩnh" → model không gọi tool, đòi mã đơn; "đúng, in
//   đơn KH000129" → in S15286 (Tuấn Tubione, lần 3) + doc_odoo partner_id=129.
// Nguyên nhân: tool không có đường tìm theo KHÁCH nên model đoán mã đơn.
// Hàng rào ở code: `khach` → tìm đơn mới nhất của khách; `ma_don` + `khach`
// không cùng chủ → TỪ CHỐI (không in nhầm giấy cho khách khác).
import { describe, it, expect, vi } from 'vitest';
import { inHoaDon, inHoaDonDefinition, kiemCauNvKhopDon } from '../../../src/modules/ai/odoo/tools/in-hoa-don.js';
import { boDau } from '../../../src/modules/ai/odoo/tim-khong-dau.js';

const KHACH = [
  { id: 1233, name: 'QC Bách Phát - Xã Đàn', ref: 'KH002265- AC', phone: false, mobile: false },
  { id: 3006, name: 'Tấn Anh - Bình Định', ref: 'KH003006ACDL', phone: false, mobile: false },
  { id: 3423, name: 'Anh Linh Hà Tĩnh - 0948.080.668', ref: 'KH000129- ACDL', phone: '0948080668', mobile: false },
  { id: 2076, name: 'Anh Linh', ref: 'KH001495', phone: false, mobile: false },
  { id: 1045, name: 'Anh Linh', ref: 'KH002416', phone: false, mobile: false },
];
const DON = [
  { id: 28199, name: 'S15281', state: 'sale', amount_total: 1140000, partner_id: [1233, 'QC Bách Phát - Xã Đàn'], invoice_ids: [7281], date_order: '2026-08-26 03:00:00' },
  { id: 27000, name: 'S14066', state: 'sale', amount_total: 1110000, partner_id: [1233, 'QC Bách Phát - Xã Đàn'], invoice_ids: [7066], date_order: '2026-08-07 03:00:00' },
  { id: 28192, name: 'S15274', state: 'sale', amount_total: 1433456, partner_id: [3006, 'Tấn Anh - Bình Định'], invoice_ids: [7274], date_order: '2026-08-26 02:00:00' },
  { id: 28203, name: 'S15285', state: 'sale', amount_total: 10108800, partner_id: [3423, 'Anh Linh Hà Tĩnh - 0948.080.668'], invoice_ids: [], date_order: '2026-08-26 03:10:00' },
];
const HD: Record<number, { id: number; name: string; state: string; amount_total: number; move_type: string; partner_id: [number, string] }> = {
  7281: { id: 7281, name: 'INV/2026/028305', state: 'posted', amount_total: 1140000, move_type: 'out_invoice', partner_id: [1233, 'QC Bách Phát - Xã Đàn'] },
  7066: { id: 7066, name: 'INV/2026/027001', state: 'posted', amount_total: 1110000, move_type: 'out_invoice', partner_id: [1233, 'QC Bách Phát - Xã Đàn'] },
  7274: { id: 7274, name: 'INV/2026/028301', state: 'posted', amount_total: 1433456, move_type: 'out_invoice', partner_id: [3006, 'Tấn Anh - Bình Định'] },
};

/** Lá domain Odoo: [field, op, value] — duyệt đệ quy bỏ qua toán tử '|' '&'. */
function la(domain: unknown[]): Array<[string, string, unknown]> {
  return domain.filter((d): d is [string, string, unknown] => Array.isArray(d) && d.length === 3);
}

/** Giả lập Odoo đủ cho res.partner (ref / name ilike), sale.order, account.move. */
function fakeOdoo() {
  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: string[], opts?: { limit?: number; order?: string }) => {
    const ds = la(domain);
    if (model === 'res.partner') {
      const ref = ds.find((d) => d[0] === 'ref');
      if (ref) {
        const v = String(ref[2]).toLowerCase();
        return KHACH.filter((k) => (ref[1] === 'ilike' ? k.ref.toLowerCase().includes(v) : k.ref.toLowerCase() === v));
      }
      const ten = ds.filter((d) => d[0] === 'name').map((d) => boDau(String(d[2])));
      return KHACH.filter((k) => ten.some((t) => boDau(k.name).includes(t)));
    }
    if (model === 'sale.order') {
      let r = DON.filter((d) => ds.every(([f, op, v]) => {
        if (f === 'id') return d.id === v;
        if (f === 'name') return d.name === v;
        if (f === 'partner_id') return d.partner_id[0] === v;
        if (f === 'state' && op === 'in') return (v as string[]).includes(d.state);
        return true;
      }));
      // 'date_order desc' (đường khách) và 'create_date desc' (đường hội thoại) — fake coi như cùng thứ tự thời gian.
      if (opts?.order?.includes('date_order desc') || opts?.order?.includes('create_date desc')) r = [...r].sort((a, b) => b.date_order.localeCompare(a.date_order));
      return r.slice(0, opts?.limit ?? r.length);
    }
    if (model === 'account.move') {
      const idIn = ds.find((d) => d[0] === 'id' && d[1] === 'in');
      const name = ds.find((d) => d[0] === 'name');
      let r = Object.values(HD);
      if (idIn) r = r.filter((h) => (idIn[2] as number[]).includes(h.id));
      if (name) r = r.filter((h) => h.name === name[2]);
      return r.slice(0, opts?.limit ?? r.length);
    }
    return [];
  });
  return { searchRead };
}

/**
 * xuatHoaDon giả: đơn chưa có hoá đơn (S15285) → xuất ra INV/2026/028500.
 * In = đã bán (anh Quyết 26/08): tool tự xuất rồi in, không in tờ đơn nháp.
 */
function xhdGia() {
  return vi.fn(async (inp: { ma_don?: string; don_id?: number }) => ({
    trangThai: 'da_xuat' as const, hoaDonId: 9285, soHoaDon: 'INV/2026/028500',
    maDon: inp.ma_don ?? 'S15285', tenKhach: 'Anh Linh Hà Tĩnh - 0948.080.668',
    tongTien: 10108800, link: 'x', anh: null,
  }));
}

describe('in_hoa_don theo KHÁCH (ca 10:36 / 10:49 26/08)', () => {
  it('"in đơn QC bách phát" → in hoá đơn của đơn MỚI NHẤT của QC Bách Phát (S15281), không phải S15274', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { khach: 'QC bách phát' });
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob).toHaveBeenCalledTimes(1);
    expect(themJob.mock.calls[0][0]).toMatchObject({ hoaDonId: 7281, soHoaDon: 'INV/2026/028305' });
  });

  it('HÀNG RÀO: model đưa ma_don=S15274 (Tấn Anh) kèm khach="QC bách phát" → TỪ CHỐI, không in nhầm', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { ma_don: 'S15274', khach: 'QC bách phát' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('S15274');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('ma_don + khach ĐÚNG chủ → in bình thường', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { ma_don: 'S15274', khach: 'Tấn Anh Bình Định' });
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob.mock.calls[0][0]).toMatchObject({ hoaDonId: 7274 });
  });

  it('"in đơn KH000129" — mã khách (ref) → đơn mới nhất S15285 chưa có hoá đơn → TỰ XUẤT rồi in hoá đơn', async () => {
    const themJob = vi.fn(async () => {});
    const odoo = fakeOdoo();
    const xhd = xhdGia();
    const kq = await inHoaDon({ odoo, themJob, xuatHoaDon: xhd }, { khach: 'KH000129' });
    expect(kq.trangThai).toBe('da_xep_hang');
    // in = đã bán: đơn nháp S15285 → xuất hoá đơn INV/2026/028500 rồi in tờ ĐÓ
    expect(xhd).toHaveBeenCalledWith({ ma_don: 'S15285' });
    expect(themJob.mock.calls[0][0]).toMatchObject({ hoaDonId: 9285, soHoaDon: 'INV/2026/028500' });
    // không được tra res.partner theo id=129
    const goiSaiId = odoo.searchRead.mock.calls.some(([m, dom]) => m === 'res.partner' && la(dom as unknown[]).some((d) => d[0] === 'id' && d[2] === 129));
    expect(goiSaiId).toBe(false);
  });

  it('"in đơn anh linh hà tĩnh" → tên gần nguyên văn áp đảo → tự chốt, TỰ XUẤT rồi in', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { khach: 'anh linh hà tĩnh' });
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob.mock.calls[0][0]).toMatchObject({ soHoaDon: 'INV/2026/028500' });
  });

  it('ca 17:35 26/08: "in đơn này" + don_id + khach trùng 3 người → có mã đơn thì tên chỉ để kiểm, vẫn in', async () => {
    const themJob = vi.fn(async () => {});
    // "Linh" khớp 3 người; đơn S15285 (28203) của Anh Linh Hà Tĩnh — tenKhopKhach("Linh", tên) = true
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { khach: 'Linh', don_id: 28203 });
    expect(kq.trangThai === 'loi' ? kq.lyDo : 'ok').toBe('ok');
    // S15285 chưa có hoá đơn → tự xuất (xhdGia trả INV/2026/028500 id 9285) rồi in
    expect(themJob.mock.calls[0][0]).toMatchObject({ hoaDonId: 9285, soHoaDon: 'INV/2026/028500' });
  });

  it('ca 17:35 26/08: "in đơn anh linh" trùng 3 người NHƯNG đơn mới nhất hội thoại là của một trong số đó → chọn, in luôn', async () => {
    const themJob = vi.fn(async () => {});
    // fakeOdoo: đường hội thoại (client_order_ref) trả đơn mới nhất = S15285 của Anh Linh Hà Tĩnh (3423)
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, conversationId: 'c1', xuatHoaDon: xhdGia() }, { khach: 'Linh' });
    expect(kq.trangThai === 'loi' ? kq.lyDo : 'ok').toBe('ok');
    if (kq.trangThai === 'da_xep_hang') expect(kq.maDon).toBe('S15285');
    expect(themJob).toHaveBeenCalledTimes(1);
  });

  it('khách trùng tên ("Linh" → 3 người) → lỗi liệt kê, KHÔNG in bừa', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { khach: 'Linh' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('KH000129');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('khách không có đơn nào → lỗi nói thẳng', async () => {
    const themJob = vi.fn(async () => {});
    const kq = await inHoaDon({ odoo: fakeOdoo(), themJob, xuatHoaDon: xhdGia() }, { khach: 'KH001495' });
    expect(kq.trangThai).toBe('loi');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('schema có `khach`; mô tả dặn: nói tên khách → truyền khach, ĐỪNG đoán ma_don', () => {
    expect(inHoaDonDefinition.inputSchema.properties).toHaveProperty('khach');
    expect(inHoaDonDefinition.description).toMatch(/khach/);
  });
});

// HÀNG RÀO CUỐI: câu NV (caller đưa, không qua LLM) — model đoán ma_don mà
// KHÔNG truyền khach thì vẫn bị chặn nếu tên NV nêu không nằm trên đơn.
describe('in_hoa_don — câu NV phải khớp đơn sắp in (deps.cauNv)', () => {
  const goi = (cauNv: string, input: Parameters<typeof inHoaDon>[1]) => {
    const themJob = vi.fn(async () => {});
    return inHoaDon({ odoo: fakeOdoo(), themJob, conversationId: 'c1', cauNv, xuatHoaDon: xhdGia() }, input).then((kq) => ({ kq, themJob }));
  };

  it('ca 10:36: "in đơn QC bách phát không in giá" + ma_don=S15274 (Tấn Anh), KHÔNG khach → TỪ CHỐI', async () => {
    const { kq, themJob } = await goi('in đơn QC bách phát không in giá', { ma_don: 'S15274' });
    expect(kq.trangThai).toBe('loi');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('ca 10:49: "[Trả lời tin: "…Anh Linh Hà Tĩnh…"] đúng, in đơn KH000129" + ma_don=S15281 (QC Bách Phát) → TỪ CHỐI', async () => {
    const { kq, themJob } = await goi('[Trả lời tin: "Nếu anh/chị muốn in đơn cho khách "Anh Linh Hà Tĩnh"…"] đúng, in đơn KH000129', { ma_don: 'S15281' });
    expect(kq.trangThai).toBe('loi');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('NV nêu ĐÚNG khách của đơn ("in đơn anh Tấn Anh Bình Định" + S15274) → in', async () => {
    const { kq, themJob } = await goi('in đơn anh Tấn Anh Bình Định', { ma_don: 'S15274' });
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob).toHaveBeenCalledTimes(1);
  });

  it('NV nêu đúng MÃ ĐƠN ("in hoá đơn S15274 có giá") → in, khỏi so tên', async () => {
    const { kq } = await goi('in hoá đơn S15274 có giá', { ma_don: 'S15274', co_gia: true });
    expect(kq.trangThai).toBe('da_xep_hang');
  });

  it('không nêu gì ("in lại đơn không giá") → đường đơn mới nhất hội thoại, cho qua', async () => {
    const { kq, themJob } = await goi('in lại đơn không giá', {});
    expect(kq.trangThai).toBe('da_xep_hang');
    expect(themJob).toHaveBeenCalledTimes(1);
  });

  it('đường hội thoại (đơn mới nhất = anh Linh) mà NV nói "in đơn anh tuấn tubione" → TỪ CHỐI', async () => {
    const { kq, themJob } = await goi('in đơn anh tuấn tubione', {});
    expect(kq.trangThai).toBe('loi');
    expect(themJob).not.toHaveBeenCalled();
  });

  it('kiemCauNvKhopDon: lý do từ chối chỉ model gọi lại bằng khach=… (bỏ ma_don)', () => {
    const ly = kiemCauNvKhopDon('in đơn QC bách phát không in giá', { maDon: 'S15274', tenKhach: 'Tấn Anh - Bình Định' });
    expect(ly).toMatch(/khach="qc bach phat"/);
    expect(kiemCauNvKhopDon('in đơn', { maDon: 'S1', tenKhach: 'X' })).toBeNull();
  });
});
