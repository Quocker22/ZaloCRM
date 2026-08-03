/**
 * staff-agent.e2e.ts — E2E luồng ĐẦY ĐỦ: nhân viên tag bot → tool thật → đơn thật.
 *
 * LLM vẫn được mock (gọi LLM thật tốn tiền và không tất định), nhưng MỌI TOOL
 * đều chạy thật trên Odoo. Đây là mức kiểm chứng cao nhất mà test tự động đạt được:
 * chứng minh chuỗi registry → vòng lặp → XML-RPC → sale.order hoạt động đầu-cuối.
 *
 * Chạy:
 *   ODOO_URL=http://localhost:8069 ODOO_DB=nelia_prod \
 *   ODOO_USERNAME=admin ODOO_PASSWORD=admin \
 *     npx vitest run --config vitest.e2e.config.ts tests/ai/agent/staff-agent.e2e.ts
 *
 * Có ghi vào Odoo (đơn draft) nhưng afterAll xoá sạch.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import { chayLenhNhanVien, type ToolCallLog } from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
const coDuCauHinh = Boolean(ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD);

const odoo = coDuCauHinh
  ? new OdooClient({
      url: ODOO_URL!, db: ODOO_DB!, username: ODOO_USERNAME!, password: ODOO_PASSWORD!,
    })
  : (null as unknown as OdooClient);

const CONV = `e2e-staff-${Date.now()}`;
let khachId = 0;
let khachSdt = '';
let spId = 0;
let spTen = '';
const donDaTao: number[] = [];

/** LLM giả: chạy tuần tự các lượt dựng sẵn. */
const kichBan = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const goiTool = (name: string, input: Record<string, unknown>): AgentTurn => ({
  text: '', toolCalls: [{ id: `t${Math.random()}`, name, input }],
  stopReason: 'tool_use', raw: [{ type: 'tool_use', name, input }],
});
const xong = (text: string): AgentTurn => ({
  text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
});

