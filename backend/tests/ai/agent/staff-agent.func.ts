// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: luồng nhân viên tag bot, nối registry + vòng lặp + quan trắc.
// Mock cả Odoo lẫn LLM để chạy nhanh, không cần hạ tầng.
import { describe, it, expect, vi } from 'vitest';
import {
  chayLenhNhanVien,
  buildStaffRegistry,
} from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({
    // res.partner: verify khách (bug S13810) — trả 1 partner để tao_don_nhap qua.
    searchRead: vi.fn(async (model: string) =>
      model === 'res.partner' ? [{ id: 1, name: 'Khách Test' }] : []),
    execute: vi.fn(async () => 1),
  }) as unknown as OdooClient;

/** LLM giả trả lần lượt các lượt dựng sẵn. */
const fakeLLM = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const turnGoiTool = (name: string, input: Record<string, unknown>): AgentTurn => ({
  text: '',
  toolCalls: [{ id: 't1', name, input }],
  stopReason: 'tool_use',
  raw: [{ type: 'tool_use', id: 't1', name, input }],
});

const turnXong = (text: string): AgentTurn => ({
  text,
  toolCalls: [],
  stopReason: 'end_turn',
  raw: [{ type: 'text', text }],
});

const deps = (over: Record<string, unknown> = {}) => ({
  odoo: fakeOdoo(),
  generate: fakeLLM([turnXong('xong')]),
  ghiNhanChuyenSale: vi.fn(async () => {}),
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  bizName: 'LEDNELIA',
  conversationId: 'conv-1',
  seq: 0,
  message: { content: '@bot tra giá P10', isSelf: true },
  ...over,
});

describe('buildStaffRegistry', () => {
  it('đăng ký đủ 20 tool (10/08: +3 tool tổng quát · 11/08: +sua_vat, +bao_cao_ban_ton)', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo(),
      conversationId: 'c',
      seq: 0,
      ghiNhanChuyenSale: async () => {},
    });

    expect(r.definitions().map((d) => d.name)).toEqual([
      'bao_cao_ban_hang',
      // KIỂM KHO từng phần (11/08) — yêu cầu anh Quyết: "hôm nay bán được bao
      // nhiêu mã và còn tồn lại là bao nhiêu". CHỈ luồng nhân viên.
      'bao_cao_ban_ton',
      'bao_cao_linh_hoat',
      'bao_cao_tong_quan',
      'canh_bao_ton_kho',
      // 3 tool tổng quát (10/08): làm được việc chưa có tool riêng, thay vì
      // cứ mỗi nghiệp vụ mới lại thêm một tool.
      'doc_odoo',
      'don_cho_xac_nhan',
      'kham_pha_odoo',
      'lam_odoo',
      'sua_chiet_khau',
      'sua_don',
      // VAT cho đơn ĐÃ LÊN (11/08) — ca hỏng 20:38→20:41 nhóm Test-AI: bot hỏi
      // vòng 4 lần vì agent tự do không có tool VAT nào. CHỈ luồng nhân viên.
      'sua_vat',
      'tao_don_nhap',
      'tao_khach_hang',
      'top_san_pham',
      'tra_danh_muc',
      'tra_khach_hang',
      'tra_san_pham',
      'tra_ton_kho',
      'xuat_cong_no',
    ]);
  });

  it('sáu tool GHI (thêm sua_vat 11/08 — VAT cho đơn đã lên)', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo(),
      conversationId: 'c',
      seq: 0,
      ghiNhanChuyenSale: async () => {},
    });

    const ghi = r.definitions().filter((d) => d.mutates).map((d) => d.name);
    // sua_chiet_khau thêm 2026-08-01; tao_khach_hang 2026-08-04; sua_don 2026-08-07
    // (đổi SL/thêm hàng vào đơn cũ thay vì tạo đơn mới); lam_odoo 2026-08-10
    // (ghi tự do có phanh xoá/hàng loạt — xem tong-quat/an-toan.ts).
    // sua_vat 2026-08-11 (thêm/bỏ VAT cho đơn đã lên — ca hỏng 20:38→20:41).
    expect(ghi.sort()).toEqual([
      'lam_odoo', 'sua_chiet_khau', 'sua_don', 'sua_vat', 'tao_don_nhap', 'tao_khach_hang',
    ]);
  });
});

