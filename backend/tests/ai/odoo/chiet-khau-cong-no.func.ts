// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: sua_chiet_khau + xuat_cong_no.
//
// sua_chiet_khau là tool GHI đầu tiên SỬA đơn đã tồn tại — mọi ranh giới phải
// nằm trong code, không phải prompt.
import { describe, it, expect, vi } from 'vitest';
import {
  suaChietKhau, dinhDangChietKhau, suaChietKhauDefinition,
} from '../../../src/modules/ai/odoo/tools/sua-chiet-khau.js';
import {
  xuatCongNo, dinhDangCongNo, xuatCongNoDefinition,
} from '../../../src/modules/ai/odoo/tools/xuat-cong-no.js';
import { linkXuLyDon } from '../../../src/modules/ai/odoo/hoa-don-anh.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const DON = {
  id: 26704, name: 'S13802', state: 'draft',
  amount_total: 1700000, partner_id: [1879, 'Anh Tuấn Đà Nẵng'],
};

/** Odoo giả trả theo model được hỏi. */
const fake = (map: Record<string, unknown[]>, sauGhi?: unknown[]) => {
  let daGhi = false;
  return {
    searchRead: vi.fn(async (model: string) => {
      if (model === 'sale.order' && daGhi && sauGhi) return sauGhi;
      return map[model] ?? [];
    }),
    execute: vi.fn(async () => { daGhi = true; return true; }),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_chiet_khau — RANH GIỚI KẾ TOÁN (trong code, không phải prompt)', () => {
  it('đơn NHÁP → cho sửa', async () => {
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }, { id: 2 }] },
      [{ amount_total: 1530000 }],
    );

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(kq.ok).toBe(true);
    expect(kq.tongSau).toBe(1530000);
    expect(kq.soDong).toBe(2);
  });

  it('đơn ĐÃ XÁC NHẬN → TỪ CHỐI, không ghi gì', async () => {
    // state=sale đã vào sổ kế toán + tồn kho. Sửa là làm lệch số đã chốt.
    const o = fake({ 'sale.order': [{ ...DON, state: 'sale' }] });

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('đã xác nhận');
    expect(o.execute).not.toHaveBeenCalled();
  });

  it('đơn ĐÃ HUỶ → từ chối', async () => {
    const o = fake({ 'sale.order': [{ ...DON, state: 'cancel' }] });

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('đã huỷ');
    expect(o.execute).not.toHaveBeenCalled();
  });

  it('state=sent (đã gửi báo giá) VẪN sửa được — chưa vào sổ', async () => {
    const o = fake(
      { 'sale.order': [{ ...DON, state: 'sent' }], 'sale.order.line': [{ id: 1 }] },
      [{ amount_total: 1530000 }],
    );

    expect((await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 })).ok).toBe(true);
  });
});

describe('sua_chiet_khau — KHÔNG giới hạn %, nhưng chặn giá trị vô nghĩa', () => {
  // Anh chốt 2026-07-31: nhân viên gõ bao nhiêu bot áp bấy nhiêu (0-100).

  it('50% được phép (không có trần 20%)', async () => {
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }] },
      [{ amount_total: 850000 }],
    );

    expect((await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 50 })).ok).toBe(true);
  });

  it('100% được phép (tặng hàng)', async () => {
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }] }, [{ amount_total: 0 }],
    );

    expect((await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 100 })).ok).toBe(true);
  });

  it('0% được phép (gỡ chiết khấu đã áp)', async () => {
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }] },
      [{ amount_total: 1700000 }],
    );

    expect((await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 0 })).ok).toBe(true);
  });

  it('ÂM → từ chối, không chạm Odoo', async () => {
    const o = fake({ 'sale.order': [DON] });

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: -5 });

    expect(kq.ok).toBe(false);
    expect(o.searchRead).not.toHaveBeenCalled();
  });

  it('trên 100 → từ chối', async () => {
    const o = fake({ 'sale.order': [DON] });

    expect((await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 150 })).ok).toBe(false);
  });

  it('NaN → từ chối (không ghi thầm thành 0)', async () => {
    const o = fake({ 'sale.order': [DON] });

    const kq = await suaChietKhau(
      { odoo: o }, { don_id: 26704, phan_tram: 'mười' as unknown as number },
    );

    expect(kq.ok).toBe(false);
    expect(o.execute).not.toHaveBeenCalled();
  });
});

