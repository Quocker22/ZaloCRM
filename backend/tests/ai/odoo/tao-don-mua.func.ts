// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool GHI `tao_don_mua` — phiếu NHẬP HÀNG (đơn mua) từ NCC.
//
// CA THẬT tái hiện ở đây (22:09-22:11 ngày 11/08/2026, nhóm Test-AI):
//   NV : "@bot rồi tạo phiếu nhập hàng giúp tôi luôn"
//   Bot: "em hiện chỉ có tool lên đơn BÁN và quản lý tồn, chưa có tool tạo
//         phiếu nhập hàng (mua hàng) — em không thể tạo phiếu nhập kho được ạ."
//   NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10 full
//         out: 10.000 tấm..."
//   Bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
//
// Bot nói SAI: quyền ghi vốn đã có. Đo trên prod 11/08 bằng chính tài khoản
// bot_zalo:  purchase.order write=true create=true
//            purchase.order.line write=true create=true
//            stock.picking write=true create=true
// và 5 đơn mua thật đang nằm đó (P04517-P04521), 4 trong số đó của NCC
// "Trung Quốc" — đúng cái nhân viên nhắc. Thiếu là thiếu TOOL, không thiếu quyền.
import { describe, it, expect, vi } from 'vitest';
import {
  taoDonMua, dinhDangTaoDonMua, traNhaCungCap, dinhDangNhaCungCap,
} from '../../../src/modules/ai/odoo/tools/tao-don-mua.js';

/** NCC thật trên prod: id=314, ref NCC000001, supplier_rank=5. */
const NCC_TQ = { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 };
/** NCC thứ hai cũng bắt đầu bằng "Trung Quốc" — ca nhiều kết quả THẬT trên prod. */
const NCC_TQ_2 = { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 };

const DON_MUA_DRAFT = {
  id: 9001,
  name: 'P04522',
  state: 'draft',
  amount_total: 0,
  origin: 'zalo:conv-1:0',
};

function fakeOdoo(
  opts: {
    daCo?: Record<string, unknown>;
    sauKhiTao?: Record<string, unknown>;
    sp?: Record<string, unknown>[];
    ncc?: Record<string, unknown>[];
  } = {},
) {
  let daTao = false;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      const s = JSON.stringify(domain);
      if (model === 'res.partner') return opts.ncc ?? [NCC_TQ];
      // Mặc định: MỌI id SP hỏi tới đều coi như có thật. Fixture phải khớp
      // domain thật, nếu không ca kiểm khác lại rớt vì "không tìm thấy SP".
      if (model === 'product.product') {
        if (opts.sp) return opts.sp;
        const ids = (domain as unknown[][])[0]?.[2] as number[] | undefined;
        return (ids ?? []).map((id) => ({ id, name: `SP ${id}`, list_price: 12000, active: true }));
      }
      if (s.includes('origin')) return opts.daCo ? [opts.daCo] : [];
      if (s.includes('"id"')) return daTao ? [opts.sauKhiTao ?? DON_MUA_DRAFT] : [];
      return [];
    }),
    execute: vi.fn(async (_m: string, method: string) => {
      if (method === 'create') {
        daTao = true;
        return 9001;
      }
      return true;
    }),
  };
}

const deps = (odoo: ReturnType<typeof fakeOdoo>) => ({
  odoo, conversationId: 'conv-1', seq: 0,
});

/**
 * 13 dòng hàng của ca thật (ảnh anh Quốc gửi 22:10 11/08). Phần lớn CHƯA CÓ
 * GIÁ NHẬP — đó chính là điểm mấu chốt của tool này.
 */
const MUOI_BA_DONG = Array.from({ length: 13 }, (_, i) => ({
  san_pham_id: 900 + i,
  so_luong: (i + 1) * 1000,
}));

const SP_13 = MUOI_BA_DONG.map((d) => ({
  id: d.san_pham_id, name: `SP ${d.san_pham_id}`, list_price: 12000, active: true,
}));

