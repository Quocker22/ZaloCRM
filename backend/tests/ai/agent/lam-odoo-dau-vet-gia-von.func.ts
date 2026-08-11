// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: DẤU VẾT sửa giá vốn đi qua ĐÚNG registry nhân viên.
//
// VÌ SAO Ở TẦNG REGISTRY: chỗ nối là nơi từng đứt (lỗ hổng 11/08 —
// `input as never` làm cờ model bịa lọt vào tham số). Dấu vết cũng vậy: nếu
// `conversationId` không được truyền từ registry xuống `lamOdoo` thì log ghi ra
// vẫn chạy nhưng KHÔNG truy được hội thoại nào — vô dụng đúng lúc cần.
//
// Quyết định nghiệp vụ được khoá ở đây, nguyên văn anh Quốc: "đừng siết chặt
// quá khó dùng". Nên: GHI DẤU VẾT, KHÔNG CHẶN.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import { taoGhiLog } from '../../../src/modules/ai/agent/ghi-log-tool.js';
import { logger } from '../../../src/shared/utils/logger.js';

function fakeOdoo(soKhop: number, cotCu: Record<string, unknown> = {}) {
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  const searchRead = vi.fn(async () =>
    Array.from({ length: Math.min(soKhop, 1000) }, (_, i) => ({ id: i + 1, ...cotCu })));
  return { execute, searchRead } as never;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

const logDaGhi = (): string =>
  warn.mock.calls.map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n');

describe('lam_odoo qua registry — sửa giá vốn: chạy ngay, có dấu vết', () => {
  it('lệnh KHÔNG bị chặn và câu trả về nêu rõ cột giá vốn', async () => {
    const odoo = fakeOdoo(1, { standard_price: 70000 });
    const r = buildStaffRegistry({
      odoo, conversationId: 'hoi-thoai-99', seq: 1,
      xacNhanTuNguoi: false, ghiNhanChuyenSale: async () => {},
    });

    const kq = await r.executor()({
      id: '1', name: 'lam_odoo',
      input: {
        bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
        du_lieu: { standard_price: 85000 },
      },
    });

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toContain('Đã sửa 1 bản ghi trên product.product');
    expect(kq.content.toLowerCase()).toContain('giá vốn');
    expect(odoo.execute.mock.calls.some((c: unknown[]) => c[1] === 'write')).toBe(true);
  });

  it('log mang theo conversationId THẬT của registry (không phải chuỗi rỗng)', async () => {
    const odoo = fakeOdoo(1, { standard_price: 70000 });
    const r = buildStaffRegistry({
      odoo, conversationId: 'hoi-thoai-99', seq: 1,
      xacNhanTuNguoi: false, ghiNhanChuyenSale: async () => {},
    });

    await r.executor()({
      id: '1', name: 'lam_odoo',
      input: {
        bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
        du_lieu: { standard_price: 85000 },
      },
    });

    const s = logDaGhi();
    expect(s).toContain('COT_NHAY_CAM');
    expect(s).toContain('hoi-thoai-99');
    expect(s).toContain('standard_price');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// YÊU CẦU 3 — bảng log tool đã đủ chưa?
//
// KIỂM TRƯỚC KHI LÀM THÊM: `tool_call_logs.input` là cột Json lưu NGUYÊN input
// của tool, nên `du_lieu` (kèm standard_price) đã nằm sẵn trong đó. Không cần
// thêm cột hay bảng mới — chỉ cần test khoá lại để người sau đừng "tối ưu" bằng
// cách cắt bớt `input`.
describe('tool_call_logs — du_lieu đã được lưu sẵn, không cần làm thêm', () => {
  it('input ghi xuống DB giữ nguyên du_lieu.standard_price', async () => {
    const daGhi: Record<string, unknown>[] = [];
    const ghiLog = taoGhiLog({
      prisma: {
        toolCallLog: {
          create: async (a) => { daGhi.push(a.data); return null; },
        },
      },
      orgId: 'org-1',
      vai: 'nhanvien',
      conversationId: 'hoi-thoai-99',
    });

    ghiLog({
      toolName: 'lam_odoo',
      input: {
        bang: 'product.product', viec: 'sua', loc: [['id', '=', 5]],
        du_lieu: { standard_price: 85000 },
      },
      output: 'Đã sửa 1 bản ghi trên product.product (có sửa giá vốn).',
      thanhCong: true,
      durationMs: 12,
      iteration: 1,
    });
    await new Promise((res) => setImmediate(res));

    expect(daGhi).toHaveLength(1);
    const input = daGhi[0]!.input as { du_lieu: Record<string, unknown> };
    expect(input.du_lieu).toMatchObject({ standard_price: 85000 });
    expect(daGhi[0]!.conversationId).toBe('hoi-thoai-99');
  });
});