describe('sua_chiet_khau — KHÔNG tự tính tiền', () => {
  it('đọc LẠI tổng từ Odoo, không nhân tay', async () => {
    // Odoo trả 1.111.111 (số lạ, không phải 1.700.000 × 0.9 = 1.530.000).
    // Nếu tool tự nhân thì kết quả sẽ là 1.530.000 → sai.
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }] },
      [{ amount_total: 1111111 }],
    );

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(kq.tongSau).toBe(1111111);
  });

  it('ghi discount cho TẤT CẢ dòng trong MỘT lần write', async () => {
    const o = fake(
      { 'sale.order': [DON], 'sale.order.line': [{ id: 1 }, { id: 2 }, { id: 3 }] },
      [{ amount_total: 1 }],
    );

    await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(o.execute).toHaveBeenCalledTimes(1);
    expect(o.execute.mock.calls[0][2]).toEqual([[1, 2, 3], { discount: 10 }]);
  });

  it('đơn KHÔNG có dòng hàng → từ chối', async () => {
    const o = fake({ 'sale.order': [DON], 'sale.order.line': [] });

    const kq = await suaChietKhau({ odoo: o }, { don_id: 26704, phan_tram: 10 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('chưa có dòng hàng');
  });

  it('không tìm thấy đơn → từ chối, không ném lỗi', async () => {
    const kq = await suaChietKhau({ odoo: fake({ 'sale.order': [] }) }, { ma_don: 'X', phan_tram: 10 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('Không tìm thấy');
  });
});

describe('dinhDangChietKhau', () => {
  it('nêu tổng trước/sau và số tiền giảm', () => {
    const s = dinhDangChietKhau({
      ok: true, donId: 1, maDon: 'S13802', phanTram: 10,
      tongTruoc: 1700000, tongSau: 1530000, soDong: 2,
    });

    expect(s).toContain('1.700.000đ');
    expect(s).toContain('1.530.000đ');
    expect(s).toContain('giảm 170.000đ');
  });

  it('từ chối → BẢO model đừng nói đã áp xong', () => {
    const s = dinhDangChietKhau({ ok: false, donId: 1, maDon: 'S1', lyDo: 'đã xác nhận' });

    expect(s).toContain('ĐỪNG nói là đã áp xong');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('xuat_cong_no — TÊN TRÙNG (bug thật 2026-07-31)', () => {
  // "Quảng Cáo Hoàng Anh" khớp cả "Quảng cáo Hoàng Nam Thanh Hóa" (ilike khớp
  // "Quảng cáo") → bot thấy 2 kết quả nên chuyển sale, dù có MỘT khách trùng
  // khít tên nhân viên gõ.

  const HAI_KHACH = [
    { id: 3898, name: 'Quảng Cáo Hoàng Anh', ref: 'KH003159', incokit_receivable_balance: 6114000 },
    { id: 849, name: 'Quảng cáo Hoàng Nam Thanh Hóa', ref: 'KH002599AC', incokit_receivable_balance: 0 },
  ];

  it('khớp CHÍNH XÁC tên (bỏ dấu) → tự chọn, KHÔNG hỏi', async () => {
    const o = fake({ 'res.partner': HAI_KHACH, 'account.move': [] });

    const kq = await xuatCongNo({ odoo: o }, { ten: 'Quảng Cáo Hoàng Anh' });

    expect(kq.loai).toBe('ok');
    if (kq.loai === 'ok') expect(kq.duLieu.khachId).toBe(3898);
  });

  it('khớp không phân biệt HOA/thường và DẤU', async () => {
    const o = fake({ 'res.partner': HAI_KHACH, 'account.move': [] });

    const kq = await xuatCongNo({ odoo: o }, { ten: 'quang cao hoang anh' });

    expect(kq.loai).toBe('ok');
  });

  it('KHÔNG khớp khít → trả danh sách để HỎI, không chuyển sale', async () => {
    const o = fake({ 'res.partner': HAI_KHACH, 'account.move': [] });

    const kq = await xuatCongNo({ odoo: o }, { ten: 'Quảng cáo' });

    expect(kq.loai).toBe('nhieu_khach');
    if (kq.loai === 'nhieu_khach') expect(kq.danhSach).toHaveLength(2);
  });

  it('đầu ra khi nhiều khách BẢO model hỏi, CẤM chuyển sale', async () => {
    const o = fake({ 'res.partner': HAI_KHACH, 'account.move': [] });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { ten: 'Quảng cáo' }));

    expect(s).toContain('HỎI nhân viên chọn');
    expect(s).toContain('ĐỪNG chuyển sale');
  });
});

describe('xuat_cong_no — số liệu', () => {
  const KHACH = [{
    id: 3898, name: 'Quảng Cáo Hoàng Anh', ref: 'KH003159',
    incokit_receivable_balance: 6114000,
  }];
  const HD = [{
    name: 'INV/2026/025950', invoice_date: '2026-07-18',
    amount_total: 6114000, amount_residual: 6114000,
  }];

  it('đọc THẲNG field công nợ, KHÔNG cộng amount_residual', async () => {
    // Odoo trả nợ 9tr nhưng HĐ chỉ 6tr — hai số có thể lệch (bút toán tay).
    // Tool phải lấy 9tr (field Odoo), không phải 6tr (tổng HĐ).
    const o = fake({
      'res.partner': [{ ...KHACH[0], incokit_receivable_balance: 9000000 }],
      'account.move': HD,
    });

    const kq = await xuatCongNo({ odoo: o }, { khach_id: 3898 });

    if (kq.loai === 'ok') expect(kq.duLieu.congNo).toBe(9000000);
  });

  it('liệt kê hoá đơn chưa trả kèm ngày', async () => {
    const o = fake({ 'res.partner': KHACH, 'account.move': HD });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3898 }));

    expect(s).toContain('6.114.000đ');
    expect(s).toContain('INV/2026/025950');
    expect(s).toContain('18/07');
  });

  it('HĐ trả một phần → nêu rõ đã trả bao nhiêu', async () => {
    const o = fake({
      'res.partner': KHACH,
      'account.move': [{ ...HD[0], amount_residual: 2000000, amount_total: 6114000 }],
    });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3898 }));

    expect(s).toContain('còn 2.000.000đ');
    expect(s).toContain('đã trả 4.114.000đ');
  });

  it('có nợ mà KHÔNG có HĐ → nói rõ, đừng để model kết luận "hết nợ"', async () => {
    const o = fake({ 'res.partner': KHACH, 'account.move': [] });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3898 }));

    expect(s).toContain('6.114.000đ');
    expect(s).toContain('bút toán thủ công');
  });

  it('không nợ và không HĐ → nói KHÔNG còn công nợ', async () => {
    const o = fake({
      'res.partner': [{ ...KHACH[0], incokit_receivable_balance: 0 }],
      'account.move': [],
    });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3898 }));

    expect(s).toContain('KHÔNG còn công nợ');
  });

  it('cắt còn 10 HĐ và báo còn nữa', async () => {
    const nhieu = Array.from({ length: 15 }, (_, i) => ({
      name: `INV/${i}`, invoice_date: '2026-07-18',
      amount_total: 1000, amount_residual: 1000,
    }));
    const o = fake({ 'res.partner': KHACH, 'account.move': nhieu });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3898 }));

    expect(s).toContain('còn 5 hoá đơn nữa');
  });

  it('chỉ lấy HĐ BÁN chưa thanh toán (không lấy HĐ mua, không lấy đã trả)', async () => {
    const o = fake({ 'res.partner': KHACH, 'account.move': [] });
    await xuatCongNo({ odoo: o }, { khach_id: 3898 });

    const domain = JSON.stringify(o.searchRead.mock.calls[1][1]);
    expect(domain).toContain('out_invoice');
    expect(domain).toContain('posted');
    expect(domain).toContain('payment_state');
  });

  it('không thấy khách → chỉ dẫn thử lại, không chuỗi rỗng', async () => {
    const s = dinhDangCongNo(await xuatCongNo({ odoo: fake({ 'res.partner': [] }) }, { ten: 'zzz' }));

    expect(s).toContain('Không tìm thấy khách');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('RANH GIỚI — khách KHÔNG có 2 tool này', () => {
  it('registry khách không có sua_chiet_khau và xuat_cong_no', () => {
    const r = buildCustomerRegistry({
      odoo: { searchRead: vi.fn(), execute: vi.fn() } as unknown as OdooClient,
      ghiNhanChuyenSale: async () => {},
    });
    const ten = r.definitions().map((d) => d.name);

    expect(ten).not.toContain('sua_chiet_khau');
    expect(ten).not.toContain('xuat_cong_no');
  });
});

describe('linkXuLyDon — dạng /web# theo link thật của anh', () => {
  it('dựng đúng dạng link app Odoo', () => {
    const l = linkXuLyDon('http://localhost:8069', 26704);

    expect(l).toContain('/web#id=26704');
    expect(l).toContain('model=sale.order');
    expect(l).toContain('view_type=form');
    expect(l).toContain('action=');
    expect(l).toContain('menu_id=');
  });

  it('KHÔNG dùng dạng /odoo/sale/<id> (mất ngữ cảnh menu)', () => {
    expect(linkXuLyDon('http://x', 5)).not.toContain('/odoo/sale/');
  });

  it('bỏ dấu / thừa ở cuối', () => {
    expect(linkXuLyDon('http://x:8069///', 5)).toContain('http://x:8069/web#id=5');
  });
});

describe('Định nghĩa tool', () => {
  it('sua_chiet_khau đánh dấu mutates (là tool GHI)', () => {
    expect(suaChietKhauDefinition.mutates).toBe(true);
  });

  it('xuat_cong_no KHÔNG mutates (chỉ đọc)', () => {
    expect(xuatCongNoDefinition.mutates).toBeUndefined();
  });

  it('mô tả chiết khấu nói RÕ là được phép, đừng chuyển sale', () => {
    expect(suaChietKhauDefinition.description).toContain('KHÔNG chuyển sale');
  });

  it('cả hai mô tả đều có điều kiện kích hoạt', () => {
    expect(suaChietKhauDefinition.description).toContain('GỌI KHI');
    expect(xuatCongNoDefinition.description).toContain('GỌI KHI');
  });
});
