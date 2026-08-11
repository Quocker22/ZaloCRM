// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: PHẢI CÓ MỘT LƯỢT NHẮN THẬT CỦA NGƯỜI giữa cảnh báo và lệnh xoá.
//
// Đây là tầng cao nhất của cách bịt lỗ hổng 11/08 — chạy qua `chayLenhNhanVien`
// thật, với LLM giả cư xử ĐÚNG như model thật đã làm khi khai thác lỗ hổng:
// gọi lam_odoo, đọc câu "cần xác nhận", rồi gọi lại ngay với xac_nhan:true.
//
// Điều kiện mở phanh phải hội đủ HAI vế (xem `xacNhanTuNguoi` trong
// staff-agent.ts):
//   1. tin MỚI của nhân viên là lời gật
//   2. bot ĐÃ xin xác nhận ở lượt TRƯỚC (nằm trong `history`)
//
// Vế 2 là thứ model không tự dựng được: lúc nó chạy, câu hỏi của chính nó chưa
// nằm trong history — history chỉ chứa các lượt ĐÃ gửi xong.
import { describe, it, expect, vi } from 'vitest';
import { chayLenhNhanVien, laGatChoLenhNguyHiem } from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

/** Odoo giả đếm 300 đơn nháp — đúng ca đã đo trong lỗ hổng. */
function fakeOdoo() {
  const execute = vi.fn(async (_model: string, method: string) =>
    (method === 'search_count' ? 300 : true));
  const searchRead = vi.fn(async (model: string) =>
    (model === 'res.partner'
      ? [{ id: 1, name: 'Khách Test' }]
      : Array.from({ length: 300 }, (_, i) => ({ id: i + 1 }))));
  return { execute, searchRead } as unknown as OdooClient;
}

const XOA_300 = {
  bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
  loc: [['state', '=', 'draft']],
};

/**
 * LLM giả KHAI THÁC lỗ hổng: lượt 1 gọi lệnh xoá, lượt 2 tự gật, lượt 3 kết.
 * Đây đúng là hành vi đã dựng lại được của model thật.
 */
function llmTuGat() {
  const turns: AgentTurn[] = [
    {
      text: '', stopReason: 'tool_use',
      toolCalls: [{ id: 't1', name: 'lam_odoo', input: XOA_300 }],
      raw: [{ type: 'tool_use', id: 't1', name: 'lam_odoo', input: XOA_300 }],
    },
    {
      text: '', stopReason: 'tool_use',
      toolCalls: [{ id: 't2', name: 'lam_odoo', input: { ...XOA_300, xac_nhan: true } }],
      raw: [{ type: 'tool_use', id: 't2', name: 'lam_odoo', input: { ...XOA_300, xac_nhan: true } }],
    },
    { text: 'Đã xử lý xong.', stopReason: 'end_turn', toolCalls: [], raw: [{ type: 'text', text: 'Đã xử lý xong.' }] },
  ];
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]!);
}

