// SPDX-License-Identifier: AGPL-3.0-or-later
// Tên file gửi Zalo (03/10): khách thấy "0-LLR%20P3.076-V2.0%20OP%20LUNG.pdf" — bỏ tiền tố chỉ số, giải %-mã hoá, bỏ đường dẫn.
import { describe, it, expect } from 'vitest';
import { tenFileGuiZalo } from '../src/modules/chat/chat-attachment-routes.js';

describe('tenFileGuiZalo', () => {
  it('giải %-mã hoá tên multipart', () => {
    expect(tenFileGuiZalo('LLR%20P3.076-V2.0%20OP%20LUNG.pdf')).toBe('LLR P3.076-V2.0 OP LUNG.pdf');
    expect(tenFileGuiZalo('P10%20SMD%20%C4%90%E1%BB%8E.pdf')).toBe('P10 SMD ĐỎ.pdf');
  });
  it('tên thường giữ nguyên; % lẻ không phải mã thì giữ', () => {
    expect(tenFileGuiZalo('LLR P3.076-V2.0 OP LUNG.pdf')).toBe('LLR P3.076-V2.0 OP LUNG.pdf');
    expect(tenFileGuiZalo('giảm 50% .pdf')).toBe('giảm 50% .pdf');
  });
  it('không thoát thư mục; rỗng ⇒ upload', () => {
    expect(tenFileGuiZalo('../../etc/passwd')).not.toContain('/');
    expect(tenFileGuiZalo('%2E%2E%2Fx.pdf')).not.toContain('/');
    expect(tenFileGuiZalo('')).toBe('upload');
    expect(tenFileGuiZalo(undefined)).toBe('upload');
  });
});
