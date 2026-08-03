# Agent — vòng lặp tool-calling

Cho phép LLM **gọi tool** (tra giá, tra tồn kho, tạo đơn) thay vì chỉ sinh text.
Nền cho việc chuyển giá/tồn từ KB sang Odoo — xem
[`docs/NGHIEN-CUU-BOT-BAN-HANG.md`](../../../../../docs/NGHIEN-CUU-BOT-BAN-HANG.md).

## Vì sao có module này

Luồng cũ (`knowledge/rag-reply.ts`) là **một lần gọi, text vào text ra**: nhồi KB
vào system prompt, LLM trả về JSON, code parse. Cách này không tra được dữ liệu
sống — giá đang parse regex `Giá bán: ([\d.]+)đ` từ text chunk, còn tồn kho thì
không có.

Module này **không thay thế** luồng cũ. Nó chạy song song; `rag-reply.ts` vẫn
nguyên vẹn cho các câu chỉ cần KB.

## Cấu trúc

| File | Việc |
|---|---|
| `types.ts` | Kiểu trung lập với provider |
| `loop.ts` | Vòng lặp: gọi → chạy tool → nhét kết quả → lặp |
| `registry.ts` | Đăng ký tool + validate tham số trước khi chạy |

Adapter provider nằm ở `../providers/` (hiện có `generateWithAnthropicTools`).

## Dùng thế nào

```ts
import { runAgent } from './agent/loop.js';
import { ToolRegistry } from './agent/registry.js';
import { generateWithAnthropicTools } from '../providers/anthropic.js';

const registry = new ToolRegistry().register({
  definition: {
    name: 'tra_gia',
    // Mô tả PHẢI nói KHI NÀO gọi, không chỉ nói tool làm gì.
    description: 'Tra giá sản phẩm. Gọi khi khách hỏi giá hoặc chốt đơn.',
    inputSchema: {
      type: 'object',
      properties: { ten: { type: 'string' } },
      required: ['ten'],
    },
  },
  run: async ({ ten }) => JSON.stringify(await odoo.timSanPham(ten as string)),
});

const result = await runAgent({
  system: 'Bạn là trợ lý bán hàng...',
  userMessage: 'P10 giá bao nhiêu?',
  tools: registry.definitions(),
  execute: registry.executor(),
  generate: (args) => generateWithAnthropicTools({ baseUrl, apiKey, model, ...args }),
  maxIterations: 8,
  onToolCall: (info) => logToolCall(info),   // quan trắc
});

// BẮT BUỘC kiểm tra trước khi gửi cho khách:
if (result.stopReason !== 'end_turn') {
  return handoff('vòng lặp chưa hoàn tất');
}
```

## Bốn quy tắc bắt buộc

Sai một cái là hỏng, và thường hỏng **im lặng**:

1. **Đẩy nguyên vẹn content assistant vào history** — không chỉ text. Thiếu
   `tool_use` block thì lượt sau provider báo lỗi.
2. **Mọi `tool_result` gộp vào MỘT message `user`.** Tách ra nhiều message sẽ
   ngầm dạy model ngừng gọi tool song song.
3. **Tool lỗi vẫn phải trả `tool_result`** với `isError: true`. Bỏ qua thì model
   treo chờ mãi.
4. **Luôn chặn số vòng lặp.** Một hệ multi-agent không chặn đã chạy 11 ngày và
   tốn 47.000 USD tiền API.

Cả bốn đều có test riêng trong `tests/ai/agent/loop.test.ts`.

## `stopReason` — đọc kỹ trước khi gửi cho khách

| Giá trị | Nghĩa | Xử lý |
|---|---|---|
| `end_turn` | Model trả lời xong | Dùng được |
| `max_iterations` | **Chạm trần, câu CHƯA HOÀN CHỈNH** | **Chuyển sale, tuyệt đối không gửi** |
| `max_tokens` | Bị cắt vì hết token | Chuyển sale |
| `other` | Bất thường | Chuyển sale |

Đây là cạm bẫy dễ mắc nhất: `result.text` **luôn** có giá trị, kể cả khi chạm
trần. Gửi thẳng `result.text` mà không kiểm tra `stopReason` là gửi câu dở dang
cho khách.

## Xử lý lỗi

| Loại | Xử lý | Vì sao |
|---|---|---|
| Tool ném exception | Thành `ToolResult` `isError`, đưa ngược cho model | Model tự sửa được (đổi tham số, hoặc chuyển sale) |
| Tham số sai schema | **Chặn trước khi chạy tool** | Tham số rác lọt xuống Odoo là nguồn "im lặng hỏng" |
| Tool không tồn tại | `isError` + liệt kê tool có sẵn | Model tự sửa tên |
| **Provider lỗi** (mạng, sai key) | **Ném ra ngoài** | Không còn gì để lặp tiếp |

## Quan trắc — không phải tuỳ chọn

Nghiên cứu cho thấy tool call lỗi **3-15% một cách im lặng**. Với bot lên đơn:
cứ 100 đơn thì 3-15 đơn sai mà không ai biết.

Luôn truyền `onToolCall` và ghi vào DB. Theo dõi tỷ lệ thành công **theo từng
tool**, độ trễ P50/P95/P99, và gọi trùng trong một phiên (dấu hiệu lỗi state).

Lỗi trong hook `onToolCall` bị nuốt cố ý — quan trắc hỏng không được làm hỏng
nghiệp vụ.

## Thêm provider mới

Viết hàm khớp `ToolAwareGenerate`, dịch 2 chiều wire format ↔ `AgentTurn`.
Tham khảo `generateWithAnthropicTools`. Ba điểm cần đúng:

- `raw` giữ **nguyên vẹn** content block của provider
- `stopReason` map đúng, nhất là `tool_use`
- `ToolResult` → block tool-result đúng chuẩn provider đó

## Prompt cache

`definitions()` **sắp xếp theo tên** cố ý. Tool render ở vị trí 0 của prompt —
thứ tự đổi giữa các request là mất sạch cache. Cũng đừng nhét timestamp vào
system prompt vì lý do tương tự.

## Test

```bash
npx vitest run tests/ai/agent/          # 46 test
```
