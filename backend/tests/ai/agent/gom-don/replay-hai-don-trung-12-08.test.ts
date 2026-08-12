// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — nhóm bán hàng, 11:14-11:16 ngày 12/08/2026.
//
// HAI ĐƠN THẬT vào Odoo cho MỘT việc:
//
//   11:14:11  NV : "@bot lên đơn cho anh Vấn 10 cái Led F5 12V Không Main
//                   Màu Đỏ giá 100k nhé"
//   11:14:19  Bot: "Anh/chị báo giá 100.000đ cho 'Led F5...' — xác nhận giúp em"
//   11:15:52  NV : "đúng rồi"                    ← tin 1
//   11:16:00  NV : "@Tiểu Mã Nelia đúng rồi"     ← tin 2, cách 8 GIÂY, CÙNG ý
//   11:16:13  Bot: "Đã lên đơn nháp S13834 ..."  ← đơn 1 (id 26751)
//   11:16:24  Bot: "Đã lên đơn nháp S13835 ..."  ← đơn 2 (id 26752), TRÙNG HẲN
//
// Cùng khách KH000027, cùng 10 × Led F5, cùng 1.000.000đ. Không chỉ là trả lời
// trùng — là GHI DỮ LIỆU SAI vào sổ sách.
//
// VÌ SAO CÁC LỚP CŨ KHÔNG CHẶN — cả ba đều trượt, mỗi cái một lý do:
//
//   1. KHOÁ VIỆC (khoa-viec.ts) băm theo NỘI DUNG CÂU. Nó chặn được khi hai câu
//      băm ra giống nhau và hai lượt cách nhau < 100s. Nhưng nội dung là thứ
//      MỎNG MANH: message-handler chèn khối `[Trả lời tin: "..."]` khi nhân viên
//      quote-reply, luong-media ghép khối `[Khách gửi ảnh...]`, tag trống gộp
//      tin trước. Hai câu CÙNG Ý ("đúng rồi" / quote rồi "đúng rồi") ra HAI mã
//      băm khác nhau → khoá mở toang. Khoá theo CÂU CHỮ không phải khoá theo
//      VIỆC.
//
//   2. MIỄN TRỪ XÁC NHẬN (luong-nhan-vien.ts ~299-313): `coTinKhachMoiHon` bỏ
//      lượt khi có tin mới hơn, NHƯNG miễn trừ câu xác nhận ngắn. Miễn trừ đó
//      SINH RA CÓ LÝ DO và không được gỡ — xem bug S13804 dưới.
//
//   3. IDEMPOTENCY Ở TOOL (`tao_don_nhap`, khoá `zalo:<conv>:<seq>`): `seq` sinh
//      từ messageId, mà hai TIN khác nhau → hai seq khác nhau → hai khoá khác
//      nhau → Odoo nhận cả hai lệnh create. Hàng rào cuối cùng cũng thủng.
//
// BUG S13804 07/08 — RÀNG BUỘC NGƯỢC LẠI, ĐỪNG PHÁ:
//   Nhân viên gõ "đúng rồi" nhiều lần; mỗi lượt thấy có tin mới hơn nên BỎ hết
//   → KHÔNG lượt nào tạo đơn, bot hỏi vô tận. Câu xác nhận là tín hiệu QUYẾT
//   ĐỊNH: nuốt nó là mất hẳn đơn. Lời giải phải thoả CẢ HAI:
//     - "đúng rồi" hai lần cho MỘT việc  → ĐÚNG MỘT đơn (không 0, không 2)
//     - "đúng rồi" cho HAI việc khác nhau → cả hai lượt đều phải chạy
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { taoDonNhap } from '../../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { taoDonMua } from '../../../../src/modules/ai/odoo/tools/tao-don-mua.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Odoo giả đúng ca thật: anh Vấn (KH000027) + Led F5 12V Không Main Màu Đỏ.
 *
 * Giá hệ thống để 2.000đ, nhân viên báo 100.000đ → lệch 50 lần, vượt biên
 * TY_LE_TRAN=10 của hàng rào giá bất thường. Nhờ đó bot HỎI XÁC NHẬN thay vì
 * lên đơn ngay — đúng hình dạng ca thật 11:14:19 ("Anh/chị báo giá 100.000đ
 * cho 'Led F5...' — xác nhận giúp em"), và chính câu hỏi đó đẻ ra hai tin
 * "đúng rồi". Đây là điểm mấu chốt: PHIÊN CÒN MỞ khi cả hai tin xác nhận tới.
 *
 * `sale.order` create TĂNG DẦN id/mã đơn để đếm được ĐÚNG số đơn thật đã ghi —
 * trả một id cố định thì hai lần create trông như một, che mất chính cái bug.
 */
function fakeOdoo() {
  const kh = [{ id: 27, name: 'Anh Vấn', ref: 'KH000027', phone: false }];
  const LED = {
    id: 512, name: 'Led F5 12V Không Main Màu Đỏ', default_code: 'SP000512',
    list_price: 2000, uom_id: [1, 'Cái'],
  };
  // Đơn đã ghi vào "Odoo": khoá chống trùng (client_order_ref) → bản ghi đơn.
  const donDaGhi = new Map<string, { id: number; name: string }>();
  let idKe = 26751; // S13834 = id 26751 trong ca thật
  const odoo = {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          return [{ id: LED.id, name: LED.name, incokit_stock_breakdown: [] }];
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [LED];
      }
      if (model === 'sale.order') {
        // Tra theo khoá chống trùng → chỉ thấy đơn nếu ĐÚNG khoá đó đã ghi.
        if (d.includes('client_order_ref')) {
          const m = d.match(/zalo:[^"]+/);
          const cu = m ? donDaGhi.get(m[0]) : undefined;
          return cu ? [{ ...cu, state: 'draft', amount_total: 1000000, client_order_ref: m![0] }] : [];
        }
        // Đọc lại đơn vừa tạo (theo id) để xác nhận state.
        const mid = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'id');
        const id = mid ? Number(mid[2]) : idKe - 1;
        return [{
          id, name: `S${13834 + (id - 26751)}`, state: 'draft',
          amount_total: 1000000, amount_untaxed: 1000000,
        }];
      }
      return [];
    }),
    execute: vi.fn(async (model: string, method: string, args?: unknown) => {
      if (model === 'sale.order' && method === 'create') {
        const vals = (args as Array<Record<string, unknown>>)[0];
        const id = idKe++;
        donDaGhi.set(String(vals.client_order_ref ?? ''), { id, name: `S${13834 + (id - 26751)}` });
        return id;
      }
      return idKe;
    }),
  };
  return odoo;
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { conversationId: string }; create: never;
        update: { slots: unknown; hetHan: Date };
      }) => {
        const cu = rows.get(where.conversationId);
        rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId); return { count: 1 };
      },
    },
  };
}

