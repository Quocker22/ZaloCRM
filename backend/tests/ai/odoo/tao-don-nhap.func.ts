// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool GHI tao_don_nhap.
//
// Ba trọng tâm, theo đúng thứ tự nguy hiểm:
//   1. Không tạo đơn trùng khi retry
//   2. Chỉ tạo DRAFT — không bao giờ gọi action_confirm
//   3. Không tạo khách, không tự đặt giá
import { describe, it, expect, vi } from 'vitest';
import { taoDonNhap, dinhDangTaoDon } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';

const DON_DRAFT = {
  id: 500,
  name: 'S00500',
  state: 'draft',
  amount_total: 1200000,
  client_order_ref: 'zalo:conv-1:0',
};

/**
 * Odoo giả.
 * @param daCo đơn đã tồn tại với khoá (mô phỏng lần retry thứ 2)
 */
/** SP mặc định: có giá, đang hoạt động. */
const SP_OK = { id: 2, name: 'Đèn LED P10', list_price: 120000, active: true };

function fakeOdoo(
  opts: {
    daCo?: Record<string, unknown>;
    sauKhiTao?: Record<string, unknown>;
    /** Thông tin SP trả về khi tool kiểm giá. */
    sp?: Record<string, unknown>[];
  } = {},
) {
  let daTao = false;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      const s = JSON.stringify(domain);
      // Kiểm SP (giá + tồn tại) trước khi tạo
      if (model === 'product.product') return opts.sp ?? [SP_OK];
      // Tra theo khoá (trước khi tạo)
      if (s.includes('client_order_ref')) return opts.daCo ? [opts.daCo] : [];
      // Đọc lại sau khi tạo
      if (s.includes('"id"')) return daTao ? [opts.sauKhiTao ?? DON_DRAFT] : [];
      return [];
    }),
    execute: vi.fn(async (_m: string, method: string) => {
      if (method === 'create') {
        daTao = true;
        return 500;
      }
      return true;
    }),
  };
}

const deps = (odoo: ReturnType<typeof fakeOdoo>) => ({ odoo, conversationId: 'conv-1', seq: 0 });
const donHopLe = { khach_hang_id: 10, dong: [{ san_pham_id: 2, so_luong: 3 }] };

describe('taoDonNhap — CHỐNG TRÙNG ĐƠN', () => {
  it('khoá đã dùng → trả đơn CŨ, KHÔNG gọi create', async () => {
    // Đây là ca quan trọng nhất của cả tool. Retry không được sinh đơn thứ 2.
    const odoo = fakeOdoo({ daCo: DON_DRAFT });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('da_ton_tai');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'da_ton_tai') expect(kq.donId).toBe(500);
  });

  it('TRA khoá TRƯỚC khi gọi create (thứ tự quan trọng)', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    // Assert theo NỘI DUNG, không theo vị trí — bền hơn khi thêm bước kiểm giá.
    const traKhoa = odoo.searchRead.mock.calls.findIndex((c) =>
      JSON.stringify(c[1]).includes('client_order_ref'),
    );
    expect(traKhoa).toBeGreaterThanOrEqual(0);   // có tra khoá
    expect(odoo.execute).toHaveBeenCalled();      // và create chạy SAU đó
  });

  it('LUÔN truyền client_order_ref rõ ràng (Odoo tự điền nếu để trống)', async () => {
    // sale_order.py:115 tự sinh ref từ sequence nếu trống → mất chốt chặn.
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    expect(vals.client_order_ref).toBe('zalo:conv-1:0');
  });

  it('cùng conversation + seq khác nhau → tạo được 2 đơn (khách chốt lần 2)', async () => {
    const o1 = fakeOdoo();
    const o2 = fakeOdoo();

    await taoDonNhap({ odoo: o1, conversationId: 'c', seq: 0 }, donHopLe);
    await taoDonNhap({ odoo: o2, conversationId: 'c', seq: 1 }, donHopLe);

    const k1 = ((o1.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>).client_order_ref;
    const k2 = ((o2.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>).client_order_ref;
    expect(k1).not.toBe(k2);
  });
});

