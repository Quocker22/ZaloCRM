// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_san_pham. Mock tầng Odoo, không cần server thật.
//
// Trọng tâm: (1) KHÔNG BAO GIỜ lộ giá vốn, (2) không trả nhầm SP khác dòng.
import { describe, it, expect, vi } from 'vitest';
import {
  traSanPham,
  dinhDangSanPham,
  boDau,
  macModel,
  domainTimKiem,
} from '../../../src/modules/ai/odoo/tools/tra-san-pham.js';

/**
 * Odoo giả trả về đúng các dòng đã dựng sẵn.
 *
 * PHẢI tôn trọng điều kiện `list_price` trong domain: code tra 2 lượt (SP có giá
 * trước, SP trống giá bù sau — xem lý do trong tra-san-pham.ts). Mock trả nguyên
 * `rows` cho cả 2 lượt sẽ nhân đôi kết quả và test đo sai hoàn toàn.
 *
 * Cũng tôn trọng `limit` để test "vừa đúng giới hạn" đo được thật.
 */
const fakeOdoo = (rows: Record<string, unknown>[]) => ({
  searchRead: vi.fn(async (
    _model: string,
    domain: unknown[],
    _fields: string[],
    opts: { limit?: number } = {},
  ) => {
    const dieuKienGia = (domain as unknown[]).filter(
      (d): d is [string, string, number] =>
        Array.isArray(d) && d[0] === 'list_price',
    );
    const khop = rows.filter((r) =>
      dieuKienGia.every(([, op, nguong]) => {
        const gia = Number(r.list_price ?? 0);
        return op === '>' ? gia > nguong : gia <= nguong;
      }),
    );
    return opts.limit !== undefined ? khop.slice(0, opts.limit) : khop;
  }),
});

const sp = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Đèn LED P10 ngoài trời',
  default_code: 'P10-OUT',
  list_price: 120000,
  uom_id: [1, 'Đơn vị'],
  ...over,
});

describe('boDau', () => {
  it('bỏ dấu tiếng Việt để khớp khi khách gõ không dấu', () => {
    expect(boDau('Đèn LED Ngoài Trời')).toBe('den led ngoai troi');
  });
  it('đổi đ → d', () => {
    expect(boDau('đèn')).toBe('den');
  });
});

describe('macModel', () => {
  it('nhận mã model có chữ số', () => {
    expect(macModel('Đèn P10 ngoài trời')).toContain('p10');
    expect(macModel('LED 2835')).toContain('2835');
  });
  it('bỏ qua đơn vị đơn lẻ (12v, 5a) — không phải mã SP', () => {
    expect(macModel('nguồn 12v 5a')).toEqual([]);
  });
  it('giữ mã ghép phức tạp', () => {
    expect(macModel('nguồn 12V400W')).toContain('12v400w');
  });
  it('tên thuần chữ → không có mã', () => {
    expect(macModel('đèn led ngoài trời')).toEqual([]);
  });
});

describe('traSanPham — hàng rào giá vốn', () => {
  it('KHÔNG BAO GIỜ yêu cầu standard_price từ Odoo', async () => {
    const odoo = fakeOdoo([sp()]);
    await traSanPham({ odoo }, { ten: 'P10' });

    const fieldsDaHoi = odoo.searchRead.mock.calls[0][2] as string[];
    expect(fieldsDaHoi).not.toContain('standard_price');
    expect(fieldsDaHoi).not.toContain('cost');
  });

  it('Odoo LỠ trả standard_price → vẫn không lọt ra ngoài (hàng rào 2)', async () => {
    // Ca này xảy ra nếu ai đó lỡ cấp group_manager cho user bot.
    const odoo = fakeOdoo([sp({ standard_price: 80000, margin: 40000 })]);

    const kq = await traSanPham({ odoo }, { ten: 'P10' });

    expect(JSON.stringify(kq)).not.toContain('80000');
    expect(JSON.stringify(kq)).not.toContain('standard_price');
    expect(kq[0].gia).toBe(120000); // giá BÁN thì vẫn có
  });
});

