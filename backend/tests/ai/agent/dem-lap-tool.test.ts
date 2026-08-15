// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÓM B (15/08) — đếm lặp tool trong MỘT lượt (học dsh repeat-tool-reminder):
// model rẻ gọi lại y hệt một tool đã có kết quả/đã bị chặn, không tiến triển.
// Lần 2 giống hệt → nhắc ngay trong kết quả; lần 3 → chặn, bắt kết luận.
import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../../src/modules/ai/agent/registry.js';

const dinhNghia = (name: string) => ({
  name, description: 't', inputSchema: { type: 'object' as const, properties: {} },
});

function dungRegistry(name = 'tra_san_pham') {
  const run = vi.fn(async () => 'ket qua');
  const r = new ToolRegistry().register({ definition: dinhNghia(name), run });
  return { r, run };
}

describe('đếm lặp tool theo (tên, tham số chuẩn hoá)', () => {
  it('lần 1 sạch; lần 2 y hệt → kèm nhắc; lần 3 → chặn, tool KHÔNG chạy nữa', async () => {
    const { r, run } = dungRegistry();
    const chay = r.executor();
    const call = { id: 't1', name: 'tra_san_pham', input: { ten: 'nguồn NB' } };

    const l1 = await chay(call);
    expect(l1.content).toBe('ket qua');

    const l2 = await chay({ ...call, id: 't2' });
    expect(l2.content).toContain('Lần gọi thứ 2 y hệt');

    const l3 = await chay({ ...call, id: 't3' });
    expect(l3.isError).toBe(true);
    expect(l3.content).toContain('DỪNG tra');
    expect(run).toHaveBeenCalledTimes(2); // lần 3 không được chạy thân tool
  });

  it('tham số KHÁC thứ tự khoá nhưng CÙNG nội dung vẫn tính là lặp', async () => {
    const { r } = dungRegistry();
    const chay = r.executor();
    await chay({ id: 'a', name: 'tra_san_pham', input: { ten: 'x', gioi_han: 5 } });
    const l2 = await chay({ id: 'b', name: 'tra_san_pham', input: { gioi_han: 5, ten: 'x' } });
    expect(l2.content).toContain('Lần gọi thứ 2');
  });

  it('tham số khác nội dung → KHÔNG nhắc; executor mới (lượt mới) → bộ đếm reset', async () => {
    const { r } = dungRegistry();
    const chay = r.executor();
    await chay({ id: 'a', name: 'tra_san_pham', input: { ten: 'x' } });
    const khac = await chay({ id: 'b', name: 'tra_san_pham', input: { ten: 'y' } });
    expect(khac.content).toBe('ket qua');

    const chayMoi = r.executor();
    const luotMoi = await chayMoi({ id: 'c', name: 'tra_san_pham', input: { ten: 'x' } });
    expect(luotMoi.content).toBe('ket qua');
  });

  it('lời gọi BỊ TỪ CHỐI (chanToolGhi) cũng bị đếm — nện mãi lệnh bị chặn là vòng đáng cắt', async () => {
    const run = vi.fn(async () => 'ok');
    const r = new ToolRegistry().register({ definition: dinhNghia('tao_don_nhap'), run });
    const chay = r.executor(true); // người dùng vừa nói dừng → tool ghi bị chặn
    const call = { id: 'a', name: 'tao_don_nhap', input: { x: 1 } };
    await chay(call);
    await chay({ ...call, id: 'b' });
    const l3 = await chay({ ...call, id: 'c' });
    expect(l3.isError).toBe(true);
    expect(l3.content).toContain('DỪNG tra');
    expect(run).not.toHaveBeenCalled();
  });
});
