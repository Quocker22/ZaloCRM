// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: NỞ VIẾT TẮT BỎ NGUYÊN ÂM trong tra_san_pham.
//
// Ca thật 11:54 18/08, anh Quốc gửi transcript "cái gì thế này?": NV gõ
// "led zz thấu kính" — catalog lưu "Led dây ziczac thấu kính 12V-30D" 75.000đ —
// mà bot đưa ra 3 SP "Led F30 ... ATX Đầu Đục" sai hẳn mặt hàng. Anh Ánh:
// "ko chuẩn rồi"; anh Quyết: "sai mã hàng rồi".
//
// Anh Quốc chốt hướng sửa (18/08): "sao lại bảng alias???? tôi tưởng AI nó
// phải biết chứ" — nên KHÔNG khai từ điển tay. Test này khoá đúng hai điều:
//   1. Luật SUY RA viết tắt đúng, và không bắt bừa.
//   2. Kết quả nở-tắt KHÔNG bị nhánh nới-OR đè lên bằng hàng vơ bừa.
import { describe, it, expect, vi } from 'vitest';
import {
  traSanPham, laVietTatCua, doanTuDayDu, laTenChungBienThe,
} from '../../../src/modules/ai/odoo/tools/tra-san-pham.js';

/** Odoo giả hiểu ilike trên `name`, điều kiện giá, và prefix-OR ('|'). */
function odooGia(rows: Record<string, unknown>[]) {
  const bo = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd').toLowerCase();
  // Đánh giá domain prefix-notation ĐÚNG CÁCH: đọc đệ quy, '&'/'|' là toán tử
  // nhị phân đứng TRƯỚC hai vế. Bản ghép-tay trước đó bỏ qua '&' nên đọc sai
  // domain thật của tool (["|","&","&",...]) — test đỏ oan trong khi đo trên
  // Odoo prod cùng câu thì đúng.
  const la = (d: unknown): ((x: Record<string, unknown>) => boolean) => {
    const [f, op, v] = d as [string, string, unknown];
    return (x: Record<string, unknown>): boolean => {
      if (f === 'list_price') {
        const g = Number(x.list_price ?? 0);
        return op === '>' ? g > Number(v) : g <= Number(v);
      }
      if (f === 'name' || f === 'default_code') {
        // So CÙNG MỘT HỆ DẤU. Tool gửi mẫu CÓ dấu khi NV gõ có dấu ("ấm"), và
        // mẫu KHÔNG dấu (kèm '_' đại diện) ở các nhánh nới. Bỏ dấu một bên mà
        // giữ dấu bên kia là fake tự tạo ra lỗi không có thật.
        const mau = bo(String(v)).replace(/[.*+?^${}()[\]\\]/g, '\\$&')
          .replace(/_/g, '.').replace(/%/g, '.*');
        return new RegExp(mau, 'i').test(bo(String(x[f] ?? '')));
      }
      return true; // sale_ok / active / product_tmpl_id.active
    };
  };
  const danhGia = (dom: unknown[], r: Record<string, unknown>): boolean => {
    let i = 0;
    const doc = (): ((x: Record<string, unknown>) => boolean) => {
      const t = dom[i]; i += 1;
      if (t === '&') { const a = doc(); const b = doc(); return (x) => a(x) && b(x); }
      if (t === '|') { const a = doc(); const b = doc(); return (x) => a(x) || b(x); }
      return la(t);
    };
    // Odoo nối các mệnh đề còn lại bằng AND ngầm.
    const ves: Array<(x: Record<string, unknown>) => boolean> = [];
    while (i < dom.length) ves.push(doc());
    return ves.every((f) => f(r));
  };
  return {
    searchRead: vi.fn(async (
      _m: string, domain: unknown[], _f: string[], opts: { limit?: number } = {},
    ) => {
      const khop = rows.filter((r) => danhGia(domain, r));
      return opts.limit === undefined ? khop : khop.slice(0, opts.limit);
    }),
  };
}

const KHO = [
  { id: 2017, name: 'Led dây ziczac thấu kính 12V-30D màu Trung tính 4500K', default_code: null, list_price: 75000, uom_id: [1, 'Cuộn'] },
  { id: 2013, name: 'Led dây ziczac thấu kính 12V-30D màu Trắng 11000K', default_code: null, list_price: 75000, uom_id: [1, 'Cuộn'] },
  { id: 2014, name: 'Led dây zichzac thấu kính 12V-30D màu Vàng Nắng 3000K', default_code: null, list_price: 75000, uom_id: [1, 'Cuộn'] },
  // Đám "khớp chữ rời" từng chiếm chỗ của hàng đúng hôm 11:54.
  { id: 886, name: 'Led F30 24V Màu Ấm ATX Đầu Đục (bóng)', default_code: 'F30ATX24V - WW - DD', list_price: 4300, uom_id: [2, 'Bóng'] },
  { id: 881, name: 'Led F30 24V Màu Trắng ATX Đầu Trong (bóng)', default_code: 'F30ATX24V W', list_price: 3500, uom_id: [2, 'Bóng'] },
];