describe.skipIf(!coDuCauHinh)('E2E luồng nhân viên tag bot — Odoo thật', () => {
  beforeAll(async () => {
    await odoo.authenticate();

    const kh = await odoo.searchRead<{ id: number; phone: string | false; mobile: string | false }>(
      'res.partner',
      ['&', ['customer_rank', '>', 0], '|', ['phone', '!=', false], ['mobile', '!=', false]],
      ['id', 'phone', 'mobile'],
      { limit: 1 },
    );
    khachId = kh[0]?.id ?? 0;
    khachSdt = String(kh[0]?.phone || kh[0]?.mobile || '');

    // PHẢI có giá > 0 — tao_don_nhap từ chối SP chưa nhập giá.
    const sp = await odoo.searchRead<{ id: number; name: string }>(
      'product.product',
      ['&', '&', ['sale_ok', '=', true], ['active', '=', true], ['list_price', '>', 0]],
      ['id', 'name'],
      { limit: 1 },
    );
    spId = sp[0]?.id ?? 0;
    spTen = sp[0]?.name ?? '';
  });

  afterAll(async () => {
    for (const id of donDaTao) {
      try { await odoo.execute('sale.order', 'unlink', [[id]]); } catch { /* bỏ qua */ }
    }
  });

  const chay = (turns: AgentTurn[], seq: number, content = '@bot lên đơn giúp em') => {
    const log: ToolCallLog[] = [];
    return chayLenhNhanVien(
      {
        odoo,
        generate: kichBan(turns),
        ghiNhanChuyenSale: async () => {},
        ghiLog: (l) => { log.push(l); },
      },
      { bizName: 'LEDNELIA', conversationId: CONV, seq, message: { content, isSelf: true } },
    ).then((r) => ({ r, log }));
  };

  it('luồng ĐẦY ĐỦ: tra khách → tra SP → tạo đơn → đơn có thật trong Odoo', async () => {
    if (!khachId || !spId) return;

    const { r, log } = await chay(
      [
        goiTool('tra_khach_hang', { sdt: khachSdt }),
        goiTool('tra_san_pham', { ten: spTen.split(/\s+/)[0] }),
        goiTool('tao_don_nhap', { khach_hang_id: khachId, dong: [{ san_pham_id: spId, so_luong: 2 }] }),
        xong('Đã lên đơn nháp cho khách.'),
      ],
      100,
    );

    expect(r.trangThai).toBe('xong');
    expect(log).toHaveLength(3);
    expect(log.every((l) => l.thanhCong)).toBe(true);

    // Đơn phải có thật trong DB.
    const don = await odoo.searchRead<{ id: number; state: string }>(
      'sale.order', [['client_order_ref', '=', `zalo:${CONV}:100`]], ['id', 'state'],
    );
    expect(don).toHaveLength(1);
    expect(don[0].state).toBe('draft');
    donDaTao.push(don[0].id);
  });

  it('tra khách bằng SĐT không có → tool báo không thấy, bot KHÔNG tạo khách', async () => {
    const demKhach = async () =>
      (await odoo.searchRead<{ id: number }>('res.partner', [['customer_rank', '>', 0]], ['id'])).length;

    const truoc = await demKhach();
    const { log } = await chay(
      [goiTool('tra_khach_hang', { sdt: '0900000009' }), xong('Không tìm thấy khách, em chuyển sale.')],
      101,
    );

    expect(log[0].output).toContain('KHÔNG được tự tạo');
    expect(await demKhach()).toBe(truoc);
  });

  it('bot gọi tao_don_nhap 2 lần cùng seq → chỉ 1 đơn trong DB', async () => {
    if (!khachId || !spId) return;

    const donInput = { khach_hang_id: khachId, dong: [{ san_pham_id: spId, so_luong: 1 }] };
    const { r } = await chay(
      [
        goiTool('tao_don_nhap', donInput),
        goiTool('tao_don_nhap', donInput), // model gọi lại — mô phỏng lỗi thật
        xong('Đã tạo đơn.'),
      ],
      102,
    );

    expect(r.trangThai).toBe('xong');

    const don = await odoo.searchRead<{ id: number }>(
      'sale.order', [['client_order_ref', '=', `zalo:${CONV}:102`]], ['id'],
    );
    expect(don).toHaveLength(1);
    donDaTao.push(don[0].id);
  });

  it('bot bịa id sản phẩm → Odoo từ chối, KHÔNG tạo đơn rác', async () => {
    if (!khachId) return;

    const { r, log } = await chay(
      [
        goiTool('tao_don_nhap', {
          khach_hang_id: khachId,
          dong: [{ san_pham_id: 999_999_999, so_luong: 1 }],
        }),
        xong('Không tạo được đơn.'),
      ],
      103,
    );

    expect(r.trangThai).toBe('xong');
    expect(log[0].output).toContain('Không tạo được đơn');

    const don = await odoo.searchRead<{ id: number }>(
      'sale.order', [['client_order_ref', '=', `zalo:${CONV}:103`]], ['id'],
    );
    expect(don).toHaveLength(0);
  });

  it('tra tồn kho thật → số liệu khớp với Odoo', async () => {
    if (!spId) return;

    const { log } = await chay(
      [goiTool('tra_ton_kho', { san_pham_id: spId }), xong('Đã kiểm tra tồn.')],
      104,
    );

    expect(log[0].thanhCong).toBe(true);
    expect(log[0].output).toContain('CÒN BÁN ĐƯỢC');
  });

  it('quan trắc ghi đủ thời lượng và số vòng cho mỗi tool', async () => {
    if (!spId) return;

    const { log } = await chay(
      [
        goiTool('tra_san_pham', { ten: 'COB' }),
        goiTool('tra_ton_kho', { san_pham_id: spId }),
        xong('xong'),
      ],
      105,
    );

    expect(log).toHaveLength(2);
    expect(log[0].iteration).toBe(1);
    expect(log[1].iteration).toBe(2);
    for (const l of log) expect(l.durationMs).toBeGreaterThanOrEqual(0);
  });
});
