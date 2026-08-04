// SPDX-License-Identifier: AGPL-3.0-or-later
// Test sổ đăng ký tool + validate tham số.
// Trọng tâm: tham số sai KHÔNG được lọt xuống tầng Odoo — đó là nguồn của
// "im lặng hỏng" (tool chạy với tham số rác, trả kết quả trông có vẻ hợp lệ).
import { describe, it, expect, vi } from 'vitest';
import {
  ToolRegistry,
  validateToolInput,
  ToolValidationError,
} from '../../../src/modules/ai/agent/registry.js';
import type { ToolDefinition } from '../../../src/modules/ai/agent/types.js';

const traGia: ToolDefinition = {
  name: 'tra_gia',
  description: 'Tra giá SP. Gọi khi khách hỏi giá.',
  inputSchema: {
    type: 'object',
    properties: { ten: { type: 'string' }, so_luong: { type: 'integer' } },
    required: ['ten'],
  },
};

const taoDon: ToolDefinition = {
  name: 'tao_don',
  description: 'Tạo đơn nháp',
  inputSchema: {
    type: 'object',
    properties: { kho: { type: 'string', enum: ['HCM', 'HN'] } },
    required: ['kho'],
  },
  mutates: true,
};

const call = (name: string, input: Record<string, unknown>) => ({ id: 'c1', name, input });

describe('validateToolInput', () => {
  it('tham số hợp lệ → không ném', () => {
    expect(() => validateToolInput(traGia, { ten: 'P10', so_luong: 5 })).not.toThrow();
  });

  it('bỏ qua field optional khi không truyền', () => {
    expect(() => validateToolInput(traGia, { ten: 'P10' })).not.toThrow();
  });

  it('thiếu field bắt buộc → ném', () => {
    expect(() => validateToolInput(traGia, {})).toThrow(ToolValidationError);
    expect(() => validateToolInput(traGia, {})).toThrow(/thiếu tham số bắt buộc 'ten'/);
  });

  it('null cũng tính là thiếu', () => {
    expect(() => validateToolInput(traGia, { ten: null })).toThrow(/thiếu tham số bắt buộc/);
  });

  it('sai kiểu → ném, nói rõ nhận được kiểu gì', () => {
    expect(() => validateToolInput(traGia, { ten: 123 })).toThrow(/'ten' phải là string, nhận được number/);
  });

  it('số dạng CHUỖI bị từ chối (chống ép kiểu ngầm cho SL/giá tiền)', () => {
    // "10" trông vô hại, nhưng với số lượng và tiền, ép kiểu ngầm là nguồn sai số.
    expect(() => validateToolInput(traGia, { ten: 'P10', so_luong: '10' })).toThrow(/'so_luong' phải là số nguyên/);
  });

  it('số thực khi schema đòi integer → ném', () => {
    expect(() => validateToolInput(traGia, { ten: 'P10', so_luong: 2.5 })).toThrow(/số nguyên/);
  });

  it('giá trị ngoài enum → ném, liệt kê giá trị hợp lệ', () => {
    expect(() => validateToolInput(taoDon, { kho: 'DN' })).toThrow(/phải là một trong \[HCM, HN\]/);
  });

  it('gom NHIỀU lỗi vào một thông điệp (model sửa 1 lần thay vì lặp)', () => {
    const t: ToolDefinition = {
      name: 'x',
      description: '',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
    };
    try {
      validateToolInput(t, {});
      expect.unreachable('phải ném');
    } catch (e) {
      expect((e as Error).message).toContain("'a'");
      expect((e as Error).message).toContain("'b'");
    }
  });
});

describe('ToolRegistry', () => {
  it('đăng ký rồi lấy được definition', () => {
    const r = new ToolRegistry().register({ definition: traGia, run: async () => 'ok' });
    expect(r.has('tra_gia')).toBe(true);
    expect(r.definitions()).toHaveLength(1);
  });

  it('trùng tên tool → ném ngay lúc khởi tạo (lỗi lập trình)', () => {
    const r = new ToolRegistry().register({ definition: traGia, run: async () => 'ok' });
    expect(() => r.register({ definition: traGia, run: async () => 'ok' })).toThrow(/đã được đăng ký/);
  });

  it('definitions() sắp xếp theo tên — ổn định prompt cache', () => {
    // Thứ tự tool đổi giữa các request là mất sạch prompt cache (tools render vị trí 0).
    const r = new ToolRegistry()
      .register({ definition: taoDon, run: async () => 'ok' })
      .register({ definition: traGia, run: async () => 'ok' });
    expect(r.definitions().map((d) => d.name)).toEqual(['tao_don', 'tra_gia']);
  });
});