describe('nở viết tắt bỏ nguyên âm', () => {
  it('suy được zz→ziczac, cb→cob; không bắt bừa', () => {
    expect(laVietTatCua('zz', 'ziczac')).toBe(true);
    expect(laVietTatCua('cb', 'cob')).toBe(true);
    // Có nguyên âm / có số / chứa nguyên chuỗi → không phải việc của tầng này.
    expect(laVietTatCua('am', 'nam')).toBe(false);
    expect(laVietTatCua('p10', 'p100')).toBe(false);
    expect(laVietTatCua('zic', 'ziczac')).toBe(false);
    // Chữ đầu khác nhau thì không bao giờ là viết tắt.
    expect(laVietTatCua('zz', 'xanhzz')).toBe(false);
  });

  it('lấy TỪ VỰNG THẬT của catalog, không phải bảng khai tay', () => {
    const doan = doanTuDayDu('zz', KHO.map((r) => String(r.name)));
    expect(doan).toContain('ziczac');
    expect(doan).toContain('zichzac');
    // Từ không có trong catalog thì không bịa ra.
    expect(doanTuDayDu('hlg', KHO.map((r) => String(r.name)))).toEqual([]);
  });

  it('ca thật 11:54: "led zz thấu kính" ra ĐÚNG hàng ziczac 75.000đ', async () => {
    const odoo = odooGia(KHO);
    const kq = await traSanPham({ odoo }, { ten: 'led zz thấu kính', gioi_han: 5 });
    expect(kq.length).toBeGreaterThanOrEqual(2);
    for (const sp of kq) {
      expect(sp.ten.toLowerCase()).toMatch(/zic[hz]?zac/);
      expect(sp.gia).toBe(75000);
    }
    // Đúng thứ đã làm NV bực: không được có Led F30 nào lọt vào.
    expect(kq.some((sp) => /F30/i.test(sp.ten))).toBe(false);
  });

  it('BẮT CẢ HAI cách viết trong catalog (ziczac lẫn zichzac)', async () => {
    const odoo = odooGia(KHO);
    const kq = await traSanPham({ odoo }, { ten: 'zz thấu kính', gioi_han: 5 });
    const ids = kq.map((s) => s.id).sort();
    expect(ids).toEqual([2013, 2014, 2017]);
  });

  it('hàng nở-tắt là hàng ĐOÁN → đánh dấu để máy gom đơn HỎI, không tự chốt', async () => {
    const odoo = odooGia(KHO);
    const kq = await traSanPham({ odoo }, { ten: 'led zz thấu kính', gioi_han: 5 });
    expect((kq as { daNoiRong?: boolean }).daNoiRong).toBe(true);
  });

  it('không đụng vào câu tra bình thường (SP khớp thẳng vẫn ra như cũ)', async () => {
    // Đo trên Odoo PROD 18/08 cùng câu này: n=3, daNoiRong=false — tầng nở-tắt
    // không xen vào khi đường AND đã khớp thẳng. Ở đây dùng tên đúng nguyên văn
    // để fake Odoo (chỉ hiểu ilike/OR, không có toàn bộ luật Odoo thật) đo được
    // đúng ý đó mà không phụ thuộc mạng.
    const odoo = odooGia(KHO);
    const kq = await traSanPham({ odoo }, { ten: 'Led F30 24V Màu Ấm ATX Đầu Đục', gioi_han: 3 });
    expect(kq[0]?.id).toBe(886);
    expect((kq as { daNoiRong?: boolean }).daNoiRong).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CA THẬT 12:33→12:38 18/08 — hậu quả NGAY SAU bản vá nở-viết-tắt.
//
// Tra đã đúng (3 màu ziczac), nhưng NV bấm "a" thì hệ HỌC alias
// "led zz thau kinh" → màu Trung tính 4500K. Một phút sau ở nhóm khác, cùng
// câu đó: log ghi '[alias học được]' → bot KHÔNG hỏi màu nữa, tự lên đơn
// S14759 màu Trung tính. 12:38 anh Ánh phải sửa: "led dây ziczac thấu kính
// 12V-30D màu trắng 11000k … Sửa lại nhé".
//
// "led zz thấu kính" là TÊN CHUNG của cả ba màu. Bấm "a" là chọn CHO LẦN NÀY,
// không phải dạy máy một luật vĩnh viễn. Cùng họ lỗi với alias sai màu ca
// 06:05 13/08 (S13848, 3000 cái sai màu) — chỉ khác là lần này tự đẻ ra.
// ═══════════════════════════════════════════════════════════════════════════
describe('laTenChungBienThe — chặn học alias cho tên gọi chung', () => {
  it('3 SP chỉ khác MÀU/NHIỆT ĐỘ → là tên chung, KHÔNG được học', () => {
    expect(laTenChungBienThe([
      { ten: 'Led dây ziczac thấu kính 12V-30D màu Trung tính 4500K' },
      { ten: 'Led dây ziczac thấu kính 12V-30D màu Trắng 11000K' },
      { ten: 'Led dây ziczac thấu kính 12V-30D màu Vàng Nắng 3000K' },
    ])).toBe(true);
  });

  it('hai MẶT HÀNG khác nhau thật → tên gọi tắt vẫn đáng học như cũ', () => {
    // Giữ nguyên hành vi P1.3: "led hắt 6313" → "3 Bóng Saso 6313" là tri thức
    // thật của NV, chặn ở đây là làm hỏng tính năng học alias.
    expect(laTenChungBienThe([
      { ten: 'Led 3 Bóng 6313 12V Trắng Saso' },
      { ten: 'Led 4 bóng 6313 ngoài trời' },
    ])).toBe(false);
    expect(laTenChungBienThe([
      { ten: 'Nguồn ATX Trong Nhà 12V400W Pro' },
      { ten: 'Nguồn NB Ngoài Trời 12V400W' },
    ])).toBe(false);
  });

  it('một ứng viên thì không có gì để so → không chặn', () => {
    expect(laTenChungBienThe([{ ten: 'Led dây ziczac thấu kính 12V-30D màu Trắng 11000K' }]))
      .toBe(false);
  });
});
