// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 T6 — MỌI đường CRM tự trả lời khách IM ở nhóm bot phụ trách (nhóm có chức năng HIỆU LỰC trên trang Quyền bot).
//
// Vì sao: ở nhóm, agent khách CRM và đường khách của bot (Hermes) cùng nổ khi nick bị tag ⇒ khách nhận HAI câu, câu của
// CRM có thể nói giá / gửi PDF. Mỗi đường bốn ca: nhóm đã xếp ⇒ im · nhóm chưa xếp ⇒ như cũ · DM ⇒ như cũ (không tra) ·
// tra lỗi ⇒ im. Nguồn tra (docCauHinhCongKhai — đúng hàm payload /api/public/bot-quyen) được mock; cổng thật chạy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    aiConfig: {
      findUnique: vi.fn(async () => ({
        orgId: 'o1', autoReplyEnabled: true, guidelineEngineMode: 'off', provider: 'p', model: 'm',
        embedProvider: 'e', embedModel: 'em', embedBaseUrl: null, autoReplyTagOnHandoff: 'handoff',
        autoReplyConfidenceThreshold: 0.5,
      })),
    },
    aiSuggestion: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
    knowledgeChunk: { count: vi.fn(async () => 0) },
    conversation: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'c1', groupGreetedAt: null, botGroupBlocked: false })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    contact: { findUnique: vi.fn(async () => null) },
    message: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('../../../src/modules/bot-quyen/bot-quyen-cong-khai.js', () => ({
  docCauHinhCongKhai: vi.fn(),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({
    accountId: 'a1', threadId: 't1', threadType: 1, zaloUid: 'u1', tenKhach: null, sdtKhach: null,
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
  trichNoiDungTaiLieu: vi.fn(async () => null),
}));
vi.mock('../../../src/modules/ai/knowledge/muc-luc.js', () => ({ mucLucSanPham: vi.fn(async () => null) }));
vi.mock('../../../src/modules/ai/agent/customer-agent.js', () => ({
  chayTuVanKhach: vi.fn(async () => ({
    trangThai: 'xong', traLoi: 'Dạ em chào anh ạ', log: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../src/modules/ai/knowledge/product-image.js', () => ({ findImageForReply: vi.fn(() => null) }));
vi.mock('../../../src/modules/ai/knowledge/anh-san-pham.js', () => ({
  timAnhSanPhamTheoReply: vi.fn(async () => []),
  taiAnhVeTam: vi.fn(async () => '/tmp/x.png'),
}));
vi.mock('../../../src/modules/ai/agent/noi-zalo/bao-nhan-vien.js', () => ({
  baoNhanVien: vi.fn(async () => true),
  CAU_GIU_CHAN: 'giữ chân',
  xoaLichSuBao: vi.fn(),
}));
vi.mock('../../../src/modules/ai/knowledge/ai-auto-reply-hook.js', () => ({ onIncomingMessageHook: vi.fn(async () => {}) }));
vi.mock('../../../src/modules/ai/ai-service.js', () => ({
  generateText: vi.fn(async () => ''),
  getProviderApiKey: vi.fn(async () => 'k'),
}));
vi.mock('../../../src/modules/ai/provider-registry.js', () => ({ getProviderBaseUrl: vi.fn(async () => undefined) }));
// Đọc ảnh (OCR) — giữ hàm thật, chỉ thay lời gọi model nhìn ảnh để đếm (nhóm bot phụ trách ⇒ KHÔNG được gọi: tốn tiền vô ích).
vi.mock('../../../src/modules/ai/agent/noi-zalo/doc-anh.js', async (goc) => ({
  ...(await goc<typeof import('../../../src/modules/ai/agent/noi-zalo/doc-anh.js')>()),
  docAnh: vi.fn(async () => 'module P10 full color'),
  docPdf: vi.fn(async () => 'phiếu nhập P04520'),
}));

import { docCauHinhCongKhai } from '../../../src/modules/bot-quyen/bot-quyen-cong-khai.js';
import { _xoaChoTest, demAiKhachBoQua } from '../../../src/modules/bot-quyen/nhom-bot-phu-trach.js';
import { guiTin } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { chayTuVanKhach } from '../../../src/modules/ai/agent/customer-agent.js';
import { onIncomingMessageHook } from '../../../src/modules/ai/knowledge/ai-auto-reply-hook.js';
import { xuLyTinKhach } from '../../../src/modules/ai/agent/noi-zalo/luong-khach.js';
import { xuLyTinMedia } from '../../../src/modules/ai/agent/noi-zalo/luong-media.js';
import { chaoNhomKhiThem } from '../../../src/modules/ai/agent/noi-zalo/chao-nhom.js';
import { runAutoReplyForMessage } from '../../../src/modules/ai/knowledge/auto-reply-wiring.js';
import { xuLyTinNhanVien } from '../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js';
import { docAnh } from '../../../src/modules/ai/agent/noi-zalo/doc-anh.js';
import { timDich } from '../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';
import { _resetKhoaViecChoTest } from '../../../src/modules/ai/agent/noi-zalo/khoa-viec.js';
import { prisma } from '../../../src/shared/database/prisma-client.js';
import { logger } from '../../../src/shared/utils/logger.js';

type CheDo = 'da_xep' | 'chua_xep' | 'loi';
function datNhom(cheDo: CheDo, chucNang = 'khach') {
  const m = vi.mocked(docCauHinhCongKhai);
  if (cheDo === 'loi') {
    m.mockRejectedValue(new Error('db sập'));
    return;
  }
  m.mockResolvedValue({
    phien_ban: 'x', nhan_vien: [], nick_crm: [],
    nhom: cheDo === 'da_xep'
      ? [{ conversation_id: 'c1', chuc_nang: chucNang, external_thread_id: 'g1', nick_uid: null, ten_dang_ky: '', mac_dinh: false }]
      : [{ conversation_id: 'nhom-khac', chuc_nang: 'khach', external_thread_id: 'g2', nick_uid: null, ten_dang_ky: '', mac_dinh: true }],
  });
}

let goc: NodeJS.ProcessEnv;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_KHACH = '1';
  process.env.AI_AGENT_NHANVIEN = '1';
  process.env.ODOO_URL = 'http://localhost:8069';
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USERNAME = 'u';
  process.env.ODOO_PASSWORD = 'p';
  vi.clearAllMocks();
  _resetKhoaViecChoTest();
  _xoaChoTest();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = goc;
  vi.restoreAllMocks();
});

// ─── 1. Agent khách (luong-khach.ts) ────────────────────────────────────────
describe('agent khách — xuLyTinKhach', () => {
  let so = 0;
  const tin = (laNhom: boolean) => ({
    orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: `m${++so}`, content: `thông số p10 lần ${so}`,
    senderUid: 'kh-1', isSelf: false, laNhom, daTagBot: true,
  });

  it.each(['khach', 'sales', 'kho'])('nhóm đã xếp (%s) + tag nick ⇒ IM, trả TRUE (RAG cũ cũng không nói), không gọi LLM', async (cn) => {
    datNhom('da_xep', cn);
    expect(await xuLyTinKhach(tin(true))).toBe(true);
    expect(chayTuVanKhach).not.toHaveBeenCalled();
    expect(guiTin).not.toHaveBeenCalled();
    expect(demAiKhachBoQua('o1').nhom_do_bot_phu_trach).toBe(1);
  });

  it('nhóm CHƯA xếp + tag nick ⇒ như cũ (agent trả lời)', async () => {
    datNhom('chua_xep');
    expect(await xuLyTinKhach(tin(true))).toBe(true);
    expect(chayTuVanKhach).toHaveBeenCalledTimes(1);
    expect(guiTin).toHaveBeenCalled();
  });

  it('DM ⇒ như cũ, KHÔNG tra trang Quyền bot', async () => {
    datNhom('da_xep');
    await xuLyTinKhach(tin(false));
    expect(chayTuVanKhach).toHaveBeenCalledTimes(1);
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ IM ở nhóm + WARNING', async () => {
    datNhom('loi');
    expect(await xuLyTinKhach(tin(true))).toBe(true);
    expect(chayTuVanKhach).not.toHaveBeenCalled();
    expect(guiTin).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ ai_khach_bo_qua: 'tra_cuu_loi' }), expect.any(String));
  });
});

// ─── 2. RAG auto-reply (auto-reply-wiring.ts) ───────────────────────────────
describe('RAG auto-reply — runAutoReplyForMessage', () => {
  const chay = () => runAutoReplyForMessage({
    orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: 'm1', messageContent: 'thông số p10',
  });
  const hoiThoai = (threadType: 'group' | 'user') => vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
    id: 'c1', isVirtual: false, zaloAccountId: 'a1', externalThreadId: 'g1', threadType, contactId: null,
  } as never);

  it('nhóm đã xếp ⇒ IM (không vào hook RAG)', async () => {
    hoiThoai('group');
    datNhom('da_xep', 'ke_toan');
    await chay();
    expect(onIncomingMessageHook).not.toHaveBeenCalled();
    expect(demAiKhachBoQua('o1').nhom_do_bot_phu_trach).toBe(1);
  });

  it('nhóm chưa xếp ⇒ như cũ', async () => {
    hoiThoai('group');
    datNhom('chua_xep');
    await chay();
    expect(onIncomingMessageHook).toHaveBeenCalledTimes(1);
  });

  it('DM ⇒ như cũ, không tra', async () => {
    hoiThoai('user');
    datNhom('da_xep');
    await chay();
    expect(onIncomingMessageHook).toHaveBeenCalledTimes(1);
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ IM ở nhóm', async () => {
    hoiThoai('group');
    datNhom('loi');
    await chay();
    expect(onIncomingMessageHook).not.toHaveBeenCalled();
  });
});

// ─── 3. Media: câu "chưa đọc được ảnh" trong nhóm có tag (luong-media.ts) ────
describe('media — câu báo ảnh hỏng trong nhóm có tag', () => {
  // ảnh không có URL ⇒ đọc hỏng ⇒ rơi xuống câu báo của nhóm có tag
  const anh = (laNhom: boolean) => xuLyTinMedia(
    { orgId: 'o1', conversationId: 'c1', messageId: 'm1', laNhom, daTagBot: true, content: '{}' }, 'image',
  );
  const cauAnhHong = () => vi.mocked(guiTin).mock.calls.filter((c) => String(c[1]).includes('chưa đọc được ảnh'));

  it('nhóm đã xếp ⇒ IM', async () => {
    datNhom('da_xep');
    expect(await anh(true)).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('nhóm chưa xếp ⇒ như cũ (một câu báo)', async () => {
    datNhom('chua_xep');
    expect(await anh(true)).toBe(true);
    expect(cauAnhHong()).toHaveLength(1);
  });

  it('DM ⇒ như cũ (giữ chân + báo người), không tra', async () => {
    datNhom('da_xep');
    expect(await anh(false)).toBe(true);
    expect(guiTin).toHaveBeenCalled();
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ IM', async () => {
    datNhom('loi');
    expect(await anh(true)).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });
});

// ─── 4. Chào nhóm (chao-nhom.ts) ────────────────────────────────────────────
describe('chào nhóm — chaoNhomKhiThem', () => {
  const chao = () => chaoNhomKhiThem({
    orgId: 'o1', accountId: 'a1', groupId: 'g1', groupName: 'Nhóm', botUid: 'bot',
    api: { getGroupChatHistory: async () => ({}) }, tenShop: 'Shop',
  });

  it('nhóm đã xếp ⇒ KHÔNG chào, KHÔNG đặt cờ đã chào', async () => {
    datNhom('da_xep');
    expect(await chao()).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('nhóm chưa xếp ⇒ như cũ (chào một lần)', async () => {
    datNhom('chua_xep');
    expect(await chao()).toBe(true);
    expect(guiTin).toHaveBeenCalledTimes(1);
  });

  it('tra lỗi ⇒ không chào', async () => {
    datNhom('loi');
    expect(await chao()).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });
});

// ─── 5. Luồng NHÂN VIÊN của CRM (luong-nhan-vien.ts — agent NV + máy gom đơn) ──
// Nhóm bot phụ trách: bot (Hermes) nhận lệnh NV ở đó — agent NV của CRM chạy song song là NV nhận HAI câu (và hai đơn).
describe('agent nhân viên — xuLyTinNhanVien', () => {
  let so = 0;
  // Tag trống ("@bot" không nội dung, không có tin trước) ⇒ đường rẻ nhất có GỬI: "Dạ em đây…".
  const tin = (laNhom: boolean) => ({
    orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: `nv${++so}`, content: '',
    senderUid: 'nv-1', isSelf: true, laNhom, daTagBot: true,
  });
  const cauDaEmDay = () => vi.mocked(guiTin).mock.calls.filter((c) => String(c[1]).includes('Dạ em đây'));

  it('nhóm đã xếp + tag ⇒ IM, trả TRUE, không tra đích / không gửi', async () => {
    datNhom('da_xep', 'sales');
    expect(await xuLyTinNhanVien(tin(true))).toBe(true);
    expect(timDich).not.toHaveBeenCalled();
    expect(guiTin).not.toHaveBeenCalled();
    expect(demAiKhachBoQua('o1').nhom_do_bot_phu_trach).toBe(1);
  });

  it('nhóm chưa xếp ⇒ như cũ (một câu "Dạ em đây")', async () => {
    datNhom('chua_xep');
    expect(await xuLyTinNhanVien(tin(true))).toBe(true);
    expect(cauDaEmDay()).toHaveLength(1);
  });

  it('DM ⇒ như cũ, không tra trang Quyền bot', async () => {
    datNhom('da_xep');
    expect(await xuLyTinNhanVien(tin(false))).toBe(true);
    expect(cauDaEmDay()).toHaveLength(1);
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ IM ở nhóm', async () => {
    datNhom('loi');
    expect(await xuLyTinNhanVien(tin(true))).toBe(true);
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('nhóm đã xếp, NV KHÔNG tag ⇒ cổng tag chặn trước (false), không cần tra', async () => {
    datNhom('da_xep');
    expect(await xuLyTinNhanVien({ ...tin(true), content: 'tán gẫu', daTagBot: false })).toBe(false);
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });
});

// ─── 6. Media: ĐỌC ẢNH (OCR) rồi chuyển luồng NV/khách (luong-media.ts docVaChuyenTiep) ──
describe('media — đọc ảnh rồi chuyển tiếp', () => {
  const anhCoUrl = (laNhom: boolean, daTagBot = true) => xuLyTinMedia(
    {
      orgId: 'o1', conversationId: 'c1', messageId: 'ma1', laNhom, daTagBot, senderUid: 'nv-1', isSelf: false,
      content: JSON.stringify({ href: 'https://zalo.example/anh.jpg', title: 'lên đơn này' }),
    },
    'image',
  );

  it('nhóm đã xếp ⇒ KHÔNG đọc ảnh (không tốn OCR), không gửi, trả TRUE — kể cả ảnh không tag', async () => {
    datNhom('da_xep');
    expect(await anhCoUrl(true)).toBe(true);
    expect(await anhCoUrl(true, false)).toBe(true);
    expect(docAnh).not.toHaveBeenCalled();
    expect(guiTin).not.toHaveBeenCalled();
  });

  it('nhóm chưa xếp ⇒ như cũ (đọc ảnh)', async () => {
    datNhom('chua_xep');
    await anhCoUrl(true);
    expect(docAnh).toHaveBeenCalledTimes(1);
  });

  it('DM ⇒ như cũ (đọc ảnh), không tra', async () => {
    datNhom('da_xep');
    await anhCoUrl(false);
    expect(docAnh).toHaveBeenCalledTimes(1);
    expect(docCauHinhCongKhai).not.toHaveBeenCalled();
  });

  it('tra lỗi ⇒ không đọc ảnh, IM', async () => {
    datNhom('loi');
    expect(await anhCoUrl(true)).toBe(true);
    expect(docAnh).not.toHaveBeenCalled();
    expect(guiTin).not.toHaveBeenCalled();
  });
});
