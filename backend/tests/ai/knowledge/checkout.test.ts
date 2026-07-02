// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { crc16, generateVietQrPayload } from '../../../src/modules/ai/knowledge/vietqr.js';
import { resolveOrder, parsePriceFromChunk, formatVnd } from '../../../src/modules/ai/knowledge/order-checkout.js';

describe('vietqr (port subiz)', () => {
  it('generateVietQrPayload khớp CHÍNH XÁC ví dụ subiz', () => {
    const got = generateVietQrPayload({ bankBin: '970415', accountNo: '0011001932418', amount: 120000, description: 'ủng hộ lũ lụt' });
    expect(got).toBe('00020101021238570010A00000072701270006970415011300110019324180208QRIBFTTA530370454061200005802VN62170813ung ho lu lut6304C15C');
  });
  it('crc16 CCITT đúng (4 ký tự hex hoa)', () => {
    const c = crc16('test6304');
    expect(c).toMatch(/^[0-9A-F]{4}$/);
  });
  it('không description vẫn ra payload hợp lệ + CRC 4 ký tự cuối', () => {
    const p = generateVietQrPayload({ bankBin: '970436', accountNo: '123456789', amount: 50000 });
    expect(p.startsWith('000201')).toBe(true);
    expect(p.slice(-8, -4)).toBe('6304');
    expect(p.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe('order-checkout', () => {
  it('parsePriceFromChunk: có giá → số; chưa có → null', () => {
    expect(parsePriceFromChunk('Tên sản phẩm: X\nGiá bán: 4.800đ')).toBe(4800);
    expect(parsePriceFromChunk('Giá bán: 425.000đ')).toBe(425000);
    expect(parsePriceFromChunk('Giá bán: chưa có trong dữ liệu')).toBeNull();
    expect(parsePriceFromChunk('không có giá')).toBeNull();
  });

  const kb = async (q: string) => {
    // mock: 'led A' có giá 100.000đ, 'nguồn B' có giá 200.000đ, 'món C' chưa có giá
    if (/led a/i.test(q)) return [{ content: 'Tên sản phẩm: Led A\nGiá bán: 100.000đ' }];
    if (/nguồn b/i.test(q)) return [{ content: 'Tên sản phẩm: Nguồn B\nGiá bán: 200.000đ' }];
    return [{ content: 'Tên sản phẩm: Món C\nGiá bán: chưa có trong dữ liệu' }];
  };

  it('resolveOrder: đủ giá → tổng đúng (code tính qty×price)', async () => {
    const r = await resolveOrder([{ name: 'led A', qty: 3 }, { name: 'nguồn B', qty: 2 }], kb);
    expect(r.missingPrice).toBe(false);
    expect(r.total).toBe(3 * 100000 + 2 * 200000); // 700.000
    expect(r.items[0].unitPrice).toBe(100000);
  });
  it('resolveOrder: thiếu giá 1 món → missingPrice=true', async () => {
    const r = await resolveOrder([{ name: 'led A', qty: 1 }, { name: 'món C', qty: 5 }], kb);
    expect(r.missingPrice).toBe(true);
  });
  it('resolveOrder: KHÔNG gán nhầm giá SP khác tên (không code, token overlap thấp)', async () => {
    const wrongKb = async () => [{ content: 'Tên sản phẩm: Nguồn XYZ 300W\nGiá bán: 4.800đ' }];
    const r = await resolveOrder([{ name: 'led thanh ấm mỏng', qty: 10 }], wrongKb);
    expect(r.missingPrice).toBe(true);
  });
  it('resolveOrder: MODEL-CODE khớp → nhận giá dù token thường khác (P10 indoor → P10 Full in)', async () => {
    const kbP10 = async () => [{ content: 'Tên sản phẩm: P10 Full in JH\nGiá bán: 100.000đ' }];
    const r = await resolveOrder([{ name: 'P10 indoor', qty: 6 }], kbP10);
    expect(r.missingPrice).toBe(false);
    expect(r.items[0].unitPrice).toBe(100000);
  });
  it('resolveOrder: MODEL-CODE KHÁC → reject (P10 query không lấy giá P4)', async () => {
    const kbP4 = async () => [{ content: 'Tên sản phẩm: Module P4 LLR Pro\nGiá bán: 500.000đ' }];
    const r = await resolveOrder([{ name: 'P10 indoor', qty: 6 }], kbP4);
    expect(r.missingPrice).toBe(true); // code P10 != P4 → không nhận giá 500k của P4
  });
  it('formatVnd', () => {
    expect(formatVnd(700000)).toBe('700.000đ');
  });
});
