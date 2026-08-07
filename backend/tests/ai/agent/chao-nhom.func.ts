// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: guard chống nói hớ ở màn chào nhóm (spec 2026-08-07).
// Câu ngữ cảnh bot NÓI TRƯỚC CẢ NHÓM phải sạch tuyệt đối.
import { describe, it, expect } from 'vitest';
import { locCauNguCanh, khuonChao } from '../../../src/modules/ai/agent/noi-zalo/chao-nhom.js';

describe('locCauNguCanh — chặn nói hớ', () => {
  it('giữ câu chủ đề sạch', () => {
    expect(locCauNguCanh('em thấy nhóm mình đang quan tâm đèn LED âm trần'))
      .toBe('em thấy nhóm mình đang quan tâm đèn LED âm trần');
  });

  it('bỏ câu nhắc tiền', () => {
    expect(locCauNguCanh('nhóm đang hỏi báo giá 500k')).toBe('');
    expect(locCauNguCanh('mọi người bàn về 2 triệu')).toBe('');
  });

  it('bỏ câu nhắc đơn/giá/khiếu nại/hứa hẹn/bảo hành', () => {
    expect(locCauNguCanh('nhóm đang khiếu nại đơn hàng')).toBe('');
    expect(locCauNguCanh('shop hứa giao hàng tuần này')).toBe('');
    expect(locCauNguCanh('mọi người hỏi về giá sản phẩm')).toBe('');
    expect(locCauNguCanh('khách bàn chuyện bảo hành')).toBe('');
  });

  it('bỏ câu chứa số điện thoại / mã đơn', () => {
    expect(locCauNguCanh('liên hệ 0901234567 nhé')).toBe('');
    expect(locCauNguCanh('về đơn DNH36805')).toBe('');
    expect(locCauNguCanh('đơn S13798 đang chờ')).toBe('');
  });

  it('bỏ câu quá dài hoặc nhiều câu', () => {
    expect(locCauNguCanh('a'.repeat(130))).toBe('');
    expect(locCauNguCanh('câu một. câu hai.')).toBe('');
    expect(locCauNguCanh('dòng một\ndòng hai')).toBe('');
  });

  it('bỏ khi model trả "không rõ" / rỗng', () => {
    expect(locCauNguCanh('không rõ')).toBe('');
    expect(locCauNguCanh('n/a')).toBe('');
    expect(locCauNguCanh('')).toBe('');
    expect(locCauNguCanh(null)).toBe('');
    expect(locCauNguCanh(undefined)).toBe('');
  });
});

describe('khuonChao', () => {
  it('luôn chứa tên shop + lời mời nhắn', () => {
    const s = khuonChao('LEDNELIA');
    expect(s).toContain('LEDNELIA');
    expect(s).toContain('nhắn em');
  });
});