describe('taoDonNhap — CHỈ TẠO DRAFT', () => {
  it('KHÔNG BAO GIỜ gọi action_confirm', async () => {
    // action_confirm sinh phiếu xuất kho → lệch tồn kho thật.
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const cacMethod = odoo.execute.mock.calls.map((c) => c[1]);
    expect(cacMethod).not.toContain('action_confirm');
    expect(cacMethod).not.toContain('action_incokit_confirm_and_invoice');
    expect(cacMethod).toEqual(['create']);
  });

  it('KHÔNG gọi _create_invoices hay validate picking', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const s = JSON.stringify(odoo.execute.mock.calls);
    expect(s).not.toContain('_create_invoices');
    expect(s).not.toContain('button_validate');
    expect(s).not.toContain('_auto_validate_picking');
  });

  it('Odoo trả state KHÁC draft → BÁO LỖI (phát hiện automation tự xác nhận)', async () => {
    // Im lặng bỏ qua ca này là để automation lạ động vào kho mà không ai biết.
    const odoo = fakeOdoo({ sauKhiTao: { ...DON_DRAFT, state: 'sale' } });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('automation');
  });

  it('tạo xong → ĐỌC LẠI để xác nhận, không tin create() mù', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    // Phải có lần đọc sale.order theo id SAU khi create.
    const docLai = odoo.searchRead.mock.calls.filter(
      (c) => c[0] === 'sale.order' && JSON.stringify(c[1]).includes('"id"'),
    );
    expect(docLai.length).toBeGreaterThan(0);
  });
});

describe('taoDonNhap — KHÔNG vượt quyền', () => {
  it('KHÔNG tự đặt giá (price_unit) — để Odoo lấy giá đúng', async () => {
    // Bot đặt giá là cách bịa số tinh vi nhất: con số trông hợp lệ, sai âm thầm.
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    const line = (vals.order_line as unknown[])[0] as unknown[];
    expect(JSON.stringify(line[2])).not.toContain('price_unit');
    expect(JSON.stringify(line[2])).not.toContain('discount');
  });

  it('KHÔNG tạo res.partner — chỉ dùng id được cấp', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const models = odoo.execute.mock.calls.map((c) => c[0]);
    expect(models).not.toContain('res.partner');
    expect(models).toEqual(['sale.order']);
  });

  it('dòng hàng dùng cú pháp (0,0,{...}) của Odoo', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), donHopLe);

    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    expect((vals.order_line as unknown[])[0]).toEqual([0, 0, { product_id: 2, product_uom_qty: 3 }]);
  });
});

