// SPDX-License-Identifier: AGPL-3.0-or-later
// TAG TRỐNG phải NUỐT các tin ngay trước đó của cùng người.
//
// Bug thật 21:04-21:05 10/08 (nhóm):
//   21:04:55  lên đơn cho anh Thức 10 cái nguồn NB   ← QUÊN tag
//   21:05:00  @Tiểu Mã Nelia                          ← tag, nhưng TRỐNG
//
// Anh Quốc: "người ta tag trong một số trường hợp mấy tin trước đó quên tag
// thì sao???". Đúng — ý người dùng rõ ràng: tin trước là VIỆC, tin tag là lệnh
// "làm đi". Đáp "Dạ em đây" là vô dụng khi câu lệnh nằm ngay trên.
//
// Luật: tag trống → gom các tin LIỀN TRƯỚC của CHÍNH người đó, dừng lại khi
// gặp tin của người khác / của bot (chỗ đó là ranh giới lượt nói).
import { describe, it, expect } from 'vitest';
import { gopTinTruocKhiTag } from '../../../src/modules/ai/agent/noi-zalo/gop-tin.js';

const NV = 'uid-quyet';
const NGUOI_KHAC = 'uid-khac';

describe('gopTinTruocKhiTag — tag trống nuốt tin liền trước của cùng người', () => {
  it('kịch bản thật 21:04-21:05: lấy đúng câu lệnh bị quên tag', () => {
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: NV, senderType: 'contact', content: '@Tiểu Mã Nelia chào' },
      { senderUid: null, senderType: 'self', content: 'Chào anh/chị, em hỗ trợ gì được ạ?' },
      { senderUid: NV, senderType: 'contact', content: 'lên đơn cho anh Thức 10 cái nguồn NB' },
    ]);
    expect(kq).toBe('lên đơn cho anh Thức 10 cái nguồn NB');
  });

  it('nhiều tin liên tiếp của cùng người → gộp theo thứ tự cũ → mới', () => {
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: null, senderType: 'self', content: 'Dạ' },
      { senderUid: NV, senderType: 'contact', content: 'lên đơn cho anh Thức' },
      { senderUid: NV, senderType: 'contact', content: '10 cái nguồn NB' },
    ]);
    expect(kq).toBe('lên đơn cho anh Thức\n10 cái nguồn NB');
  });

  it('DỪNG ở tin của bot — không nuốt ngược qua lượt đã trả lời', () => {
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: NV, senderType: 'contact', content: 'việc CŨ đã xong' },
      { senderUid: null, senderType: 'self', content: 'Em làm xong rồi ạ' },
      { senderUid: NV, senderType: 'contact', content: 'việc mới' },
    ]);
    expect(kq).toBe('việc mới');
  });

  it('DỪNG ở tin của người khác — không bốc câu người ta nói với nhau', () => {
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: NV, senderType: 'contact', content: 'câu của tôi trước đó' },
      { senderUid: NGUOI_KHAC, senderType: 'contact', content: 'anh ơi cho hỏi' },
    ]);
    expect(kq).toBeNull();
  });

  it('lịch sử trống → null (không bịa nội dung)', () => {
    expect(gopTinTruocKhiTag(NV, [])).toBeNull();
  });

  it('tin trước cũng chỉ là tag trống → bỏ, không gộp rác', () => {
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: NV, senderType: 'contact', content: 'lên đơn cho anh Thức' },
      { senderUid: NV, senderType: 'contact', content: '@Tiểu Mã Nelia' },
    ]);
    expect(kq).toBe('lên đơn cho anh Thức');
  });

  it('tin trước có tag KÈM nội dung → vẫn lấy (đã xử rồi thì bot đã trả lời)', () => {
    // Không được cắt nhầm: "@bot lên đơn cho anh Thức" là tin CÓ việc.
    // Nếu bot đã trả lời nó thì vòng lặp đã dừng ở tin 'self' trước đó rồi.
    const kq = gopTinTruocKhiTag(NV, [
      { senderUid: NV, senderType: 'contact', content: '@Tiểu Mã Nelia lên đơn cho anh Thức' },
    ]);
    expect(kq).toBe('@Tiểu Mã Nelia lên đơn cho anh Thức');
  });

  it('giới hạn 5 tin — tag trống không kéo cả buổi chat vào', () => {
    const nhieu = Array.from({ length: 12 }, (_, i) => ({
      senderUid: NV, senderType: 'contact', content: `tin ${i}`,
    }));
    const kq = gopTinTruocKhiTag(NV, nhieu);
    expect(kq?.split('\n')).toHaveLength(5);
    expect(kq).toContain('tin 11');
    expect(kq).not.toContain('tin 6');
  });
});
