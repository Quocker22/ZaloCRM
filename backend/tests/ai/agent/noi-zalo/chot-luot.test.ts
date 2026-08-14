// SPDX-License-Identifier: AGPL-3.0-or-later
// A3 (14/08) — chặn tin MUỘN của luồng mồ côi sau hết giờ (học dsh tool-calls):
// chayCoHanGio không huỷ được Promise; quá hạn thì gom-đơn mồ côi vẫn chạy nốt
// và guiTin của nó nổ SAU fallback "em chưa xử lý kịp" → khách nhận 2 câu đá
// nhau. Lượt đã chốt thì lời nói muộn phải câm; thao tác GHI vẫn chạy nốt
// (idempotency client_order_ref lo phần thử lại).
import { describe, it, expect, vi } from 'vitest';
import { chotLuot } from '../../../../src/modules/ai/agent/noi-zalo/dung.js';

describe('chotLuot — chốt lượt chặn tin muộn', () => {
  it('trước khi chốt: tin đi bình thường', async () => {
    const guiThat = vi.fn(async (_t: string) => {});
    const chot = chotLuot();
    const gui = chot.bocGui(guiThat, 'test');
    await gui('tin trong lượt');
    expect(guiThat).toHaveBeenCalledWith('tin trong lượt');
  });

  it('sau khi chốt: tin muộn bị nuốt, không ném lỗi (luồng mồ côi không được sập)', async () => {
    const guiThat = vi.fn(async (_t: string) => {});
    const chot = chotLuot();
    const gui = chot.bocGui(guiThat, 'test');
    chot.chot(); // catch đã gửi fallback
    await expect(gui('tin muộn của luồng mồ côi')).resolves.toBeUndefined();
    expect(guiThat).not.toHaveBeenCalled();
    expect(chot.daChot()).toBe(true);
  });

  it('nhiều hàm gửi bọc cùng một chốt — chốt một lần là chặn tất', async () => {
    const guiTin = vi.fn(async (_t: string) => {});
    const guiAnh = vi.fn(async (_b: Buffer) => {});
    const chot = chotLuot();
    const tin = chot.bocGui(guiTin, 'tin');
    const anh = chot.bocGui(guiAnh, 'anh');
    chot.chot();
    await tin('x'); await anh(Buffer.from('y'));
    expect(guiTin).not.toHaveBeenCalled();
    expect(guiAnh).not.toHaveBeenCalled();
  });
});