function dungMay(slots: Record<string, unknown>[], conversationId = 'c-hai-don-12-08') {
  const odoo = fakeOdoo();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: fakeDb() as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    /** Mỗi tin Zalo là một `seq` KHÁC nhau — seq sinh từ messageId (du-lieu.ts). */
    goi: (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo,
  };
}

/** Số lệnh `create` THẬT gửi sang sale.order — đây là số đơn nằm trong Odoo. */
const soDonDaTao = (odoo: ReturnType<typeof fakeOdoo>): number =>
  odoo.execute.mock.calls.filter(
    (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create',
  ).length;

// Slot của ca thật: lệnh lên đơn giá 100k, rồi hai lượt xác nhận.
const LENH = { lenDon: true, khach: 'vấn', dong: [{ sp: 'led f5 12v không main màu đỏ', sl: 10, gia: 100000 }] };

describe('CA THẬT 11:15-11:16 12/08 — hai tin "đúng rồi" đẻ HAI ĐƠN S13834/S13835', () => {
  it('hai lượt xác nhận LIÊN TIẾP → ĐÚNG MỘT đơn vào Odoo', async () => {
    const { goi, odoo } = dungMay([LENH, { xacNhan: true }, { xacNhan: true }]);

    // 11:14:11 — lệnh lên đơn. Giá 100k lệch giá hệ thống (0đ) → bot hỏi xác nhận.
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 1001);
    expect(soDonDaTao(odoo)).toBe(0); // chưa gật thì chưa được ghi

    // 11:15:52 và 11:16:00 — hai tin cùng ý, seq khác nhau (hai messageId).
    await goi('đúng rồi', 1002);
    await goi('đúng rồi', 1003);

    // ĐÂY LÀ CÁI ĐỎ: trước vá là 2 (S13834 + S13835).
    expect(soDonDaTao(odoo)).toBe(1);
  });

  it('tin 2 có khối quote-reply → vẫn ĐÚNG MỘT đơn (khoá theo nội dung câu thủng ở đây)', async () => {
    // Nhân viên quote câu hỏi của bot rồi gõ "đúng rồi": message-handler chèn
    // `[Trả lời tin: "..."]` vào đầu câu → mã băm khác hẳn tin trước, khoá việc
    // theo NỘI DUNG mở toang. Chốt chặn phải nằm ở tầng VIỆC, không phải câu chữ.
    const { goi, odoo } = dungMay([LENH, { xacNhan: true }, { xacNhan: true }]);
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 2001);
    await goi('đúng rồi', 2002);
    await goi('[Trả lời tin: "Anh/chị báo giá 100.000đ cho Led F5 — xác nhận giúp em"] đúng rồi', 2003);
    expect(soDonDaTao(odoo)).toBe(1);
  });

  it('hai lượt xác nhận CHẠY SONG SONG (cách 8 giây, chồng lượt) → vẫn ĐÚNG MỘT đơn', async () => {
    // Ca thật là hai lượt CHỒNG NHAU: lượt 1 bắt đầu 11:15:52 và mãi 11:16:13
    // mới xong, còn lượt 2 vào lúc 11:16:00 — tức là lúc lượt 1 chưa xoá phiên.
    // Chạy tuần tự không tái hiện được khe hở này.
    const { goi, odoo } = dungMay([LENH, { xacNhan: true }, { xacNhan: true }]);
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 3001);
    await Promise.all([goi('đúng rồi', 3002), goi('đúng rồi', 3003)]);
    expect(soDonDaTao(odoo)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RÀNG BUỘC NGƯỢC — bản vá KHÔNG được làm sống lại bug S13804 07/08.
describe('KHÔNG được nuốt đơn (bug S13804 07/08)', () => {
  it('gõ "đúng rồi" nhiều lần → VẪN tạo được đơn (đúng 1, KHÔNG phải 0)', async () => {
    const { goi, odoo } = dungMay([LENH, { xacNhan: true }, { xacNhan: true }, { xacNhan: true }]);
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 4001);
    await goi('đúng rồi', 4002);
    await goi('đúng rồi', 4003);
    await goi('ok em', 4004);
    // Đúng MỘT — không 0 (S13804), không 2 (ca 12/08).
    expect(soDonDaTao(odoo)).toBe(1);
  });

  it('"đúng rồi" cho HAI VIỆC KHÁC NHAU → hai đơn, cả hai lượt đều chạy', async () => {
    // Đây là ranh giới quan trọng nhất: chốt chặn phải khoá theo VIỆC, nên
    // việc thứ hai (phiên MỚI) không bao giờ bị việc thứ nhất chặn nhầm.
    const { goi, odoo } = dungMay([
      LENH, { xacNhan: true },
      LENH, { xacNhan: true },
    ]);
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 5001);
    await goi('đúng rồi', 5002);
    expect(soDonDaTao(odoo)).toBe(1);

    // Nhân viên lên đơn THỨ HAI cho cùng khách rồi lại gật — việc thật, hợp lệ.
    await goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 5003);
    await goi('đúng rồi', 5004);
    expect(soDonDaTao(odoo)).toBe(2);
  });

  it('hai hội thoại khác nhau cùng gật → mỗi bên một đơn, không chặn chéo (KHÔNG dùng chung khoá)', async () => {
    const a = dungMay([LENH, { xacNhan: true }], 'conv-A');
    const b = dungMay([LENH, { xacNhan: true }], 'conv-B');
    await a.goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 6001);
    await b.goi('lên đơn cho anh Vấn 10 cái Led F5 12V Không Main Màu Đỏ giá 100k nhé', 6001);
    await a.goi('đúng rồi', 6002);
    await b.goi('đúng rồi', 6002);
    expect(soDonDaTao(a.odoo)).toBe(1);
    expect(soDonDaTao(b.odoo)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HÀNG RÀO CUỐI, đo THẲNG ở tầng TOOL GHI.
//
// Các ca trên đi qua máy gom đơn nên còn phụ thuộc luật của máy. Ở đây gọi
// thẳng tool với CÙNG một khoá chống trùng và ép hai lượt CHỒNG NHAU: đây là
// đúng hình dạng vật lý của ca 11:15-11:16 12/08 (lượt 1 chạy 21 giây, lượt 2
// vào ở giây thứ 8), và là chỗ cuối cùng có thể chặn trước khi dữ liệu vào sổ.
//
// "Tra rồi ghi" là HAI BƯỚC RỜI NHAU: không nối đuôi thì cả hai lượt cùng tra
// thấy trống rồi cùng create. Xem `noiDuoiTheoKhoa` trong odoo/idempotency.ts.
describe('tầng TOOL — hai lượt chồng nhau cùng khoá chỉ ghi MỘT bản', () => {
  /** Odoo giả có ĐỘ TRỄ thật giữa lúc tra và lúc ghi — không trễ thì không có đua. */
  function odooCoTre(model: 'sale.order' | 'purchase.order', fieldKhoa: string) {
    const daGhi = new Map<string, number>();
    let idKe = 900;
    const nghi = () => new Promise((r) => setTimeout(r, 5));
    return {
      searchRead: vi.fn(async (m: string, domain: unknown[], fields?: unknown) => {
        const d = JSON.stringify(domain);
        if (m === 'res.partner') {
          return [{ id: 27, name: 'Anh Vấn', ref: 'KH000027', supplier_rank: 5 }];
        }
        if (m === 'product.product') {
          if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
            return [{ id: 512, name: 'Led F5', incokit_stock_breakdown: [] }];
          }
          return [{ id: 512, name: 'Led F5', default_code: 'SP000512', list_price: 100000, uom_id: [1, 'Cái'] }];
        }
        if (m === model) {
          await nghi(); // chỗ hai lượt chen được vào nhau
          if (d.includes(fieldKhoa)) {
            const k = d.match(/zalo:[^"]+/)?.[0] ?? '';
            const id = daGhi.get(k);
            return id ? [{ id, name: `X${id}`, state: 'draft', amount_total: 1, [fieldKhoa]: k }] : [];
          }
          const id = Number(d.match(/(\d+)/)?.[1] ?? idKe);
          return [{ id, name: `X${id}`, state: 'draft', amount_total: 1 }];
        }
        return [];
      }),
      execute: vi.fn(async (m: string, method: string, args?: unknown) => {
        if (m === model && method === 'create') {
          await nghi();
          const vals = (args as Array<Record<string, unknown>>)[0];
          const id = idKe++;
          daGhi.set(String(vals[fieldKhoa] ?? ''), id);
          return id;
        }
        return idKe;
      }),
    };
  }

  const soCreate = (odoo: { execute: { mock: { calls: unknown[][] } } }, model: string) =>
    odoo.execute.mock.calls.filter((c) => String(c[0]) === model && String(c[1]) === 'create').length;

  it('ĐƠN BÁN — hai lời gọi song song cùng khoá → 1 đơn, lượt sau báo da_ton_tai', async () => {
    const odoo = odooCoTre('sale.order', 'client_order_ref');
    const vao = {
      khach_hang_id: 27, ten_khach: 'Vấn',
      dong: [{ san_pham_id: 512, so_luong: 10, don_gia: 100000 }],
    };
    const deps = { odoo: odoo as never, conversationId: 'c-tool', seq: 7, choPhepDatGia: true };
    const [a, b] = await Promise.all([taoDonNhap(deps, vao), taoDonNhap(deps, vao)]);

    expect(soCreate(odoo, 'sale.order')).toBe(1);
    // Một lượt tạo mới, lượt kia phải nhận ra đơn đã có — KHÔNG được báo lỗi,
    // vì máy gom đơn đọc 'loi' là giữ phiên rồi thử lại (kẹt vòng).
    expect([a.trangThai, b.trangThai].sort()).toEqual(['da_tao', 'da_ton_tai']);
  });

  it('PHIẾU NHẬP — cùng bệnh, cùng thuốc: hai lời gọi song song → 1 phiếu', async () => {
    const odoo = odooCoTre('purchase.order', 'origin');
    const vao = {
      nha_cung_cap_id: 27, ten_ncc: 'Vấn',
      dong: [{ san_pham_id: 512, so_luong: 10 }],
    };
    const deps = { odoo: odoo as never, conversationId: 'c-tool-mua', seq: 7 };
    const [a, b] = await Promise.all([taoDonMua(deps, vao), taoDonMua(deps, vao)]);

    expect(soCreate(odoo, 'purchase.order')).toBe(1);
    expect([a.trangThai, b.trangThai].sort()).toEqual(['da_tao', 'da_ton_tai']);
  });

  it('khoá KHÁC nhau → không xếp hàng nhầm, cả hai đều ghi', async () => {
    // Hàng đợi theo khoá, không phải hàng đợi toàn cục: hai việc thật khác
    // nhau chạy song song vẫn phải ra hai bản ghi.
    const odoo = odooCoTre('sale.order', 'client_order_ref');
    const vao = {
      khach_hang_id: 27, ten_khach: 'Vấn',
      dong: [{ san_pham_id: 512, so_luong: 10, don_gia: 100000 }],
    };
    await Promise.all([
      taoDonNhap({ odoo: odoo as never, conversationId: 'c-tool', seq: 1, choPhepDatGia: true }, vao),
      taoDonNhap({ odoo: odoo as never, conversationId: 'c-tool', seq: 2, choPhepDatGia: true }, vao),
    ]);
    expect(soCreate(odoo, 'sale.order')).toBe(2);
  });
});
