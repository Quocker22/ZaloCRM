// SPDX-License-Identifier: AGPL-3.0-or-later
// BA TOOL BÁO CÁO nhận ngày từ model — bộ test khoá đường ra ngày sai.
//
// ═══ CA THẬT 21:17 ngày 11/08/2026 (nhóm Test-AI) ════════════════════════
//   NV : "@bot Anh muốn nó báo cáo theo ngày các sản phẩm bán ra hôm nay"
//   Bot: "báo cáo bán ra + tồn kho hôm nay (20/06/2026) đây ạ:
//         Hôm nay bán ra 69 mã sản phẩm..."
//   Anh Quốc: "sao lại 20/6/2026 ???"
//
// Và ca 03:29 CÙNG NGÀY, bot tự thú: "em thấy dữ liệu đơn hàng trả về đang ở
// kỳ 2026-06-20 — không rõ hôm nay là ngày nào". CÙNG MỘT NGÀY BỊA.
//
// Ba tool dưới đây đều khai `tu_ngay`/`den_ngay` trong inputSchema, tức là
// MỜI model tự tính ngày — mà model không có đồng hồ. Bộ test này khoá: dù
// model điền ngày bịa, hễ nhân viên nói "hôm nay" thì kỳ chạy thật vẫn phải
// là hôm nay.
//
// ĐỒNG HỒ ĐƯỢC TIÊM ở mọi test — không gọi `new Date()` trần, để hôm nay xanh
// thì mai cũng xanh.
import { describe, it, expect, vi } from 'vitest';
import { baoCaoBanTon, dinhDangBanTon } from '../../../src/modules/ai/odoo/tools/bao-cao-ban-ton.js';
import { topSanPham } from '../../../src/modules/ai/odoo/tools/top-san-pham.js';
import { baoCaoLinhHoat } from '../../../src/modules/ai/odoo/tools/bao-cao-linh-hoat.js';
import { baoCaoBanTonDefinition } from '../../../src/modules/ai/odoo/tools/bao-cao-ban-ton.js';
import { topSanPhamDefinition } from '../../../src/modules/ai/odoo/tools/top-san-pham.js';
import { baoCaoLinhHoatDefinition } from '../../../src/modules/ai/odoo/tools/bao-cao-linh-hoat.js';

/** 21:17 ngày 11/08/2026 giờ VN = 14:17 UTC — đúng thời điểm ca hỏng. */
const BAY_GIO = new Date('2026-08-11T14:17:00Z');
const HOM_NAY = '2026-08-11';
const HOM_QUA = '2026-08-10';
/** Ngày model bịa trong CẢ HAI ca (21:17 và 03:29) cùng ngày 11/08. */
const NGAY_BIA = '2026-06-20';

function fakeOdoo(nhom: unknown[] = [], rows: unknown[] = []) {
  return { execute: vi.fn(async () => nhom), searchRead: vi.fn(async () => rows) };
}

