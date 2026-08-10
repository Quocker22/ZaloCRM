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

describe('quote-reply nhân viên — tag vẫn được nhận khi có tiền tố quote', () => {
  // 06/08/2026: message-handler nạp tin được quote thành tiền tố
  // `[Trả lời tin: "..."] @bot ...` — cổng phải tìm được tag ở GIỮA chuỗi.
  it('nick shop: `[Trả lời tin: "..."] @bot lên đơn` → là lệnh, giữ nguyên quote cho model', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '[Trả lời tin: "cho mình 5 cuộn led 5m"] @bot lên đơn cái này',
      isSelf: true,
    });
    expect(lenh).not.toBeNull();
    expect(lenh!.noiDung).toBe('[Trả lời tin: "cho mình 5 cuộn led 5m"] lên đơn cái này');
  });

  it('quote chứa chữ "@bot" bên trong ngoặc kép KHÔNG bị nhầm là tag khi thiếu ranh giới từ', () => {
    // Tin khách được quote có "mail@bot.com" — không có khoảng trắng quanh
    // @bot nên timTag bỏ qua (cùng luật đã chặn mail@ai.com từ 03/08).
    expect(nhanDienLenhNhanVien({
      content: '[Trả lời tin: "gửi vào mail@bot.com nhé"] dạ vâng ạ',
      isSelf: true,
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

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 17:07-17:08 10/08 (nhóm): anh Quyết tag bot "lên đơn cho anh chiến",
// bot liệt kê 10 anh Chiến và hỏi chọn. Anh trả lời "khách mới" — KHÔNG tag —
// nên cổng batBuocTag vứt câu đó. Bot không bao giờ thấy câu trả lời, phiên
// treo, nhân viên tưởng bot hỏng.
//
// Bot vừa hỏi thì câu kế của CHÍNH người được hỏi là câu trả lời. Nhưng đây
// nới lỏng ranh giới nên phải chặt: chỉ đúng người, chỉ khi phiên còn mở.
const UID_NV2 = '9111111111111111111';

describe('dangChoTraLoi — bot đang hỏi thì người được hỏi khỏi tag lại', () => {
  it('bot đang hỏi, ĐÚNG người trả lời không tag → LÀ lệnh (bug 17:08 10/08)', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'khách mới', isSelf: false, senderUid: UID_NV,
      batBuocTag: true, dangChoTraLoi: true,
    });
    expect(lenh).not.toBeNull();
    expect(lenh?.noiDung).toBe('khách mới');
  });

  it('bot đang hỏi NGƯỜI KHÁC → người này nói chen vẫn phải tag', () => {
    process.env.AI_AGENT_UID_NHANVIEN = `${UID_NV},${UID_NV2}`;
    const lenh = nhanDienLenhNhanVien({
      content: 'ừ đúng rồi', isSelf: false, senderUid: UID_NV2,
      batBuocTag: true, dangChoTraLoi: false,
    });
    expect(lenh).toBeNull();
  });

  it('KHÔNG có phiên đang hỏi → nhóm vẫn bắt buộc tag, hành vi cũ giữ nguyên', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV,
      batBuocTag: true, dangChoTraLoi: false,
    });
    expect(lenh).toBeNull();
  });

  it('BẢO MẬT: người LẠ (không phải nhân viên) không được nới, kể cả khi bot đang hỏi', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'khách mới', isSelf: false, senderUid: '5555555555555555555',
      batBuocTag: true, dangChoTraLoi: true,
    });
    expect(lenh).toBeNull();
  });

  it('có tag thì vẫn chạy như cũ, tag bị bóc khỏi nội dung', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot khách mới', isSelf: false, senderUid: UID_NV,
      batBuocTag: true, dangChoTraLoi: true,
    });
    expect(lenh?.noiDung).toBe('khách mới');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tag TRỐNG (bug thật 21:05:00 10/08): anh Quốc tag "@Tiểu Mã Nelia" rồi không
// gõ gì thêm — bot IM. Anh hỏi lại: "khi tag là chắc chắn khách cần xử lý rồi
// thì vẫn phải handle chứ????". Đúng: tag = gọi bot. Im lặng là phản hồi tệ
// nhất, người gọi không biết bot có nghe không, tưởng bot chết.
//
// Nhưng KHÔNG gọi LLM cho tag trống — không có gì để suy nghĩ, và đó là câu
// tốn ~3k token cho một dấu tag. Trả cờ `tagTrong` để caller đáp câu tất định.
describe('tag TRỐNG — bot phải lên tiếng, nhưng không gọi LLM', () => {
  it('chỉ có tag, không nội dung → LÀ lệnh, đánh dấu tagTrong', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).not.toBeNull();
    expect(lenh?.tagTrong).toBe(true);
    expect(lenh?.noiDung).toBe('');
  });

  it('tag + khoảng trắng thừa vẫn tính là trống', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot   ', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh?.tagTrong).toBe(true);
  });

  it('tag CÓ nội dung → tagTrong không bật, chạy như cũ', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh?.tagTrong).toBeFalsy();
    expect(lenh?.noiDung).toBe('giá P10 bao nhiêu');
  });

  it('KHÔNG tag và không nội dung → vẫn không phải lệnh (không tự dưng nói)', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '   ', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).toBeNull();
  });
});

describe('tag trống — không rò sang các đường khác', () => {
  it('luồng khách TRÁNH tin tag trống của nhân viên (khỏi trả lời chồng)', () => {
    // laLenhNhanVien chỉ cần biết "có phải lệnh không" — tag trống LÀ lệnh,
    // nên luồng khách phải nhường, đúng như mọi lệnh khác.
    const lenh = nhanDienLenhNhanVien({
      content: '@bot', isSelf: false, senderUid: UID_NV, batBuocTag: true,
    });
    expect(lenh).not.toBeNull();
  });

  it('BẢO MẬT: người lạ tag trống → vẫn không phải lệnh', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot', isSelf: false, senderUid: 'nguoi-la-9999', batBuocTag: true,
    });
    expect(lenh).toBeNull();
  });
});
