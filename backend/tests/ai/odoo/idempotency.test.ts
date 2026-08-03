// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test: khoá chống trùng đơn. Hàm thuần, không I/O.
import { describe, it, expect } from 'vitest';
import { sinhKhoaDon, laKhoaBot, tachKhoaDon } from '../../../src/modules/ai/odoo/idempotency.js';

describe('sinhKhoaDon', () => {
  it('cùng hội thoại + cùng lượt → CÙNG khoá (điều kiện để chặn trùng)', () => {
    // Đây là tính chất quan trọng nhất: retry phải sinh ra cùng khoá.
    expect(sinhKhoaDon('conv-1', 0)).toBe(sinhKhoaDon('conv-1', 0));
  });

  it('khác lượt → khác khoá (khách chốt đơn thứ 2 vẫn tạo được)', () => {
    expect(sinhKhoaDon('conv-1', 0)).not.toBe(sinhKhoaDon('conv-1', 1));
  });

  it('khác hội thoại → khác khoá', () => {
    expect(sinhKhoaDon('conv-1', 0)).not.toBe(sinhKhoaDon('conv-2', 0));
  });

  it('KHÔNG chứa thời gian hay ngẫu nhiên — gọi 100 lần vẫn ra 1 giá trị', () => {
    const bo = new Set(Array.from({ length: 100 }, () => sinhKhoaDon('conv-1', 0)));
    expect(bo.size).toBe(1);
  });

  it('định dạng zalo:{conv}:{seq}', () => {
    expect(sinhKhoaDon('abc', 2)).toBe('zalo:abc:2');
  });

  it('seq không hợp lệ → về 0 thay vì sinh khoá rác', () => {
    expect(sinhKhoaDon('abc', -1)).toBe('zalo:abc:0');
    expect(sinhKhoaDon('abc', 1.5)).toBe('zalo:abc:0');
  });

  it('thiếu conversationId → ném (không được tạo đơn không truy vết được)', () => {
    expect(() => sinhKhoaDon('', 0)).toThrow(/Thiếu conversationId/);
    expect(() => sinhKhoaDon('   ', 0)).toThrow();
  });
});

describe('laKhoaBot', () => {
  it('phân biệt được đơn bot với đơn người/hệ thống', () => {
    expect(laKhoaBot('zalo:conv-1:0')).toBe(true);
    expect(laKhoaBot('DH00123')).toBe(false);   // sequence incokit.dh.ref
    expect(laKhoaBot('')).toBe(false);
    expect(laKhoaBot(null)).toBe(false);
    expect(laKhoaBot(123)).toBe(false);
  });
});

describe('tachKhoaDon', () => {
  it('tách ngược ra conversationId + seq', () => {
    expect(tachKhoaDon('zalo:conv-1:3')).toEqual({ conversationId: 'conv-1', seq: 3 });
  });

  it('conversationId chứa dấu hai chấm vẫn tách đúng (tách từ PHẢI)', () => {
    expect(tachKhoaDon('zalo:a:b:c:5')).toEqual({ conversationId: 'a:b:c', seq: 5 });
  });

  it('không phải khoá bot → null', () => {
    expect(tachKhoaDon('DH00123')).toBeNull();
  });

  it('khoá hỏng → null, không ném', () => {
    expect(tachKhoaDon('zalo:conv-1:abc')).toBeNull();
    expect(tachKhoaDon('zalo:')).toBeNull();
  });

  it('sinh rồi tách → về đúng dữ liệu ban đầu', () => {
    expect(tachKhoaDon(sinhKhoaDon('conv-xyz', 7))).toEqual({ conversationId: 'conv-xyz', seq: 7 });
  });
});
