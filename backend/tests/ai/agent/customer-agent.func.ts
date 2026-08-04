// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: luồng KHÁCH HÀNG.
//
// Trọng tâm: ranh giới bảo vệ thông tin nội bộ. Khách KHÔNG được thấy id, giá vốn,
// tồn theo kho, công nợ — và KHÔNG được tự tạo đơn (sale phải chốt).
import { describe, it, expect, vi } from 'vitest';
import {
  chayTuVanKhach,
  buildCustomerRegistry,
  buildCustomerSystemPrompt,
} from '../../../src/modules/ai/agent/customer-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({ searchRead: vi.fn(async () => []), execute: vi.fn() }) as unknown as OdooClient;

const fakeLLM = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const goiTool = (name: string, input: Record<string, unknown>): AgentTurn => ({
  text: '', toolCalls: [{ id: 't1', name, input }],
  stopReason: 'tool_use', raw: [{ type: 'tool_use', id: 't1', name, input }],
});
const xong = (text: string): AgentTurn => ({
  text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
});

const deps = (over: Record<string, unknown> = {}) => ({
  odoo: fakeOdoo(),
  generate: fakeLLM([xong('Dạ em nghe ạ')]),
  ghiNhanChuyenSale: vi.fn(async () => {}),
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  bizName: 'LEDNELIA', message: 'giá đèn P10 bao nhiêu ạ', ...over,
});

describe('buildCustomerRegistry — CHỈ 4 tool', () => {
  it('KHÔNG có tao_don_nhap (khách không được tạo đơn)', () => {
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });

    expect(r.has('tao_don_nhap')).toBe(false);
  });

  it('KHÔNG có tra_khach_hang (sẽ lộ công nợ + tên khách trùng SĐT)', () => {
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });

    expect(r.has('tra_khach_hang')).toBe(false);
  });

  it('có đúng 3 tool: danh mục, tra SP, chuyển sale', () => {
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });

    expect(r.definitions().map((d) => d.name)).toEqual([
      'chuyen_sale', 'tra_danh_muc', 'tra_san_pham',
    ]);
  });

  it('KHÔNG có tra_ton_kho — với khách thì LUÔN báo còn hàng', () => {
    // Anh chốt 2026-08-02: không bao giờ nói số tồn cho khách, và không từ
    // chối đơn vì thiếu hàng. Giữ tool chỉ tổ tốn một vòng gọi rồi bỏ kết quả
    // (đo thật: bot gọi tra_ton_kho xong vẫn lờ đi).
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });

    expect(r.has('tra_ton_kho')).toBe(false);
  });

  it('KHÔNG có 3 tool BÁO CÁO — doanh thu/lợi nhuận là thông tin nội bộ', () => {
    // Test này chống việc refactor sau vô tình gom registry, mở báo cáo cho
    // khách. Cùng nguyên tắc khiến registry khách không có tra_khach_hang.
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });
    const ten = r.definitions().map((d) => d.name);

    expect(ten).not.toContain('bao_cao_tong_quan');
    expect(ten).not.toContain('bao_cao_ban_hang');
    expect(ten).not.toContain('canh_bao_ton_kho');
  });

  it('CÓ tra_danh_muc — khách hỏi "bên bạn bán gì" phải trả lời được', () => {
    // Bug thật 2026-07-30: thiếu tool này, bot đoán từ khoá 3 lần rồi chuyển sale
    // cho câu hỏi mở đầu phổ biến nhất của khách buôn.
    const r = buildCustomerRegistry({ odoo: fakeOdoo(), ghiNhanChuyenSale: async () => {} });

    expect(r.has('tra_danh_muc')).toBe(true);
  });
});