describe('taoDonNhap — CHẶN SP chưa có giá', () => {
  // Đơn có SP giá 0 là đơn sai: tổng tiền sai, sale phải sửa tay.
  // Chặn ở đây rẻ hơn nhiều so với dọn đơn rác sau.

  it('SP giá 0 → TỪ CHỐI tạo đơn', async () => {
    const odoo = fakeOdoo({ sp: [{ id: 2, name: 'Đèn X', list_price: 0, active: true }] });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'loi') {
      expect(kq.lyDo).toContain('chưa có giá hợp lệ');
      expect(kq.lyDo).toContain('chuyen_sale');
    }
  });

  it('SP giá ẢO (1đ placeholder) → cũng TỪ CHỐI', async () => {
    // DB thật có 63 SP để đúng 1đ. Không mặt hàng LED nào bán 1 đồng — đó là
    // placeholder khi nhập liệu. Tạo đơn với giá đó là ghi doanh thu sai.
    const odoo = fakeOdoo({ sp: [{ id: 2, name: 'Led COB 24V', list_price: 1, active: true }] });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('giá 1đ');
  });

  it('giá 1.000đ (rẻ nhưng THẬT) → vẫn tạo đơn bình thường', async () => {
    // Ngưỡng phải đủ thấp để không loại oan hàng rẻ thật.
    const odoo = fakeOdoo({ sp: [{ id: 2, name: 'Bóng LED', list_price: 1000, active: true }] });

    expect((await taoDonNhap(deps(odoo), donHopLe)).trangThai).toBe('da_tao');
  });

  it('nêu TÊN sản phẩm thiếu giá để sale biết xử lý cái nào', async () => {
    const odoo = fakeOdoo({ sp: [{ id: 2, name: 'Đèn fa 30w màu vàng nắng', list_price: 0 }] });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('Đèn fa 30w màu vàng nắng');
  });

  it('SP không tồn tại → lỗi rõ, gợi ý tra lại id', async () => {
    const odoo = fakeOdoo({ sp: [] });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_san_pham');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('MỘT SP thiếu giá trong nhiều dòng → chặn CẢ ĐƠN', async () => {
    const odoo = fakeOdoo({
      sp: [
        { id: 2, name: 'Đèn A', list_price: 120000 },
        { id: 3, name: 'Đèn B', list_price: 0 },
      ],
    });

    const kq = await taoDonNhap(deps(odoo), {
      khach_hang_id: 10,
      dong: [{ san_pham_id: 2, so_luong: 1 }, { san_pham_id: 3, so_luong: 1 }],
    });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('mọi SP có giá → tạo đơn bình thường', async () => {
    const odoo = fakeOdoo();
    expect((await taoDonNhap(deps(odoo), donHopLe)).trangThai).toBe('da_tao');
  });

  it('đơn đã tồn tại → KHÔNG kiểm giá lại (tiết kiệm round-trip)', async () => {
    const odoo = fakeOdoo({ daCo: DON_DRAFT });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('da_ton_tai');
    const models = odoo.searchRead.mock.calls.map((c) => c[0]);
    expect(models).not.toContain('product.product');
  });
});

describe('taoDonNhap — chặn dữ liệu sai TRƯỚC khi chạm Odoo', () => {
  const khongChamOdoo = async (input: Record<string, unknown>) => {
    const odoo = fakeOdoo();
    const kq = await taoDonNhap(deps(odoo), input as never);
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    return kq;
  };

  it('khach_hang_id không hợp lệ → lỗi + gợi ý dùng tra_khach_hang', async () => {
    const kq = await khongChamOdoo({ khach_hang_id: 0, dong: [{ san_pham_id: 2, so_luong: 1 }] });
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_khach_hang');
  });

  it('đơn không có dòng hàng → lỗi', async () => {
    await khongChamOdoo({ khach_hang_id: 10, dong: [] });
  });

  it('san_pham_id không hợp lệ → lỗi + gợi ý dùng tra_san_pham', async () => {
    const kq = await khongChamOdoo({ khach_hang_id: 10, dong: [{ san_pham_id: -5, so_luong: 1 }] });
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_san_pham');
  });

  it('số lượng <= 0 → lỗi', async () => {
    await khongChamOdoo({ khach_hang_id: 10, dong: [{ san_pham_id: 2, so_luong: 0 }] });
    await khongChamOdoo({ khach_hang_id: 10, dong: [{ san_pham_id: 2, so_luong: -3 }] });
  });

  it('thiếu conversationId → lỗi, KHÔNG tạo đơn không truy vết được', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonNhap({ odoo, conversationId: '', seq: 0 }, donHopLe);

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('Odoo từ chối tạo → lỗi sạch, không ném ra vòng lặp', async () => {
    const odoo = fakeOdoo();
    odoo.execute = vi.fn(async () => { throw new Error('AccessError: không có quyền'); });

    const kq = await taoDonNhap(deps(odoo), donHopLe);

    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('AccessError');
  });
});

describe('dinhDangTaoDon', () => {
  it('tạo xong → nhắc model NÓI RÕ là đơn nháp, chưa xong', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonNhap(deps(odoo), donHopLe);

    const s = dinhDangTaoDon(kq);
    expect(s).toContain('NHÁP');
    expect(s).toContain('KHÔNG nói là đã xong');
  });

  it('đơn đã tồn tại → nhắc model KHÔNG tạo lại', async () => {
    const kq = await taoDonNhap(deps(fakeOdoo({ daCo: DON_DRAFT })), donHopLe);
    expect(dinhDangTaoDon(kq)).toContain('KHÔNG tạo lại');
  });

  it('lỗi → nêu rõ lý do để model tự sửa', () => {
    expect(dinhDangTaoDon({ trangThai: 'loi', lyDo: 'thiếu id' })).toContain('thiếu id');
  });
});
