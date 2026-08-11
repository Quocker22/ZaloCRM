// SPDX-License-Identifier: AGPL-3.0-or-later
// YÊU CẦU THẬT 17:58–17:59 ngày 11/08/2026 — anh Quyết (khách hàng), nguyên văn:
//   "Anh muốn nó báo cáo theo ngày các sản phẩm bán ra"
//   "Xem còn tồn kho bao nhiêu"
//   "Ví dụ anh có 1.000 sản phẩm như hôm nay anh chỉ bán được 10 mã sản phẩm thôi
//    thì anh sẽ hỏi nó là hôm nay bán được bao nhiêu mã và còn tồn lại là bao nhiêu"
//   "Sau đó anh sẽ cho kho đi đối chiếu với số lượng thực tế những cái mã bán ra
//    thì nó sẽ nhanh hơn"
//   "Bây giờ bọn anh đang bị tình trạng là lâu lâu kiểm tra lại một lần thì lại
//    thấy thiếu nhiều hàng"
//
// ĐÂY KHÔNG PHẢI BÁO CÁO DOANH SỐ. Đây là công cụ KIỂM KHO TỪNG PHẦN: thay vì
// đếm cả 1.000 mã mỗi lần, kho chỉ đối chiếu những mã CÓ BIẾN ĐỘNG hôm nay.
// Mục đích cuối là PHÁT HIỆN THẤT THOÁT SỚM. Vì vậy bộ test này khoá 3 thứ:
//   1. Đếm đúng SỐ MÃ bán ra (câu anh Quyết hỏi ĐẦU TIÊN)
//   2. Chỉ ra mã BẤT THƯỜNG (bán > 0 mà tồn = 0/âm) — phần giá trị nhất
//   3. Mô tả tool nói được cho model biết nó làm được việc này — bài học
//      `canh_bao_ton_kho`: tool có sẵn mà bot vẫn đáp "em không có công cụ".
import { describe, it, expect, vi } from 'vitest';
import { ngayVietNam } from '../../../src/modules/ai/odoo/ky-thoi-gian.js';
import {
  baoCaoBanTon, dinhDangBanTon, bangBanTon, baoCaoBanTonDefinition,
} from '../../../src/modules/ai/odoo/tools/bao-cao-ban-ton.js';

/**
 * Odoo giả. `execute` phục vụ read_group trên sale.order.line (số bán),
 * `searchRead` phục vụ product.product (tồn hiện tại).
 *
 * Hình dạng dữ liệu chép từ đo THẬT trên prod ngày 11/08/2026.
 */
function fakeOdoo(nhomBan: unknown[], tonSP: unknown[] = []) {
  return {
    execute: vi.fn(async () => nhomBan),
    searchRead: vi.fn(async () => tonSP),
  };
}

/** read_group sale.order.line — đúng 3 mã thật đo được 11/08 trên prod. */
const BAN_MAU = [
  { product_id: [2043, '[SP000448] Card thu BX-V7512'], product_uom_qty: 201, price_total: 40_200_000 },
  { product_id: [4102, '[K2OVP] Đầu xử lý hình ảnh OVP-K2'], product_uom_qty: 10, price_total: 25_000_000 },
  { product_id: [1057, '[SP000910] Nguồn 12V400W Jinbo'], product_uom_qty: 10, price_total: 3_000_000 },
];