describe('traSanPham — chống nhầm sản phẩm', () => {
  it('query có mã P10 → loại SP P4 dù tên gần giống', async () => {
    // P10 và P4 khác hàng, khác giá. Trả nhầm là báo sai giá cho khách.
    const odoo = fakeOdoo([
      sp({ id: 1, name: 'Đèn LED P4 ngoài trời', default_code: 'P4-OUT', list_price: 90000 }),
      sp({ id: 2, name: 'Đèn LED P10 ngoài trời', default_code: 'P10-OUT', list_price: 120000 }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn P10' });

    expect(kq).toHaveLength(1);
    expect(kq[0].id).toBe(2);
  });

  it('có mã nhưng KHÔNG SP nào khớp → trả RỖNG, không rơi về danh sách chưa lọc', async () => {
    // Thà nói "không tìm thấy" còn hơn báo giá sai sản phẩm.
    const odoo = fakeOdoo([sp({ name: 'Đèn LED P4', default_code: 'P4' })]);

    const kq = await traSanPham({ odoo }, { ten: 'P10' });

    // toHaveLength thay vì toEqual([]): mảng có thêm thuộc tính tongKhop.
    expect(kq).toHaveLength(0);
    expect(kq.tongKhop).toBe(0);
  });

  it('query KHÔNG có mã → trả hết kết quả Odoo (không lọc)', async () => {
    const odoo = fakeOdoo([
      sp({ id: 1, name: 'Đèn LED ngoài trời' }),
      sp({ id: 2, name: 'Đèn LED trong nhà' }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn led' });

    expect(kq).toHaveLength(2);
  });
});

describe('domainTimKiem — TÁCH TỪ KHOÁ', () => {
  // Bug thật 2026-07-29: nhân viên gõ "COB 24v xanh ngọc" nhưng SP tên
  // "Led dây COB 24v MÀU xanh ngọc" → ilike nguyên chuỗi KHÔNG khớp vì thiếu
  // chữ "màu" ở giữa. Bot báo "không tìm thấy" dù SP có thật trong DB.

  it('nhiều từ → mỗi từ một điều kiện AND (khớp dù thiếu từ ở giữa)', () => {
    const d = domainTimKiem('COB 24v xanh ngọc');
    const s = JSON.stringify(d);

    // Phải có ilike riêng cho từng từ trên `name`.
    expect(s).toContain('"COB"');
    expect(s).toContain('"24v"');
    expect(s).toContain('"xanh"');
    expect(s).toContain('"ngọc"');

    // `name` KHÔNG được khớp nguyên chuỗi (đó chính là bug cũ).
    // `default_code` thì CÓ — mã SP không tách từ, gõ mã là gõ đủ.
    const dieuKienName = d.filter(
      (x) => Array.isArray(x) && (x as unknown[])[0] === 'name',
    );
    expect(dieuKienName).toHaveLength(4);
    expect(JSON.stringify(dieuKienName)).not.toContain('COB 24v xanh ngọc');
  });

  it('vẫn giữ được tính chặt — không nới lỏng thành OR', () => {
    const d = domainTimKiem('COB xanh');
    // 2 từ → 1 toán tử '&' (AND) chứ không phải '|'
    expect(d.filter((x) => x === '&').length).toBe(1);
  });

  it('một từ → tra cả name lẫn mã SP', () => {
    const d = JSON.stringify(domainTimKiem('P10'));
    expect(d).toContain('name');
    expect(d).toContain('default_code');
  });

  it('bỏ từ đệm ("màu", "cái", "cuộn") — chúng không phân biệt được SP', () => {
    const d = JSON.stringify(domainTimKiem('COB màu xanh'));
    expect(d).not.toContain('"màu"');
    expect(d).toContain('"xanh"');
  });

  it('mã SP dài vẫn tra được nguyên chuỗi qua default_code', () => {
    const d = JSON.stringify(domainTimKiem('220V-6615-ATX-3B-W'));
    expect(d).toContain('220V-6615-ATX-3B-W');
  });

  it('query toàn từ đệm → về khớp nguyên chuỗi (không trả cả kho)', () => {
    const d = JSON.stringify(domainTimKiem('cái'));
    expect(d).toContain('"cái"');
  });
});

describe('traSanPham — DỰ PHÒNG khi đòi đủ từ ra rỗng', () => {
  // Ca thật: "đèn led" — trong catalog KHÔNG SP nào có cả "đèn" lẫn "led"
  // (SP tên "Led 3 Bóng…", không ai đặt "Đèn LED 3 Bóng"). Đòi đủ → 0 kết quả
  // dù có 353 SP chứa "led". Thà trả rộng kèm dấu CÒN NỮA còn hơn nói không có.

  it('AND ra rỗng → tự nới sang OR', async () => {
    let lan = 0;
    const odoo = {
      searchRead: vi.fn(async () => {
        lan += 1;
        return lan === 1 ? [] : [sp({ id: 5, name: 'Led 3 Bóng Ngoài Trời' })];
      }),
    };

    const kq = await traSanPham({ odoo }, { ten: 'đèn led' });

    expect(odoo.searchRead).toHaveBeenCalledTimes(2);
    expect(kq).toHaveLength(1);
    // Lần 2 phải dùng OR ('|'), không phải AND ('&')
    expect(JSON.stringify(odoo.searchRead.mock.calls[1][1])).toContain('"|"');
  });

  it('AND có kết quả CÓ GIÁ đủ dùng → KHÔNG hỏi thêm SP trống giá', async () => {
    // 12 SP có giá = limit*4 → lấp kín, không cần lượt bù trống giá.
    const odoo = fakeOdoo(Array.from({ length: 12 }, (_, i) => sp({ id: i + 1 })));
    await traSanPham({ odoo }, { ten: 'led dây cob' });
    expect(odoo.searchRead).toHaveBeenCalledTimes(1);
  });

  it('một từ mà rỗng → KHÔNG nới sang OR (nới cũng vẫn rỗng)', async () => {
    const odoo = fakeOdoo([]);
    const kq = await traSanPham({ odoo }, { ten: 'zzzkhongcogi' });

    // Đúng 2 lượt = tra SP-có-giá rồi bù SP-trống-giá (cùng một domain từ khoá).
    // KHÔNG có lượt thứ 3 — lượt 3 mới là nhánh nới rộng, và query một từ thì nới
    // vô nghĩa (không có từ nào để bỏ đi).
    //
    // Đếm số lượt là bằng chứng duy nhất đúng ở đây: KHÔNG thể assert vắng '|'
    // trong domain, vì query một từ vốn đã có '|' của (name OR default_code).
    expect(odoo.searchRead).toHaveBeenCalledTimes(2);
    expect(kq).toHaveLength(0);
  });
});

describe('SỐ ĐẾM trong tên hàng — 3 bóng ≠ 4 bóng (bug 2026-07-30)', () => {
  // Ca thật: khách hỏi "led hắt cụm 3 bóng giá bao nhiêu". Chữ "3" bị lọc mất
  // (length >= 2), "led"/"cụm"/"bóng" bị TU_DEM bỏ → còn "hắt" một mình → khớp
  // bừa, trả về SP "Led 4 bóng". Bot không dám báo giá nên chuyển sale, dù DB có
  // hàng 3 bóng giá 5.000đ.

  it('GIỮ token số 1 ký tự trong domain (không lọc như từ ngắn)', () => {
    const d = JSON.stringify(domainTimKiem('led 3 bóng'));

    expect(d).toContain('"3"');
  });

  it('số đếm KHÔNG bị TU_DEM loại bỏ', () => {
    // "led" và "bóng" đều trong TU_DEM; nếu số cũng bị bỏ thì domain rỗng nghĩa.
    const d = JSON.stringify(domainTimKiem('led 4 bóng'));

    expect(d).toContain('"4"');
  });

  it('query 3 bóng KHÔNG khớp SP 4 bóng', async () => {
    const odoo = fakeOdoo([
      sp({ id: 1, name: 'Led 4 bóng 220V trắng ngoài trời', default_code: '4B' }),
      sp({ id: 2, name: 'Led 3 Bóng Ngoài Trời 6615', default_code: '3B' }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'led 3 bóng' });

    // Mock không tự lọc theo name, nên chốt ở tầng domain: phải có điều kiện "3".
    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('"3"');
    expect(kq.length).toBeGreaterThan(0);
  });
});

describe('XẾP THEO ĐỘ KHỚP khi nới sang OR (bug 2026-07-30)', () => {
  // Nới rộng trả "chứa BẤT KỲ từ nào", Odoo giữ thứ tự theo id → SP khớp 1 từ có
  // thể đứng trên SP khớp 4 từ. Ca thật: "led hắt cụm 3 bóng" (chữ "cụm" không có
  // trong tên SP nào → AND vỡ) trả "P10 3 màu" (khớp mỗi "3") lên đầu.

  it('SP khớp NHIỀU từ lên trước SP khớp ít từ', async () => {
    let lan = 0;
    const odoo = {
      searchRead: vi.fn(async () => {
        lan += 1;
        // Lượt 1+2 = nhánh AND (rỗng → buộc nới rộng). Lượt 3+ = nhánh OR.
        if (lan <= 2) return [];
        return [
          sp({ id: 1, name: 'P10 3 màu LLR', default_code: 'P10-3M' }),
          sp({ id: 2, name: 'Led hắt 3 bóng 7 màu', default_code: 'SP754' }),
        ];
      }),
    };

    const kq = await traSanPham({ odoo }, { ten: 'led hắt cụm 3 bóng' });

    // "Led hắt 3 bóng" khớp led+hat+3+bong = 4 từ; "P10 3 màu" khớp mỗi "3".
    expect(kq[0].ten).toContain('hắt 3 bóng');
  });

  it('nhánh AND (không nới) KHÔNG xếp lại — giữ thứ tự Odoo', async () => {
    // Mọi dòng đã khớp đủ từ nên xếp lại chỉ làm mất thứ tự Odoo.
    const odoo = fakeOdoo([
      sp({ id: 1, name: 'Led dây COB 24V xanh' }),
      sp({ id: 2, name: 'Led dây COB 24V xanh ngọc' }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'cob 24v xanh' });

    expect(kq[0].id).toBe(1);
  });

  it('nới rộng ƯU TIÊN ĐỘ KHỚP hơn giá (SP đúng loại mà trống giá vẫn hữu ích)', async () => {
    let lan = 0;
    const odoo = {
      searchRead: vi.fn(async () => {
        lan += 1;
        if (lan <= 2) return [];
        return [
          // Sai loại nhưng CÓ giá.
          sp({ id: 1, name: 'Nguồn 12V', default_code: 'N12', list_price: 195000 }),
          // Đúng loại nhưng TRỐNG giá — vẫn phải lên trước.
          sp({ id: 2, name: 'Led hắt 3 bóng 7 màu', default_code: 'S754', list_price: 0 }),
        ];
      }),
    };

    const kq = await traSanPham({ odoo }, { ten: 'led hắt cụm 3 bóng' });

    expect(kq[0].ten).toContain('hắt 3 bóng');
  });
});

describe('traSanPham — LỌC HÀNG ĐÃ LƯU TRỮ', () => {
  // Bug thật phát hiện 2026-07-29 qua UI: "Đèn fa 30w màu vàng nắng" (id=1719) đã
  // lưu trữ nhưng bot vẫn báo giá. Nguyên nhân: product_template.active=false mà
  // product_product.active=true → chỉ lọc một cấp là SP archive vẫn lọt.

  it('lọc active ở CẢ HAI cấp: variant VÀ template', async () => {
    const odoo = fakeOdoo([]);
    await traSanPham({ odoo }, { ten: 'đèn' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('"active"');                  // cấp variant
    expect(domain).toContain('product_tmpl_id.active');    // cấp template
  });

  it('chỉ lọc variant thôi là KHÔNG đủ (chốt chặn hồi quy)', async () => {
    const odoo = fakeOdoo([]);
    await traSanPham({ odoo }, { ten: 'đèn' });

    const domain = odoo.searchRead.mock.calls[0][1] as unknown[];
    const coTemplateActive = JSON.stringify(domain).includes('product_tmpl_id.active');
    expect(coTemplateActive).toBe(true);
  });
});

describe('traSanPham — tham số', () => {
  it('chỉ lấy SP đang bán (sale_ok = true)', async () => {
    const odoo = fakeOdoo([]);
    await traSanPham({ odoo }, { ten: 'x' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('sale_ok');
  });

  it('tìm cả theo name và default_code', async () => {
    const odoo = fakeOdoo([]);
    await traSanPham({ odoo }, { ten: 'P10' });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('name');
    expect(domain).toContain('default_code');
  });

  it('tên rỗng → trả rỗng, KHÔNG gọi Odoo', async () => {
    const odoo = fakeOdoo([]);
    expect(await traSanPham({ odoo }, { ten: '  ' })).toEqual([]);
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('gioi_han bị chặn trần ở 10 (kết quả tool nằm lại lịch sử, tính tiền mọi vòng)', async () => {
    const odoo = fakeOdoo(Array.from({ length: 100 }, (_, i) => sp({ id: i + 1 })));

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 9999 });

    expect(kq.length).toBeLessThanOrEqual(10);
  });

  it('mặc định 3 kết quả (hạ từ 5 để lịch sử nhẹ hơn)', async () => {
    const odoo = fakeOdoo(Array.from({ length: 20 }, (_, i) => sp({ id: i + 1 })));

    expect(await traSanPham({ odoo }, { ten: 'đèn' })).toHaveLength(3);
  });

  it('many2one [id, tên] → lấy đúng tên đơn vị', async () => {
    const odoo = fakeOdoo([sp({ uom_id: [7, 'Cái'] })]);
    const kq = await traSanPham({ odoo }, { ten: 'đèn' });
    expect(kq[0].donVi).toBe('Cái');
  });
});

describe('dinhDangSanPham', () => {
  it('không có kết quả → hướng dẫn model hỏi lại khách', async () => {
    const s = dinhDangSanPham([]);
    expect(s).toContain('Không tìm thấy');
    expect(s).toContain('hỏi lại');
  });

  it('có kết quả → kèm id để model dùng cho tool sau', () => {
    const s = dinhDangSanPham([
      { id: 42, ten: 'Đèn P10', ma: 'P10', gia: 120000, donVi: 'Cái' },
    ]);
    expect(s).toContain('id=42');
    expect(s).toContain('120.000đ');
  });
});

describe('ƯU TIÊN SP CÓ GIÁ khi cắt kết quả', () => {
  // Ca thật: tra "COB" ra 12 SP, cắt 3 đầu theo thứ tự Odoo → cả 3 đều trống giá,
  // trong khi SP thứ 2 (bóng COB trắng = 5.000đ) bị cắt mất. Nhân viên hỏi giá mà
  // bot đưa toàn hàng chưa có giá là vô dụng.

  it('SP có giá lên ĐẦU dù Odoo trả sau', async () => {
    const odoo = fakeOdoo([
      sp({ id: 1, list_price: 0 }),
      sp({ id: 2, list_price: 0 }),
      sp({ id: 3, list_price: 5000 }),   // có giá nhưng ở cuối
      sp({ id: 4, list_price: 0 }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 2 });

    expect(kq[0].id).toBe(3);       // SP có giá được ưu tiên
    expect(kq[0].gia).toBe(5000);
  });

  it('giữ thứ tự tương đối TRONG mỗi nhóm', async () => {
    const odoo = fakeOdoo([
      sp({ id: 1, list_price: 100 }),
      sp({ id: 2, list_price: 0 }),
      sp({ id: 3, list_price: 200 }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 3 });

    expect(kq.map((s) => s.id)).toEqual([1, 3, 2]);  // có giá (1,3) rồi trống (2)
  });

  it('mọi SP đều có giá → thứ tự KHÔNG đổi', async () => {
    const odoo = fakeOdoo([
      sp({ id: 7, list_price: 100 }),
      sp({ id: 8, list_price: 200 }),
    ]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 5 });
    expect(kq.map((s) => s.id)).toEqual([7, 8]);
  });
});

describe('GIÁ ẢO (placeholder 1đ) — đánh dấu rõ', () => {
  // Đo DB thật: 63/313 SP "có giá" để đúng 1đ. Không mặt hàng LED nào bán 1 đồng.
  // Không đánh dấu thì bot tưởng bán 1đ thật và báo cho khách.

  it('giá 1đ → ghi "GIÁ TẠM, KHÔNG DÙNG ĐƯỢC"', async () => {
    const odoo = fakeOdoo([sp({ list_price: 1 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn' }));

    expect(s).toContain('GIÁ TẠM');
    expect(s).toContain('KHÔNG DÙNG ĐƯỢC');
  });

  it('giá ảo KHÔNG được tính là "có giá"', async () => {
    const odoo = fakeOdoo([sp({ id: 1, list_price: 1 }), sp({ id: 2, list_price: 5000 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 5 }));

    expect(s).toContain('1/2');   // 1 SP thiếu giá (SP giá 1đ)
  });

  it('giá 1.000đ (rẻ THẬT) → hiện bình thường, không đánh dấu oan', async () => {
    const odoo = fakeOdoo([sp({ list_price: 1000 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn' }));

    expect(s).toContain('1.000đ');
    expect(s).not.toContain('GIÁ TẠM');
  });

  it('SP giá thật lên trước SP giá ảo', async () => {
    const odoo = fakeOdoo([sp({ id: 1, list_price: 1 }), sp({ id: 2, list_price: 5000 })]);

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 1 });

    expect(kq[0].id).toBe(2);   // giá thật, không phải placeholder
  });
});

describe('giá 0đ — KHÔNG báo như giá thật', () => {
  // Giá 0 trong Odoo = dữ liệu CHƯA NHẬP, không phải "miễn phí".
  // Báo "0đ" cho khách là hứa bán miễn phí.

  it('giá 0 → hiện "CHƯA CÓ GIÁ", không hiện "0đ" như giá thật', async () => {
    const odoo = fakeOdoo([sp({ list_price: 0 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn' }));

    expect(s).toContain('CHƯA CÓ GIÁ');
    // Khớp chính xác chuỗi "| 0đ" (dòng giá), không dùng '0đ' vì nó khớp cả "120.000đ".
    expect(s).not.toMatch(/\|\s*0đ/);
  });

  it('CÓ SP có giá lẫn thiếu giá → bảo model DÙNG SP có giá, đừng bỏ cuộc', async () => {
    // 74% catalog chưa nhập giá. Nếu hễ thấy 1 SP thiếu giá là chuyển sale
    // thì bot vô dụng — phải dùng được các SP còn lại.
    const odoo = fakeOdoo([sp({ id: 1, list_price: 120000 }), sp({ id: 2, list_price: 0 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 5 }));

    expect(s).toContain('1/2');                        // đếm đúng
    expect(s).toContain('vẫn dùng bình thường');       // không bỏ cuộc
    expect(s).toContain('Chỉ chuyển sale cho SP thiếu giá');
  });

  it('TẤT CẢ thiếu giá → bảo TRA RỘNG HƠN trước, chưa chuyển sale ngay', async () => {
    // Ca thật anh gặp: "COB 24v xanh ngọc" trống giá → bot chuyển sale ngay.
    // Nhưng catalog CÓ "Led dây 24V COB Màu Trắng" = 1đ và "COB 220v" = 14.000đ.
    // Nhân viên cần LỰA CHỌN, không cần lời từ chối.
    const odoo = fakeOdoo([sp({ id: 1, list_price: 0 }), sp({ id: 2, list_price: 0 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 5 }));

    expect(s).toContain('KHÔNG báo 0đ');
    expect(s).toContain('rộng hơn');
    expect(s).toContain('tương tự CÓ giá');
    // CHẶN SỐ LẦN nới rộng (bug 2026-07-30): thiếu giới hạn, model tra lại 4 lần
    // cùng ra 1 kết quả trống giá rồi mới chuyển sale — 10s và chạm trần vòng lặp.
    expect(s).toContain('ĐÚNG MỘT LẦN');
    expect(s).toContain('CHUYỂN SALE NGAY');
    expect(s).toContain('ĐỪNG tra thêm');
  });

  it('mọi SP đều có giá → KHÔNG thêm cảnh báo thừa', async () => {
    const odoo = fakeOdoo([sp({ list_price: 120000 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn' }));

    expect(s).not.toContain('CHƯA CÓ GIÁ');
    expect(s).toContain('120.000đ');
  });
});

describe('ID NHÉT NHẦM VÀO Ô `ten` (bug thật 2026-07-30)', () => {
  // Bot đã có id=1056 từ lượt trước, vẫn gọi tra_san_pham {ten:"1056"} rồi
  // bối rối khi không thấy gì — mất một vòng lặp vô nghĩa. Thông báo cũ còn
  // dẫn sai: "hỏi lại tên chính xác hơn" trong khi bot đang cầm đúng id.

  it('từ khoá toàn SỐ + rỗng → nói thẳng id không tra ngược được', async () => {
    const s = dinhDangSanPham(await traSanPham({ odoo: fakeOdoo([]) }, { ten: '1056' }), '1056');

    expect(s).toContain('id sản phẩm');
    expect(s).toContain('KHÔNG cần tra lại');
    expect(s).toContain('tao_don_nhap');
  });

  it('chỉ dẫn dùng id cho tool khác thay vì hỏi lại nhân viên', async () => {
    const s = dinhDangSanPham(await traSanPham({ odoo: fakeOdoo([]) }, { ten: '790' }), '790');

    expect(s).toContain('tra_ton_kho');
    expect(s).not.toContain('hỏi lại khách');
  });

  it('từ khoá CÓ CHỮ + rỗng → thông báo thường (không nhắc id)', async () => {
    const s = dinhDangSanPham(
      await traSanPham({ odoo: fakeOdoo([]) }, { ten: 'zzz khong co' }), 'zzz khong co',
    );

    expect(s).toContain('Hãy hỏi lại khách');
    expect(s).not.toContain('id sản phẩm');
  });

  it('số nhưng CÓ kết quả → không nhắc gì (2607 là mã model thật)', async () => {
    const s = dinhDangSanPham(
      await traSanPham({ odoo: fakeOdoo([sp({ id: 1056, name: 'Led 2607' })]) }, { ten: '2607' }),
      '2607',
    );

    expect(s).not.toContain('KHÔNG cần tra lại');
  });

  it('không truyền tuKhoa → vẫn chạy, dùng thông báo thường', async () => {
    // Giữ tương thích ngược: tham số thứ 2 là tuỳ chọn.
    const s = dinhDangSanPham(await traSanPham({ odoo: fakeOdoo([]) }, { ten: '1056' }));

    expect(s).toContain('Hãy hỏi lại khách');
  });
});

describe('dấu cắt tường minh — CHỐNG "agent nói dối"', () => {
  // Cạm bẫy: tool trả 50KB, agent thấy 700 ký tự, rồi tự tin tóm tắt cái không có.
  // Cắt IM LẶNG tệ hơn báo lỗi vì model không có tín hiệu nào để biết.

  it('bị cắt → NÓI RÕ số đã quét và còn nữa', async () => {
    const odoo = fakeOdoo(Array.from({ length: 47 }, (_, i) => sp({ id: i + 1 })));

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 3 }));

    // Con số báo ra là số dòng ĐÃ QUÉT (limit*4 = 12), KHÔNG phải tổng trong DB —
    // ta không gọi search_count nên không biết tổng thật. Cố ý: mục đích của dấu
    // này là cho model biết "còn nữa, hãy thu hẹp", không phải báo cáo thống kê.
    // Miễn số báo ra > số hiển thị thì tín hiệu vẫn đúng.
    expect(s).toMatch(/Tìm thấy 12 sản phẩm, hiển thị 3/);
    expect(s).toContain('CÒN NỮA');
    expect(s).toContain('cụ thể hơn');  // hướng dẫn thu hẹp
  });

  it('KHÔNG bị cắt → không thêm nhiễu', async () => {
    const odoo = fakeOdoo([sp({ id: 1 }), sp({ id: 2 })]);

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 5 }));

    expect(s).not.toContain('CÒN NỮA');
  });

  it('vừa đúng giới hạn → KHÔNG báo còn nữa (tránh báo sai)', async () => {
    const odoo = fakeOdoo(Array.from({ length: 3 }, (_, i) => sp({ id: i + 1 })));

    const s = dinhDangSanPham(await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 3 }));

    expect(s).not.toContain('CÒN NỮA');
  });

  it('gắn tongKhop để tầng gọi biết có bị cắt không', async () => {
    const odoo = fakeOdoo(Array.from({ length: 12 }, (_, i) => sp({ id: i + 1 })));

    const kq = await traSanPham({ odoo }, { ten: 'đèn', gioi_han: 3 });

    expect(kq).toHaveLength(3);
    expect(kq.tongKhop).toBe(12);
  });
});

describe('traSanPham — viết liền vs viết cách (dự phòng 2)', () => {
  // Bug thật 06/08/2026: nhân viên gõ "Nb12v100w", SP tên "NB 12V100w".
  // Tách-theo-khoảng-trắng ra MỘT token nên dự phòng OR bị bỏ qua, bot đáp
  // "không khớp sản phẩm nào" — ngay sau khi CHÍNH NÓ liệt kê SP đó.
  const spNguon = () => ({
    id: 1039,
    name: 'Nguồn NB Ngoài Trời 12V100W (cái)',
    default_code: 'NB 12V100w',
    list_price: 78000,
    uom_id: [1, 'Cái'],
  });

  /** Odoo giả: chỉ khớp khi domain chứa pattern có wildcard `%`. */
  const odooChiKhopWildcard = () => ({
    searchRead: vi.fn(async (_m: string, domain: unknown[]) => {
      const d = JSON.stringify(domain);
      return d.includes('%') && d.includes('nb%12%v%100%w') ? [spNguon()] : [];
    }),
  });

  it('"Nb12v100w" (viết liền) → tìm ra "NB 12V100w" nhờ wildcard ranh giới chữ-số', async () => {
    const odoo = odooChiKhopWildcard();

    const kq = await traSanPham({ odoo } as never, { ten: 'Nb12v100w' });

    expect(kq).toHaveLength(1);
    expect(kq[0].ten).toContain('12V100W');
  });

  it('pattern đúng dạng nb%12%v%100%w — chèn % ở MỌI ranh giới chữ↔số', async () => {
    const odoo = odooChiKhopWildcard();

    await traSanPham({ odoo } as never, { ten: 'Nb12v100w' });

    const domainCuoi = JSON.stringify(odoo.searchRead.mock.calls.at(-1)?.[1]);
    expect(domainCuoi).toContain('nb%12%v%100%w');
  });

  it('query MỘT đoạn thuần chữ ("ziczac") → KHÔNG chạy dự phòng wildcard (vô nghĩa)', async () => {
    const odoo = { searchRead: vi.fn(async () => []) };

    await traSanPham({ odoo } as never, { ten: 'ziczac' });

    const coWildcard = odoo.searchRead.mock.calls.some((c) => JSON.stringify(c[1]).includes('%'));
    expect(coWildcard).toBe(false);
  });

  it('tìm thấy ngay từ vòng thường → KHÔNG tốn thêm round-trip wildcard', async () => {
    const odoo = fakeOdoo([sp()]);

    await traSanPham({ odoo } as never, { ten: 'P10' });

    const coWildcard = odoo.searchRead.mock.calls.some((c) => JSON.stringify(c[1]).includes('nb%'));
    expect(coWildcard).toBe(false);
  });
});
