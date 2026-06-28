// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildRagSystemPrompt, parseRagReply, decideAction } from '../../../src/modules/ai/knowledge/rag-reply.js';

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
});
