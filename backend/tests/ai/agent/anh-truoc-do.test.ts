// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 16:19 26/08 nhóm "Dậy học cho AI": ảnh hoá đơn gửi 16:19:29 KHÔNG
// tag, lệnh "@bot đơn như này nhưng số lượng 20m mỗi loại" 16:19:53 → bot
// không thấy ảnh, hỏi lại; NV phải gửi lại ảnh kèm caption mới chạy.
import { describe, it, expect, vi } from 'vitest';
import {
  canAnhTruocDo, ghepAnhTruocDo, CUA_SO_ANH_TRUOC_MS,
} from '../../../src/modules/ai/agent/noi-zalo/anh-truoc-do.js';

describe('canAnhTruocDo — câu có chỉ về thứ vừa gửi không', () => {
  it.each([
    '@Tiểu Mã Nelia đơn như này nhưng số lượng 20m mỗi loại',
    'lên đơn như này, khách trong hình luôn',
    'Đây e',
    'đây ạ',
    'lấy từ trong ảnh ra',
    'in đơn này',
    'giá như trên nhé',
  ])('có chỉ dấu: %s', (cau) => expect(canAnhTruocDo(cau)).toBe(true));

  it.each([
    'cho công nợ anh Quế HCM',
    'in đơn anh vũ hải',
    'a vũ hải 8 cái 12v400w Df x 180k lên đơn',
    'Led đơn nhé',
    '',
  ])('KHÔNG chỉ dấu (không ghép bừa): %s', (cau) => expect(canAnhTruocDo(cau)).toBe(false));
});

describe('ghepAnhTruocDo', () => {
  const T0 = 1_756_000_000_000;
  const deps = (anhCachMs: number | null, moTa: string | null = 'Hoá đơn INV/2026/028232 · QC Hoàng Nguyên · Vỏ Neon 6mm Xanh Ngọc (50m/c): 30 mét, giá 9.000') => {
    const docAnh = vi.fn(async () => moTa);
    const timAnh = vi.fn(async () => (anhCachMs == null ? null : { url: 'http://x/a.jpg', sentAt: new Date(T0 - anhCachMs) }));
    return { docAnh, timAnh, ghep: (c: string, m: string) => `[Khách gửi ảnh: ${m}]\n${c}`, bayGio: () => T0 };
  };

  it('ca thật: ảnh 24s trước + "đơn như này" → đọc ảnh, ghép ẢNH TRƯỚC LỜI NHẮN', async () => {
    const d = deps(24_000);
    const kq = await ghepAnhTruocDo(d, '@bot đơn như này nhưng số lượng 20m mỗi loại');
    expect(kq).toMatch(/^\[Khách gửi ảnh: Hoá đơn INV\/2026\/028232/);
    expect(kq).toContain('20m mỗi loại');
    expect(d.docAnh).toHaveBeenCalledWith('http://x/a.jpg', expect.any(String));
  });

  it('không có chỉ dấu → null và KHÔNG đọc ảnh (không tốn tiền)', async () => {
    const d = deps(24_000);
    expect(await ghepAnhTruocDo(d, 'cho công nợ anh Quế')).toBeNull();
    expect(d.timAnh).not.toHaveBeenCalled();
    expect(d.docAnh).not.toHaveBeenCalled();
  });

  it('ảnh quá cũ (ngoài cửa sổ) → null', async () => {
    const d = deps(CUA_SO_ANH_TRUOC_MS + 1000);
    expect(await ghepAnhTruocDo(d, 'đơn như này')).toBeNull();
    expect(d.docAnh).not.toHaveBeenCalled();
  });

  it('không có ảnh / đọc hỏng / timAnh ném → null, không ném', async () => {
    expect(await ghepAnhTruocDo(deps(null), 'đơn như này')).toBeNull();
    expect(await ghepAnhTruocDo(deps(5_000, null), 'đơn như này')).toBeNull();
    const d = deps(5_000);
    d.timAnh.mockRejectedValueOnce(new Error('db'));
    expect(await ghepAnhTruocDo(d, 'đơn như này')).toBeNull();
  });
});
