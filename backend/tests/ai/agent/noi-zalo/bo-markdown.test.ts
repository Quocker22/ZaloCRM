// SPDX-License-Identifier: AGPL-3.0-or-later
// Cổng ra chống markdown — Zalo hiển thị thô. Prompt dặn rồi mà model vẫn vi
// phạm (chat thật 16:42 08/08: "**mạch full viền Solantech**") → chặn bằng code.
import { describe, it, expect } from 'vitest';
import { boMarkdown } from '../../../../src/modules/ai/agent/noi-zalo/bo-markdown.js';

describe('boMarkdown', () => {
  it('bỏ **đậm** và __gạch__ nhưng giữ nguyên chữ (bug thật 16:42 08/08)', () => {
    expect(boMarkdown('Shop có **mạch full viền Solantech** ạ')).toBe('Shop có mạch full viền Solantech ạ');
    expect(boMarkdown('hàng __chính hãng__ nhé')).toBe('hàng chính hãng nhé');
  });

  it('bỏ `code` và ### heading đầu dòng', () => {
    expect(boMarkdown('dùng lệnh `tra_gia` nhé')).toBe('dùng lệnh tra_gia nhé');
    expect(boMarkdown('### Thông số\nĐiện áp 12V')).toBe('Thông số\nĐiện áp 12V');
  });

  it('KHÔNG đụng link có #, dấu * trong toán (2*3), dấu - gạch ngang', () => {
    const link = 'https://led.incokit.com/web#id=26728&model=sale.order';
    expect(boMarkdown(`Link: ${link}`)).toBe(`Link: ${link}`);
    expect(boMarkdown('khổ 2*3m, giá 5-7 triệu')).toBe('khổ 2*3m, giá 5-7 triệu');
  });

  it('bỏ [nhãn](url) markdown-link → giữ "nhãn: url"', () => {
    expect(boMarkdown('xem [hoá đơn](https://x.com/a) nhé')).toBe('xem hoá đơn: https://x.com/a nhé');
  });
});

// Trói reasoning model thinking trong vòng lặp tool (bug 90s 16:53 08/08)
import { laModelThinking } from '../../../../src/modules/ai/providers/openai-compat.js';
describe('laModelThinking', () => {
  it('nhận deepseek/r1/qwq, bỏ qua gemini/gpt-4o-mini thường', () => {
    expect(laModelThinking('deepseek/deepseek-v4-flash-0731')).toBe(true);
    expect(laModelThinking('deepseek/deepseek-r1')).toBe(true);
    expect(laModelThinking('google/gemini-2.5-flash-lite')).toBe(false);
    expect(laModelThinking('openai/gpt-4o-mini')).toBe(false);
  });
});