describe('buildCustomerSystemPrompt — ranh giới', () => {
  const p = buildCustomerSystemPrompt('LEDNELIA');

  it('nói rõ đang chat với KHÁCH, không phải nhân viên', () => {
    expect(p).toContain('KHÁCH HÀNG');
  });

  it('cấm lộ id sản phẩm / mã nội bộ', () => {
    expect(p).toContain('Không nói id sản phẩm');
  });

  it('cấm lộ giá vốn, tồn theo kho, công nợ', () => {
    expect(p).toContain('giá vốn');
    expect(p).toContain('công nợ');
  });

  it('cấm hứa giảm giá / ngày giao', () => {
    expect(p).toContain('Không hứa giảm giá');
  });

  it('SP chưa có giá → KHÔNG nói 0đ', () => {
    expect(p).toContain('KHÔNG nói "0đ"');
  });

  it('khách muốn mua → chuyển sale, bot KHÔNG tự lên đơn', () => {
    expect(p).toContain('Bot không tự lên đơn');
  });

  it('giọng khách: lịch sự, có dạ/ạ, không markdown', () => {
    expect(p).toContain('dạ/ạ');
    // Luật markdown gộp về MỘT chỗ ở đầu prompt (2026-08-02) — trước đây lặp
    // ba chỗ mà model vẫn bỏ qua vì prompt quá dài.
    expect(p).toContain('KHÔNG render markdown');
  });

  it('nhắc đừng tra lòng vòng (khách chờ lâu là mất kiên nhẫn)', () => {
    expect(p).toContain('Đừng tra lòng vòng');
  });

  it('khách hỏi "bán gì" → chỉ đúng sang tra_danh_muc', () => {
    expect(p).toContain('tra_danh_muc');
  });

  it('CẤM chuyển sale khi khách chỉ hỏi shop bán gì / hỏi giá / hỏi tồn', () => {
    // Bug thật 2026-07-30: mục "Khi nào chuyển sale" cũ liệt kê "hỏi ngoài phạm vi
    // tư vấn" → model coi câu hỏi mở là ngoài phạm vi rồi đẩy sang sale ngay.
    expect(p).toContain('KHÔNG chuyển sale khi');
    expect(p).toContain('Tra trước, chuyển sau');
  });

  it('dùng tên doanh nghiệp truyền vào', () => {
    expect(buildCustomerSystemPrompt('SHOP ABC')).toContain('SHOP ABC');
  });

  it('giữ ngắn — prompt nằm trong MỌI request', () => {
    // VÌ SAO CẦN TRẦN (bug thật 2026-08-02): prompt khách phình tới 3.826 ký tự
    // (gấp đôi prompt nhân viên) vì mỗi lần sửa lỗi lại thêm một mục. Hệ quả:
    // luật "không markdown" bị lặp BA chỗ mà model vẫn bỏ qua — nội dung ở giữa
    // prompt dài bị loãng. Gộp lại còn 2.673.
    //
    // Đo bằng TÊN THẬT production dùng, không phải tên ngắn (xem staff-command).
    //
    // Thêm mục lần sau: NÉN TRƯỚC, nới trần sau. Prompt đi kèm MỌI request nên
    // phình ra là tốn tiền ở mọi lượt chat.
    const BIZ_THAT = 'LEDNELIA - shop đèn LED & phụ kiện điện';
    expect(buildCustomerSystemPrompt(BIZ_THAT).length).toBeLessThan(2800);
  });

  it('luật KHÔNG MARKDOWN nằm ngay đầu prompt (model đọc kỹ nhất chỗ đó)', () => {
    // Lặp luật ở giữa prompt dài KHÔNG ăn thua — đã thử 3 chỗ vẫn lọt bullet.
    const p2 = buildCustomerSystemPrompt('X');
    expect(p2.indexOf('KHÔNG render markdown')).toBeLessThan(300);
  });
});

