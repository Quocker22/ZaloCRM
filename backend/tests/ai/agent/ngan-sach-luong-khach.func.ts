// SPDX-License-Identifier: AGPL-3.0-or-later
// NGÂN SÁCH THỜI GIAN — LỖ HỔNG CÒN LẠI ở luồng KHÁCH và luồng CHÀO NHÓM.
//
// Sửa 272c58f2 (đã lên prod) chỉ phủ luồng NHÂN VIÊN: đặt `hanChot` đầu lượt
// rồi truyền vào `dungGenerate(orgId, hanChot)`. Luồng khách và chào nhóm vẫn
// gọi `dungGenerate(orgId)` TRỐNG — trong khi cả hai cũng nằm dưới cùng một
// hàng rào `chayCoHanGio` 90s.
//
// Nên bug gốc CÒN NGUYÊN ở hai luồng đó (đo lại trên prod 11/08):
//   - hạn tổng một lượt agent            : 90s
//   - một vòng thử-lại của provider được : 12+20+30+40s chờ, cộng nghỉ backoff
//     phép chạy                            1+2+4s = 109s
//   → 109s > 90s. Không có mốc hết hạn tuyệt đối, chỉ cần gateway chậm MỘT lần
//     là cả lượt bị `chayCoHanGio` cắt. Với NHÂN VIÊN thì lộ câu "quá hạn
//     90000ms"; với KHÁCH thì khách ngồi chờ rồi nhận câu giữ chân vô cớ.
//
// Test khoá đúng một điều: mọi luồng bọc `chayCoHanGio` PHẢI truyền mốc hết hạn
// xuống `dungGenerate`, và mốc đó phải nằm trong ngân sách một lượt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    aiConfig: { findUnique: vi.fn(async () => ({ orgId: 'o1', autoReplyEnabled: true, guidelineEngineMode: 'off' })) },
    aiSuggestion: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
    conversation: {
      upsert: vi.fn(async () => ({ id: 'c1', groupGreetedAt: null, botGroupBlocked: false })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'a1', threadId: 't1', threadType: 1, zaloUid: 'u1', tenKhach: null, sdtKhach: null,
  })),
  guiTin: vi.fn(async () => {}),
  guiAnh: vi.fn(async () => {}),
  guiHoaDonVaQr: vi.fn(async () => {}),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/llm.js', () => ({
  dungGenerate: vi.fn(async () => async () => ({
    text: 'ok', toolCalls: [], stopReason: 'end_turn', raw: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/du-lieu.js', () => ({
  layOdoo: vi.fn(() => ({})),
  layAnhClient: vi.fn(() => null),
  timTriThuc: vi.fn(async () => null),
  layLichSu: vi.fn(async () => []),
  seqTuMessageId: vi.fn(() => 1),
  coTinKhachMoiHon: vi.fn(async () => false),
}));
vi.mock('../../../src/modules/ai/agent/customer-agent.js', () => ({
  chayTuVanKhach: vi.fn(async () => ({
    trangThai: 'xong', traLoi: 'Dạ em trả lời khách ạ', log: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../src/modules/ai/knowledge/product-image.js', () => ({
  findImageForReply: vi.fn(() => null),
}));
vi.mock('../../../src/modules/ai/knowledge/anh-san-pham.js', () => ({
  timAnhSanPhamTheoReply: vi.fn(async () => []),
  taiAnhVeTam: vi.fn(async () => '/tmp/x.png'),
}));

import { xuLyTinKhach } from '../../../src/modules/ai/agent/noi-zalo/luong-khach.js';
import { chaoNhomKhiThem } from '../../../src/modules/ai/agent/noi-zalo/chao-nhom.js';
import { dungGenerate } from '../../../src/modules/ai/agent/noi-zalo/llm.js';
import { hanGioLuot } from '../../../src/modules/ai/agent/noi-zalo/dung.js';

const ctx = {
  orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: 'm1',
  content: 'shop còn nguồn NB không ạ',
  senderUid: 'kh-1', isSelf: false, laNhom: false, daTagBot: false,
};

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_KHACH = '1';
  process.env.ODOO_URL = 'http://localhost:8069';
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USERNAME = 'u';
  process.env.ODOO_PASSWORD = 'p';
  vi.clearAllMocks();
});
afterEach(() => { process.env = goc; });

/** Mốc hết hạn phải là thời điểm TƯƠNG LAI, nằm gọn trong một ngân sách lượt. */
function kiemMocHopLe(hanChot: unknown, truocKhiChay: number): void {
  expect(typeof hanChot).toBe('number');
  const h = hanChot as number;
  // Phải là mốc tuyệt đối trong tương lai — không phải khoảng thời lượng (90000)
  // vốn nằm ở quá khứ so với Date.now(), lỗi dễ mắc khi truyền nhầm tham số.
  expect(h).toBeGreaterThan(truocKhiChay);
  // Và không được rộng hơn ngân sách một lượt: rộng hơn thì `chayCoHanGio` vẫn
  // cắt trước, tức mốc vô dụng — đúng cái bug đang sửa.
  expect(h).toBeLessThanOrEqual(truocKhiChay + hanGioLuot() + 1_000);
}

describe('luồng KHÁCH — phải có ngân sách thời gian như luồng nhân viên', () => {
  it('truyền MỐC HẾT HẠN xuống dungGenerate, không gọi trống', async () => {
    const truoc = Date.now();
    expect(await xuLyTinKhach(ctx)).toBe(true);

    expect(dungGenerate).toHaveBeenCalledTimes(1);
    const [orgId, hanChot] = vi.mocked(dungGenerate).mock.calls[0];
    expect(orgId).toBe('o1');
    // ĐỎ trước khi sửa: luồng khách gọi `dungGenerate(ctx.orgId)` — hanChot
    // undefined → provider tự đặt hạn riêng → một vòng thử-lại 109s trong khi
    // hàng rào chỉ cho 90s.
    kiemMocHopLe(hanChot, truoc);
  });
});

describe('luồng CHÀO NHÓM — cùng lỗ hổng, cùng cách vá', () => {
  const deps = {
    orgId: 'o1', accountId: 'a1', groupId: 'g1', groupName: 'Nhóm test',
    botUid: 'bot-1', tenShop: 'Shop',
    api: {
      getGroupChatHistory: vi.fn(async () => ({
        groupMsgs: [{ data: { uidFrom: 'kh-1', dName: 'Khách', content: 'shop ơi' } }],
      })),
    },
  };

  it('truyền MỐC HẾT HẠN xuống dungGenerate, không gọi trống', async () => {
    const truoc = Date.now();
    expect(await chaoNhomKhiThem(deps)).toBe(true);

    expect(dungGenerate).toHaveBeenCalledTimes(1);
    const [orgId, hanChot] = vi.mocked(dungGenerate).mock.calls[0];
    expect(orgId).toBe('o1');
    kiemMocHopLe(hanChot, truoc);
  });
});