describe('chayLenhNhanVien — lọc tin', () => {
  it('tin KHÔNG phải lệnh → khong_phai_lenh, KHÔNG gọi LLM (0 token)', async () => {
    const d = deps();
    const r = await chayLenhNhanVien(d, input({ message: { content: 'dạ em chào chị', isSelf: true } }));

    expect(r.trangThai).toBe('khong_phai_lenh');
    expect(d.generate).not.toHaveBeenCalled();
  });

  it('tin của KHÁCH → khong_phai_lenh, kể cả khi có tag', async () => {
    const d = deps();
    const r = await chayLenhNhanVien(d, input({ message: { content: '@bot lên đơn 10 cái', isSelf: false } }));

    expect(r.trangThai).toBe('khong_phai_lenh');
    expect(d.generate).not.toHaveBeenCalled();
  });
});

describe('chayLenhNhanVien — chạy vòng lặp', () => {
  it('lệnh hợp lệ → chạy và trả kết quả', async () => {
    const d = deps({ generate: fakeLLM([turnXong('Giá P10 là 120.000đ')]) });
    const r = await chayLenhNhanVien(d, input());

    expect(r.trangThai).toBe('xong');
    if (r.trangThai === 'xong') expect(r.traLoi).toBe('Giá P10 là 120.000đ');
  });

  it('bỏ tag @bot trước khi gửi cho LLM', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input());

    const msg = generate.mock.calls[0][0].messages[0].content as string;
    expect(msg).not.toContain('@bot');
    expect(msg).toContain('tra giá P10');
  });

  it('gửi đủ 20 tool cho LLM (10/08: +3 tool tổng quát · 11/08: +sua_vat, +bao_cao_ban_ton)', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input());

    expect(generate.mock.calls[0][0].tools).toHaveLength(20);
  });

  it('system prompt là prompt NHÂN VIÊN, không phải prompt khách', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input());

    expect(generate.mock.calls[0][0].system).toContain('NHÂN VIÊN');
  });
});

describe('LỊCH SỬ hội thoại — lên đơn nhiều lượt (bug thật 2026-07-30)', () => {
  // NV : "@bot lên đơn chị Yến 1000 cái led 12v"
  // Bot: "có nhiều loại, chọn loại nào?"
  // NV : "@bot Led 2 bóng 2607 màu Trắng"
  // Bot: (không có lịch sử) → tưởng chỉ hỏi giá → BÁO GIÁ rồi dừng, không lên đơn.

  it('ghép lịch sử vào prompt để bot nhớ việc đang làm dở', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input({
      message: { content: '@bot Led 2 bóng 2607 màu Trắng', isSelf: true },
      history: [
        { vai: 'nhanvien' as const, noiDung: 'lên đơn chị Yến 1000 cái led 12v' },
        { vai: 'bot' as const, noiDung: 'Có nhiều loại led 12v, chọn loại nào?' },
      ],
    }));

    const msg = generate.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('1000 cái');
    expect(msg).toContain('chị Yến');
    expect(msg).toContain('Led 2 bóng 2607');
  });

  it('NHẮC làm tiếp việc dở — không có câu này model vẫn coi tin mới là độc lập', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input({
      history: [{ vai: 'nhanvien' as const, noiDung: 'lên đơn 10 cái' }],
    }));

    const msg = generate.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('LÀM TIẾP');
    expect(msg).toContain('thay vì hỏi lại');
  });

  it('không có lịch sử → gửi thẳng tin, không thêm nhiễu', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input());

    expect(generate.mock.calls[0][0].messages[0].content).toBe('tra giá P10');
  });

  it('nhãn vai đúng NHÂN VIÊN/BOT (không phải KHÁCH/SHOP)', async () => {
    const generate = fakeLLM([turnXong('ok')]);
    await chayLenhNhanVien(deps({ generate }), input({
      history: [
        { vai: 'nhanvien' as const, noiDung: 'a' },
        { vai: 'bot' as const, noiDung: 'b' },
      ],
    }));

    const msg = generate.mock.calls[0][0].messages[0].content as string;
    expect(msg).toContain('NHÂN VIÊN: a');
    expect(msg).toContain('BOT: b');
  });
});

