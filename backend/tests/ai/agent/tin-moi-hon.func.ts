// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: guard "tin mới đến giữa chừng" (07/08, học Chatwoot).
//
// Bug gốc 06/08: khách gõ "cả tháng này và tháng trước" thành nhiều tin liên
// tiếp. Bot bắt đầu xử lý tin đầu ("cả"), gọi LLM mất vài giây, trong lúc đó
// tin sau đến. Trả lời tin cũ → lệch. Guard: có tin khách mới hơn + chưa ghi
// tool → bỏ lượt này, để lượt do tin mới kích trả lời gộp.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: { message: { findUnique: vi.fn(), count: vi.fn() } },
}));

import { prisma } from '../../../src/shared/database/prisma-client.js';
import { coTinKhachMoiHon } from '../../../src/modules/ai/agent/noi-zalo/du-lieu.js';

const findUnique = vi.mocked(prisma.message.findUnique);
const count = vi.mocked(prisma.message.count);

beforeEach(() => { findUnique.mockReset(); count.mockReset(); });

describe('coTinKhachMoiHon', () => {
  it('có tin khách mới hơn → true (khách gõ tiếp trong lúc bot nghĩ)', async () => {
    findUnique.mockResolvedValue({ sentAt: new Date('2026-08-06T08:00:00Z') } as never);
    count.mockResolvedValue(2 as never);

    expect(await coTinKhachMoiHon('conv-1', 'msg-1')).toBe(true);
  });

  it('không có tin mới → false (tin này là tin cuối)', async () => {
    findUnique.mockResolvedValue({ sentAt: new Date() } as never);
    count.mockResolvedValue(0 as never);

    expect(await coTinKhachMoiHon('conv-1', 'msg-1')).toBe(false);
  });

  it('tin đang xử lý không tồn tại (đã xoá) → false, không nổ', async () => {
    findUnique.mockResolvedValue(null as never);

    expect(await coTinKhachMoiHon('conv-1', 'msg-1')).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  it('CHỈ đếm tin KHÁCH (senderType=contact), không tính tin bot/nhân viên', async () => {
    findUnique.mockResolvedValue({ sentAt: new Date('2026-08-06T08:00:00Z') } as never);
    count.mockResolvedValue(0 as never);

    await coTinKhachMoiHon('conv-1', 'msg-1');

    const where = count.mock.calls[0][0].where;
    expect(where.senderType).toBe('contact');
    expect(where.sentAt).toEqual({ gt: new Date('2026-08-06T08:00:00Z') });
    expect(where.conversationId).toBe('conv-1');
  });
});
