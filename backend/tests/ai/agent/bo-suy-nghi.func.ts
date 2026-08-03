// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: bỏ khối <think> của model reasoning.
//
// Bug thật (đo 2026-08-03): cầu nối Zalo gửi nguyên "<think>Okay, let's see.
// The user wants me to…" cho khách khi chạy qwen3:8b qua Ollama. Cắt ở tầng
// provider nên cả luồng khách lẫn nhân viên đều được che.
import { describe, it, expect } from 'vitest';
import { boSuyNghi } from '../../../src/modules/ai/providers/openai-compat.js';

describe('boSuyNghi', () => {
  it('bỏ khối think, giữ câu trả lời', () => {
    expect(boSuyNghi("<think>Okay, let's see. The user wants…</think>Shop có đèn LED âm trần."))
      .toBe('Shop có đèn LED âm trần.');
  });

  it('khối think NHIỀU DÒNG (dạng thật của qwen3)', () => {
    const raw = '<think>\nOkay, let me think.\nThe user asked about products.\n</think>\n\nDạ shop bán đèn LED ạ.';
    expect(boSuyNghi(raw)).toBe('Dạ shop bán đèn LED ạ.');
  });

  it('THẺ MỞ KHÔNG ĐÓNG (model bị cắt giữa chừng) → bỏ hết phần còn lại', () => {
    // Phần sau thẻ mở vẫn là suy nghĩ, chưa phải câu trả lời — gửi ra là lộ.
    expect(boSuyNghi('<think>Okay so the customer is asking about pric')).toBe('');
  });

  it('nhiều khối think → bỏ hết', () => {
    expect(boSuyNghi('<think>a</think>Xin chào.<think>b</think> Còn hàng ạ.'))
      .toBe('Xin chào. Còn hàng ạ.');
  });

  it('KHÔNG có think → giữ nguyên, chỉ trim', () => {
    expect(boSuyNghi('  Dạ shop còn hàng ạ.  ')).toBe('Dạ shop còn hàng ạ.');
  });

  it('không nuốt nhầm chữ "think" trong câu bình thường', () => {
    expect(boSuyNghi('I think đèn này hợp ạ')).toBe('I think đèn này hợp ạ');
  });

  it('chuỗi rỗng → rỗng (không ném)', () => {
    expect(boSuyNghi('')).toBe('');
  });
});
