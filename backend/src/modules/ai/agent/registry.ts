// SPDX-License-Identifier: AGPL-3.0-or-later
// Sổ đăng ký tool: giữ định nghĩa + hàm chạy, và VALIDATE tham số trước khi chạy.
//
// Vì sao phải validate ở đây: LLM sinh tham số dạng văn bản, có thể thiếu field,
// sai kiểu, hoặc gọi tool không tồn tại. Nếu để tham số sai lọt xuống tầng Odoo,
// lỗi sẽ xuất hiện ở chỗ khác và rất khó truy — tệ nhất là "im lặng hỏng":
// tool chạy với tham số rác, trả kết quả trông có vẻ hợp lệ.
//
// Validate ở đây là cố ý nông (kiểu + field bắt buộc + enum), KHÔNG phải
// validate nghiệp vụ. Nghiệp vụ ("SP này có tồn tại không") là việc của tool.

import type { ToolCall, ToolDefinition, ToolResult } from './types.js';

export interface RegisteredTool {
  definition: ToolDefinition;
  run: (input: Record<string, unknown>) => Promise<string>;
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

/** Kiểu JSON Schema mà validator nông này hiểu. */
type SchemaProp = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  enum?: unknown[];
};

function typeOfValue(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/** Kiểm tra 1 giá trị có khớp schema không. Trả về thông điệp lỗi, hoặc null nếu ổn. */
function checkProp(name: string, value: unknown, spec: SchemaProp): string | null {
  if (spec.type) {
    const actual = typeOfValue(value);
    if (spec.type === 'integer') {
      if (actual !== 'number' || !Number.isInteger(value)) {
        return `'${name}' phải là số nguyên, nhận được ${actual}`;
      }
    } else if (spec.type === 'number') {
      // Số dạng chuỗi ("10") bị từ chối cố ý: với số lượng và giá tiền, ép kiểu
      // ngầm là nguồn sai số. Model phải gửi đúng kiểu.
      if (actual !== 'number' || !Number.isFinite(value)) {
        return `'${name}' phải là số, nhận được ${actual}`;
      }
    } else if (actual !== spec.type) {
      return `'${name}' phải là ${spec.type}, nhận được ${actual}`;
    }
  }
  if (spec.enum && !spec.enum.includes(value)) {
    return `'${name}' phải là một trong [${spec.enum.join(', ')}], nhận được ${JSON.stringify(value)}`;
  }
  return null;
}

/**
 * Validate input theo inputSchema của tool.
 * @throws ToolValidationError khi sai.
 */
export function validateToolInput(
  definition: ToolDefinition,
  input: Record<string, unknown>,
): void {
  const schema = definition.inputSchema;
  const errors: string[] = [];

  for (const field of schema.required ?? []) {
    if (input[field] === undefined || input[field] === null) {
      errors.push(`thiếu tham số bắt buộc '${field}'`);
    }
  }

  for (const [name, rawSpec] of Object.entries(schema.properties ?? {})) {
    const value = input[name];
    if (value === undefined || value === null) continue; // optional, đã check ở trên
    const err = checkProp(name, value, rawSpec as SchemaProp);
    if (err) errors.push(err);
  }

  if (errors.length > 0) {
    throw new ToolValidationError(`Tham số cho tool '${definition.name}' không hợp lệ: ${errors.join('; ')}`);
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /** Đăng ký tool. Trùng tên là lỗi lập trình — ném ngay lúc khởi tạo. */
  register(tool: RegisteredTool): this {
    const { name } = tool.definition;
    if (this.tools.has(name)) throw new Error(`Tool '${name}' đã được đăng ký`);
    this.tools.set(name, tool);
    return this;
  }

  /** Danh sách định nghĩa để gửi cho LLM. Sắp xếp theo tên cho ổn định prompt cache. */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()]
      .map((t) => t.definition)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Trả về executor cho vòng lặp. Executor này KHÔNG ném exception — mọi lỗi
   * (không tìm thấy tool, sai tham số, tool ném) đều thành ToolResult isError,
   * để model nhìn thấy và tự sửa.
   */
  executor(): (call: ToolCall) => Promise<ToolResult> {
    return async (call: ToolCall): Promise<ToolResult> => {
      // Model hay thêm tiền tố vào tên tool: Gemini gọi
      // `default_api.tra_danh_muc` thay vì `tra_danh_muc` (bug thật 2026-08-05
      // — khách hỏi "có những loại nào", bot đáp "em không tra được danh mục").
      //
      // Bỏ tiền tố rồi tra lại: tên tool của ta không bao giờ chứa dấu chấm,
      // nên cắt ở dấu chấm cuối là an toàn.
      const tool = this.tools.get(call.name) ?? this.tools.get(call.name.split('.').pop() ?? '');
      if (!tool) {
        const known = [...this.tools.keys()].sort().join(', ');
        return {
          toolCallId: call.id,
          content: `Không có tool tên '${call.name}'. Các tool hiện có: ${known}`,
          isError: true,
        };
      }

      try {
        validateToolInput(tool.definition, call.input);
      } catch (err) {
        return {
          toolCallId: call.id,
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }

      try {
        const output = await tool.run(call.input);
        return { toolCallId: call.id, content: output };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { toolCallId: call.id, content: `Lỗi khi chạy tool: ${message}`, isError: true };
      }
    };
  }
}