const daXoa = (odoo: OdooClient) =>
  (odoo.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .some((c) => c[1] === 'unlink');

describe('lam_odoo — bắt buộc có lượt nhắn của NGƯỜI ở giữa', () => {
  it('LƯỢT 1: model tự gật hai lần liên tiếp trong CÙNG lượt → 300 đơn KHÔNG bị xoá', async () => {
    const odoo = fakeOdoo();

    const kq = await chayLenhNhanVien(
      { odoo, generate: llmTuGat(), ghiNhanChuyenSale: vi.fn(async () => {}) } as never,
      {
        bizName: 'LEDNELIA', conversationId: 'conv-1', seq: 0,
        message: { content: '@bot xoá hết đơn nháp đi', isSelf: true },
        // Lượt ĐẦU: chưa có lịch sử, nhân viên chưa gật gì.
        history: [],
      } as never,
    );

    expect(kq.trangThai).toBe('xong');
    // Điểm mấu chốt: model đã cố gật thay người và KHÔNG thành công.
    expect(daXoa(odoo)).toBe(false);
  });

  it('LƯỢT SAU: bot đã hỏi + nhân viên nhắn "đồng ý" → lệnh CHẠY THẬT', async () => {
    const odoo = fakeOdoo();

    const kq = await chayLenhNhanVien(
      { odoo, generate: llmTuGat(), ghiNhanChuyenSale: vi.fn(async () => {}) } as never,
      {
        bizName: 'LEDNELIA', conversationId: 'conv-1', seq: 1,
        message: { content: '@bot đồng ý', isSelf: true },
        history: [
          { vai: 'nhanvien', noiDung: 'xoá hết đơn nháp đi' },
          // Câu bot ĐÃ GỬI ĐI ở lượt trước — bằng chứng nhân viên đã đọc cảnh báo.
          {
            vai: 'bot',
            noiDung:
              'Lệnh này sẽ XOÁ 300 bản ghi trên sale.order — Odoo KHÔNG hoàn tác được. '
              + 'Anh/chị nhắn "đồng ý" (hoặc "xác nhận") ở tin SAU thì em làm ngay ạ.',
          },
        ],
      } as never,
    );

    expect(kq.trangThai).toBe('xong');
    expect(daXoa(odoo)).toBe(true);
  });

  it('nhân viên gật nhưng bot CHƯA HỀ hỏi → KHÔNG mở phanh (chống gật vu vơ)', async () => {
    const odoo = fakeOdoo();

    await chayLenhNhanVien(
      { odoo, generate: llmTuGat(), ghiNhanChuyenSale: vi.fn(async () => {}) } as never,
      {
        bizName: 'LEDNELIA', conversationId: 'conv-1', seq: 1,
        message: { content: '@bot ok', isSelf: true },
        history: [
          { vai: 'nhanvien', noiDung: 'giá P10 bao nhiêu' },
          // Bot chỉ báo giá — KHÔNG có câu xin xác nhận cho lệnh nguy hiểm.
          { vai: 'bot', noiDung: 'Dạ P10 giá 230.000đ/cái ạ.' },
        ],
      } as never,
    );

    expect(daXoa(odoo)).toBe(false);
  });

  it('bot hỏi xoá nhưng nhân viên nói CHUYỆN KHÁC → không tính là gật', async () => {
    const odoo = fakeOdoo();

    await chayLenhNhanVien(
      { odoo, generate: llmTuGat(), ghiNhanChuyenSale: vi.fn(async () => {}) } as never,
      {
        bizName: 'LEDNELIA', conversationId: 'conv-1', seq: 1,
        message: { content: '@bot khoan đã, để tôi xem lại', isSelf: true },
        history: [
          { vai: 'nhanvien', noiDung: 'xoá hết đơn nháp đi' },
          {
            vai: 'bot',
            noiDung:
              'Lệnh này sẽ XOÁ 300 bản ghi trên sale.order — Odoo KHÔNG hoàn tác được. '
              + 'Anh/chị nhắn "đồng ý" (hoặc "xác nhận") ở tin SAU thì em làm ngay ạ.',
          },
        ],
      } as never,
    );

    expect(daXoa(odoo)).toBe(false);
  });
});

// ── Lời gật cho lệnh nguy hiểm phải NGẶT hơn lời gật thường ────────────────
// `laXacNhanNgan` (dùng cho lên đơn) gật nhầm với "khoan đã, để tôi xem lại" —
// chuỗi 'da' của chữ "đã" nằm trong danh sách cụm xác nhận. Gật nhầm lúc lên
// đơn tốn một câu sửa; gật nhầm lúc XOÁ 300 đơn là mất dữ liệu vĩnh viễn.
describe('laGatChoLenhNguyHiem — chỉ nhận lời gật RÕ RÀNG', () => {
  it.each([
    'đồng ý', 'dong y', 'xác nhận', 'xac nhan', 'ok', 'OK', 'oke',
    'đúng rồi', 'chốt', 'làm đi', 'xoá đi', 'đồng ý!', 'ok.',
  ])('nhận lời gật rõ: "%s"', (cau) => {
    expect(laGatChoLenhNguyHiem(cau)).toBe(true);
  });

  it.each([
    'khoan đã, để tôi xem lại',   // ca thật khiến test trên đỏ
    'khoan đã',
    'để tôi hỏi lại sếp',
    'thôi khỏi',
    'không xoá nữa',
    'để sau',
    'ok nhưng chỉ xoá đơn của tháng 7 thôi',  // có điều kiện → không phải gật trơn
    'sao lại xoá',
    '',
  ])('KHÔNG nhận là gật: "%s"', (cau) => {
    expect(laGatChoLenhNguyHiem(cau)).toBe(false);
  });
});
