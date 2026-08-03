// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { onIncomingMessageHook } from '../../../src/modules/ai/knowledge/ai-auto-reply-hook.js';

function deps(genReply: string) {
  return {
    search: vi.fn(async () => [{ content: 'Mở 9h-22h' }]),
    getHistory: vi.fn(async () => []),
    generate: vi.fn(async () => genReply),
    sendReply: vi.fn(async () => {}),
    addTag: vi.fn(async () => {}),
    alreadyHandled: vi.fn(async () => false),
    recordSuggestion: vi.fn(async () => {}),
    openHandoffGroup: vi.fn(async () => {}),
  };
}
const conv = { id: 'c1', isVirtual: false, zaloAccountId: 'a', externalThreadId: 't', threadType: 'user', contactId: 'ct', hasHandoffTag: false };
const baseInput = (over: any = {}) => ({
  orgId: 'org1',
  conversation: { ...conv, ...(over.conversation ?? {}) },
  message: { id: 'm1', content: 'mấy giờ mở?', isSelf: false, ...(over.message ?? {}) },
  cfg: { bizName: 'ABC', autoReplyEnabled: true, threshold: 0.7, topK: 5, tagOnHandoff: 'auto:can-sale', historyLimit: 8, ...(over.cfg ?? {}) },
});
const confident = '{"reply":"9h-22h","confidence":0.9,"needs_human":false,"reason":""}';

describe('onIncomingMessageHook', () => {
  it('tự tin + autoReply bật → sent', async () => {
    const d = deps(confident);
    const r = await onIncomingMessageHook(d, baseInput());
    expect(r).toBe('sent');
    expect(d.sendReply).toHaveBeenCalled();
    expect(d.addTag).not.toHaveBeenCalled();
  });
  it('gửi thành công → KHÔNG mở group handoff (câu vặt không cần sale)', async () => {
    const d = deps(confident);
    await onIncomingMessageHook(d, baseInput());
    expect(d.openHandoffGroup).not.toHaveBeenCalled();
  });
  it('needs_human handoff → MỞ group handoff cho sale', async () => {
    const d = deps('{"reply":"Dạ em chuyển sale báo giá sỉ nhé","confidence":0.9,"needs_human":true,"reason":"giá sỉ"}');
    await onIncomingMessageHook(d, baseInput());
    expect(d.openHandoffGroup).toHaveBeenCalledWith('c1', expect.any(String), 'handoff');
  });
  it('khiếu nại → MỞ group handoff (decision=complaint)', async () => {
    const d = deps(confident);
    await onIncomingMessageHook(d, baseInput({ message: { content: 'hàng tôi mua bị hư rồi' } }));
    expect(d.openHandoffGroup).toHaveBeenCalledWith('c1', 'hàng tôi mua bị hư rồi', 'complaint');
  });
  it('autoReply tắt → handoff (gắn tag, không gửi)', async () => {
    const d = deps(confident);
    const r = await onIncomingMessageHook(d, baseInput({ cfg: { autoReplyEnabled: false } }));
    expect(r).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
    expect(d.addTag).toHaveBeenCalledWith('ct', 'auto:can-sale');
  });
  it('needs_human + câu sạch (không bịa số) → handoff NHƯNG VẪN gửi câu cho khách', async () => {
    // Khách hỏi giá sỉ: bot chuyển sale nhưng phải nói "em chuyển sale báo giá nhé", không im.
    const d = deps('{"reply":"Dạ em chuyển sale báo giá sỉ tốt nhất nhé","confidence":0.9,"needs_human":true,"reason":"giá sỉ"}');
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).toHaveBeenCalled(); // KHÔNG để khách im lặng
    expect(d.addTag).toHaveBeenCalledWith('ct', 'auto:can-sale');
  });
  it('confidence thấp → handoff, NHƯNG VẪN gửi câu (khách không bị im lặng)', async () => {
    // Đổi CỐ Ý ở commit 9078e3c6 "handoff luôn gửi câu cho khách": trước đây
    // confidence thấp → bot im, khách chờ mà không biết gì. Giờ `deliver` chỉ phụ
    // thuộc (a) câu KHÔNG bịa số và (b) có nội dung thật — không phụ thuộc confidence.
    // Vẫn gắn tag handoff để sale vào tiếp.
    const d = deps('{"reply":"chắc là vậy","confidence":0.2,"needs_human":false,"reason":""}');
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).toHaveBeenCalled();
    expect(d.addTag).toHaveBeenCalledWith('ct', 'auto:can-sale');
  });
  it('handoff vì bịa số → KHÔNG gửi (guard chặn)', async () => {
    // reply chứa 999.000đ không có trong KB ("Mở 9h-22h") → guard chặn, không gửi số bịa.
    const d = deps('{"reply":"Dạ tổng cộng 999.000đ ạ","confidence":0.95,"needs_human":false,"reason":""}');
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
  });
  it('tin của self → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ message: { isSelf: true } }))).toBe('ignored');
    expect(d.generate).not.toHaveBeenCalled();
  });
  it('hội thoại virtual → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ conversation: { isVirtual: true } }))).toBe('ignored');
  });
  it('đã có tag handoff → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ conversation: { hasHandoffTag: true } }))).toBe('ignored');
  });
  it('messageId đã xử lý → ignored', async () => {
    const d = deps(confident);
    d.alreadyHandled = vi.fn(async () => true);
    expect(await onIncomingMessageHook(d, baseInput())).toBe('ignored');
  });
  it('LLM lỗi → handoff (không gửi rác)', async () => {
    const d = deps(confident);
    d.generate = vi.fn(async () => { throw new Error('llm down'); });
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
  });
  it('sendReply lỗi → handoff (không retry mù)', async () => {
    const d = deps(confident);
    d.sendReply = vi.fn(async () => { throw new Error('send fail'); });
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.addTag).toHaveBeenCalled();
  });
});
