// SPDX-License-Identifier: AGPL-3.0-or-later
// BA LỚP CHỐNG TRẢ LỜI TRÙNG — mỗi lớp một bug thật, KHÔNG lớp nào thay được lớp nào.
//
// File này khoá RANH GIỚI của cả ba lớp cùng một chỗ, để lần sau ai thấy
// "trông thừa" mà định gộp thì có test đỏ chặn tay lại:
//
//   Lớp 1 — KHOÁ VIỆC (Redis, băm theo NỘI DUNG)
//     Bug 21:34:22-24 10/08 (nhóm, luồng nhân viên): tin "lên đơn cho anh Thức"
//     tự chạy, rồi tag trống nuốt LẠI đúng câu đó → bot trả lời HAI LẦN.
//     Hai lượt đến từ HAI messageId khác nhau nhưng cùng MỘT việc.
//
//   Lớp 2 — aiSuggestion.count (đếm theo messageId)
//     Chống retry / tin trùng từ Zalo: CÙNG một messageId được đưa vào xử lý
//     hai lần (webhook gửi lại, sync lại).
//
//   Lớp 3 — coTinKhachMoiHon (có tin khách mới hơn thì bỏ lượt)
//     Khách gõ 3-4 tin ngắn liên tiếp; trả lời tin #1 thì lệch ngữ cảnh.
//
// KHE HỞ ĐÃ ĐO ĐƯỢC TRÊN PROD (vì sao thêm Lớp 1 vào luồng KHÁCH):
//   conversation 0d81fe67 (threadType='user', chat 1-1 với khách), 04/08:
//     18:23:41.303  contact "chào"   msg 24f20f8e…  ← messageId A
//     18:23:46.550  contact "chào"   msg a558b28e…  ← messageId B (KHÁC A)
//     18:23:59.588  self    "Dạ chào anh Quốc, em chào lại anh ạ…"
//     18:24:15.987  self    "Dạ chào anh Quốc ạ! Em đã kiểm tra thông tin rồi ạ…"
//   → khách nhận HAI câu chào cho cùng một việc.
//   `aiSuggestion.count` KHÔNG cứu được: A ≠ B nên mỗi lượt đếm ra 0.
//   `coTinKhachMoiHon` KHÔNG cứu được: nó chỉ chạy SAU khi LLM trả lời xong, và
//   lượt của tin B (tin mới nhất) không có tin nào mới hơn nữa để mà bỏ.
//   Chỉ khoá theo NỘI DUNG đặt NGAY ĐẦU LƯỢT mới chặn được — đúng Lớp 1.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    aiConfig: {
      findUnique: vi.fn(async () => ({ orgId: 'o1', autoReplyEnabled: true, guidelineEngineMode: 'off' })),
    },
    aiSuggestion: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
    knowledgeChunk: { count: vi.fn(async () => 0) },
  },
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'a1', threadId: 't1', threadType: 0, zaloUid: 'u1', tenKhach: null, sdtKhach: null,
  })),
  guiTin: vi.fn(async () => {}),
  guiAnh: vi.fn(async () => {}),
  guiFile: vi.fn(async () => {}),
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
vi.mock('../../../src/modules/ai/knowledge/kho-tai-lieu.js', () => ({
  khoTaiLieuCuaOrg: vi.fn(async () => null),
}));
vi.mock('../../../src/modules/ai/agent/customer-agent.js', () => ({
  chayTuVanKhach: vi.fn(async () => ({
    trangThai: 'xong', traLoi: 'Dạ em chào anh Quốc ạ', log: [],
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
vi.mock('../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js', () => ({
  baoNhanVien: vi.fn(async () => true),
  CAU_GIU_CHAN: 'giữ chân',
}));

import { xuLyTinKhach } from '../../../src/modules/ai/agent/noi-zalo/luong-khach.js';
import { _resetKhoaViecChoTest } from '../../../src/modules/ai/agent/noi-zalo/khoa-viec.js';
import { guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { prisma } from '../../../src/shared/database/prisma-client.js';
import { coTinKhachMoiHon } from '../../../src/modules/ai/agent/noi-zalo/du-lieu.js';

const tinKhach = (messageId: string, content: string) => ({
  orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId, content,
  senderUid: 'kh-1', isSelf: false, laNhom: false, daTagBot: false,
});

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_KHACH = '1';
  process.env.ODOO_URL = 'http://localhost:8069';
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USERNAME = 'u';
  process.env.ODOO_PASSWORD = 'p';
  vi.clearAllMocks();
  _resetKhoaViecChoTest();
});
afterEach(() => { process.env = goc; });

// ═══════════════════════════════════════════════════════════════════════════
// LỚP 1 ở luồng KHÁCH — khe hở đo được trên prod (ca "chào" 18:23 04/08).
describe('Lớp 1 — khoá việc theo NỘI DUNG, ở luồng KHÁCH', () => {
  it('HAI messageId khác nhau, CÙNG nội dung → chỉ trả lời MỘT lần (ca 18:23 04/08)', async () => {
    // Tái hiện đúng ca prod: khách gõ "chào" hai lần cách 5 giây, Zalo sinh hai
    // messageId khác nhau. Trước khi vá: bot trả lời hai lần.
    expect(await xuLyTinKhach(tinKhach('msg-A', 'chào'))).toBe(true);
    expect(await xuLyTinKhach(tinKhach('msg-B', 'chào'))).toBe(true);

    // Cả hai lượt đều "đã xử lý" với caller (không nhường RAG), nhưng chỉ MỘT
    // câu thật sự bay sang Zalo.
    expect(vi.mocked(guiTin).mock.calls.length).toBe(1);
  });

  it('nội dung KHÁC nhau → vẫn trả lời cả hai (không chặn nhầm khách hỏi tiếp)', async () => {
    await xuLyTinKhach(tinKhach('msg-A', 'shop còn nguồn NB không'));
    await xuLyTinKhach(tinKhach('msg-B', 'giá bao nhiêu ạ'));
    expect(vi.mocked(guiTin).mock.calls.length).toBe(2);
  });

  it('cùng nội dung nhưng KHÁC hội thoại → hai khách khác nhau đều được trả lời', async () => {
    await xuLyTinKhach({ ...tinKhach('msg-A', 'chào'), conversationId: 'c1' });
    await xuLyTinKhach({ ...tinKhach('msg-B', 'chào'), conversationId: 'c2' });
    expect(vi.mocked(guiTin).mock.calls.length).toBe(2);
  });

  it('khoá đặt TRƯỚC khi gọi LLM — lượt bị chặn không đốt tiền model', async () => {
    const { dungGenerate } = await import('../../../src/modules/ai/agent/noi-zalo/llm.js');
    await xuLyTinKhach(tinKhach('msg-A', 'chào'));
    await xuLyTinKhach(tinKhach('msg-B', 'chào'));
    // Lượt thứ hai phải chết ở cổng khoá, KHÔNG được đi tới provider.
    expect(vi.mocked(dungGenerate).mock.calls.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỚP 2 — aiSuggestion.count. Lớp 1 KHÔNG thay được lớp này: khoá việc chỉ sống
// 100 giây, còn tin trùng từ Zalo có thể đến lại sau đó rất lâu (sync lại lịch
// sử, webhook gửi lại). Xoá lớp 2 là mở lại cửa cho bot trả lời lại tin cũ.
describe('Lớp 2 — aiSuggestion.count chống retry CÙNG messageId', () => {
  it('messageId ĐÃ có câu trả lời → bỏ qua, không trả lời lần hai', async () => {
    vi.mocked(prisma.aiSuggestion.count).mockResolvedValueOnce(1 as never);
    expect(await xuLyTinKhach(tinKhach('msg-cu', 'shop còn hàng không'))).toBe(true);
    expect(vi.mocked(guiTin).mock.calls.length).toBe(0);
  });

  it('vẫn chặn được khi khoá việc ĐÃ HẾT HẠN (ngoài tầm 100 giây của Lớp 1)', async () => {
    // Mô phỏng: tin cũ quay lại sau khi khoá việc hết hạn — reset khoá để giả
    // lập đúng tình huống đó. Chỉ Lớp 2 còn đứng chặn.
    _resetKhoaViecChoTest();
    vi.mocked(prisma.aiSuggestion.count).mockResolvedValueOnce(1 as never);
    await xuLyTinKhach(tinKhach('msg-cu', 'shop còn hàng không'));
    expect(vi.mocked(guiTin).mock.calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỚP 3 — coTinKhachMoiHon. Lớp 1 KHÔNG thay được lớp này: hai tin ở đây có
// NỘI DUNG KHÁC NHAU ("cả tháng này" / "và tháng trước") nên khoá theo nội dung
// không hề khớp. Lớp 3 giải bài toán GỘP NGỮ CẢNH, không phải bài toán trùng.
describe('Lớp 3 — coTinKhachMoiHon bỏ lượt khi khách đã gõ tin mới hơn', () => {
  it('có tin khách mới hơn và chưa ghi tool → im lặng, nhường lượt sau gộp', async () => {
    vi.mocked(coTinKhachMoiHon).mockResolvedValueOnce(true as never);
    expect(await xuLyTinKhach(tinKhach('msg-1', 'cho em hỏi'))).toBe(true);
    expect(vi.mocked(guiTin).mock.calls.length).toBe(0);
  });

  it('lượt sau (tin mới nhất, nội dung khác) vẫn trả lời bình thường', async () => {
    vi.mocked(coTinKhachMoiHon).mockResolvedValueOnce(true as never);
    await xuLyTinKhach(tinKhach('msg-1', 'cho em hỏi'));
    await xuLyTinKhach(tinKhach('msg-2', 'nguồn NB 12V100W còn không ạ'));
    expect(vi.mocked(guiTin).mock.calls.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RỦI RO CỦA CHÍNH BẢN VÁ NÀY — chặn NHẦM tin hợp lệ.
//
// Bug S13804 07/08 dạy: câu XÁC NHẬN ngắn ("đúng rồi", "ok") là tín hiệu quyết
// định, bị nuốt là bot hỏi lại vô tận và đơn không bao giờ được ghi. Khoá việc
// băm theo nội dung, mà "ok" thì lần nào cũng ra CÙNG một mã băm — nên khách
// gõ "ok" hai lần cho HAI câu hỏi KHÁC NHAU của bot là có nguy cơ mất lượt thứ
// hai. Ca dưới ghim đúng ranh giới đó lại.
describe('không được chặn NHẦM — câu xác nhận ngắn (bài học S13804 07/08)', () => {
  it('khách gõ "ok" cho hai câu hỏi khác nhau → lượt thứ hai VẪN phải chạy', async () => {
    expect(await xuLyTinKhach(tinKhach('msg-1', 'ok'))).toBe(true);
    // Bot hỏi tiếp một câu khác, khách lại "ok" — đây là việc MỚI, không phải
    // tin trùng. Nuốt lượt này là tái hiện đúng bug S13804.
    expect(await xuLyTinKhach(tinKhach('msg-2', 'ok'))).toBe(true);
    expect(vi.mocked(guiTin).mock.calls.length).toBe(2);
  });
});
