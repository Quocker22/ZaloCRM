// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: trong NHÓM, bot chỉ nói khi được tag.
//
// Lỗ hổng gốc (06/08/2026): cả luồng khách lẫn đặc quyền UID nhân viên đều
// không phân biệt nhóm với chat 1-1 —
//   - luồng khách: nhóm nhiều người tán gẫu, bot chen vào TỪNG CÂU, đốt tiền
//     LLM theo cuộc nói chuyện của người khác;
//   - UID nhân viên: "mọi tin là lệnh" đúng cho 1-1, nhưng trong nhóm thì
//     nhân viên bàn việc/nói với khách — mỗi câu thành một lệnh bot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nhanDienLenhNhanVien, coTagBot } from '../../../src/modules/ai/agent/staff-command.js';

const UID_NV = '7684573050905916234';

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_UID_NHANVIEN = UID_NV;
});
afterEach(() => { process.env = goc; });

describe('batBuocTag — UID nhân viên trong NHÓM mất đặc quyền không-cần-tag', () => {
  it('1-1 (không batBuocTag): UID nhân viên nhắn trần vẫn là lệnh — hành vi cũ giữ nguyên', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV,
    });
    expect(lenh).not.toBeNull();
  });

  it('NHÓM (batBuocTag): UID nhân viên nhắn trần → KHÔNG phải lệnh', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).toBeNull();
  });

  it('NHÓM: UID nhân viên gõ tay @bot → là lệnh, tag bị bỏ khỏi nội dung', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).not.toBeNull();
    expect(lenh!.noiDung).toBe('giá P10 bao nhiêu');
  });

  it('NHÓM: mention Zalo thật được caller quy đổi thành "@bot " đứng đầu → là lệnh', () => {
    // luong-nhan-vien prepend '@bot ' khi daTagBot=true — đây là hình dạng
    // content lúc tới cổng.
    const lenh = nhanDienLenhNhanVien({
      content: '@bot @Viết Quốc Crm lên đơn 5 cái', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).not.toBeNull();
  });

  it('NHÓM: nick shop cũng vẫn cần tag như trước — không đổi hành vi', () => {
    expect(nhanDienLenhNhanVien({
      content: 'dạ em gửi hàng chiều nay', isSelf: true, batBuocTag: true,
    })).toBeNull();
  });

  it('NHÓM: khách lạ gõ @bot vẫn KHÔNG vào được luồng nhân viên — bảo mật giữ nguyên', () => {
    expect(nhanDienLenhNhanVien({
      content: '@bot lên đơn 1000 cái', isSelf: false, senderUid: 'khach-la', batBuocTag: true,
    })).toBeNull();
  });
});

describe('coTagBot — gate nhóm của luồng khách', () => {
  it.each(['@bot còn hàng không', 'bot ơi giá nhiêu', 'cho hỏi @ai cái này'])(
    'có tag: "%s"', (c) => expect(coTagBot(c)).toBe(true),
  );

  it.each(['còn hàng không', 'mail@ai.com gửi giúp em', ''])(
    'không tag: "%s"', (c) => expect(coTagBot(c)).toBe(false),
  );
});