describe('ToolRegistry.executor', () => {
  it('chạy tool và trả nội dung', async () => {
    const run = vi.fn(async () => 'giá 120.000đ');
    const exec = new ToolRegistry().register({ definition: traGia, run }).executor();

    const res = await exec(call('tra_gia', { ten: 'P10' }));

    expect(res.content).toBe('giá 120.000đ');
    expect(res.isError).toBeUndefined();
    expect(run).toHaveBeenCalledWith({ ten: 'P10' });
  });

  it('tool KHÔNG TỒN TẠI → isError + liệt kê tool có sẵn (model tự sửa được)', async () => {
    const exec = new ToolRegistry().register({ definition: traGia, run: async () => 'ok' }).executor();

    const res = await exec(call('tra_ton_kho', {}));

    expect(res.isError).toBe(true);
    expect(res.content).toContain('tra_gia');
  });

  it('tham số sai → CHẶN TRƯỚC khi chạy tool (không cho lọt xuống Odoo)', async () => {
    const run = vi.fn(async () => 'ok');
    const exec = new ToolRegistry().register({ definition: traGia, run }).executor();

    const res = await exec(call('tra_gia', { ten: 123 }));

    expect(res.isError).toBe(true);
    expect(run).not.toHaveBeenCalled(); // điểm mấu chốt
  });

  it('tool ném exception → thành isError, KHÔNG thoát ra vòng lặp', async () => {
    const exec = new ToolRegistry()
      .register({ definition: traGia, run: async () => { throw new Error('Odoo timeout'); } })
      .executor();

    const res = await exec(call('tra_gia', { ten: 'P10' }));

    expect(res.isError).toBe(true);
    expect(res.content).toContain('Odoo timeout');
  });

  it('executor KHÔNG BAO GIỜ ném — mọi lỗi thành ToolResult', async () => {
    const exec = new ToolRegistry()
      .register({ definition: traGia, run: async () => { throw new Error('bất kỳ'); } })
      .executor();

    // Không cần try/catch: nếu ném thì test này fail.
    await expect(exec(call('khong_co', {}))).resolves.toBeDefined();
    await expect(exec(call('tra_gia', {}))).resolves.toBeDefined();
    await expect(exec(call('tra_gia', { ten: 'P10' }))).resolves.toBeDefined();
  });

  it('giữ đúng toolCallId để model khớp được kết quả', async () => {
    const exec = new ToolRegistry().register({ definition: traGia, run: async () => 'ok' }).executor();

    const res = await exec({ id: 'toolu_abc123', name: 'tra_gia', input: { ten: 'P10' } });

    expect(res.toolCallId).toBe('toolu_abc123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Tên tool CÓ TIỀN TỐ — model hay thêm namespace', () => {
  // Bug thật 2026-08-05: khách hỏi "có những loại nào", bot đáp "em không tra
  // được danh mục sản phẩm". Log tool cho thấy Gemini gọi
  // `default_api.tra_danh_muc` thay vì `tra_danh_muc` — registry không nhận,
  // trả lỗi, model bỏ cuộc.
  const dungRegistry = () =>
    new ToolRegistry().register({
      definition: {
        name: 'tra_danh_muc',
        description: 'x',
        inputSchema: { type: 'object', properties: {} },
      },
      run: async () => 'KẾT QUẢ DANH MỤC',
    });

  it.each([
    'tra_danh_muc',
    'default_api.tra_danh_muc',
    'functions.tra_danh_muc',
    'namespace.con.tra_danh_muc',
  ])('gọi "%s" → chạy đúng tool', async (ten) => {
    const kq = await dungRegistry().executor()({ id: '1', name: ten, input: {} });

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toBe('KẾT QUẢ DANH MỤC');
  });

  it('tên SAI HẲN vẫn báo lỗi (không nuốt nhầm)', async () => {
    const kq = await dungRegistry().executor()({ id: '1', name: 'default_api.tool_khong_co', input: {} });

    expect(kq.isError).toBe(true);
    expect(kq.content).toContain('Không có tool tên');
  });

  it('tên rỗng sau khi cắt tiền tố → báo lỗi, không ném', async () => {
    const kq = await dungRegistry().executor()({ id: '1', name: 'abc.', input: {} });

    expect(kq.isError).toBe(true);
  });
});
