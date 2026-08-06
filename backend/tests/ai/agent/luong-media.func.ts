// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tin không phải chữ — sticker bỏ qua, ảnh/voice báo người.
//
// Lỗ hổng gốc (06/08/2026): hai luồng agent chỉ nhận contentType='text', mọi
// sticker/ảnh/voice rơi vào im lặng TUYỆT ĐỐI. Ảnh khách gửi thường là ảnh
// CHUYỂN KHOẢN — im lặng ở đó là mất tiền thật.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'acc-1', threadId: 'kh-1', threadType: 0,
    zaloUid: 'kh-uid', tenKhach: 'Anh Long', sdtKhach: null,
  })),
  guiTin: vi.fn(async () => {}),
}));

import { timDich, guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { xuLyTinMedia, chiCoEmoji } from '../../../src/modules/ai/agent/noi-zalo/luong-media.js';
import { xoaLichSuBao } from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { logger } from '../../../src/shared/utils/logger.js';

const CTX = { orgId: 'org-1', conversationId: 'conv-media', messageId: 'msg-1' };

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_KHACH = '1';
  process.env.AI_AGENT_THREAD_BAO_SALE = 'nhom-sale';
  xoaLichSuBao();
  vi.mocked(guiTin).mockClear();
  vi.mocked(timDich).mockClear();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

describe('chiCoEmoji — cái like không đáng một lượt agent', () => {
  it.each(['👍', '👌👌', '😀 !!', '???', '...', '   ', ''])(
    'chỉ emoji/trang trí: "%s" → true', (t) => expect(chiCoEmoji(t)).toBe(true),
  );

  it.each(['ok 👍', '10 cái', 'ừ', 'giá nhiêu 😀', '5'])(
    'có nội dung thật: "%s" → false', (t) => expect(chiCoEmoji(t)).toBe(false),
  );
});

describe('xuLyTinMedia — ảnh/voice: giữ chân + báo người', () => {
  it('ảnh từ khách 1-1 → MỘT câu giữ chân + MỘT tin báo nhân viên', async () => {
    const kq = await xuLyTinMedia(CTX, 'image');

    expect(kq).toBe(true);
    // 2 lần guiTin: 1 báo nhân viên (qua baoNhanVien), 1 giữ chân khách.
    expect(guiTin).toHaveBeenCalledTimes(2);
    const noiDungGuiKhach = vi.mocked(guiTin).mock.calls
      .map((c) => c[1])
      .find((t) => t.includes('em đã nhận được'));
    expect(noiDungGuiKhach).toContain('ảnh');
  });

  it('album 5 tấm → vẫn chỉ MỘT lượt giữ chân + báo (throttle của bao-nhan-vien)', async () => {
    for (let i = 0; i < 5; i++) await xuLyTinMedia(CTX, 'image');

    expect(guiTin).toHaveBeenCalledTimes(2); // không phải 10
  });

  it('sticker → bỏ qua có chủ đích: không gửi gì, nhưng trả true (đã xử lý)', async () => {
    const kq = await xuLyTinMedia(CTX, 'sticker');

    expect(kq).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('trong NHÓM → không làm gì: giữ chân giữa đám đông là ồn vô nghĩa', async () => {
    const kq = await xuLyTinMedia({ ...CTX, laNhom: true }, 'image');

    expect(kq).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('công tắc AI_AGENT_KHACH tắt → không làm gì (mặc định an toàn)', async () => {
    process.env.AI_AGENT_KHACH = '0';

    expect(await xuLyTinMedia(CTX, 'image')).toBe(false);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('voice → câu giữ chân nói đúng loại ("tin nhắn thoại", không phải "ảnh")', async () => {
    await xuLyTinMedia(CTX, 'voice');

    const guiKhach = vi.mocked(guiTin).mock.calls.map((c) => c[1]).find((t) => t.includes('em đã nhận được'));
    expect(guiKhach).toContain('tin nhắn thoại');
  });

  it('loại lạ (vd "location") → trả false, để pipeline cũ tự xử', async () => {
    expect(await xuLyTinMedia(CTX, 'location')).toBe(false);
  });
});
