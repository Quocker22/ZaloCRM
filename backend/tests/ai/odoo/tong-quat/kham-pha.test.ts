// SPDX-License-Identifier: AGPL-3.0-or-later
// kham_pha_odoo — bot tự hỏi Odoo "bảng này có cột gì" để làm được việc chưa
// ai khai trước. Đây là thứ trả lời câu "thao tác gì trên Odoo cũng làm được".
import { describe, it, expect, vi } from 'vitest';
import { khamPhaOdoo, khamPhaOdooDefinition, dinhDangKhamPha }
  from '../../../../src/modules/ai/odoo/tong-quat/kham-pha.js';

/** `rows` cho searchRead (tim_bang); `cot` cho fields_get (hoi=cot). */
const fake = (rows: unknown[], cot?: Record<string, { string: string; type: string }>) => ({
  searchRead: vi.fn(async () => rows),
  execute: vi.fn(async () => cot ?? rows),
});

describe('khamPhaOdoo', () => {
  // Dùng fields_get (method trên chính model) chứ KHÔNG đọc ir.model.fields:
  // bot_zalo không có quyền đọc bảng đó — bug thật 19:01 10/08 làm tool khám
  // phá vô dụng, bot mù và mò tới hết hạn 90s.
  it('hỏi cột → fields_get, BỎ cột cấm khỏi kết quả', async () => {
    const odoo = fake([], {
      list_price: { string: 'Giá bán', type: 'float' },
      standard_price: { string: 'Giá vốn', type: 'float' },
    });
    const kq = await khamPhaOdoo({ odoo } as never, { bang: 'product.product', hoi: 'cot' });
    const text = dinhDangKhamPha(kq);
    expect(text).toContain('list_price');
    expect(text).not.toContain('standard_price');
  });

  it('tìm bảng theo từ khoá', async () => {
    const odoo = fake([{ model: 'stock.picking', name: 'Transfer' }]);
    const kq = await khamPhaOdoo({ odoo } as never, { hoi: 'tim_bang', tu_khoa: 'kho' });
    expect(dinhDangKhamPha(kq)).toContain('stock.picking');
  });

  it('hỏi nút → gợi ý các method thường dùng, có kèm cảnh báo unlink', async () => {
    const odoo = fake([]);
    const kq = await khamPhaOdoo({ odoo } as never, { bang: 'sale.order', hoi: 'nut' });
    const text = dinhDangKhamPha(kq);
    expect(text).toContain('action_confirm');
    expect(text.toLowerCase()).toContain('xác nhận');
  });

  it('hỏi cột mà thiếu bảng → lỗi', async () => {
    const odoo = fake([]);
    expect((await khamPhaOdoo({ odoo } as never, { hoi: 'cot' })).trangThai).toBe('loi');
  });

  it('tên tool đúng', () => {
    expect(khamPhaOdooDefinition.name).toBe('kham_pha_odoo');
  });
});
