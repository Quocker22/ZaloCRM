// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểu dữ liệu cho vòng lặp tool-calling (agentic loop).
//
// Thiết kế: trung lập với provider. Anthropic/Gemini/OpenAI có wire format khác
// nhau; các adapter dịch qua lại với những kiểu ở đây. Vòng lặp (loop.ts) chỉ
// biết những kiểu này, không biết provider nào đang chạy.

/** Định nghĩa 1 tool gửi cho LLM. JSON Schema mô tả tham số đầu vào. */
export interface ToolDefinition {
  name: string;
  /**
   * Mô tả PHẢI nói rõ KHI NÀO gọi tool, không chỉ nói tool làm gì.
   * Các model mới có xu hướng dè dặt khi gọi tool — mô tả có điều kiện kích
   * hoạt ("Gọi khi khách hỏi giá hoặc tồn kho") cho kết quả tốt hơn hẳn.
   */
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Tool có ghi dữ liệu không. Vòng lặp KHÔNG dùng cờ này để chặn — chặn là
   * việc của tầng gọi (registry + cổng duyệt). Ở đây chỉ để ghi log/quan trắc
   * phân biệt được đọc với ghi.
   */
  mutates?: boolean;
}

/** LLM yêu cầu gọi 1 tool. */
export interface ToolCall {
  /** id do provider sinh; phải khớp khi trả kết quả về. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Kết quả trả về cho LLM sau khi chạy tool. */
export interface ToolResult {
  toolCallId: string;
  /** Nội dung text trả cho model. Lỗi thì để thông điệp lỗi ở đây. */
  content: string;
  /**
   * true = tool chạy lỗi. QUAN TRỌNG: vẫn phải trả kết quả về cho model,
   * KHÔNG được bỏ qua — bỏ qua thì model treo chờ mãi.
   */
  isError?: boolean;
}

/** Số token của một lượt — dùng để đo hiệu quả cache. */
export interface TurnUsage {
  /** Token tính giá đầy đủ (1,0×). */
  inputTokens: number;
  outputTokens: number;
  /** Token đọc từ cache — chỉ tốn 0,1× giá gốc. Càng cao càng tốt. */
  cacheReadTokens: number;
  /** Token ghi vào cache — tốn 1,25× (TTL 5 phút). Chỉ nên xảy ra ở vòng đầu. */
  cacheWriteTokens: number;
}

/** Một lượt trả lời của LLM. */
export interface AgentTurn {
  /** Text mà model sinh ra ở lượt này (có thể rỗng khi model chỉ gọi tool). */
  text: string;
  /** Các tool model muốn gọi. Rỗng = model đã trả lời xong. */
  toolCalls: ToolCall[];
  /**
   * 'tool_use' → còn phải chạy tool rồi lặp tiếp.
   * 'end_turn' → model đã xong.
   * 'max_tokens' → bị cắt giữa chừng, coi như kết thúc bất thường.
   */
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'other';
  /** Nội dung thô của provider — phải đẩy nguyên vẹn vào history lượt sau. */
  raw: unknown;
  /** Số token lượt này. Có thể thiếu nếu provider không trả về. */
  usage?: TurnUsage;
}

/**
 * Cấu hình context editing — xoá tool result cũ khỏi prompt gửi lên.
 *
 * Anthropic gọi đây là "dạng compaction nhẹ và an toàn nhất". Server xoá result
 * CŨ NHẤT trước, thay bằng placeholder để model biết có thứ đã bị xoá. Client vẫn
 * giữ lịch sử đầy đủ — chỉ prompt gửi lên bị cắt.
 *
 * ĐÁNH ĐỔI: mỗi lần xoá PHÁ CACHE tại điểm đó. Dùng `clear_at_least` để đảm bảo
 * xoá đủ nhiều thì mới bõ công phá cache.
 */
export interface ContextManagementConfig {
  edits: Array<{
    type: 'clear_tool_uses_20250919';
    /** Ngưỡng kích hoạt. Mặc định của API: 100.000 input token. */
    trigger?: { type: 'input_tokens' | 'tool_uses'; value: number };
    /** Giữ lại N cặp tool gần nhất. Mặc định 3. */
    keep?: { type: 'tool_uses'; value: number };
    /** Xoá ít nhất N token thì mới làm — tránh phá cache vì chút đỉnh. */
    clear_at_least?: { type: 'input_tokens'; value: number };
    /** Tool KHÔNG BAO GIỜ bị xoá kết quả. */
    exclude_tools?: string[];
    /** Xoá cả tham số đầu vào của tool, không chỉ kết quả. Mặc định false. */
    clear_tool_inputs?: boolean;
  }>;
}

/** Một message trong lịch sử hội thoại gửi lên LLM. */
export interface AgentMessage {
  role: 'user' | 'assistant';
  /** Chuỗi thuần, hoặc mảng content block thô của provider. */
  content: string | unknown[];
}

/** Hàm gọi provider. Adapter của từng provider implement interface này. */
export type ToolAwareGenerate = (args: {
  system: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}) => Promise<AgentTurn>;

/** Hàm chạy 1 tool thật. */
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

export interface RunAgentOptions {
  system: string;
  /** Tin đầu tiên của người dùng. */
  userMessage: string;
  tools: ToolDefinition[];
  generate: ToolAwareGenerate;
  execute: ToolExecutor;
  /**
   * Trần số vòng lặp. Đây là hàng rào chống vòng lặp vô hạn — một hệ thống
   * multi-agent không chặn vòng lặp đã chạy 11 ngày và tốn 47.000 USD tiền API.
   * Mặc định 8: đủ cho tra SP → tra tồn → tra khách → tạo đơn, còn dư.
   */
  maxIterations?: number;
  maxTokens?: number;
  /** Hook quan trắc: gọi sau mỗi lần chạy tool. Lỗi trong hook bị nuốt. */
  onToolCall?: (info: {
    call: ToolCall;
    result: ToolResult;
    durationMs: number;
    iteration: number;
  }) => void | Promise<void>;
}

export interface RunAgentResult {
  /** Câu trả lời cuối cùng của model. */
  text: string;
  /** Số vòng đã chạy. */
  iterations: number;
  /** Toàn bộ tool đã gọi, theo thứ tự — dùng cho log và test. */
  toolCalls: Array<{ call: ToolCall; result: ToolResult; durationMs: number }>;
  /**
   * 'end_turn'    → model trả lời xong bình thường.
   * 'max_iterations' → chạm trần vòng lặp, CÂU TRẢ LỜI CÓ THỂ CHƯA HOÀN CHỈNH.
   * 'max_tokens'  → bị cắt vì hết token.
   */
  stopReason: 'end_turn' | 'max_iterations' | 'max_tokens' | 'other';
  /** History đầy đủ — dùng để debug và ghi log. */
  messages: AgentMessage[];
  /**
   * Tổng token cả phiên, cộng dồn mọi vòng.
   *
   * Kiểm hiệu quả cache: `cacheReadTokens` phải LỚN sau vòng 2. Nếu vẫn 0 qua nhiều
   * vòng nghĩa là có thứ gì đó phá cache (thứ tự tool đổi, timestamp trong system…).
   */
  usage: TurnUsage;
}
