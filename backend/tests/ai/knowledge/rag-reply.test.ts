// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildRagSystemPrompt, parseRagReply, decideAction, replyHasUnsupportedNumber } from '../../../src/modules/ai/knowledge/rag-reply.js';

describe('buildRagSystemPrompt', () => {
  it('chứa biz name + chunk + JSON + needs_human', () => {
    const s = buildRagSystemPrompt('LEDNELIA', ['Mở 9h-22h.', 'Có giao hàng.']);
    expect(s).toContain('LEDNELIA');
    expect(s).toContain('Mở 9h-22h');
    expect(s.toLowerCase()).toContain('json');
    expect(s.toLowerCase()).toContain('needs_human');
  });
  it('hướng dẫn bán hàng: hỏi nhu cầu + chống bịa', () => {
    const s = buildRagSystemPrompt('LEDNELIA', []);
    expect(s.toLowerCase()).toContain('nhu cầu');
    expect(s.toLowerCase()).toContain('bịa');
  });
  it('chèn lịch sử hội thoại khi có', () => {
    const s = buildRagSystemPrompt('LEDNELIA', ['x'], [
      { role: 'customer', content: 'có bóng decor không' },
      { role: 'shop', content: 'dạ có ạ' },
    ]);
    expect(s).toContain('có bóng decor không');
    expect(s).toContain('KHÁCH:');
    expect(s).toContain('SHOP:');
  });
});

describe('parseRagReply', () => {
  it('parse JSON sạch', () => {
    const r = parseRagReply('{"reply":"hi","confidence":0.9,"needs_human":false,"reason":"ok"}');
    expect(r.confidence).toBe(0.9);
    expect(r.needsHuman).toBe(false);
    expect(r.reply).toBe('hi');
  });
  it('trích JSON lẫn prose', () => {
    const r = parseRagReply('Đây là kết quả: {"reply":"x","confidence":0.5,"needs_human":true,"reason":"r"} hết.');
    expect(r.reply).toBe('x');
    expect(r.needsHuman).toBe(true);
  });
  it('JSON hỏng → default an toàn (handoff)', () => {
    const r = parseRagReply('không phải json');
    expect(r.needsHuman).toBe(true);
    expect(r.confidence).toBe(0);
  });
});

describe('decideAction', () => {
  const base = { reply: 'x', confidence: 0.9, needsHuman: false, reason: '' };
  it('tự tin + bật → send', () => {
    expect(decideAction(base, { autoReplyEnabled: true, threshold: 0.7 })).toBe('send');
  });
  it('tắt auto → handoff', () => {
    expect(decideAction(base, { autoReplyEnabled: false, threshold: 0.7 })).toBe('handoff');
  });
  it('needs_human → handoff', () => {
    expect(decideAction({ ...base, needsHuman: true }, { autoReplyEnabled: true, threshold: 0.7 })).toBe('handoff');
  });
  it('confidence thấp → handoff', () => {
    expect(decideAction({ ...base, confidence: 0.3 }, { autoReplyEnabled: true, threshold: 0.7 })).toBe('handoff');
  });
  it('số bịa trong reply (combo total) → handoff dù confidence cao', () => {
    const rep = { ...base, reply: 'Combo 2 cuộn 210.000đ và cáp 170.000đ, tổng cộng 380.000đ ạ.' };
    const sources = ['Led dây COB 5m: Giá bán 105.000đ', 'cáp 16 sợi: Giá bán 170.000đ'];
    expect(decideAction(rep, { autoReplyEnabled: true, threshold: 0.7, numberSources: sources })).toBe('handoff');
  });
  it('giá thật có trong KB → vẫn send', () => {
    const rep = { ...base, reply: 'Dạ Led dây COB 5m giá 105.000đ ạ.' };
    const sources = ['Led dây COB 5m: Giá bán 105.000đ'];
    expect(decideAction(rep, { autoReplyEnabled: true, threshold: 0.7, numberSources: sources })).toBe('send');
  });
});

describe('replyHasUnsupportedNumber (chống bot tự tính số)', () => {
  it('flag tổng combo bịa (380.000 không có trong nguồn)', () => {
    const sources = ['Led dây COB 5m: 105.000đ', 'cáp 16 sợi: 170.000đ', 'Đồng hồ: 260.000đ'];
    expect(replyHasUnsupportedNumber('tổng cộng 380.000đ ạ', sources)).toBe(true);
  });
  it('flag tiền điện ước lượng (không có dữ liệu)', () => {
    const sources = ['Led dây COB 5m: 105.000đ'];
    expect(replyHasUnsupportedNumber('tiền điện khoảng 15.000đ đến 30.000đ một tháng', sources)).toBe(true);
  });
  it('KHÔNG flag giá thật lặp lại đúng từ KB', () => {
    const sources = ['Led dây COB 5m 12V: Giá bán 105.000đ. Tồn 239'];
    expect(replyHasUnsupportedNumber('Dạ loại này 105.000đ ạ', sources)).toBe(false);
  });
  it('KHÔNG flag khi reply không có số cỡ giá tiền', () => {
    expect(replyHasUnsupportedNumber('Dạ bên em có 2 màu ạ, anh/chị thích màu nào?', ['x'])).toBe(false);
  });
  it('khớp được dù KB ghi có dấu chấm nghìn còn reply cũng vậy', () => {
    const sources = ['Giá bán: 1.200.000đ'];
    expect(replyHasUnsupportedNumber('Dạ giá 1.200.000đ ạ', sources)).toBe(false);
    expect(replyHasUnsupportedNumber('Dạ giá 1.500.000đ ạ', sources)).toBe(true);
  });
});
