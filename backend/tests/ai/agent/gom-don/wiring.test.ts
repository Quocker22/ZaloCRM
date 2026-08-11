// SPDX-License-Identifier: AGPL-3.0-or-later
// Wiring: máy gom đơn đứng TRƯỚC agent thường trong xuLyTinNhanVien.
// Máy nhận (true) → agent thường KHÔNG chạy; máy nhường (false) → luồng cũ y nguyên.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({ accountId: 'a1', threadId: 't1', threadType: 1, zaloUid: 'bot-uid' })),
  guiTin: vi.fn(async () => {}),
  guiAnh: vi.fn(async () => {}),
  guiFile: vi.fn(async () => {}),
  ghiAnhTam: vi.fn(async () => '/tmp/x.png'),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/llm.js', () => ({
  dungGenerate: vi.fn(async () => async () => ({
    text: 'ok', toolCalls: [], stopReason: 'end_turn', raw: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../../src/modules/ai/agent/agent-operator-service.js', () => ({
  laNhanVienSync: vi.fn(() => true),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/du-lieu.js', () => ({
  layOdoo: vi.fn(() => ({})),
  layAnhClient: vi.fn(() => null),
  timTriThuc: vi.fn(async () => null),
  layLichSu: vi.fn(async () => []),
  seqTuMessageId: vi.fn(() => 1),
  coTinKhachMoiHon: vi.fn(async () => false),
}));
vi.mock('../../../../src/modules/ai/agent/staff-agent.js', () => ({
  chayLenhNhanVien: vi.fn(async () => ({
    trangThai: 'xong', traLoi: 'từ agent thường', log: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js', () => ({
  xuLyGomDon: vi.fn(async () => true),
}));

import { xuLyTinNhanVien } from '../../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js';
import { xuLyGomDon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { chayLenhNhanVien } from '../../../../src/modules/ai/agent/staff-agent.js';
import { guiTin } from '../../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { _resetKhoaViecChoTest } from '../../../../src/modules/ai/agent/noi-zalo/khoa-viec.js';

const ctx = {
  orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: 'm1',
  content: 'lên đơn cho anh Hưng 10 cái nguồn NB nhé',
  senderUid: 'nv-1', isSelf: false, laNhom: false, daTagBot: false,
};

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_NHANVIEN = '1';
  process.env.ODOO_URL = 'http://localhost:8069';
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USERNAME = 'u';
  process.env.ODOO_PASSWORD = 'p';
  vi.clearAllMocks();
  // Khoá việc (10/08) chặn hai lượt cùng xử một câu — các ca dưới dùng chung
  // conversationId + câu lệnh nên ca sau bị ca trước khoá. Dọn giữa mỗi ca.
  _resetKhoaViecChoTest();
});
afterEach(() => { process.env = goc; });

describe('wiring máy gom đơn trong xuLyTinNhanVien', () => {
  it('máy nhận (true) → agent thường KHÔNG chạy', async () => {
    vi.mocked(xuLyGomDon).mockResolvedValueOnce(true);
    expect(await xuLyTinNhanVien(ctx)).toBe(true);
    expect(xuLyGomDon).toHaveBeenCalledTimes(1);
    const [, thamSo] = vi.mocked(xuLyGomDon).mock.calls[0];
    expect(thamSo).toMatchObject({ orgId: 'o1', conversationId: 'c1', cau: expect.stringContaining('lên đơn') });
    expect(chayLenhNhanVien).not.toHaveBeenCalled();
  });

  it('máy nhường (false) → agent thường chạy, trả lời được gửi', async () => {
    vi.mocked(xuLyGomDon).mockResolvedValueOnce(false);
    expect(await xuLyTinNhanVien(ctx)).toBe(true);
    expect(chayLenhNhanVien).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guiTin).mock.calls.some((c) => c[1] === 'từ agent thường')).toBe(true);
  });

  // ĐỔI CÂU BÁO 11/08: trước đây dán "Bot gặp lỗi (<thông báo kỹ thuật>)" —
  // nhân viên đọc "lượt agent quá hạn 90000ms" thì làm được gì? Anh Quốc: "bỏ
  // cái báo lỗi đó đi được không". Vẫn PHẢI nhắn (im lặng là họ ngồi chờ mãi),
  // nhưng bằng câu người đọc được, và lý do kỹ thuật ở lại trong log.
  it('máy NÉM lỗi → nhân viên vẫn được báo, nhưng KHÔNG lộ chữ kỹ thuật', async () => {
    vi.mocked(xuLyGomDon).mockRejectedValueOnce(new Error('nổ thử'));
    expect(await xuLyTinNhanVien(ctx)).toBe(true);

    const daGui = vi.mocked(guiTin).mock.calls.map((c) => String(c[1])).join('\n');
    // Không im lặng.
    expect(daGui.trim().length).toBeGreaterThan(0);
    // Không lộ nội tình: tên lỗi, chữ "Bot gặp lỗi", số ms.
    expect(daGui).not.toContain('nổ thử');
    expect(daGui).not.toContain('Bot gặp lỗi');
    expect(daGui).not.toMatch(/\d+ms|quá hạn/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KHÔNG rò thông báo NỘI BỘ ra cho khách.
//
// Bug thật 23:38:44 10/08: khách gửi ảnh sản phẩm hỏi "bên shop có sản phẩm
// này không". Hàng rào chống-hứa-lèo chặn câu trả lời, và luồng nhân viên dán
// nguyên `r.lyDo` — văn bản kỹ thuật viết cho lập trình viên — vào tin gửi đi:
//   "Bot chưa xử lý xong (Model nói đã gửi ảnh ("...") nhưng KHÔNG có ảnh hoá
//    đơn nào được tạo. Muốn gửi ảnh phải gọi tool gui_hoa_don để render ảnh
//    thật; chặn câu bịa để nhân viên khỏi tin nhầm.)"
// Nhóm bán hàng có cả khách ngồi trong đó.
describe('dở dang — báo người thật, KHÔNG lộ nội tình kỹ thuật', () => {
  it('không dán lý do kỹ thuật vào tin nhắn, nhưng vẫn báo', async () => {
    vi.mocked(chayLenhNhanVien).mockResolvedValueOnce({
      trangThai: 'chua_hoan_tat',
      lyDo: 'Model nói đã gửi ảnh ("...") nhưng KHÔNG có ảnh hoá đơn nào được tạo. '
        + 'Muốn gửi ảnh phải gọi tool gui_hoa_don để render ảnh thật.',
      log: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    } as never);
    vi.mocked(xuLyGomDon).mockResolvedValueOnce(false);

    await xuLyTinNhanVien({
      orgId: 'o1', bizName: 'LEDNELIA', conversationId: 'c-loro', messageId: 'm-loro',
      content: '@bot bên shop có sản phẩm này không', senderUid: 'uid-nv', isSelf: true,
    } as never);

    const daGui = vi.mocked(guiTin).mock.calls.map((c) => String(c[1])).join('\n');
    // Vẫn phải nhắn gì đó — im lặng thì nhân viên không biết mà xử.
    expect(daGui.length).toBeGreaterThan(0);
    // Nhưng tuyệt đối không lộ tên tool, chữ "Model", hay hướng dẫn kỹ thuật.
    expect(daGui).not.toContain('gui_hoa_don');
    expect(daGui).not.toContain('Model nói');
    expect(daGui).not.toMatch(/render|tool\b/i);
  });
});