describe('taoDonMua — CA THẬT 22:09-22:11 ngày 11/08/2026', () => {
  it('NCC "Trung Quốc" + 13 dòng hàng → TẠO ĐƯỢC phiếu nhập nháp', async () => {
    // Đây là câu bot đã từ chối. Nó phải chạy được.
    const odoo = fakeOdoo({ sp: SP_13 });

    const kq = await taoDonMua(deps(odoo), {
      nha_cung_cap_id: 314, ten_ncc: 'Trung Quốc', dong: MUOI_BA_DONG,
    });

    expect(kq.trangThai).toBe('da_tao');
    if (kq.trangThai === 'da_tao') {
      expect(kq.maDon).toBe('P04522');
      expect(kq.donId).toBe(9001);
    }

    // Ghi vào purchase.order, đủ 13 dòng, cú pháp (0,0,{...}) của Odoo.
    const [model, method, args] = odoo.execute.mock.calls[0];
    expect(model).toBe('purchase.order');
    expect(method).toBe('create');
    const vals = (args as unknown[])[0] as Record<string, unknown>;
    expect(vals.partner_id).toBe(314);
    expect((vals.order_line as unknown[]).length).toBe(13);
    expect((vals.order_line as unknown[])[0]).toEqual([
      0, 0, { product_id: 900, product_qty: 1000 },
    ]);
  });

  it('CHỈ TẠO NHÁP — không xác nhận, không tạo phiếu kho', async () => {
    // button_confirm sinh phiếu nhập kho thật + công nợ phải trả. Người xem
    // lại rồi bấm trên Odoo, bot không được tự bấm.
    const odoo = fakeOdoo();
    await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    const cacMethod = odoo.execute.mock.calls.map((c) => c[1]);
    expect(cacMethod).toEqual(['create']);
    const s = JSON.stringify(odoo.execute.mock.calls);
    expect(s).not.toContain('button_confirm');
    expect(s).not.toContain('button_approve');
    expect(s).not.toContain('action_create_invoice');
    expect(s).not.toContain('button_validate');
  });

  it('Odoo trả state KHÁC draft → BÁO LỖI (có automation tự xác nhận)', async () => {
    const odoo = fakeOdoo({ sauKhiTao: { ...DON_MUA_DRAFT, state: 'purchase' } });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('automation');
  });
});

describe('taoDonMua — GIÁ NHẬP (khác hẳn giá bán)', () => {
  it('KHÔNG có giá nhập → để TRỐNG cho người điền sau, KHÔNG chặn', async () => {
    // QUYẾT ĐỊNH (a): đơn nháp thì điền sau được. Ca thật cho thấy NV chưa có
    // giá lúc tạo phiếu, và chính đơn thật P04520 trên prod cũng có 3 dòng
    // price_unit=0 nằm cạnh 2 dòng 8.300đ — nghiệp vụ này vốn đã vậy.
    const odoo = fakeOdoo({ sp: SP_13 });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG });

    expect(kq.trangThai).toBe('da_tao');
    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    for (const line of vals.order_line as unknown[][]) {
      expect(JSON.stringify(line[2])).not.toContain('price_unit');
    }
  });

  it('TUYỆT ĐỐI không lấy giá BÁN (list_price) làm giá nhập', async () => {
    // Sai bản chất: list_price là giá bán cho khách. Nhét nó vào price_unit là
    // ghi sai giá vốn → lãi/lỗ mọi báo cáo về sau đều sai.
    const odoo = fakeOdoo({ sp: [{ id: 944, name: 'X', list_price: 12000, active: true }] });

    await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: [{ san_pham_id: 944, so_luong: 5 }] });

    const s = JSON.stringify(odoo.execute.mock.calls);
    expect(s).not.toContain('12000');
  });

  it('CÓ giá nhập NV báo → ghi vào price_unit', async () => {
    const odoo = fakeOdoo();

    await taoDonMua(deps(odoo), {
      nha_cung_cap_id: 314, dong: [{ san_pham_id: 944, so_luong: 6000, gia_nhap: 8300 }],
    });

    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    expect((vals.order_line as unknown[])[0]).toEqual([
      0, 0, { product_id: 944, product_qty: 6000, price_unit: 8300 },
    ]);
  });

  it('SP chưa có giá BÁN vẫn nhập được (giá bán không liên quan giá nhập)', async () => {
    // Khác hẳn tool đơn BÁN: bên đó SP giá 0 bị chặn. Ở đây SP mới toanh chưa
    // đặt giá bán là chuyện bình thường — mua về rồi mới định giá bán.
    const odoo = fakeOdoo({ sp: [{ id: 944, name: 'SP mới', list_price: 0, active: true }] });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: [{ san_pham_id: 944, so_luong: 10 }] });

    expect(kq.trangThai).toBe('da_tao');
  });
});

