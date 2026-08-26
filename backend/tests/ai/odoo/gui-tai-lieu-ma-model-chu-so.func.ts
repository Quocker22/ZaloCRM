// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 10:30 26/08: NV "@bot cho cattalog bx y3" → bot hỏi "BX-Y3 hay
// BX-Y3E?". Anh Quốc: "bx y3 thì nó là BX-Y3, cái BX-Y3E thì liên quan gì".
// Nguyên nhân: `laMaModel` chỉ biết mã kiểu P4/P10/3840hz — "y3" bị chấm
// như chữ thường (1 điểm), nên bx-y3 = 2 điểm mà 7 file BX khác đều 1 điểm
// → cách nhau 1 < CACH_BIET → tool đẩy cả 8 file ra bắt hỏi lại.
// Luật suy ra (không khai bảng): token TRỘN CHỮ + SỐ là mã model; khớp
// NGUYÊN mã ở một file thì file khác chỉ chứa mã đó một phần (y3 ⊂ y3e)
// KHÔNG được ăn điểm phần — người đã nêu đúng mã, đừng lôi họ hàng ra hỏi.
import { describe, it, expect } from 'vitest';
import { guiTaiLieu, type TaiLieu } from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';

// Đúng 8 file tool trả ra lúc 10:30:11 26/08 trên prod.
const KHO: TaiLieu[] = [
  'thông số kỹ thuật bộ xử lý bx-y3.pdf',
  'thông số kỹ thuật bộ xử lý bx-y3e.pdf',
  'thông số kỹ thuật bộ xử lý bx-y2l.pdf',
  'BX-C08 Specification.pdf',
  'Hộp Đựng Card BX.pdf',
  'BX-C04 Specification.pdf',
  'BX-C2 Specification.pdf',
  'BX-C1 Specification.pdf',
].map((tieuDe, i) => ({ tieuDe, duongDan: `http://x/${i}.pdf`, kichThuoc: 1000 }));

const deps = { liet: async () => KHO, taiVe: async (t: TaiLieu) => `/tmp/${t.tieuDe}` };

async function fileGui(yeu_cau: string): Promise<string | null> {
  const kq = await guiTaiLieu(deps, { yeu_cau });
  return kq.loai === 'da_gui' ? kq.taiLieu.tieuDe : null;
}

describe('guiTaiLieu — mã model trộn chữ+số (bx y3 / y3e / c08)', () => {
  it('ca thật: model gọi "catalog BX Y3" → gửi ĐÚNG bx-y3, không hỏi', async () => {
    expect(await fileGui('catalog BX Y3')).toBe('thông số kỹ thuật bộ xử lý bx-y3.pdf');
  });

  it('nguyên văn NV "cho cattalog bx y3" cũng ra bx-y3', async () => {
    expect(await fileGui('cho cattalog bx y3')).toBe('thông số kỹ thuật bộ xử lý bx-y3.pdf');
  });

  it('phản chứng: xin "bx y3e" → ra y3e, bx-y3 không ăn theo', async () => {
    expect(await fileGui('gửi catalog bx y3e')).toBe('thông số kỹ thuật bộ xử lý bx-y3e.pdf');
  });

  it('mã C-series: "cho catalog bx c08" → BX-C08', async () => {
    expect(await fileGui('cho catalog bx c08')).toBe('BX-C08 Specification.pdf');
  });

  it('phản chứng: chỉ nói "bx" (8 file đều BX) → KHÔNG được tự gửi bừa một file', async () => {
    const kq = await guiTaiLieu(deps, { yeu_cau: 'cho catalog bx' });
    expect(kq.loai).not.toBe('da_gui');
  });
});
