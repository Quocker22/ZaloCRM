// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: sua_vat — thêm/đổi/bỏ VAT cho đơn ĐÃ LÊN.
//
// ═══════════════════════════════════════════════════════════════════════════
// CA THẬT HỎNG (nhóm Test-AI, 20:38→20:41 ngày 11/08/2026)
//
//   20:38:02  Bot: "Đã lên đơn nháp S13829 ... tổng 45.000.000đ"
//   20:38:18  NV : "@bot sửa lại thêm VAT 8%"
//   20:38:23  Bot: hỏi "cộng thêm 8% vào tổng hay sửa giá các dòng hàng?"
//   20:38:40  NV : "đúng rồi"
//   20:39:47  Bot: hỏi lại y hệt
//   20:40:17  NV : "@bot đúng rồi xuất đi"
//   20:40:27  Bot: "...NHÂN GIÁ LÊN 1.08 hay chỉ cộng vào dòng nào cụ thể ạ?"
//   20:41:00  NV : "@bot cộng thẳng vào đơn nhé"
//   20:41:05  Bot: hỏi vòng thứ TƯ
//
//   Anh Quốc: "hiện tại cái thêm VAT đang không được này hỏi vòng quanh hoài à"
//
// CHẨN ĐOÁN: đơn S13829 đã lên rồi → máy gom đơn (`gom-don`) không còn cầm lái
// (log không có dòng `nhanh: 'gom-don'` nào), câu rơi vào agent tự do. Agent có
// `sua_chiet_khau` cho chiết khấu nên chiết khấu làm được ngay (20:41:56 "Đã áp
// chiết khấu 10% cho đơn S13829") — nhưng VAT KHÔNG có tool tương đương.
// `sua_don` nhận `thue_id` nhưng đó là tool sửa DÒNG HÀNG: model phải dựng cả
// danh sách dòng mới gọi được, nó không biết làm nên hỏi vòng quanh.
//
// NGUY HIỂM: model tự đề nghị "nhân giá lên 1.08". Sai hoàn toàn — Odoo sẽ ghi
// giá bán 237.600đ thay vì 220.000đ (sai giá đã chốt với khách), hoá đơn sai, mà
// `amount_tax` vẫn = 0. VAT phải vào `tax_id`, KHÔNG nhét vào giá.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import {
  suaVat, dinhDangVat, suaVatDefinition,
} from '../../../src/modules/ai/odoo/tools/sua-vat.js';
import { xoaCacheThue } from '../../../src/modules/ai/odoo/tools/tra-thue.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import { TOOL_GHI } from '../../../src/modules/ai/agent/y-dinh-dung.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

/** Đơn thật của ca hỏng: S13829, id 26746, tổng 45.000.000đ, chưa có thuế. */
const S13829 = {
  id: 26746, name: 'S13829', state: 'draft',
  amount_untaxed: 45000000, amount_tax: 0, amount_total: 45000000,
  partner_id: [1879, 'Anh Tuấn Đà Nẵng'],
};

/**
 * Danh mục thuế BÁN thật đo trên prod LEDNELIA VN 11/08/2026:
 *   id=3 "VAT 4%", id=4 "VAT 8%", id=5 "VAT 10%", id=6 "0%". KHÔNG có 5%.
 */
const THUE_PROD = [
  { id: 3, name: 'VAT 4%', amount: 4 },
  { id: 4, name: 'VAT 8%', amount: 8 },
  { id: 5, name: 'VAT 10%', amount: 10 },
];

/** 2 dòng hàng thật: 200 cái × 220.000đ + 1 dòng tặng 0đ. */
const DONG = [
  { id: 501, price_unit: 220000, product_uom_qty: 200, tax_id: [] },
  { id: 502, price_unit: 0, product_uom_qty: 1, tax_id: [] },
];

/**
 * Odoo giả. `sauGhi` = giá trị sale.order trả về SAU khi đã có lệnh write —
 * dùng để kiểm "đọc lại từ Odoo" chứ không tự tính.
 */