/** Gom mọi chuỗi truyền xuống Odoo để soi kỳ thật sự đã chạy. */
function domainCuaLanGoi(o: { execute: { mock: { calls: unknown[][] } } }, i = 0): string {
  return JSON.stringify(o.execute.mock.calls[i]);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('bao_cao_ban_ton — TOOL CỦA CHÍNH CA HỎNG 21:17', () => {
  it('CA THẬT: NV nói "hôm nay", model điền tu_ngay=2026-06-20 + ky=hom_nay → chạy kỳ HÔM NAY', async () => {
    const o = fakeOdoo();

    const kq = await baoCaoBanTon(
      { odoo: o },
      { ky: 'hom_nay', tu_ngay: NGAY_BIA, den_ngay: NGAY_BIA, bayGio: BAY_GIO },
    );

    const d = domainCuaLanGoi(o);
    expect(d).toContain(`${HOM_NAY} 00:00:00`);
    expect(d).toContain(`${HOM_NAY} 23:59:59`);
    // Ngày bịa KHÔNG được lọt xuống Odoo dưới bất kỳ dạng nào.
    expect(d).not.toContain(NGAY_BIA);
    // Và không được lọt lên câu trả lời cho nhân viên.
    expect(kq.trangThai).toBe('ok');
    expect(dinhDangBanTon(kq)).not.toContain('20/06/2026');
  });

  it('không có ky, không có ngày → HÔM NAY (mặc định cũ vẫn đúng)', async () => {
    const o = fakeOdoo();
    await baoCaoBanTon({ odoo: o }, { bayGio: BAY_GIO });
    expect(domainCuaLanGoi(o)).toContain(`${HOM_NAY} 00:00:00`);
  });

  it('"hôm qua" → ky=hom_qua ra đúng 10/08, kỳ đúng MỘT ngày', async () => {
    const o = fakeOdoo();
    await baoCaoBanTon({ odoo: o }, { ky: 'hom_qua', bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain(`${HOM_QUA} 00:00:00`);
    expect(d).toContain(`${HOM_QUA} 23:59:59`);
  });

  it('NV nêu NGÀY CỤ THỂ ("từ 1/8 đến 5/8") → tôn trọng, không đè về hôm nay', async () => {
    const o = fakeOdoo();
    await baoCaoBanTon({ odoo: o }, { tu_ngay: '2026-08-01', den_ngay: '2026-08-05', bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain('2026-08-01 00:00:00');
    expect(d).toContain('2026-08-05 23:59:59');
  });

  it('ngày TƯƠNG LAI model bịa → kéo về hôm nay và NÓI RA cho nhân viên biết', async () => {
    const o = fakeOdoo();
    const kq = await baoCaoBanTon({ odoo: o }, { tu_ngay: '2027-03-01', bayGio: BAY_GIO });
    expect(domainCuaLanGoi(o)).toContain(`${HOM_NAY} 00:00:00`);
    // Sửa im lặng cũng là một kiểu bịa — nhân viên phải thấy dòng cảnh báo.
    expect(dinhDangBanTon(kq)).toMatch(/tương lai|không hợp lệ|đã tự sửa|LƯU Ý/i);
  });

  it('tonDauKy vẫn suy ra được khi ky=hom_nay (laHomNay phải nhận đúng)', async () => {
    // Bẫy hồi quy: nếu chỉ so `tu === homNay()` bằng đồng hồ THẬT thay vì đồng
    // hồ tiêm, test này đỏ vào mọi ngày khác 11/08/2026.
    const o = fakeOdoo(
      [{ product_id: [1, '[A] SP A'], product_uom_qty: 5 }],
      [{ id: 1, name: 'SP A', default_code: 'A', qty_available: 3 }],
    );
    const kq = await baoCaoBanTon({ odoo: o }, { ky: 'hom_nay', tu_ngay: NGAY_BIA, bayGio: BAY_GIO });
    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai !== 'ok') return;
    expect(kq.laHomNay).toBe(true);
    expect(kq.danhSach[0]!.tonDauKy).toBe(8); // 3 tồn + 5 bán
  });

  it('schema có `ky` và mô tả tu_ngay nói RÕ chỉ dùng khi NV nêu ngày cụ thể', () => {
    const p = baoCaoBanTonDefinition.inputSchema.properties as Record<string, { enum?: string[]; description?: string }>;
    expect(p.ky?.enum).toContain('hom_nay');
    expect(p.ky?.enum).toContain('hom_qua');
    // Mô tả cũ MỜI model tự tính ngày ("Bỏ trống = HÔM NAY. 'Hôm qua' → điền
    // ngày hôm qua") — chính là cái bẫy. Phải biến mất.
    expect(p.tu_ngay?.description ?? '').not.toContain('Hôm qua');
    expect(p.tu_ngay?.description ?? '').toMatch(/cụ thể/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('top_san_pham — cùng bệnh, cùng thuốc', () => {
  it('ky=hom_nay thắng ngày bịa model điền', async () => {
    const o = fakeOdoo();
    await topSanPham({ odoo: o }, { kieu: 'ban_chay', ky: 'hom_nay', tu_ngay: NGAY_BIA, bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain(`${HOM_NAY} 00:00:00`);
    expect(d).not.toContain(NGAY_BIA);
  });

  it('ky=thang_nay → 01/08 đến 11/08', async () => {
    const o = fakeOdoo();
    await topSanPham({ odoo: o }, { ky: 'thang_nay', bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain('2026-08-01 00:00:00');
    expect(d).toContain(`${HOM_NAY} 23:59:59`);
  });

  // Mặc định CŨ của tool này là 30 ngày gần nhất — giữ nguyên, vì "dạo này bán
  // gì chạy" là câu hỏi phổ biến nhất và 30 ngày là câu trả lời đúng cho nó.
  it('không ky, không ngày → vẫn 30 ngày gần nhất, tính theo đồng hồ TIÊM', async () => {
    const o = fakeOdoo();
    await topSanPham({ odoo: o }, { bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain(`${HOM_NAY} 23:59:59`);
    expect(d).toContain('2026-07-12 00:00:00'); // 11/08 lùi 30 ngày
  });

  it('schema có `ky`', () => {
    const p = topSanPhamDefinition.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(p.ky?.enum).toContain('hom_nay');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('bao_cao_linh_hoat — cùng bệnh, cùng thuốc', () => {
  const CO_BAN = { bang: 'don_hang' as const, do: 'tong_tien', nhom_theo: 'ngay' as const };

  it('ky=hom_nay thắng ngày bịa model điền', async () => {
    const o = fakeOdoo();
    await baoCaoLinhHoat({ odoo: o }, { ...CO_BAN, ky: 'hom_nay', tu_ngay: NGAY_BIA, bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain(`${HOM_NAY} 00:00:00`);
    expect(d).not.toContain(NGAY_BIA);
  });

  it('ky=thang_truoc → trọn tháng 7 (01/07–31/07)', async () => {
    const o = fakeOdoo();
    await baoCaoLinhHoat({ odoo: o }, { ...CO_BAN, ky: 'thang_truoc', bayGio: BAY_GIO });
    const d = domainCuaLanGoi(o);
    expect(d).toContain('2026-07-01 00:00:00');
    expect(d).toContain('2026-07-31 23:59:59');
  });

  // KHÁC hai tool kia: không nêu kỳ ở đây nghĩa là "toàn bộ thời gian" — một
  // lựa chọn HỢP LỆ ("khách nào mua nhiều nhất từ trước tới nay"). Đừng ép về
  // hôm nay, sẽ đổi nghĩa câu hỏi.
  it('không ky, không ngày → TOÀN BỘ thời gian (không tự ép về hôm nay)', async () => {
    const o = fakeOdoo();
    const kq = await baoCaoLinhHoat({ odoo: o }, { ...CO_BAN, bayGio: BAY_GIO });
    expect(domainCuaLanGoi(o)).not.toContain('00:00:00');
    if (kq.trangThai === 'ok') expect(kq.moTa).toContain('toàn bộ thời gian');
  });

  it('schema có `ky`', () => {
    const p = baoCaoLinhHoatDefinition.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(p.ky?.enum).toContain('hom_nay');
  });
});