describe('chayLenhNhanVien — vòng lặp chưa xong', () => {
  it('chạm trần → chua_hoan_tat, KHÔNG trả text như kết quả thật', async () => {
    // Text lúc này dở dang. Trả về như kết quả thật là nói dối nhân viên.
    const d = deps({ generate: fakeLLM([turnGoiTool('tra_san_pham', { ten: 'P10' })]) });
    const r = await chayLenhNhanVien(d, { ...input(), maxIterations: 2 });

    expect(r.trangThai).toBe('chua_hoan_tat');
    expect(r).not.toHaveProperty('traLoi');
    if (r.trangThai === 'chua_hoan_tat') expect(r.lyDo).toContain('chưa xong');
  });

  it('bị cắt vì hết token → chua_hoan_tat', async () => {
    const d = deps({
      generate: fakeLLM([{ text: 'Giá là', toolCalls: [], stopReason: 'max_tokens', raw: [] }]),
    });
    const r = await chayLenhNhanVien(d, input());

    expect(r.trangThai).toBe('chua_hoan_tat');
  });
});

describe('chayLenhNhanVien — quan trắc', () => {
  it('ghi log MỌI lần gọi tool (phát hiện lỗi im lặng 3-15%)', async () => {
    const ghiLog = vi.fn();
    const d = deps({
      generate: fakeLLM([turnGoiTool('tra_san_pham', { ten: 'P10' }), turnXong('xong')]),
      ghiLog,
    });

    const r = await chayLenhNhanVien(d, input());

    expect(ghiLog).toHaveBeenCalledTimes(1);
    const log = ghiLog.mock.calls[0][0];
    expect(log.toolName).toBe('tra_san_pham');
    expect(log.input).toEqual({ ten: 'P10' });
    expect(typeof log.durationMs).toBe('number');
    expect(log.iteration).toBe(1);
    if (r.trangThai === 'xong') expect(r.log).toHaveLength(1);
  });

  it('tool LỖI vẫn ghi log với thanhCong=false', async () => {
    const ghiLog = vi.fn();
    const odoo = fakeOdoo();
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Odoo chết'));

    await chayLenhNhanVien(
      deps({
        odoo,
        generate: fakeLLM([turnGoiTool('tra_san_pham', { ten: 'P10' }), turnXong('xong')]),
        ghiLog,
      }),
      input(),
    );

    expect(ghiLog.mock.calls[0][0].thanhCong).toBe(false);
  });

  it('log LỖI vẫn ghi khi vòng lặp chạm trần (không mất dữ liệu chẩn đoán)', async () => {
    const ghiLog = vi.fn();
    const d = deps({
      generate: fakeLLM([turnGoiTool('tra_san_pham', { ten: 'P10' })]),
      ghiLog,
    });

    const r = await chayLenhNhanVien(d, { ...input(), maxIterations: 2 });

    expect(ghiLog).toHaveBeenCalled();
    if (r.trangThai === 'chua_hoan_tat') expect(r.log.length).toBeGreaterThan(0);
  });

  it('ghiLog ném lỗi → KHÔNG làm hỏng nghiệp vụ', async () => {
    const d = deps({
      generate: fakeLLM([turnGoiTool('tra_san_pham', { ten: 'P10' }), turnXong('xong')]),
      ghiLog: vi.fn(() => { throw new Error('DB log chết'); }),
    });

    expect((await chayLenhNhanVien(d, input())).trangThai).toBe('xong');
  });
});

describe('chayLenhNhanVien — idempotency xuyên suốt', () => {
  it('truyền conversationId + seq xuống tool tạo đơn', async () => {
    const odoo = fakeOdoo();
    const d = deps({
      odoo,
      generate: fakeLLM([
        turnGoiTool('tao_don_nhap', { khach_hang_id: 10, dong: [{ san_pham_id: 2, so_luong: 1 }] }),
        turnXong('xong'),
      ]),
    });

    await chayLenhNhanVien(d, { ...input(), conversationId: 'conv-abc', seq: 3 });

    // Tool phải tra khoá zalo:conv-abc:3. Assert theo NỘI DUNG mọi lần gọi,
    // không theo vị trí — bền hơn khi thêm/bớt bước kiểm tra.
    const moiLanGoi = JSON.stringify(
      (odoo.searchRead as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(moiLanGoi).toContain('zalo:conv-abc:3');
  });
});