/** product.product — tồn hiện tại. Nguồn 12V400W bán 10 mà tồn 0 → BẤT THƯỜNG. */
const TON_MAU = [
  { id: 2043, name: 'Card thu BX-V7512', default_code: 'SP000448', qty_available: 2636 },
  { id: 4102, name: 'Đầu xử lý hình ảnh OVP-K2', default_code: 'K2OVP', qty_available: 113 },
  { id: 1057, name: 'Nguồn 12V400W Jinbo', default_code: 'SP000910', qty_available: 0 },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('CA THẬT 17:58 11/08 — "hôm nay bán được bao nhiêu mã và còn tồn lại bao nhiêu"', () => {
  it('KỲ MẶC ĐỊNH LÀ HÔM NAY — anh Quyết hỏi "theo ngày", không phải 30 ngày', async () => {
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    const kq = await baoCaoBanTon({ odoo: o }, {});

    expect(kq.trangThai).toBe('ok');
    // Dùng ĐÚNG hàm code dùng: giờ VIỆT NAM, không phải UTC.
    // Bug test 00:02 ngày 12/08: test tự tính `toISOString()` ra giờ UTC nên
    // từ 0h đến 7h sáng giờ VN thì lệch một ngày, test đỏ oan.
    const homNay = ngayVietNam();
    // Cả hai đầu kỳ phải là HÔM NAY. Rơi về "30 ngày gần nhất" như top_san_pham
    // là trả lời câu khác: kho sẽ đi đếm mã của cả tháng.
    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).toContain(`${homNay} 00:00:00`);
    expect(domain).toContain(`${homNay} 23:59:59`);
  });

  it('lọc theo NGÀY ĐẶT ĐƠN (order_id.date_order), không phải create_date', async () => {
    // Nghiệp vụ kiểm kho bám ngày đơn phát sinh. `create_date` là ngày tạo DÒNG
    // — sửa đơn cũ hôm nay sẽ đẻ dòng mới mang ngày hôm nay, làm lệch danh sách
    // mã cần kiểm.
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    await baoCaoBanTon({ odoo: o }, {});

    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).toContain('order_id.date_order');
  });

  it('loại đơn HUỶ và dòng ghi chú/section (display_type)', async () => {
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    await baoCaoBanTon({ odoo: o }, {});

    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).toContain('cancel');
    expect(domain).toContain('display_type');
  });

  it('trả TỔNG SỐ MÃ bán ra — con số anh Quyết hỏi ĐẦU TIÊN', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});

    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    expect(kq.soMa).toBe(3);

    // Và phải hiện ra CHỮ trong câu trả lời — model đọc text, không đọc field.
    const s = dinhDangBanTon(kq);
    expect(s).toContain('3 mã');
  });

  it('mỗi dòng có ĐỦ: mã · tên · số bán · tồn hiện tại', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    const card = kq.danhSach.find((d) => d.sanPhamId === 2043)!;
    expect(card.ma).toBe('SP000448');
    expect(card.banRa).toBe(201);
    expect(card.tonHienTai).toBe(2636);
  });

  it('sắp theo SỐ BÁN GIẢM DẦN — mã bán nhiều nhất kho phải kiểm trước', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    expect(kq.danhSach.map((d) => d.banRa)).toEqual([201, 10, 10]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHẦN GIÁ TRỊ NHẤT: "lâu lâu kiểm tra lại một lần thì lại thấy thiếu nhiều hàng"
describe('ĐÁNH DẤU BẤT THƯỜNG — phát hiện thất thoát sớm', () => {
  it('bán > 0 mà TỒN = 0 → đánh dấu bất thường (ca Nguồn 12V400W Jinbo thật)', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    const nguon = kq.danhSach.find((d) => d.sanPhamId === 1057)!;
    expect(nguon.batThuong).toBeTruthy();

    // Hai mã còn lại tồn dày → KHÔNG được báo động giả. Báo động giả nhiều thì
    // kho bỏ qua hết, đúng lúc có thất thoát thật cũng không ai nhìn.
    expect(kq.danhSach.find((d) => d.sanPhamId === 2043)!.batThuong).toBeFalsy();
    expect(kq.danhSach.find((d) => d.sanPhamId === 4102)!.batThuong).toBeFalsy();
  });

  it('TỒN ÂM → bất thường (dấu hiệu CHẮC CHẮN có sai lệch sổ sách)', async () => {
    const ton = [{ id: 1057, name: 'Nguồn 12V400W Jinbo', default_code: 'SP000910', qty_available: -7 }];
    const ban = [{ product_id: [1057, '[SP000910] Nguồn 12V400W Jinbo'], product_uom_qty: 10, price_total: 1 }];

    const kq = await baoCaoBanTon({ odoo: fakeOdoo(ban, ton) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    expect(kq.danhSach[0]!.batThuong).toBeTruthy();
    expect(kq.soBatThuong).toBe(1);
  });

  it('câu trả lời NÊU THẲNG mã bất thường — không bắt người đọc tự dò bảng', async () => {
    const s = dinhDangBanTon(await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {}));

    expect(s.toUpperCase()).toContain('BẤT THƯỜNG');
    expect(s).toContain('Nguồn 12V400W Jinbo');
  });

  it('không có mã nào bất thường → nói rõ "không có", KHÔNG im lặng', async () => {
    // Im lặng khiến model tự suy diễn. Nói thẳng "0 mã bất thường" là thông tin.
    const tonDay = TON_MAU.map((t) => ({ ...t, qty_available: 500 }));
    const s = dinhDangBanTon(await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, tonDay) }, {}));

    expect(s.toLowerCase()).toMatch(/không có mã nào bất thường|0 mã bất thường/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('LỌC SẢN PHẨM KỸ THUẬT — VAT/phí ship làm hỏng báo cáo SỐ LƯỢNG', () => {
  it('dòng VAT bị loại khỏi danh sách VÀ khỏi tổng số mã', async () => {
    // Tiền lệ commit 720bca7a: kế toán ghi VAT bằng SP giả đơn giá 1đ, số lượng
    // = số tiền (qty = 43.968.000). Lọt vào đây thì nó chiếm hạng 1 và kho sẽ
    // được yêu cầu đi đếm "43 triệu cái VAT".
    const banCoVat = [
      ...BAN_MAU,
      { product_id: [562, '[SP000070] VAT 8%'], product_uom_qty: 43_968_000, price_total: 43_968_000 },
      { product_id: [563, 'Phí vận chuyển'], product_uom_qty: 500_000, price_total: 500_000 },
    ];

    const kq = await baoCaoBanTon({ odoo: fakeOdoo(banCoVat, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    expect(kq.danhSach.map((d) => d.sanPhamId)).not.toContain(562);
    expect(kq.danhSach.map((d) => d.sanPhamId)).not.toContain(563);
    // Số mã phải là 3, KHÔNG phải 5 — đây là con số anh Quyết dùng để giao việc
    // cho kho, sai một mã là kho đếm thừa/thiếu.
    expect(kq.soMa).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KỲ KHÔNG CÓ ĐƠN NÀO — không được trả bảng rỗng khó hiểu', () => {
  it('nói rõ "không có mã nào bán ra" kèm kỳ và nguồn', async () => {
    const s = dinhDangBanTon(await baoCaoBanTon({ odoo: fakeOdoo([], TON_MAU) }, {}));

    expect(s.trim().length).toBeGreaterThan(30);
    expect(s.toLowerCase()).toMatch(/không có mã nào/);
    expect(s).toContain('Nguồn:');
  });

  it('Odoo lỗi → trả trạng thái lỗi, KHÔNG giả vờ "hôm nay bán 0 mã"', async () => {
    // Nhầm lỗi hạ tầng thành "hôm nay không bán gì" là nguy hiểm nhất: kho sẽ
    // KHÔNG đi kiểm những mã thật sự có biến động.
    const o = { execute: vi.fn(async () => { throw new Error('XML-RPC sập'); }), searchRead: vi.fn(async () => []) };

    const kq = await baoCaoBanTon({ odoo: o }, {});

    expect(kq.trangThai).toBe('loi');
    expect(dinhDangBanTon(kq).toLowerCase()).not.toMatch(/không có mã nào bán/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KHOẢNG NGÀY — "hôm qua", "tuần này", "từ ngày… đến ngày…"', () => {
  it('nhận tu_ngay/den_ngay cụ thể', async () => {
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    await baoCaoBanTon({ odoo: o }, { tu_ngay: '2026-08-01', den_ngay: '2026-08-10' });

    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).toContain('2026-08-01 00:00:00');
    expect(domain).toContain('2026-08-10 23:59:59');
  });

  it('chỉ có tu_ngay ("hôm qua") → den_ngay bằng chính ngày đó, không kéo tới hôm nay', async () => {
    // "Hôm qua bán bao nhiêu mã" mà trả cả hôm qua + hôm nay là sai danh sách
    // mã kho phải đếm.
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    await baoCaoBanTon({ odoo: o }, { tu_ngay: '2026-08-10' });

    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).toContain('2026-08-10 23:59:59');
  });

  it('ngày rác → rơi về hôm nay chứ không đẩy chuỗi rác xuống Odoo', async () => {
    const o = fakeOdoo(BAN_MAU, TON_MAU);

    await baoCaoBanTon({ odoo: o }, { tu_ngay: 'hôm qua', den_ngay: '???' });

    const domain = JSON.stringify(o.execute.mock.calls[0]![2]);
    expect(domain).not.toContain('hôm qua');
    expect(domain).toContain(ngayVietNam());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('EXCEL — kho cầm đi đối chiếu thực tế, không đọc trên Zalo được', () => {
  it('có cột TRỐNG "Thực tế đếm" và "Chênh lệch" để kho điền tay', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    const bang = bangBanTon(kq);
    expect(bang.cot).toContain('Thực tế đếm');
    expect(bang.cot).toContain('Chênh lệch');

    // Trống THẬT: điền sẵn số là kho sẽ chép lại thay vì đi đếm.
    const iThucTe = bang.cot.indexOf('Thực tế đếm');
    for (const d of bang.dong) expect(d[iThucTe]).toBe('');
  });

  it('bảng có đủ mã · tên · bán ra · tồn hiện tại và đúng số dòng', async () => {
    const kq = await baoCaoBanTon({ odoo: fakeOdoo(BAN_MAU, TON_MAU) }, {});
    if (kq.trangThai !== 'ok') throw new Error('phải ok');

    const bang = bangBanTon(kq);
    expect(bang.dong).toHaveLength(3);
    expect(bang.cot.join('|')).toMatch(/Mã/);
    expect(bang.cot.join('|')).toMatch(/Bán ra/);
    expect(bang.cot.join('|')).toMatch(/Tồn/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BÀI HỌC 11/08: `canh_bao_ton_kho` có sẵn mà model không biết dùng → bot đáp
// "em không có công cụ". Mô tả tool là thứ DUY NHẤT model đọc để chọn tool.
describe('MÔ TẢ TOOL — model chọn tool bằng mô tả, không bằng code', () => {
  const d = baoCaoBanTonDefinition;

  it('chép NGUYÊN VĂN câu hỏi thật của anh Quyết làm ví dụ', () => {
    expect(d.description.toLowerCase()).toContain('bán được bao nhiêu mã');
    expect(d.description.toLowerCase()).toContain('còn tồn');
  });

  it('giữ quy ước "GỌI KHI" của mọi mô tả tool trong hệ', () => {
    expect(d.description).toContain('GỌI KHI');
  });

  it('nói rõ đây là KIỂM KHO, không phải báo cáo doanh số', () => {
    expect(d.description.toLowerCase()).toContain('kiểm kho');
  });

  it('schema khai tu_ngay/den_ngay có mô tả — model mới điền đúng', () => {
    const p = d.inputSchema.properties as Record<string, { description?: string }>;
    expect(p).toHaveProperty('tu_ngay');
    expect(p).toHaveProperty('den_ngay');
    expect(p.tu_ngay!.description ?? '').not.toBe('');
  });
});
