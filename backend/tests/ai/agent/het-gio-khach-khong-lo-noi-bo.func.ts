// SPDX-License-Identifier: AGPL-3.0-or-later
// HẾT GIỜ Ở LUỒNG KHÁCH — nói câu mềm, TUYỆT ĐỐI không kèm dữ liệu tool.
//
// Vì sao tách khỏi luồng nhân viên: sửa 272c58f2 chốt "hết giờ thì trả lời bằng
// dữ liệu đã tra được" (`tomTatDoDang`) — đúng với NHÂN VIÊN, họ là người trong
// nhà, output tool là thứ họ đang cần.
//
// KHÁCH thì ngược lại. `tomTatDoDang` trả NGUYÊN output của tool cuối cùng, mà
// tool luồng khách chạm vào Odoo: bản ghi khách hàng (mã KH, SĐT của NGƯỜI
// KHÁC), dòng giá. Dán nguyên khối đó vào tin gửi khách là rò dữ liệu nội bộ —
// và khách cũng chẳng hiểu "KH000027 · công nợ 12.000.000đ" nghĩa là gì.
//
// Nên luồng khách giữ đúng cách cũ: một câu giữ chân + báo nhân viên vào tiếp.
// Test này khoá lại để người sau không "thống nhất hai luồng" bằng cách bê
// `tomTatDoDang` sang đây.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    aiConfig: { findUnique: vi.fn(async () => ({ orgId: 'o1', autoReplyEnabled: true, guidelineEngineMode: 'off' })) },
    aiSuggestion: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
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
    trangThai: 'xong', traLoi: 'ok', log: [],
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
import { chayTuVanKhach } from '../../../src/modules/ai/agent/customer-agent.js';
import { guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { CAU_GIU_CHAN } from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { xoaLichSuBao } from '../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js';
import { _resetKhoaViecChoTest } from '../../../src/modules/ai/agent/noi-zalo/khoa-viec.js';

const ctx = {
  orgId: 'o1', bizName: 'Shop', conversationId: 'c-het-gio', messageId: 'm1',
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
  xoaLichSuBao(); // throttle báo nhân viên dùng chung Map — dọn giữa mỗi ca
  // KHOÁ VIỆC cũng là state dùng chung trong tiến trình (11/08): mọi ca ở đây
  // dùng CÙNG một `ctx` (cùng hội thoại, cùng câu), nên khoá do ca trước đặt sẽ
  // chặn ca sau và làm test đỏ oan. Dọn giữa mỗi ca, giống xoaLichSuBao.
  _resetKhoaViecChoTest();
});
afterEach(() => { process.env = goc; });

/** Những chuỗi TUYỆT ĐỐI không được xuất hiện trong tin gửi khách. */
const CAM_LO = [
  'KH000027',        // mã khách hàng nội bộ (của người khác)
  'giá vốn',         // biên lợi nhuận
  '12.000.000',      // số công nợ tra được
  'quá hạn',         // thông báo kỹ thuật
  '90000',           // số ms
  'agent',           // chữ nội bộ
  'Odoo',            // tên hệ thống nội bộ
];

describe('luồng KHÁCH hết giờ — câu mềm, không lộ dữ liệu nội bộ', () => {
  it('agent quá hạn giữa chừng → khách nhận câu giữ chân, KHÔNG kèm output tool', async () => {
    // Mô phỏng đúng ca prod: agent đã tra Odoo (ghi log tool) rồi lượt bị cắt
    // vì hết hạn — trước khi soạn được câu trả lời.
    vi.mocked(chayTuVanKhach).mockImplementationOnce(async (deps: any) => {
      deps.ghiLog({
        toolName: 'tra_khach_hang',
        output: 'Anh Vấn · KH000027 · công nợ 12.000.000đ · giá vốn 85.000đ',
        thanhCong: true,
      });
      throw new Error('lượt agent quá hạn 90000ms');
    });

    expect(await xuLyTinKhach(ctx)).toBe(true);

    const daGui = vi.mocked(guiTin).mock.calls
      .filter((c: any[]) => c[0]?.threadId === 't1')   // chỉ tin gửi CHO KHÁCH
      .map((c: any[]) => String(c[1]))
      .join('\n');

    // Không im lặng: khách phải nhận một câu.
    expect(daGui).toContain(CAU_GIU_CHAN);
    // Và câu đó không được mang theo bất cứ mảnh dữ liệu nội bộ nào.
    for (const cam of CAM_LO) expect(daGui).not.toContain(cam);
  });

  it('chưa tra được gì mà hết giờ → nhường luồng RAG cũ, không tự bịa câu', async () => {
    // Chưa chạm dữ liệu thì luồng cũ còn xử lý được từ đầu — hợp đồng cũ của
    // file này, giữ nguyên. Test khoá để bản sửa ngân sách không phá nó.
    vi.mocked(chayTuVanKhach).mockRejectedValueOnce(new Error('lượt agent quá hạn 90000ms'));

    expect(await xuLyTinKhach(ctx)).toBe(false);
  });
});