function fake(opts: {
  don?: unknown[];
  dong?: unknown[];
  thue?: unknown[];
  sauGhi?: unknown[];
}) {
  let daGhi = false;
  return {
    searchRead: vi.fn(async (model: string) => {
      if (model === 'sale.order') {
        return daGhi && opts.sauGhi ? opts.sauGhi : (opts.don ?? [S13829]);
      }
      if (model === 'sale.order.line') return opts.dong ?? DONG;
      if (model === 'account.tax') {
        // Bắt chước filter theo `amount` của traThueBan.
        return opts.thue ?? THUE_PROD;
      }
      return [];
    }),
    execute: vi.fn(async () => { daGhi = true; return true; }),
  };
}

/** Odoo giả tra thuế ĐÚNG luật (lọc theo amount trong domain). */
function fakeThueThat(opts: { don?: unknown[]; dong?: unknown[]; sauGhi?: unknown[] } = {}) {
  let daGhi = false;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'sale.order') {
        return daGhi && opts.sauGhi ? opts.sauGhi : (opts.don ?? [S13829]);
      }
      if (model === 'sale.order.line') return opts.dong ?? DONG;
      if (model === 'account.tax') {
        const dk = (domain as Array<[string, string, unknown]>).find((d) => d[0] === 'amount');
        const pt = Number(dk?.[2]);
        return THUE_PROD.filter((t) => t.amount === pt);
      }
      return [];
    }),
    execute: vi.fn(async () => { daGhi = true; return true; }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — TÁI HIỆN ca hỏng 20:38 11/08: "sửa lại thêm VAT 8%" cho S13829', () => {
  it('câu thật "sửa lại thêm VAT 8%" → gắn VAT 8% vào đơn, KHÔNG hỏi lại', async () => {
    xoaCacheThue();
    const o = fakeThueThat({
      sauGhi: [{
        id: 26746, name: 'S13829', state: 'draft',
        amount_untaxed: 45000000, amount_tax: 3600000, amount_total: 48600000,
      }],
    });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    expect(kq.ok).toBe(true);
    expect(kq.maDon).toBe('S13829');
    expect(kq.thueId).toBe(4);          // id thuế TRA ĐỘNG, không hard-code
    expect(kq.phanTram).toBe(8);
    // Số THẬT Odoo trả về, không phải 45.000.000 × 1,08 tự tính.
    expect(kq.tienHang).toBe(45000000);
    expect(kq.tienThue).toBe(3600000);
    expect(kq.tongSau).toBe(48600000);
  });

  it('gắn tax_id đúng lệnh Odoo (6,0,[id]) cho MỌI dòng, KHÔNG đụng price_unit', async () => {
    xoaCacheThue();
    const o = fakeThueThat({});

    await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    const ghi = o.execute.mock.calls.filter((c) => c[0] === 'sale.order.line' && c[1] === 'write');
    expect(ghi.length).toBe(1);
    const [ids, vals] = ghi[0][2] as [number[], Record<string, unknown>];
    expect(ids.sort()).toEqual([501, 502]);           // CẢ dòng tặng 0đ
    expect(vals.tax_id).toEqual([[6, 0, [4]]]);
    // ĐÂY LÀ HÀNG RÀO CHỐNG CA 20:40:27 — model đòi "nhân giá lên 1.08".
    expect(vals).not.toHaveProperty('price_unit');
    expect(vals).not.toHaveProperty('discount');
  });

  it('câu trả lời cho nhân viên nêu ĐỦ tiền hàng + thuế + tổng', async () => {
    xoaCacheThue();
    const o = fakeThueThat({
      sauGhi: [{
        id: 26746, name: 'S13829', state: 'draft',
        amount_untaxed: 45000000, amount_tax: 3600000, amount_total: 48600000,
      }],
    });

    const s = dinhDangVat(await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 }));

    expect(s).toContain('S13829');
    expect(s).toContain('VAT 8%');
    expect(s).toContain('45.000.000đ');
    expect(s).toContain('3.600.000đ');
    expect(s).toContain('48.600.000đ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — KHÔNG bao giờ đụng giá (chống "nhân giá lên 1.08")', () => {
  it('đơn giá dòng hàng giữ NGUYÊN sau khi gắn thuế', async () => {
    xoaCacheThue();
    const o = fakeThueThat({});

    await suaVat({ odoo: o }, { don_id: 26746, phan_tram: 10 });

    for (const c of o.execute.mock.calls) {
      const vals = (c[2] as unknown[])[1] as Record<string, unknown> | undefined;
      if (vals && typeof vals === 'object') {
        expect(Object.keys(vals)).toEqual(['tax_id']);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — BỎ VAT', () => {
  it('phan_tram=0 → gỡ hết thuế bằng lệnh (6,0,[])', async () => {
    xoaCacheThue();
    const o = fakeThueThat({
      dong: [{ id: 501, price_unit: 220000, tax_id: [4] }],
      sauGhi: [{
        id: 26746, name: 'S13829', state: 'draft',
        amount_untaxed: 45000000, amount_tax: 0, amount_total: 45000000,
      }],
    });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 0 });

    expect(kq.ok).toBe(true);
    expect(kq.boThue).toBe(true);
    const ghi = o.execute.mock.calls.find((c) => c[1] === 'write');
    expect((ghi?.[2] as [number[], Record<string, unknown>])[1].tax_id).toEqual([[6, 0, []]]);
    expect(kq.tienThue).toBe(0);
  });

  it('câu trả lời nói rõ ĐÃ BỎ, không nói "đã thêm"', async () => {
    xoaCacheThue();
    const o = fakeThueThat({
      sauGhi: [{
        id: 26746, name: 'S13829', state: 'draft',
        amount_untaxed: 45000000, amount_tax: 0, amount_total: 45000000,
      }],
    });

    const s = dinhDangVat(await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 0 }));

    expect(s).toMatch(/[Bb]ỏ VAT|gỡ VAT/);
    expect(s).toContain('45.000.000đ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — BÁO RÕ khi không làm được (đừng im lặng)', () => {
  it('đơn không tồn tại → nói thẳng không tìm thấy', async () => {
    xoaCacheThue();
    const o = fakeThueThat({ don: [] });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S99999', phan_tram: 8 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('Không tìm thấy');
    expect(o.execute).not.toHaveBeenCalled();
    expect(dinhDangVat(kq)).toContain('ĐỪNG nói');
  });

  it('mức thuế KHÔNG có trong Odoo (VAT 5%) → báo rõ, KHÔNG ghi bừa', async () => {
    // Prod chỉ có 4/8/10%. Im lặng lên đơn không thuế là sai sổ sách mà nhân
    // viên tưởng đã có VAT — phát hiện thì hoá đơn đã xuất mất rồi.
    xoaCacheThue();
    const o = fakeThueThat({});

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 5 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('5%');
    expect(o.execute).not.toHaveBeenCalled();
    const s = dinhDangVat(kq);
    expect(s).toContain('ĐỪNG nói');
  });

  it('đơn ĐÃ XÁC NHẬN → từ chối (ranh giới kế toán, giống sua_chiet_khau)', async () => {
    xoaCacheThue();
    const o = fakeThueThat({ don: [{ ...S13829, state: 'sale' }] });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('đã xác nhận');
    expect(o.execute).not.toHaveBeenCalled();
  });

  it('đơn ĐÃ HUỶ → từ chối', async () => {
    xoaCacheThue();
    const o = fakeThueThat({ don: [{ ...S13829, state: 'cancel' }] });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('đã huỷ');
  });

  it('đơn chưa có dòng hàng → báo rõ', async () => {
    xoaCacheThue();
    const o = fakeThueThat({ dong: [] });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('dòng hàng');
    expect(o.execute).not.toHaveBeenCalled();
  });

  it('phần trăm rác (âm, > 100, NaN) → chặn TRƯỚC khi chạm Odoo', async () => {
    xoaCacheThue();
    for (const pt of [-5, 150, Number.NaN]) {
      const o = fakeThueThat({});
      const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: pt });
      expect(kq.ok).toBe(false);
      expect(o.execute).not.toHaveBeenCalled();
    }
  });

  it('thiếu cả don_id lẫn ma_don → báo cần mã đơn, không đoán bừa', async () => {
    xoaCacheThue();
    const o = fakeThueThat({ don: [] });

    const kq = await suaVat({ odoo: o }, { phan_tram: 8 });

    expect(kq.ok).toBe(false);
    expect(o.execute).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — số liệu ĐỌC LẠI từ Odoo, không tự tính', () => {
  it('lấy amount_untaxed/amount_tax/amount_total Odoo trả về, kể cả khi lệch phép nhân', async () => {
    // Odoo trả tổng "lạ" (làm tròn, thuế lồng nhau...). Tool phải báo ĐÚNG số
    // Odoo trả, không sửa lại theo 45.000.000 × 1,08.
    // Bài học 11/08: tool công nợ tự tính tổng rời khỏi danh sách nên báo
    // 3,99tr trong khi thật 144tr.
    xoaCacheThue();
    const o = fakeThueThat({
      sauGhi: [{
        id: 26746, name: 'S13829', state: 'draft',
        amount_untaxed: 45000000, amount_tax: 3599999, amount_total: 48599999,
      }],
    });

    const kq = await suaVat({ odoo: o }, { ma_don: 'S13829', phan_tram: 8 });

    expect(kq.tienThue).toBe(3599999);
    expect(kq.tongSau).toBe(48599999);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — RANH GIỚI: luồng KHÁCH không có tool này', () => {
  it('registry khách KHÔNG chứa sua_vat', () => {
    // Khách điều khiển được câu chữ thì điều khiển được thuế → sai sổ sách.
    const r = buildCustomerRegistry({
      odoo: { searchRead: vi.fn(), execute: vi.fn() } as unknown as OdooClient,
      ghiNhanChuyenSale: async () => {},
    });

    expect(r.definitions().map((d) => d.name)).not.toContain('sua_vat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('sua_vat — định nghĩa tool', () => {
  it('đánh dấu mutates (là tool GHI)', () => {
    expect(suaVatDefinition.mutates).toBe(true);
  });

  it('nằm trong TOOL_GHI để hàng rào "thôi/dừng" chặn được', () => {
    expect(TOOL_GHI).toContain('sua_vat');
  });

  it('mô tả CHÉP NGUYÊN VĂN câu thật của nhân viên (bài học canh_bao_ton_kho)', () => {
    // canh_bao_ton_kho có sẵn mà model không biết dùng → bot đáp "em không có
    // công cụ". Mô tả phải nói thẳng điều kiện kích hoạt.
    const d = suaVatDefinition.description;
    expect(d).toContain('GỌI KHI');
    expect(d).toContain('sửa lại thêm VAT 8%');
    expect(d).toContain('hoá đơn đỏ');
    expect(d).toContain('xuất VAT');
  });

  it('mô tả CẤM nhân giá — chặn ca 20:40:27', () => {
    expect(suaVatDefinition.description).toMatch(/KHÔNG.*nhân giá|nhân giá.*KHÔNG/s);
  });

  it('nhận cả don_id, ma_don và phan_tram', () => {
    const p = suaVatDefinition.inputSchema.properties as Record<string, unknown>;
    expect(p).toHaveProperty('don_id');
    expect(p).toHaveProperty('ma_don');
    expect(p).toHaveProperty('phan_tram');
    expect(suaVatDefinition.inputSchema.required).toContain('phan_tram');
  });
});
