// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: hai bug nổ cùng lúc tối 05/08/2026 khi nhân viên sửa đơn.
//
// Diễn biến thật:
//   20:56:46  bot: "Tôi đã ghi nhận đơn S13797 cho Anh Dương Tuấn Anh, 78.000đ"
//   20:57:02  NV : "10 cái mà"                    ← ý là SỬA đơn vừa rồi
//   20:57:06  bot: tao_don_nhap → tạo S13798 cho "chị thuấn", 780.000đ  ← BUG 1
//   20:57:11  bot: text RỖNG → sendMessage lỗi "Missing message content" ← BUG 2
//
// Bug 2 CHE bug 1: nhân viên chỉ thấy dòng báo lỗi, không hề biết Odoo vừa có
// thêm một đơn thừa. Test này khoá cả hai.
import { describe, it, expect } from 'vitest';
import { taoDonNhap } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { chanDonLienKeGiay } from '../../../src/modules/ai/agent/noi-zalo/cong-tac.js';

const CONV = 'conv-sua-don';
const SP = { id: 1039, name: 'Nguồn NB Ngoài Trời 12V100W', list_price: 78_000, active: true };

/**
 * Odoo giả. `donGan` = đơn vừa tạo trong hội thoại (đáp cho truy vấn thời gian).
 *
 * Thứ tự truy vấn của `taoDonNhap`: khoá chống trùng (`['id','=',...]` không có,
 * dùng client_order_ref '=') → đơn liền kề (có `create_date`) → product.product
 * → create → ĐỌC LẠI theo `['id','=',donId]` để xác nhận.
 */
function odooGia(opts: { donGan?: Array<Record<string, unknown>> } = {}) {
  const goi: Array<{ model: string; domain: unknown }> = [];
  let daTao = false;
  return {
    goi,
    odoo: {
      searchRead: async (model: string, domain: unknown) => {
        goi.push({ model, domain });
        if (model === 'product.product') return [SP];
        const d = JSON.stringify(domain);
        if (d.includes('create_date')) return opts.donGan ?? [];
        // Đọc lại sau create — nhận ra bằng việc lọc theo id.
        if (daTao && d.includes('"id"')) {
          return [{ id: 999, name: 'S99999', state: 'draft', amount_total: 780_000 }];
        }
        return []; // khoá chống trùng: chưa có đơn nào
      },
      execute: async () => { daTao = true; return 999; },
    },
  };
}

describe('chanDonLienKeGiay — công tắc', () => {
  it('mặc định 90 giây: người ta không lên hai đơn thật cách nhau ngần ấy', () => {
    delete process.env.AI_AGENT_CHAN_DON_LIEN_KE_GIAY;
    expect(chanDonLienKeGiay()).toBe(90);
  });

  it('đặt 0 để tắt hẳn hàng rào', () => {
    process.env.AI_AGENT_CHAN_DON_LIEN_KE_GIAY = '0';
    expect(chanDonLienKeGiay()).toBe(0);
    delete process.env.AI_AGENT_CHAN_DON_LIEN_KE_GIAY;
  });
});

describe('BUG 1 — sửa đơn KHÔNG được thành đơn mới', () => {
  it('có đơn vừa tạo trong hội thoại → TỪ CHỐI tạo đơn thứ hai, nêu rõ mã đơn cũ', async () => {
    const { odoo } = odooGia({
      donGan: [{ id: 26715, name: 'S13797', amount_total: 78_000, create_date: '2026-08-05 13:56:41' }],
    });

    const kq = await taoDonNhap(
      { odoo, conversationId: CONV, seq: 1, chanDonLienKeGiay: 90 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: SP.id, so_luong: 10 }] },
    );

    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai !== 'loi') return;
    expect(kq.lyDo, 'phải nêu mã đơn để nhân viên biết sửa cái nào').toContain('S13797');
    expect(kq.lyDo).toContain('SỬA');
  });

  it('KHÔNG có đơn gần đó → tạo bình thường, hàng rào không cản việc thật', async () => {
    const { odoo } = odooGia({ donGan: [] });

    const kq = await taoDonNhap(
      { odoo, conversationId: CONV, seq: 1, chanDonLienKeGiay: 90 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: SP.id, so_luong: 10 }] },
    );

    expect(kq.trangThai).toBe('da_tao');
  });

  it('tắt hàng rào (0) → KHÔNG truy vấn đơn liền kề, giữ nguyên hành vi cũ', async () => {
    const { odoo, goi } = odooGia({
      donGan: [{ id: 26715, name: 'S13797', amount_total: 78_000 }],
    });

    const kq = await taoDonNhap(
      { odoo, conversationId: CONV, seq: 1, chanDonLienKeGiay: 0 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: SP.id, so_luong: 10 }] },
    );

    expect(kq.trangThai).toBe('da_tao');
    expect(goi.some((g) => JSON.stringify(g.domain).includes('create_date'))).toBe(false);
  });

  it('lọc theo ĐÚNG hội thoại — đơn hội thoại khác không được chặn nhầm', async () => {
    const { odoo, goi } = odooGia({ donGan: [] });

    await taoDonNhap(
      { odoo, conversationId: CONV, seq: 1, chanDonLienKeGiay: 90 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: SP.id, so_luong: 1 }] },
    );

    const truyVan = goi.find((g) => JSON.stringify(g.domain).includes('create_date'));
    expect(JSON.stringify(truyVan?.domain)).toContain(`zalo:${CONV}:`);
  });
});
