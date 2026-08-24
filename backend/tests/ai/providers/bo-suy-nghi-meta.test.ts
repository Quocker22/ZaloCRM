// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 11:01 & 11:07 24/08 (nhóm NV, model deepseek-v4-flash-0731 qua
// OpenRouter, reasoning đã TẮT): model "nghĩ thành lời" bằng tiếng Anh NGAY
// TRONG content, không có thẻ <think> → boSuyNghi cũ (chỉ cắt thẻ) để lọt
// nguyên đoạn "The user said "ok" - this seems to be…" ra nhóm Zalo.
import { describe, it, expect } from 'vitest';
import { boSuyNghi } from '../../../src/modules/ai/providers/openai-compat.js';

const LO_11_01 = `The user said "ok" - this seems to be a simple acknowledgment. Looking at the context, the last thing discussed was about "3b hồng cước vận chuyển" (the NV was asking why 3B Hồng shipping was added). The message "ok" could be acknowledging something but it's ambiguous.

Let me look at the recent flow. The last exchange was NV saying "sao lại thêm 3b hồng, cước vận chuyển mà" - questioning why adding 3B Hồng shipping. Then "ok".

"ok" is a simple acknowledgement without clear intent. There's no pending order action clear - actually the last order was S15113 for Anh Dương which had freight added. But "ok" doesn't clearly map to anything pending.

This is ambiguous - "ok" could mean "OK, proceed/fine". It doesn't clearly fit 1 (cancel), 2 (fix order), or clearly a reply to my question. Given the conversation is about questioning the freight, "ok" might be acknowledging something.

But there's no clear pending action to continue. Let me ask for clarification.

Dạ anh/chị "ok" là khớp gì ạ? Em cần biết thêm để tiếp: là đơn S15113 (Dương Thanh Hóa) rồi thêm vận chuyển 70k rồi, câu "3b hồng cước vận chuyển" em còn hạng nhầm — anh/chị mua muốn em sửa đơn nào, thêm/đổi gì, nhắn rõ giúp em nhé.`;

const LO_11_07 = `The user message is "e nhắn vào đây" - this refers to the freight link. In the previous message, the NV said "cái vận chuyển để em update thêm" (let me update the freight myself). So "e nhắn vào đây" seems to indicate they want to click into the link to update the freight themselves.

This is acknowledging that the NV will handle updating the shipping cost themselves via the link. Let me respond briefly.

This appears to be NV saying they'll click into the link to add the freight themselves. No tool needed for this - just acknowledge.`;

describe('boSuyNghi — cắt suy nghĩ tiếng Anh không có thẻ <think>', () => {
  it('11:01: bỏ 5 đoạn reasoning, GIỮ đúng câu trả lời tiếng Việt cuối', () => {
    const ra = boSuyNghi(LO_11_01);
    expect(ra.startsWith('Dạ anh/chị "ok" là khớp gì ạ?')).toBe(true);
    expect(ra).not.toMatch(/The user said|Let me|This is ambiguous|pending/);
  });

  it('11:07: toàn reasoning, không có câu trả lời → rỗng (tầng trên báo chưa hoàn tất, KHÔNG gửi)', () => {
    expect(boSuyNghi(LO_11_07)).toBe('');
  });

  it('câu trả lời tiếng Việt có tên hàng tiếng Anh → giữ nguyên, không cắt oan', () => {
    const tin = [
      'Đơn cho Led Minh Khang (KH000616): 3 × P10 3 màu LLR 260409 = 540.000đ',
      '- Card thu BX-V7512 (12 cổng) 260.000đ',
      '- FULL MASTER 4 CỔNG ĐỒNG BỘ AC: chưa có giá',
      'Link xử lý: https://quyetanh.com/web#id=28031&model=sale.order&view_type=form',
      'Sai chỗ nào anh/chị nhắn "sửa đơn ..." em sửa ngay ạ.',
    ].join('\n');
    expect(boSuyNghi(tin)).toBe(tin);
  });

  it('thẻ <think> vẫn cắt như cũ', () => {
    expect(boSuyNghi("<think>Okay, let's see.</think>Shop có đèn LED âm trần.")).toBe('Shop có đèn LED âm trần.');
  });

  it('reasoning + trả lời trên CÙNG dòng-đoạn tách bằng 1 xuống dòng → vẫn cắt đúng dòng', () => {
    const ra = boSuyNghi('The user wants the price. Let me check the tool result.\nDạ Card thu BX-V7508 giá 238.000đ ạ.');
    expect(ra).toBe('Dạ Card thu BX-V7508 giá 238.000đ ạ.');
  });
});
