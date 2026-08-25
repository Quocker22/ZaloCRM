// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 13:58 25/08: "@Tiểu Mã Nelia cho cattalog K6P" → bot "chưa có tài
// liệu" dù K6P.pdf NẰM TRONG KHO. Tên file cụt (K6P/Y2/a6) chấm điểm token
// chỉ được 1 — dưới ngưỡng; "catalog" lại là stopword. Tầng token-nguyên-mã
// (đã vá cho kemFileTriThuc) giờ áp cho chính guiTaiLieu.
import { describe, it, expect } from 'vitest';
import { guiTaiLieu, type TaiLieu } from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';

const KHO: TaiLieu[] = [
  { tieuDe: 'K6P.pdf', duongDan: 'http://x/k6p.pdf', kichThuoc: 100 },
  { tieuDe: 'k6.pdf', duongDan: 'http://x/k6.pdf', kichThuoc: 100 },
  { tieuDe: 'K10P.pdf', duongDan: 'http://x/k10p.pdf', kichThuoc: 100 },
  { tieuDe: 'Bóng LED F8 Full IC 1908.pdf', duongDan: 'http://x/f8.pdf', kichThuoc: 100 },
];
const deps = { liet: async () => KHO, taiVe: async (t: TaiLieu) => `/tmp/${t.tieuDe}` };

describe('guiTaiLieu — tên file cụt khớp nguyên token', () => {
  it('ca thật: "cho cattalog K6P" → gửi ĐÚNG K6P.pdf, không dính k6.pdf', async () => {
    const kq = await guiTaiLieu(deps, { yeu_cau: 'cho cattalog K6P' });
    expect(kq.loai).toBe('da_gui');
    if (kq.loai === 'da_gui') expect(kq.taiLieu.tieuDe).toBe('K6P.pdf');
  });

  it('"gửi tài liệu k6" → gửi k6.pdf (token "k6" không ăn theo K6P)', async () => {
    const kq = await guiTaiLieu(deps, { yeu_cau: 'gửi tài liệu k6' });
    expect(kq.loai).toBe('da_gui');
    if (kq.loai === 'da_gui') expect(kq.taiLieu.tieuDe).toBe('k6.pdf');
  });

  it('xin chung chung không nêu mã → vẫn liệt kê như cũ, không gửi bừa', async () => {
    const kq = await guiTaiLieu(deps, { yeu_cau: 'gửi cho anh tài liệu catalog' });
    expect(kq.loai).toBe('nhieu_ket_qua');
  });
});
