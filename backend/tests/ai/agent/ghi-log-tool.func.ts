// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: ghi nhật ký gọi tool.
//
// Trọng tâm: quan trắc hỏng thì bot VẪN phải trả lời. Mọi lỗi ở đây phải bị nuốt.
import { describe, it, expect, vi } from 'vitest';
import { taoGhiLog, catOutput, chuanHoaJson } from '../../../src/modules/ai/agent/ghi-log-tool.js';
import type { ToolCallLog } from '../../../src/modules/ai/agent/staff-agent.js';

const LOG: ToolCallLog = {
  toolName: 'tra_san_pham',
  input: { tu_khoa: 'led 3 bóng' },
  output: 'Led 3 bóng — 195.000đ',
  thanhCong: true,
  durationMs: 132,
  iteration: 1,
};

const gia = (create = vi.fn(async () => ({}))) => ({ prisma: { toolCallLog: { create } }, create });

describe('taoGhiLog', () => {
  it('ghi đủ trường xuống DB', async () => {
    const { prisma, create } = gia();
    taoGhiLog({ prisma, orgId: 'org1', vai: 'nhanvien', conversationId: 'c1' })(LOG);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    expect(create.mock.calls[0][0].data).toMatchObject({
      orgId: 'org1', vai: 'nhanvien', conversationId: 'c1',
      toolName: 'tra_san_pham', thanhCong: true, durationMs: 132, iteration: 1,
    });
  });

  it('KHÔNG có conversationId → lưu null (cột nullable)', async () => {
    const { prisma, create } = gia();
    taoGhiLog({ prisma, orgId: 'org1', vai: 'khach' })(LOG);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    expect(create.mock.calls[0][0].data.conversationId).toBeNull();
  });

  it('DB hỏng → KHÔNG ném, bot vẫn chạy tiếp', async () => {
    const create = vi.fn(async () => { throw new Error('connection refused'); });
    const onError = vi.fn();
    const ghi = taoGhiLog({ prisma: { toolCallLog: { create } }, orgId: 'o', vai: 'khach', onError });

    expect(() => ghi(LOG)).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('KHÔNG chờ DB — trả về ngay (câu trả lời không bị quan trắc làm chậm)', () => {
    let xong = false;
    const create = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      xong = true;
      return {};
    });
    taoGhiLog({ prisma: { toolCallLog: { create } }, orgId: 'o', vai: 'khach' })(LOG);

    expect(xong).toBe(false);
  });

  it('output dài bị cắt — một truy vấn sản phẩm có thể hàng chục KB', async () => {
    const { prisma, create } = gia();
    taoGhiLog({ prisma, orgId: 'o', vai: 'khach' })({ ...LOG, output: 'x'.repeat(50_000) });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    const out = create.mock.calls[0][0].data.output as string;
    expect(out.length).toBeLessThan(4100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('catOutput', () => {
  it('ngắn thì giữ nguyên, không thêm dấu …', () => {
    expect(catOutput('ngắn')).toBe('ngắn');
  });
});

describe('chuanHoaJson', () => {
  it('BigInt từ Odoo → chuỗi (Prisma không nhận BigInt trong Json)', () => {
    expect(chuanHoaJson({ id: BigInt(9) })).toEqual({ id: '9' });
  });

  it('vòng lặp tham chiếu → không ném, lưu mô tả thay thế', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => chuanHoaJson(a)).not.toThrow();
    expect(chuanHoaJson(a)).toHaveProperty('khongTuanTuHoaDuoc');
  });
});
