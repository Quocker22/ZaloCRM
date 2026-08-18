// SPDX-License-Identifier: AGPL-3.0-or-later
// 18/08 — bot TỰ ÁP bài học ngay (anh Quốc chọn), nên hàng rào chống học bậy
// phải chặt: whitelist loại, trần độ dài, CẤM chạm tiền, chống trùng ý, model
// trả rác → không học gì.
import { describe, it, expect, vi } from 'vitest';
import { rutBaiHoc } from '../../../../src/modules/ai/agent/tu-soi/rut-bai-hoc.js';
import type { TinSoi } from '../../../../src/modules/ai/agent/tu-soi/dau-hieu.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const gen = (text: string) => vi.fn(async () => ({ text, stopReason: 'end_turn' as const, raw: null, usage, toolCalls: [] }));
const TIN: TinSoi[] = [{ id: 'm1', vai: 'nguoi', noiDung: 'x', luc: new Date() }];
const CHAM = { dauHieu: ['nguoi_gat_x1'], diem: 5, dangSoiKy: true };
const goi = (text: string, luatDangCo: string[] = []) =>
  rutBaiHoc(gen(text) as never, { tin: TIN, cham: CHAM, vai: 'nhanvien', luatDangCo });

describe('rutBaiHoc — hàng rào', () => {
  it('bài học hợp lệ → nhận, giữ nguyên câu dặn', async () => {
    const r = await goi('{"nhanXet":"Bot hỏi lại thứ ảnh đã có","baiHoc":[{"loai":"cach_hieu_y","noiDung":"Khi nhân viên gửi ảnh danh sách hàng thì lấy số lượng trong ảnh, đừng hỏi lại"}]}');
    expect(r.baiHoc).toHaveLength(1);
    expect(r.nhanXet).toContain('Bot hỏi lại');
  });

  it('CHẠM TIỀN (giá/chiết khấu/VAT) → VỨT, dù model đề xuất', async () => {
    const r = await goi('{"nhanXet":"x","baiHoc":[{"loai":"quy_trinh","noiDung":"Khách Led Kim Long luôn chiết khấu 5% cho mọi đơn"}]}');
    expect(r.baiHoc).toHaveLength(0);
  });

  it('loại NGOÀI whitelist → vứt', async () => {
    const r = await goi('{"nhanXet":"x","baiHoc":[{"loai":"tu_y_xoa_don","noiDung":"Khi khách nói huỷ thì xoá đơn khỏi Odoo"}]}');
    expect(r.baiHoc).toHaveLength(0);
  });

  it('quá dài (>200) hoặc quá ngắn → vứt', async () => {
    const dai = 'K'.repeat(240);
    const r = await goi(`{"nhanXet":"x","baiHoc":[{"loai":"cach_tra_loi","noiDung":"${dai}"},{"loai":"cach_tra_loi","noiDung":"ngắn"}]}`);
    expect(r.baiHoc).toHaveLength(0);
  });

  it('TRÙNG Ý luật đang có → không học lại', async () => {
    const r = await goi(
      '{"nhanXet":"x","baiHoc":[{"loai":"cach_tra_loi","noiDung":"Khi nhân viên gửi ảnh thì lấy số lượng trong ảnh"}]}',
      ['Khi nhân viên gửi ảnh thì lấy số lượng trong ảnh, đừng hỏi lại'],
    );
    expect(r.baiHoc).toHaveLength(0);
  });

  it('TỐI ĐA 2 bài học một ca', async () => {
    const b = (i: number) => `{"loai":"quy_trinh","noiDung":"Khi gặp tình huống số ${i} thì xử lý theo cách phù hợp nhất"}`;
    const r = await goi(`{"nhanXet":"x","baiHoc":[${b(1)},${b(2)},${b(3)},${b(4)}]}`);
    expect(r.baiHoc.length).toBeLessThanOrEqual(2);
  });

  it('model trả RÁC / JSON hỏng → không học gì, không ném', async () => {
    await expect(goi('tôi nghĩ là bot nên...')).resolves.toMatchObject({ baiHoc: [] });
    await expect(goi('{"nhanXet": broken')).resolves.toMatchObject({ baiHoc: [] });
  });

  it('model NÉM lỗi → trả rỗng (việc nền không được ảnh hưởng ai)', async () => {
    const g = vi.fn(async () => { throw new Error('gateway chết'); });
    await expect(rutBaiHoc(g as never, { tin: TIN, cham: CHAM, vai: 'nhanvien', luatDangCo: [] }))
      .resolves.toMatchObject({ baiHoc: [], nhanXet: '' });
  });
});