describe('taoDonMua — NHÀ CUNG CẤP', () => {
  it('NCC không tồn tại → BÁO RÕ, KHÔNG tự tạo NCC mới', async () => {
    // Bài học ca "khách rác Long" 11/08: bot tự bịa khách rồi xuất hoá đơn 21
    // triệu lên đó. Không bao giờ tự tạo partner.
    const odoo = fakeOdoo({ ncc: [] });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 99999, dong: MUOI_BA_DONG.slice(0, 1) });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_nha_cung_cap');
  });

  it('KHÔNG BAO GIỜ create res.partner', async () => {
    const odoo = fakeOdoo();
    await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    expect(odoo.execute.mock.calls.map((c) => c[0])).toEqual(['purchase.order']);
  });

  it('id trỏ vào KHÁCH HÀNG (supplier_rank=0) → chặn, không cho mua', async () => {
    // Trên prod có cả "TRung Quốc" [KH001046] customer_rank=1 lẫn "Trung Quốc"
    // [NCC000001] supplier_rank=5 — tên gần y hệt. Lấy nhầm là đơn mua treo vào
    // một khách hàng.
    const odoo = fakeOdoo({ ncc: [{ id: 2519, name: 'TRung Quốc', ref: 'KH001046', supplier_rank: 0 }] });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 2519, dong: MUOI_BA_DONG.slice(0, 1) });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('không phải nhà cung cấp');
  });

  it('tên NV nhắc LỆCH tên NCC theo id → chặn (chống bịa id từ lịch sử)', async () => {
    const odoo = fakeOdoo({ ncc: [NCC_TQ] });

    const kq = await taoDonMua(deps(odoo), {
      nha_cung_cap_id: 314, ten_ncc: 'Mogen Star', dong: MUOI_BA_DONG.slice(0, 1),
    });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('traNhaCungCap — tra NCC', () => {
  it('CHỈ tra supplier_rank > 0, không lôi khách hàng vào', async () => {
    const odoo = fakeOdoo();
    await traNhaCungCap({ odoo }, { ten: 'Trung Quốc' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('supplier_rank');
  });

  it('gõ CÓ DẤU mà DB lưu KHÔNG DẤU → dự phòng nới, vẫn tìm ra NCC', async () => {
    // Luật 12/08 tôn trọng dấu, nhưng phải có đường lùi: dữ liệu NCC prod cũng
    // lẫn lộn dấu. Không có nhánh này thì lại dựng lại đúng bug 23:15 11/08
    // ("ủa sao không tìm được nhà Cung cấp").
    const odoo = {
      searchRead: vi.fn()
        .mockResolvedValueOnce([])                                             // 'quốc' nguyên văn: rỗng
        .mockResolvedValueOnce([{ id: 314, name: 'Trung Quoc', ref: 'NCC000001' }]),
    };
    const kq = await traNhaCungCap({ odoo }, { ten: 'Trung Quốc' });

    expect(odoo.searchRead).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(odoo.searchRead.mock.calls[1][1])).toContain('tr_ng q__c');
    expect(kq.trangThai).toBe('tim_thay');
  });

  it('nhiều NCC khớp → HỎI CHỌN, không tự nhặt', async () => {
    // Ca thật trên prod: "Trung Quốc" ra đúng 2 NCC (id=314 và id=21).
    const odoo = fakeOdoo({ ncc: [NCC_TQ, NCC_TQ_2] });

    const kq = await traNhaCungCap({ odoo }, { ten: 'Trung Quốc' });

    expect(kq.trangThai).toBe('nhieu_ket_qua');
    const s = dinhDangNhaCungCap(kq);
    expect(s).toContain('314');
    expect(s).toContain('21');
    expect(s).toContain('KHÔNG tự chọn');
  });

  it('đúng 1 NCC → trả thẳng id', async () => {
    const odoo = fakeOdoo({ ncc: [NCC_TQ] });
    const kq = await traNhaCungCap({ odoo }, { ten: 'Trung Quốc' });

    expect(kq.trangThai).toBe('tim_thay');
    if (kq.trangThai === 'tim_thay') expect(kq.ncc.id).toBe(314);
  });

  it('không có NCC → nói rõ KHÔNG tự tạo', async () => {
    const odoo = fakeOdoo({ ncc: [] });
    const kq = await traNhaCungCap({ odoo }, { ten: 'NCC không có thật' });

    expect(kq.trangThai).toBe('khong_thay');
    const s = dinhDangNhaCungCap(kq);
    expect(s).toContain('KHÔNG');
    expect(s.toLowerCase()).toContain('không được tự tạo');
  });

  it('gõ KHÔNG DẤU thì NỚI, gõ CÓ DẤU thì TÔN TRỌNG DẤU', async () => {
    // Bản 11/08 ép hai kiểu gõ về CÙNG một truy vấn — nghe gọn nhưng hỏng ở ca
    // 01:12 12/08 ("anh Vấn" ra 10 người Văn/Vạn/Vân, không ai tên Vấn). Nay
    // tách đôi: người gõ dấu là đã nói rõ họ tìm ai, đừng nới hộ. Xem
    // tim-khong-dau.ts. NCC dùng CHUNG hàm nên chung luật.
    const coDau = fakeOdoo();
    await traNhaCungCap({ odoo: coDau }, { ten: 'Trung Quốc' });
    const khongDau = fakeOdoo();
    await traNhaCungCap({ odoo: khongDau }, { ten: 'trung quoc' });

    // "Quốc" có dấu → giữ nguyên; "Trung" tự nó không dấu → vẫn được nới.
    expect(JSON.stringify(coDau.searchRead.mock.calls[0][1])).toContain('tr_ng quốc');
    expect(JSON.stringify(khongDau.searchRead.mock.calls[0][1])).toContain('tr_ng q__c');
  });

  it('BỎ TIỀN TỐ "nhà cung cấp" trước khi tra (ca thật 23:16:15)', async () => {
    // Nhân viên đáp nguyên văn "Nhà cung cấp Trung Quốc"; tra cả cụm thì ilike
    // ra 0 kq vì tên trong DB chỉ là "Trung Quốc".
    const odoo = fakeOdoo();
    await traNhaCungCap({ odoo }, { ten: 'Nhà cung cấp Trung Quốc' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('tr_ng quốc');
    expect(d).not.toContain('nhà cung cấp');
  });

  it('gõ MÃ NCC vào ô tên → tra theo ref, ra đúng một NCC (ca thật 23:16:53)', async () => {
    // "NCC000001" là ref thật của id=314 (đo prod). Phải nhận ra là MÃ chứ không
    // đem đi tra như tên.
    const odoo = fakeOdoo();
    await traNhaCungCap({ odoo }, { ten: 'NCC000001' });

    const d = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(d).toContain('ref');
    expect(d).toContain('NCC000001');
  });
});

describe('taoDonMua — CHỐNG TRÙNG', () => {
  it('gọi 2 lần cùng seq → KHÔNG tạo đơn thứ hai', async () => {
    const odoo = fakeOdoo({ daCo: DON_MUA_DRAFT });

    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    expect(kq.trangThai).toBe('da_ton_tai');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'da_ton_tai') expect(kq.donId).toBe(9001);
  });

  it('LUÔN ghi khoá vào `origin` rõ ràng', async () => {
    const odoo = fakeOdoo();
    await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    const vals = (odoo.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>;
    expect(vals.origin).toBe('zalo:conv-1:0');
  });

  it('TRA khoá TRƯỚC khi create', async () => {
    const odoo = fakeOdoo();
    await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    const traKhoa = odoo.searchRead.mock.calls.findIndex(
      (c) => c[0] === 'purchase.order' && JSON.stringify(c[1]).includes('origin'),
    );
    expect(traKhoa).toBeGreaterThanOrEqual(0);
    expect(odoo.execute).toHaveBeenCalled();
  });

  it('seq khác → khoá khác → tạo được đơn thứ hai', async () => {
    const o1 = fakeOdoo();
    const o2 = fakeOdoo();
    await taoDonMua({ odoo: o1, conversationId: 'c', seq: 0 }, { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });
    await taoDonMua({ odoo: o2, conversationId: 'c', seq: 1 }, { nha_cung_cap_id: 314, dong: MUOI_BA_DONG.slice(0, 1) });

    const k1 = ((o1.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>).origin;
    const k2 = ((o2.execute.mock.calls[0][2] as unknown[])[0] as Record<string, unknown>).origin;
    expect(k1).not.toBe(k2);
  });
});

describe('taoDonMua — VÀO SỐ SAI', () => {
  it('không có dòng hàng nào → báo lỗi', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: [] });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('số lượng <= 0 → báo lỗi', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: [{ san_pham_id: 944, so_luong: 0 }] });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('SP không tồn tại → báo lỗi, chỉ sang tra_san_pham', async () => {
    const odoo = fakeOdoo({ sp: [] });
    const kq = await taoDonMua(deps(odoo), { nha_cung_cap_id: 314, dong: [{ san_pham_id: 999999, so_luong: 5 }] });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('tra_san_pham');
  });

  it('giá nhập ÂM → báo lỗi (không ghi số rác vào giá vốn)', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonMua(deps(odoo), {
      nha_cung_cap_id: 314, dong: [{ san_pham_id: 944, so_luong: 5, gia_nhap: -100 }],
    });

    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('dinhDangTaoDonMua — câu trả lời cho nhân viên', () => {
  it('tạo xong → nói rõ là PHIẾU NHÁP, chưa vào kho', async () => {
    const s = dinhDangTaoDonMua({
      trangThai: 'da_tao', donId: 9001, maDon: 'P04522', khoa: 'zalo:c:0',
      tongTien: 0, soDong: 13, soDongChuaCoGia: 13,
    });

    expect(s).toContain('P04522');
    expect(s).toContain('nháp');
    // Phải DẶN model đừng nói đã nhập kho — phiếu nháp chưa động vào kho thật.
    expect(s).toContain('KHÔNG nói là đã nhập kho');
    expect(s).toContain('chưa ghi công nợ');
  });

  it('có dòng chưa có giá → NÓI RÕ để nhân viên biết mà điền', async () => {
    const s = dinhDangTaoDonMua({
      trangThai: 'da_tao', donId: 9001, maDon: 'P04522', khoa: 'zalo:c:0',
      tongTien: 0, soDong: 13, soDongChuaCoGia: 13,
    });

    expect(s).toContain('13');
    expect(s.toLowerCase()).toContain('chưa có giá');
  });

  it('đơn đã tồn tại → bảo KHÔNG tạo lại', async () => {
    const s = dinhDangTaoDonMua({
      trangThai: 'da_ton_tai', donId: 9001, maDon: 'P04522', khoa: 'zalo:c:0',
    });

    expect(s).toContain('P04522');
    expect(s).toContain('KHÔNG tạo lại');
  });
});
