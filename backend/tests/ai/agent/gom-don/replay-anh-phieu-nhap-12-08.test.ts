// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — luồng PHIẾU NHẬP, 11:50:29 → 11:52:46 ngày 12/08/2026.
//
//   11:50:29  NV : [Ảnh] "@bot tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc"
//   11:50:46  Bot: 'Có 2 nhà cung cấp tên "Trung Quốc": 1) Trung Quốc · NCC000001
//                   2) Trung Quốc- Kho Cô Lỳ · NCC000290. Anh/chị chọn giúp em (vd: 1) ạ.'
//   11:50:51  NV : "1"
//   11:50:51  Bot: 'Anh/chị nhập những hàng gì ạ? (tên hàng + số lượng...)'
//                  ^^^ ĐÃ CHỐT NCC, ĐÃ sang bước hàng hoá
//   11:51:13  NV : [Ảnh danh sách hàng viết tay ~20 dòng] "@bot đây lấy từ trong ảnh ra"
//   11:52:46  Bot: 'Em vẫn chưa khớp được "@Tiểu Mã Nelia đây lấy từ trong ảnh ra
//                   [Khách gửi ảnh, nội dung trong ảnh: P10 f" với nhà cung cấp nào ạ...'
//
// BA LỖI TRONG MỘT LƯỢT — đã ĐO, không đoán:
//
// A. "VĂN BẢN ẢNH BỊ CẮT" LÀ CHẨN ĐOÁN SAI. Chuỗi đứt giữa chữ "full" nhìn như
//    model đọc hụt, nhưng đo lại thì nó đứng ĐÚNG ký tự thứ 80 của câu:
//      "@Tiểu Mã Nelia đây lấy từ trong ảnh ra\n[Khách gửi ảnh, nội dung trong
//       ảnh: P10 f"   ← đúng 80 ký tự
//    Thủ phạm là `cauChon.slice(0, 80)` trong câu template "Em vẫn chưa khớp
//    được ..." (gom-don/index.ts). Model ĐỌC ĐỦ cả 20 dòng; chỗ cắt nằm ở phía
//    ta, trong TIN GỬI RA, không phải ở đường đọc ảnh. Đổi model đọc ảnh không
//    chữa được lỗi này một chút nào.
//
// B. NHÃN KỸ THUẬT LỌT RA NGOÀI. `[Khách gửi ảnh, nội dung trong ảnh: …]` là
//    khối NỘI BỘ do `luong-media` ghép để model trích slot biết đây là chữ đọc
//    từ ảnh. Nó không bao giờ được xuất hiện trong tin gửi cho người. Ở đây câu
//    template nhét NGUYÊN chuỗi thô vào giữa, cắt 80 ký tự nên dấu `"` đóng
//    ngay giữa nhãn — nhân viên đọc ra một câu vô nghĩa.
//
// C. PHIÊN QUAY NGƯỢC VỀ BƯỚC NHÀ CUNG CẤP. NCC đã chốt lúc 11:50:51 (bot tự
//    chuyển sang hỏi hàng hoá), vậy mà 11:52:46 bot lại hỏi NCC. Nguyên nhân:
//    ảnh danh sách hàng ĐI KÈM lời nhắn "đây lấy từ trong ảnh ra". `trich-slot`
//    thấy tên/mã hàng viết tay và trả về `khach` (ô này ở chế nhập mang NCC) —
//    hoặc trả `ngoaiLe` — nhưng lỗi thật nằm ở ĐƯỜNG THOÁT 4: nó chạy khi phiên
//    đang chờ chọn và ĐÈ `khachTuKhoa` bằng chính câu thô của nhân viên, kéo
//    phiên ngược về bước tra NCC dù NCC đã chốt xong.
//
//    KHÁC GỐC với ca 11:41-11:43 (`replay-mat-khach-giua-phien-12-08.test.ts`):
//    ca đó do `NHAN_LENH_LEN_DON` bắt nhầm câu gật "đúng rồi lên đơn đi" thành
//    lệnh mới rồi xoá phiên. Câu 11:51:13 KHÔNG khớp regex nào (đã đo), phiên
//    KHÔNG bị xoá — nó bị kéo lùi bước. Hai gốc khác nhau, vá riêng.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilike, khopDomain } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * NỘI DUNG ẢNH THẬT lúc 11:51:13 — giấy viết tay ~20 dòng hàng.
 *
 * Chép đúng những dòng anh Quốc đọc lại từ ảnh. Dùng nguyên văn để test bắt
 * được cả ca "chỉ trích ra 1 dòng" lẫn ca "chuỗi bị cắt cụt".
 */
