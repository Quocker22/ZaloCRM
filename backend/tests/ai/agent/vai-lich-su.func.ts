// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: vai trong lịch sử + bóc mention — hai thủ phạm làm bot lú
// trong nhóm (06/08/2026 13:02).
//
// Chat thật: nhân viên tag bot chọn khách "Anh Dương Tuấn Anh", bot đáp
// "Tồn kho của nguồn NB còn bao nhiêu ạ?" — nhai lại câu cũ, 0 tool chạy.
// Mổ ra hai lỗi: (1) vai lịch sử gán NGƯỢC (nhân viên nick cá nhân → BOT,
// bot → NHÂN VIÊN), (2) chuỗi mention "@Led Nelia" dính nguyên trong content.
import { describe, it, expect } from 'vitest';
import { bocMention } from '../../../src/modules/ai/agent/noi-zalo/boc-mention.js';
import { ghepLichSuNhanVien } from '../../../src/modules/ai/agent/staff-agent.js';

describe('bocMention — cắt chuỗi mention bằng pos/len Zalo trả', () => {
  it('CA THẬT: "@Led Nelia Anh Dương Tuấn Anh" → "Anh Dương Tuấn Anh"', () => {
    const content = '@Led Nelia Anh Dương Tuấn Anh';
    expect(bocMention(content, [{ uid: 'bot-1', pos: 0, len: 10 }])).toBe('Anh Dương Tuấn Anh');
  });

  it('mention giữa câu — không để lại hai khoảng trắng liền nhau', () => {
    const content = 'nhờ @Led Nelia lên đơn giúp';
    expect(bocMention(content, [{ uid: 'bot-1', pos: 4, len: 10 }])).toBe('nhờ lên đơn giúp');
  });

  it('nhiều mention — cắt từ phải sang, pos không lệch', () => {
    const content = '@An giao việc cho @Bình nhé';
    expect(bocMention(content, [
      { uid: 'u1', pos: 0, len: 3 },
      { uid: 'u2', pos: 18, len: 5 },
    ])).toBe('giao việc cho nhé');
  });

  it('pos/len rác (ngoài biên) → bỏ qua mention đó, không cắt bậy', () => {
    expect(bocMention('ngắn', [{ uid: 'u', pos: 10, len: 99 }])).toBe('ngắn');
  });

  it('không mention → giữ nguyên', () => {
    expect(bocMention('lên đơn 10 cái', undefined)).toBe('lên đơn 10 cái');
    expect(bocMention('lên đơn 10 cái', [])).toBe('lên đơn 10 cái');
  });
});

describe('ghepLichSuNhanVien — ba vai, không còn gán ngược', () => {
  it('render đủ NHÂN VIÊN / BOT / KHÁCH đúng nhãn', () => {
    const ketQua = ghepLichSuNhanVien(
      [
        { vai: 'nhanvien', noiDung: 'lên đơn cho anh tuấn 10 cái nguồn NB' },
        { vai: 'bot', noiDung: 'Tìm thấy 10 khách có tên "anh tuấn"...' },
        { vai: 'khach', noiDung: 'shop ơi còn hàng không' },
      ],
      'Anh Dương Tuấn Anh',
    );

    expect(ketQua).toContain('NHÂN VIÊN: lên đơn cho anh tuấn');
    expect(ketQua).toContain('BOT: Tìm thấy 10 khách');
    expect(ketQua).toContain('KHÁCH: shop ơi còn hàng không');
    expect(ketQua).toContain('[Tin mới]\nAnh Dương Tuấn Anh');
  });
});
