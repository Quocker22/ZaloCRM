// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng thử lại sự cố máy in (docs/78 Codex v1 #2) — hàm thuần, không DB: DB lỗi ⇒ giữ mục (giờ GỐC), xả theo thứ tự khi
// DB sống lại, trần hàng bỏ mục cũ nhất, `khong_luu` (không xác định org) không giữ lại.
import { describe, it, expect } from 'vitest';
import { taoHangThuLaiSuCo, type SuCoIn } from '../src/modules/ai/may-in/su-kien-in.js';

describe('taoHangThuLaiSuCo', () => {
  it('loi_db ⇒ giữ lại kèm giờ gốc; lần ghi thành công sau đó xả hàng THEO THỨ TỰ', async () => {
    let hong = true;
    const ghi: SuCoIn[] = [];
    const goc = new Date('2026-10-02T01:00:00Z');
    const h = taoHangThuLaiSuCo({
      ghi: async (sc) => { if (hong) return 'loi_db'; ghi.push(sc); return 'da_luu'; },
      msNhip: 60_000, bayGio: () => goc,
    });
    expect(await h.ghi({ maSuCo: 'het_giay' })).toBe('loi_db');
    expect(await h.ghi({ maSuCo: 'tam_giu', maGoc: 'het_giay' })).toBe('loi_db');
    expect(h.soCho()).toBe(2);
    hong = false;
    expect(await h.ghi({ maSuCo: 'tiep_tuc_in', maGoc: 'het_giay' })).toBe('da_luu');
    await h.xa();
    expect(h.soCho()).toBe(0);
    expect(ghi.map((s) => s.maSuCo)).toEqual(['tiep_tuc_in', 'het_giay', 'tam_giu']);
    expect(ghi[1].luc).toEqual(goc); // dòng ghi bù mang giờ GỐC
    expect(ghi[0].luc).toBeUndefined(); // ghi được ngay ⇒ để DB đặt giờ
    h.dung();
  });

  it('tự xả theo nhịp; trần hàng bỏ mục CŨ NHẤT; khong_luu / trung không giữ', async () => {
    let hong = true;
    const ghi: string[] = [];
    const h = taoHangThuLaiSuCo({
      ghi: async (sc) => {
        if (sc.maSuCo === 'x_khong_org') return 'khong_luu';
        if (hong) return 'loi_db';
        ghi.push(sc.maSuCo);
        return 'trung';
      },
      msNhip: 20, tran: 2,
    });
    await h.ghi({ maSuCo: 'a' });
    await h.ghi({ maSuCo: 'b' });
    await h.ghi({ maSuCo: 'c' }); // đầy ⇒ bỏ 'a'
    expect(await h.ghi({ maSuCo: 'x_khong_org' })).toBe('khong_luu');
    expect(h.soCho()).toBe(2);
    hong = false;
    await new Promise((r) => setTimeout(r, 80));
    expect(ghi).toEqual(['b', 'c']);
    expect(h.soCho()).toBe(0);
    h.dung();
  });

  it('người ghi NÉM ⇒ coi như loi_db (không bao giờ ném ra ngoài)', async () => {
    const h = taoHangThuLaiSuCo({ ghi: async () => { throw new Error('chập'); }, msNhip: 60_000 });
    expect(await h.ghi({ maSuCo: 'het_giay' })).toBe('loi_db');
    expect(h.soCho()).toBe(1);
    h.dung();
  });
});