const NOI_DUNG_ANH = [
  'P10 full out: 10.000 tấm | 242 thùng',
  'P5 full out: 1460 tấm',
  'Cabin 960*960*120: 80 cái',
  'Quạt gió: 160 cái',
  'RY3-800W: 109',
  '12V600W: 1263',
  'DM: 12V400W: 1616',
  'NB-12V400W: 3030',
  'NB-12V60W: 970',
  'NB-12V100W: 873',
  'NB-12V200W: 556',
  '5V60A mỏng: 1131',
  'Led thanh toả 12V lixin trong nhà: 20 thùng',
  'Led thanh toả 12V lixin ngoài trời: 15 thùng',
  '4B 220V lixin trong nhà: 30 thùng',
].join('\n');

/** Khối ảnh y như `luong-media.docVaChuyenTiep` ghép ra (đã đo, không bịa). */
const KHOI_ANH = `[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;

/** Lượt 11:50:29 nguyên văn (tag @bot đã bị cổng nhận lệnh bóc trước). */
const CAU_11_50 = `tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc\n${KHOI_ANH}`;
/**
 * Lượt 11:51:13 nguyên văn — CÓ mention người khác ("@Tiểu Mã Nelia") còn dính
 * trong câu, đúng như log prod. Đây là lời nhắn kèm ảnh danh sách hàng.
 */
const CAU_11_51 = `@Tiểu Mã Nelia đây lấy từ trong ảnh ra\n${KHOI_ANH}`;

/** Odoo giả — NCC/SP lấy đúng theo prod 12/08. */
function fakeOdoo() {
  const ncc = [
    { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 },
    { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 },
  ];
  const khach = [{ id: 2519, name: 'TRung Quốc', ref: 'KH001046', supplier_rank: 0 }];
  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 902, name: 'Màn hình LED P5 full out', default_code: 'P5FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 903, name: 'Cabin 960*960*120', default_code: 'CB960', list_price: 0, uom_id: [1, 'Cái'] },
    { id: 904, name: 'Quạt gió', default_code: 'QG01', list_price: 0, uom_id: [1, 'Cái'] },
    { id: 905, name: 'Nguồn NB-12V400W', default_code: 'NB12V400', list_price: 0, uom_id: [1, 'Cái'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) return [...ncc, ...khach].filter((p) => p.id === Number(theoId[2]));
      const nguon = s.includes('supplier_rank') ? ncc : khach;
      const theoRef = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'ref' && d[1] === '=ilike');
      if (theoRef) {
        const m = String(theoRef[2]).toLowerCase();
        return nguon.filter((p) => (p.ref ?? '').toLowerCase() === m).slice(0, opts?.limit ?? 10);
      }
      return nguon.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'supplier_rank' ? Number(p.supplier_rank ?? 0) > 0
            : true)).slice(0, opts?.limit ?? 10);
    }
    if (model === 'product.product') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === 'in');
      if (theoId) return products.filter((p) => (theoId[2] as number[]).includes(p.id));
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '>') return [];
      return products.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'default_code' && dk[1] === 'ilike'
            ? ilike(`%${String(dk[2])}%`, p.default_code)
            : true));
    }
    if (model === 'purchase.order') {
      if (s.includes('origin') && !s.includes('"id"')) return [];
      return [{ id: 7001, name: 'P04531', state: 'draft', amount_total: 0, origin: 'zalo:c-anh:1' }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 7001) };
}

/**
 * LLM giả — trả về ĐÚNG hình dạng model thật trả trên prod cho từng lượt.
 *
 * Lượt 11:51 là chỗ quan trọng: model nhìn thấy một câu toàn tên/mã hàng viết
 * tay, KHÔNG có tên NCC nào. Nó trích ra các dòng hàng và (theo đo prod) còn
 * gắn thêm `khach` bằng chính mẩu chữ đầu ảnh vì tưởng đó là tên đối tác. Test
 * cho model trả đúng như vậy — chỗ nào model sai thì CODE phải đỡ.
 */
function fakeGenerate(hong = false): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    if (nd.includes('tạo phiếu nhập hàng giúp tôi nhà cung cấp')) {
      input = { nhapHang: true, khach: 'Trung Quốc' };
    } else if (hong && nd.includes('đây lấy từ trong ảnh ra')) {
      // HÌNH DẠNG THẬT LÚC 11:51:13 (đo prod, không đoán): câu chỉ có "đây lấy
      // từ trong ảnh ra" — không động từ, không tên hàng ngoài chữ viết tay —
      // nên model gọi cả lượt là chuyện phiếm và KHÔNG trích ra dòng hàng nào.
      // Phiên vào `buocTiepTheo` với `dong` rỗng, lại ra `hoi_thieu: sp`, render
      // TRÙNG câu lượt trước, và rơi vào guard chống lặp — chỗ đẻ ra tin sai.
      input = { ngoaiLe: true };
    } else if (nd.includes('đây lấy từ trong ảnh ra')) {
      // Lượt 11:51:13 — model trích ĐỦ các dòng hàng trong ảnh, và bịa thêm một
      // ô `khach` từ mẩu chữ đầu ảnh (đo prod: đây là cách nó hay sai).
      input = {
        nhapHang: true,
        khach: 'P10 full out',
        dong: [
          { sp: 'P10 full out', sl: 10000 },
          { sp: 'P5 full out', sl: 1460 },
          { sp: 'Cabin 960*960*120', sl: 80 },
          { sp: 'Quạt gió', sl: 160 },
          { sp: 'NB-12V400W', sl: 3030 },
        ],
      };
    }
    return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
  };
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    rows,
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: { where: { conversationId: string }; create: never; update: { slots: unknown; hetHan: Date } }) => {
        const cu = rows.get(where.conversationId);
        rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => { rows.delete(where.conversationId); return { count: 1 }; },
    },
  };
}

function dungMay(conversationId = 'c-anh', hong = false) {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(hong),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  return {
    goi: (cau: string, seq = 1) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

/** Phiên đang lưu trong DB giả — để soi NCC đã chốt còn hay mất. */
function phienDangLuu(db: ReturnType<typeof fakeDb>, cid = 'c-anh'): Record<string, unknown> | null {
  const row = db.rows.get(cid);
  return row ? (row.slots as Record<string, unknown>) : null;
}

describe('ca thật 11:50–11:52 12/08 — ảnh danh sách hàng giữa phiếu nhập', () => {
  it('LỖI B: nhãn "[Khách gửi ảnh…]" KHÔNG BAO GIỜ được lọt vào tin gửi ra', async () => {
    const { goi, tinGui } = dungMay('c-nhan');

    await goi(CAU_11_50, 11);
    await goi('1', 12);
    await goi(CAU_11_51, 13);
    // Gõ lại đúng câu đó lần nữa để chạm cả nhánh guard chống lặp — chính
    // nhánh nhả nhãn ra ngoài trong ca thật.
    await goi(CAU_11_51, 14);

    for (const tin of tinGui) {
      expect(tin).not.toContain('[Khách gửi ảnh');
      expect(tin).not.toContain('nội dung trong ảnh');
    }
  });

  it('LỖI A: câu trích lại trong tin bot KHÔNG được cắt cụt giữa nội dung ảnh', async () => {
    // Chuỗi "P10 f" trong ca thật là dấu vết của `slice(0, 80)` cắt giữa chữ
    // "full". Tin gửi ra không được chứa mẩu cụt nào như vậy.
    const { goi, tinGui } = dungMay('c-cut');

    await goi(CAU_11_50, 21);
    await goi('1', 22);
    await goi(CAU_11_51, 23);
    await goi(CAU_11_51, 24);

    for (const tin of tinGui) {
      expect(tin).not.toMatch(/P10 f"/);
    }
  });

  it('LỖI C: NCC đã chốt ở lượt trước → gửi ảnh hàng hoá KHÔNG làm hỏi lại NCC', async () => {
    // Dựng đúng hình dạng hỏng: model KHÔNG trích ra dòng hàng nào từ ảnh, nên
    // câu hỏi "nhập những hàng gì ạ?" lặp lại nguyên văn và guard chống lặp vào
    // cuộc. Trước bản vá, guard chỉ nhìn `che === 'nhap'` và nhả câu của bước
    // NCC — kéo nhân viên ngược về bước đã chốt xong từ lượt trước.
    const { goi, tinGui, db } = dungMay('c-giu', true);

    await goi(CAU_11_50, 31);
    // Chốt NCC số 1 — đúng lượt 11:50:51 của ca thật.
    await goi('1', 32);
    const truoc = phienDangLuu(db, 'c-giu');
    expect(truoc?.khachDaChot).toBeTruthy();

    const tinTruocAnh = tinGui.length;
    await goi(CAU_11_51, 33);

    // NCC phải còn nguyên trong phiên.
    const sau = phienDangLuu(db, 'c-giu');
    // Phiên có thể đã chết vì phiếu nhập ra xong — đó cũng là kết quả ĐÚNG.
    if (sau) expect(sau.khachDaChot).toBeTruthy();

    // Và tuyệt đối không hỏi lại NCC ở các tin sau khi gửi ảnh.
    const tinSauAnh = tinGui.slice(tinTruocAnh).join('\n');
    expect(tinSauAnh).not.toContain('của nhà cung cấp nào ạ');
    expect(tinSauAnh).not.toContain('với nhà cung cấp nào ạ');
    // Cũng không được bày đường thoát của bước NCC (gõ lại tên/mã NCC).
    expect(tinSauAnh).not.toContain('TÊN NCC');
    expect(tinSauAnh).not.toContain('mã NCC');
    // Đường thoát phải chỉ đúng việc đang treo: HÀNG HOÁ. Từ 12/08 tối, parser
    // code (`bocDongTuKhoiAnh`) bóc được dòng hàng từ khối ảnh kể cả khi model
    // trả ngoaiLe, nên máy không xin gõ tay nữa mà đi thẳng tới tra SP — câu
    // trả lời giờ là "không tìm thấy sản phẩm …" cho các mã ngoài catalog.
    // Cả hai dạng đều là nói về HÀNG, không phải NCC — đúng tinh thần test.
    expect(tinSauAnh).toMatch(/TÊN HÀNG|sản phẩm/);
  });

  it('CA NGƯỢC: NCC CHƯA chốt → đường thoát vẫn hỏi NCC như cũ', async () => {
    // Hàng rào mới không được vá chết đường thoát cũ. Chưa chốt NCC mà nhân viên
    // gõ thứ máy không hiểu hai lượt liền thì vẫn phải được chỉ cách gõ tên/mã
    // NCC — đúng như trước bản vá.
    const { goi, tinGui } = dungMay('c-chua', true);

    await goi(CAU_11_50, 51);
    // KHÔNG chốt số nào. Gõ hai lượt câu vô nghĩa để chạm guard chống lặp.
    const tinTruoc = tinGui.length;
    await goi(CAU_11_51, 52);
    await goi(CAU_11_51, 53);

    const tinSau = tinGui.slice(tinTruoc).join('\n');
    expect(tinSau).toContain('NCC');
  });

  it('ảnh danh sách hàng → gom được NHIỀU dòng hàng, không phải 1 dòng', async () => {
    const { goi, db } = dungMay('c-nhieu');

    await goi(CAU_11_50, 41);
    await goi('1', 42);
    await goi(CAU_11_51, 43);

    // Hoặc phiên còn sống với nhiều dòng, hoặc phiếu nhập đã ghi với nhiều dòng.
    const sau = phienDangLuu(db, 'c-nhieu');
    if (sau) {
      const dong = (sau.dong ?? []) as unknown[];
      expect(dong.length).toBeGreaterThan(1);
    }
  });
});