describe('ẢNH SẢN PHẨM — gửi kèm câu trả lời (bug thật 2026-08-02)', () => {
  // Kho có 250 ảnh / 232 SP trong `backend/product-images/`, hàm
  // `findImageForReply` hoạt động tốt — nhưng luồng agent MỚI không gọi nó,
  // nên ảnh không bao giờ được gửi. Luồng cũ (auto-reply-wiring) thì có.

  it('bot nhắc đúng tên SP có ảnh → trả về đường dẫn ảnh', async () => {
    const d = deps({
      generate: fakeLLM([xong('Dạ Nguồn NB Ngoài Trời 12V60W giá 68.000đ ạ')]),
    });

    const r = await chayTuVanKhach(d, input());

    expect(r.trangThai).toBe('xong');
    if (r.trangThai === 'xong') expect(r.anhSanPham).toBeTruthy();
  });

  it('câu trả lời chung chung → KHÔNG gửi ảnh (thà không gửi còn hơn gửi nhầm)', async () => {
    const d = deps({ generate: fakeLLM([xong('Dạ em chào anh chị ạ')]) });

    const r = await chayTuVanKhach(d, input());

    if (r.trangThai === 'xong') expect(r.anhSanPham).toBeUndefined();
  });

  it('tìm ảnh theo CÂU TRẢ LỜI, không theo câu hỏi', async () => {
    // Chỉ gửi khi bot đã CHỐT được đúng một SP. Câu hỏi có thể mơ hồ.
    const d = deps({ generate: fakeLLM([xong('Dạ anh chị cần loại nào ạ?')]) });

    const r = await chayTuVanKhach(d, input({ message: 'Nguồn NB Ngoài Trời 12V60W' }));

    if (r.trangThai === 'xong') expect(r.anhSanPham).toBeUndefined();
  });
});

