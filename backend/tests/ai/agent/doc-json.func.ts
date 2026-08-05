// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: đọc JSON chịu được rác ở đầu thân phản hồi.
//
// Bug thật 2026-08-05: OpenRouter trả `"\n         \n{...}"` — khoảng trắng và
// xuống dòng TRƯỚC dấu `{`. `response.json()` của Node ném ngay, agent chết ở
// lượt LLM ĐẦU TIÊN. Bot im lặng hoàn toàn, log chỉ có "BẮT ĐẦU xử lý" rồi
// không gì nữa — mất cả tiếng dò mới ra.
import { describe, it, expect } from 'vitest';
import { docJson } from '../../../src/modules/ai/providers/openai-compat.js';

const gia = (t: string) => ({ text: async () => t }) as unknown as Response;

describe('docJson', () => {
  it('JSON sạch → phân tích bình thường', async () => {
    expect(await docJson(gia('{"ok":1}'))).toEqual({ ok: 1 });
  });

  it.each([
    ['xuống dòng + khoảng trắng (lỗi THẬT của OpenRouter)', '\n         \n{"ok":1}'],
    ['tab', '\t{"ok":1}'],
    ['nhiều dòng trống', '\n\n\n  {"ok":1}'],
  ])('bỏ rác đầu thân: %s', async (_ten, raw) => {
    expect(await docJson(gia(raw))).toEqual({ ok: 1 });
  });

  it('mảng cũng nhận', async () => {
    expect(await docJson(gia('  [1,2]'))).toEqual([1, 2]);
  });

  it('thân KHÔNG có JSON → ném kèm nội dung để đọc log là biết', async () => {
    // Gateway lỗi hay trả HTML. Nuốt lỗi ở đây là mất manh mối duy nhất.
    await expect(docJson(gia('<html>502 Bad Gateway</html>'))).rejects.toThrow(/502 Bad Gateway/);
  });

  it('thân rỗng → ném, không trả undefined', async () => {
    await expect(docJson(gia(''))).rejects.toThrow(/không phải JSON/);
  });

  it('JSON hỏng giữa chừng → ném kèm đoạn hỏng', async () => {
    await expect(docJson(gia('{"a":'))).rejects.toThrow(/JSON hỏng/);
  });
});
