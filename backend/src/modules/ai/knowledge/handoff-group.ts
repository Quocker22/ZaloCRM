// SPDX-License-Identifier: AGPL-3.0-or-later
// Tạo group Zalo (bot + sale + khách) khi handoff, rồi gửi tin TÓM TẮT vấn đề của khách
// để sale đọc là hiểu ngay. Chỉ chạy khi có cấu hình sale UID + handoff là ca đáng giá.
import type { HistoryTurn } from './rag-reply.js';

/** Prompt cho LLM viết tóm tắt ngắn gọn cho sale đọc (không phải nói với khách). */
export function buildSummaryPrompt(
  bizName: string,
  customerName: string,
  history: HistoryTurn[],
  latestCustomerMsg: string,
): { system: string; prompt: string } {
  const hist = history.length
    ? history.map((h) => `${h.role === 'customer' ? 'KHÁCH' : 'BOT'}: ${h.content}`).join('\n')
    : '(chưa có)';
  const system = [
    `Bạn viết TÓM TẮT NỘI BỘ cho nhân viên sale của ${bizName}, KHÔNG phải nói với khách.`,
    'Đọc lịch sử chat giữa khách và bot, viết tóm tắt NGẮN GỌN (3-5 dòng) để sale nắm ngay:',
    '- Khách tên gì (nếu có), đang quan tâm/hỏi SẢN PHẨM gì, số lượng nếu có.',
    '- Vấn đề/nhu cầu chính cần sale xử lý (báo giá sỉ, chốt đơn lớn, khiếu nại, hỏi chính sách...).',
    '- Thông tin đã có (giá/tồn bot đã báo) và cái CÒN THIẾU cần sale làm.',
    'CHỈ dùng thông tin trong lịch sử, KHÔNG bịa. Viết gạch đầu dòng, tiếng Việt, cô đọng.',
  ].join('\n');
  const prompt = [
    `Khách: ${customerName || '(chưa rõ tên)'}`,
    '',
    '=== LỊCH SỬ CHAT ===',
    hist,
    `KHÁCH (mới nhất): ${latestCustomerMsg}`,
    '',
    'Viết tóm tắt cho sale:',
  ].join('\n');
  return { system, prompt };
}

/** Ghép tin tóm tắt gửi vào group (có tiêu đề + nội dung tóm tắt). bizName bỏ hardcode LEDNELIA. */
export function formatGroupSummary(customerName: string, summary: string, bizName = 'Bot'): string {
  const name = customerName || 'khách';
  return [
    `🔔 KHÁCH CẦN SALE HỖ TRỢ: ${name}`,
    '',
    summary.trim(),
    '',
    `— Bot ${bizName} tự động chuyển. Anh/chị sale tiếp nhận giúp ạ.`,
  ].join('\n');
}

/** Tên group ngắn gọn. */
export function groupName(customerName: string): string {
  const name = (customerName || 'khách').slice(0, 30);
  return `Tư vấn: ${name}`;
}