describe('chayTuVanKhach — luồng', () => {
  it('trả lời được → xong + traLoi', async () => {
    const d = deps({ generate: fakeLLM([xong('Dạ giá 120.000đ ạ')]) });

    const r = await chayTuVanKhach(d, input());

    expect(r.trangThai).toBe('xong');
    if (r.trangThai === 'xong') expect(r.traLoi).toBe('Dạ giá 120.000đ ạ');
  });

  it('trần vòng lặp mặc định 5 (thấp hơn staff=8 vì khách chờ ít kiên nhẫn)', async () => {
    const d = deps({ generate: fakeLLM([goiTool('tra_san_pham', { ten: 'P10' })]) });

    const r = await chayTuVanKhach(d, input());

    expect(r.trangThai).toBe('chua_hoan_tat');
    // 5 vòng, không phải 8. Luồng dài nhất (danh mục → SP → tồn) ăn 3 vòng tool,
    // cần chỗ dư để chốt câu trả lời.
    expect(r.log.length).toBe(5);
  });

  it('chạm trần → chua_hoan_tat, KHÔNG có traLoi (câu dở dang)', async () => {
    // Gửi câu dở cho khách tệ hơn im lặng — sale vào tiếp.
    const d = deps({ generate: fakeLLM([goiTool('tra_san_pham', { ten: 'x' })]) });

    const r = await chayTuVanKhach(d, input());

    expect(r).not.toHaveProperty('traLoi');
  });

  it('ghép lịch sử vào prompt để bot hiểu ngữ cảnh', async () => {
    const generate = fakeLLM([xong('ok')]);
    await chayTuVanKhach(deps({ generate }), input({
      message: 'thế còn loại kia?',
      history: [
        { vai: 'khach' as const, noiDung: 'P10 giá bao nhiêu' },
        { vai: 'shop' as const, noiDung: 'Dạ 120.000đ ạ' },
      ],
    }));

    const msg = generate.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('P10 giá bao nhiêu');
    expect(msg).toContain('120.000đ');
    expect(msg).toContain('thế còn loại kia?');
  });

  it('không có lịch sử → gửi thẳng tin khách, không thêm nhiễu', async () => {
    const generate = fakeLLM([xong('ok')]);
    await chayTuVanKhach(deps({ generate }), input({ message: 'giá P10' }));

    expect(generate.mock.calls[0][0].messages[0].content).toBe('giá P10');
  });

  it('chỉ gửi 3 tool cho LLM', async () => {
    const generate = fakeLLM([xong('ok')]);
    await chayTuVanKhach(deps({ generate }), input());

    expect(generate.mock.calls[0][0].tools).toHaveLength(3);
  });

  it('quan trắc ghi log mọi tool call', async () => {
    const ghiLog = vi.fn();
    const d = deps({
      generate: fakeLLM([goiTool('tra_san_pham', { ten: 'P10' }), xong('Dạ 120.000đ')]),
      ghiLog,
    });

    await chayTuVanKhach(d, input());

    expect(ghiLog).toHaveBeenCalledTimes(1);
    expect(ghiLog.mock.calls[0][0].toolName).toBe('tra_san_pham');
  });

  it('ghi nhận chuyển sale khi model gọi chuyen_sale', async () => {
    const ghiNhanChuyenSale = vi.fn(async () => {});
    const d = deps({
      generate: fakeLLM([
        goiTool('chuyen_sale', { ly_do: 'khac', tom_tat: 'Khách muốn mua 10 cái' }),
        xong('Dạ em chuyển sale ạ'),
      ]),
      ghiNhanChuyenSale,
    });

    await chayTuVanKhach(d, input());

    expect(ghiNhanChuyenSale).toHaveBeenCalledWith(
      expect.objectContaining({ tomTat: 'Khách muốn mua 10 cái' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Khách TỰ CHỐT ĐƠN — hàng rào phải ở CODE', () => {
  const odooGia = () => ({
    searchRead: vi.fn(async () => []),
    execute: vi.fn(async () => 1),
  }) as unknown as OdooClient;

  it('KHÔNG bật → registry KHÔNG có tool ghi (mặc định an toàn)', () => {
    const r = buildCustomerRegistry({ odoo: odooGia(), ghiNhanChuyenSale: async () => {} });

    expect(r.has('tao_don_nhap')).toBe(false);
    expect(r.has('tao_khach_hang')).toBe(false);
    // Không tool nào được đánh dấu GHI — đây là ranh giới, không phải tuỳ chọn.
    expect(r.definitions().filter((d) => d.mutates).map((d) => d.name)).toEqual(['chuyen_sale']);
  });

  it('BẬT → có đúng hai tool ghi', () => {
    const r = buildCustomerRegistry({
      odoo: odooGia(), ghiNhanChuyenSale: async () => {},
      choKhachChotDon: { conversationId: 'c', seq: 1, tranTien: 20_000_000 },
    });

    expect(r.has('tao_don_nhap')).toBe(true);
    expect(r.has('tao_khach_hang')).toBe(true);
  });

  it('BẬT vẫn KHÔNG có tool nội bộ — công nợ/báo cáo/giá vốn', () => {
    // Cho khách chốt đơn ≠ cho khách xem số liệu nội bộ.
    const r = buildCustomerRegistry({
      odoo: odooGia(), ghiNhanChuyenSale: async () => {},
      choKhachChotDon: { conversationId: 'c', seq: 1, tranTien: 20_000_000 },
    });

    for (const t of ['xuat_cong_no', 'bao_cao_tong_quan', 'bao_cao_ban_hang', 'tra_khach_hang', 'tra_ton_kho']) {
      expect(r.has(t), `khách KHÔNG được có ${t}`).toBe(false);
    }
  });

  it('prompt BẬT → dạy tự lên đơn; TẮT → dạy chuyển sale', () => {
    expect(buildCustomerSystemPrompt('X', true)).toContain('TỰ LÊN ĐƠN');
    expect(buildCustomerSystemPrompt('X', false)).toContain('Bot không tự lên đơn');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Prompt không được TỰ dùng markdown', () => {
  // Bug thật 2026-08-05: bot gửi khách "địa chỉ **Gò Vấp**" — Zalo hiện ra dấu
  // sao. Prompt CẤM markdown nhưng chính nó chứa 26 dấu ** (kể cả dòng cấm:
  // "**Zalo KHÔNG render markdown.**"). Model bắt chước những gì nó THẤY, không
  // chỉ những gì nó ĐỌC.
  it.each([true, false])('không có dấu ** nào (tuChotDon=%s)', (chot) => {
    const p = buildCustomerSystemPrompt('LEDNELIA', chot);

    expect(p.match(/\*\*/g)).toBeNull();
  });

  it('vẫn có luật cấm markdown, nằm ở đầu prompt', () => {
    const p = buildCustomerSystemPrompt('LEDNELIA');

    expect(p).toContain('KHÔNG render markdown');
    expect(p.indexOf('KHÔNG render markdown')).toBeLessThan(300);
  });
});

describe('Khách chốt đủ → LÊN ĐƠN, không chuyển sale', () => {
  // Bug thật 2026-08-05: khách chốt 100 cuộn, đưa SĐT + địa chỉ + tên, mà bot
  // vẫn "chuyển sang cho anh chị sale". Nguyên nhân: bot gọi `tra_khach_hang`
  // (tool KHÔNG có trong registry khách), thất bại, rồi bỏ cuộc.
  const p = () => buildCustomerSystemPrompt('LEDNELIA', true);

  it('cấm rõ chuyen_sale khi đã chốt đủ', () => {
    expect(p()).toContain('CẤM `chuyen_sale` khi khách đã chốt đủ');
  });

  it('nói rõ KHÔNG có tool tra khách — đừng đi tìm', () => {
    expect(p()).toContain('KHÔNG có tool tra khách');
  });

  it('dạy dùng tên Zalo sẵn có thay vì hỏi lại', () => {
    expect(p()).toContain('TÊN ZALO');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Câu trả lời RỖNG → chưa hoàn tất, KHÔNG trả "xong"', () => {
  // Bug thật 2026-08-05: model kết thúc với stopReason='end_turn' nhưng text
  // rỗng. Agent trả 'xong' với chuỗi rỗng → caller gọi sendMessage → Zalo ném
  // 'Missing message content' → agent báo lỗi → NHƯỜNG luồng RAG cũ.
  //
  // Khách nhận câu của luồng RAG (lặp y hệt câu trước, nói "để em kiểm tra tồn
  // kho") thay vì câu agent vừa tra Odoo.
  const odooGia = () => ({ searchRead: vi.fn(async () => []), execute: vi.fn() }) as unknown as OdooClient;

  it.each(['', '   ', '\n\n'])('text = %j → chua_hoan_tat', async (text) => {
    const generate = vi.fn(async () => ({
      text, toolCalls: [], stopReason: 'end_turn' as const,
      raw: [], usage: { inputTokens: 1, outputTokens: 0 },
    }));

    const kq = await chayTuVanKhach(
      { odoo: odooGia(), generate, ghiNhanChuyenSale: async () => {} },
      { bizName: 'X', message: 'led dây còn không' },
    );

    expect(kq.trangThai).toBe('chua_hoan_tat');
  });

  it('text có nội dung → vẫn xong bình thường', async () => {
    const generate = vi.fn(async () => ({
      text: 'Dạ bên em còn hàng ạ.', toolCalls: [], stopReason: 'end_turn' as const,
      raw: [], usage: { inputTokens: 1, outputTokens: 5 },
    }));

    const kq = await chayTuVanKhach(
      { odoo: odooGia(), generate, ghiNhanChuyenSale: async () => {} },
      { bizName: 'X', message: 'led dây còn không' },
    );

    expect(kq.trangThai).toBe('xong');
    if (kq.trangThai === 'xong') expect(kq.traLoi).toBe('Dạ bên em còn hàng ạ.');
  });

  it('text thừa khoảng trắng → cắt sạch trước khi gửi', async () => {
    const generate = vi.fn(async () => ({
      text: '  Dạ còn hàng ạ.  \n', toolCalls: [], stopReason: 'end_turn' as const,
      raw: [], usage: { inputTokens: 1, outputTokens: 5 },
    }));

    const kq = await chayTuVanKhach(
      { odoo: odooGia(), generate, ghiNhanChuyenSale: async () => {} },
      { bizName: 'X', message: 'x' },
    );

    if (kq.trangThai === 'xong') expect(kq.traLoi).toBe('Dạ còn hàng ạ.');
  });
});
