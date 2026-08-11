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

  it('tổng công nợ CỘNG TỪ CHÍNH danh sách HĐ, không đọc field rời', async () => {
    // ĐẢO NGƯỢC giả định cũ (xem ca thật 16:09 11/08 ở describe dưới):
    // `incokit_receivable_balance` là field TỰ VIẾT, đo trên prod thấy sai ở
    // 29/40 khách nợ nhiều nhất. Nguồn đúng là tổng amount_residual của HĐ.
    const o = fake({
      'res.partner': [{ ...KHACH[0], incokit_receivable_balance: 9000000 }],
      'account.move': HD,
    });

    const kq = await xuatCongNo({ odoo: o }, { khach_id: 3898 });

    // 6.114.000 = tổng HĐ thật, KHÔNG phải 9.000.000 của field hỏng.
    if (kq.loai === 'ok') expect(kq.duLieu.congNo).toBe(6114000);
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
describe('xuat_cong_no — TÍNH SAI CÔNG NỢ (bug thật 16:09 11/08/2026)', () => {
  // CA THẬT, nhóm Test-AI: hỏi công nợ "Lộc Beco Thanh Hóa" (Odoo id=2293
  // "Anh Lộc Led Beco Thanh Hóa"). Bot báo "Công nợ hiện tại: 3.990.000đ"
  // rồi in NGAY BÊN DƯỚI 10 hoá đơn chưa trả cộng lại 144.796.039đ — riêng
  // INV/2026/025127 đã 100.100.000đ. Số tổng mâu thuẫn với chính danh sách.
  //
  // NGUYÊN NHÂN: tool đọc field TỰ VIẾT `incokit_receivable_balance`
  // (=3.990.000) làm số tổng, còn danh sách in ra từ account.move — hai đường
  // tính tách rời. Đo trên prod: field sai ở 29/40 khách nợ nhiều nhất, báo
  // thiếu tổng 3,92 TỶ, có khách field=0 mà thực tế đang nợ.
  // Ba nguồn độc lập cho khách 2293 đều ra 144.796.039: partner.credit,
  // tổng amount_residual HĐ, và tổng amount_residual của account.move.line
  // phải thu chưa đối trừ.

  // Dữ liệu THẬT lấy từ Odoo prod ngày 11/08/2026.
  const LOC_BECO = [{
    id: 2293, name: 'Anh Lộc Led Beco Thanh Hóa', ref: 'KH001276',
    phone: false, mobile: false, credit: 144796039,
    incokit_receivable_balance: 3990000, // ← field hỏng, số bot đã báo
  }];

  const hd = (
    name: string, invoice_date: string, amount_total: number, amount_residual: number,
  ) => ({
    name, invoice_date, move_type: 'out_invoice', amount_total, amount_residual,
    amount_residual_signed: amount_residual,
  });

  const HD_THAT = [
    hd('INV/2026/026149', '2026-07-21', 240000, 240000),
    hd('INV/2026/026108', '2026-07-21', 3750000, 3750000),
    hd('INV/2026/025989', '2026-07-18', 10146640, 10146640),
    hd('INV/2026/025602', '2026-07-13', 3570000, 3570000),
    hd('INV/2026/025491', '2026-07-08', 4500000, 4500000),
    hd('INV/2026/025359', '2026-07-06', 2900000, 2900000),
    hd('INV/2026/025299', '2026-07-04', 4500000, 4500000),
    hd('INV/2026/025127', '2026-07-01', 100100000, 100100000),
    hd('INV/2026/023866', '2026-06-10', 11250000, 11250000),
    hd('INV/2026/023765', '2026-06-08', 6128400, 3839399),
  ];

  /** Tổng thật, đối chiếu được với partner.credit của Odoo. */
  const TONG_THAT = 144796039;

  it('KHÔNG báo 3.990.000đ khi danh sách cộng lại 144.796.039đ', async () => {
    const o = fake({ 'res.partner': LOC_BECO, 'account.move': HD_THAT });

    const kq = await xuatCongNo({ odoo: o }, { khach_id: 2293, ten_nhac: 'Lộc Beco Thanh Hóa' });

    expect(kq.loai).toBe('ok');
    if (kq.loai === 'ok') {
      expect(kq.duLieu.congNo).not.toBe(3990000);
      expect(kq.duLieu.congNo).toBe(TONG_THAT);
    }
  });

  it('đầu ra in ra: số tổng KHỚP tổng danh sách, có HĐ 100 triệu', async () => {
    const o = fake({ 'res.partner': LOC_BECO, 'account.move': HD_THAT });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 2293 }));

    // Số tổng đứng đầu tin PHẢI là 144tr, không phải 3,99tr như bug.
    expect(s).toContain('Công nợ: 144.796.039đ');
    expect(s).not.toContain('Công nợ: 3.990.000đ');
    expect(s).toContain('INV/2026/025127');
    expect(s).toContain('100.100.000đ');
    // 3.990.000 vẫn được nêu, nhưng CHỈ trong cảnh báo lệch sổ.
    expect(s).toMatch(/LỆCH SỔ[\s\S]*3\.990\.000đ/);
  });

  it('BẤT BIẾN: tổng LUÔN bằng tổng các dòng in ra', async () => {
    // Chốt chống tái phát: cấm tính tổng tách rời khỏi danh sách.
    for (const bo of [HD_THAT, HD_THAT.slice(0, 3), [HD_THAT[7]], []]) {
      const o = fake({ 'res.partner': LOC_BECO, 'account.move': bo });
      const kq = await xuatCongNo({ odoo: o }, { khach_id: 2293 });

      if (kq.loai === 'ok') {
        const tongDong = kq.duLieu.hoaDon.reduce((a, h) => a + h.conNo, 0);
        expect(kq.duLieu.congNo).toBe(tongDong);
      }
    }
  });

  it('HOÁ ĐƠN HOÀN TRẢ (out_refund) phải TRỪ, không cộng', async () => {
    // Ca thật "Anh Khoa Cabin": HĐ bán 261.580.240 − hoàn trả 2.480.000
    // = 259.100.240 đúng bằng partner.credit. Cộng nhầm dấu là đòi thừa
    // 2 lần tiền đã hoàn cho khách.
    const o = fake({
      'res.partner': LOC_BECO,
      'account.move': [
        hd('INV/2026/025127', '2026-07-01', 100100000, 100100000),
        {
          name: 'RINV/2026/00054', invoice_date: '2026-08-03', move_type: 'out_refund',
          amount_total: 2200000, amount_residual: 2200000, amount_residual_signed: -2200000,
        },
      ],
    });

    const kq = await xuatCongNo({ odoo: o }, { khach_id: 2293 });

    if (kq.loai === 'ok') {
      expect(kq.duLieu.congNo).toBe(97900000);
      const tongDong = kq.duLieu.hoaDon.reduce((a, h) => a + h.conNo, 0);
      expect(kq.duLieu.congNo).toBe(tongDong);
    }
  });

  it('nhiều hơn 10 HĐ → tổng tính TRÊN TOÀN BỘ, nêu rõ phần chưa liệt kê', async () => {
    const nhieu = Array.from({ length: 14 }, (_, i) =>
      hd(`INV/${i}`, '2026-07-18', 1000000, 1000000));
    const o = fake({ 'res.partner': LOC_BECO, 'account.move': nhieu });

    const kq = await xuatCongNo({ odoo: o }, { khach_id: 2293 });
    const s = dinhDangCongNo(kq);

    if (kq.loai === 'ok') expect(kq.duLieu.congNo).toBe(14000000);
    expect(s).toContain('14.000.000đ');
    expect(s).toContain('còn 4 hoá đơn nữa');
  });

  it('LỆCH với sổ kế toán → CẢNH BÁO, không im lặng trả số', async () => {
    // Ca thật "CTY 3S": HĐ cộng lại 77.100.000 nhưng sổ phải thu chỉ còn
    // 44.600.000 (bút toán tay đối trừ mà không đánh dấu HĐ đã trả).
    // Danh sách KHÔNG giải thích được số dư → phải nói ra để nhân viên tra tay.
    const o = fake({
      'res.partner': [{
        id: 3846, name: 'CTY 3S', ref: 'KH009',
        credit: 44600000, incokit_receivable_balance: 44600000,
      }],
      'account.move': [
        hd('INV/A', '2026-07-01', 40000000, 40000000),
        hd('INV/B', '2026-07-02', 37100000, 37100000),
      ],
    });

    const s = dinhDangCongNo(await xuatCongNo({ odoo: o }, { khach_id: 3846 }));

    expect(s).toContain('77.100.000đ');
    expect(s).toMatch(/LỆCH|lệch/);
    expect(s).toContain('44.600.000đ');
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
