// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: HAI CỔNG phải đồng thuận — tin qua cổng 1 thì cổng 2 phải nhận.
//
// Bug thật (2026-08-05, mất một buổi): nhân viên nhắn "chào ní" từ UID đã khai
// trong AI_AGENT_UID_NHANVIEN. Cổng 1 (`luong-nhan-vien`) CHO QUA vì UID hợp lệ
// — không cần tag. Nhưng `chayLenhNhanVien` kiểm cổng LẦN HAI với dữ liệu
// KHÁC: chỉ có `content` + `isSelf`, KHÔNG có `senderUid`. Tin không tag `@bot`
// → cổng 2 TỪ CHỐI → `khong_phai_lenh` → `return false` KHÔNG log.
//
// Nhìn log chỉ thấy "BẮT ĐẦU xử lý" rồi im, tưởng treo ở LLM. Thực ra nó thoát
// sau 0,00s. Test này khoá cả hai mặt: cổng phải đồng thuận, và bất đồng phải
// có log.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nhanDienLenhNhanVien } from '../../../src/modules/ai/agent/staff-command.js';

let goc: NodeJS.ProcessEnv;
beforeEach(() => { goc = { ...process.env }; });
afterEach(() => { process.env = goc; });

const UID_NV = '7684573050905916234';

describe('hai cổng nhận lệnh phải đồng thuận', () => {
  it('BUG GỐC: UID nhân viên nhắn KHÔNG tag → cổng 1 nhận, cổng 2 (thiếu senderUid) TỪ CHỐI', () => {
    process.env.AI_AGENT_UID_NHANVIEN = UID_NV;

    // Cổng 1 — có senderUid, đúng như luong-nhan-vien gọi.
    const cong1 = nhanDienLenhNhanVien({
      content: 'chào ní', isSelf: false, senderUid: UID_NV,
    });
    expect(cong1, 'cổng 1 phải cho qua — UID đã khai là nhân viên').not.toBeNull();

    // Cổng 2 — chayLenhNhanVien kiểm lại, KHÔNG có senderUid. Đây là chỗ vỡ.
    const cong2ThoNhu_cu = nhanDienLenhNhanVien({
      content: 'chào ní', isSelf: true, // truyền content THÔ như code cũ
    });
    expect(cong2ThoNhu_cu, 'tái hiện bug: cổng 2 từ chối vì không thấy tag').toBeNull();
  });

  it('CÁCH SỬA: nối lại "@bot " vào nội dung đã qua cổng → cổng 2 nhận', () => {
    process.env.AI_AGENT_UID_NHANVIEN = UID_NV;

    const cong1 = nhanDienLenhNhanVien({
      content: 'chào ní', isSelf: false, senderUid: UID_NV,
    });
    expect(cong1).not.toBeNull();

    // Đúng thứ luong-nhan-vien truyền xuống sau khi sửa.
    const cong2 = nhanDienLenhNhanVien({
      content: `@bot ${cong1!.noiDung}`, isSelf: true,
    });

    expect(cong2, 'cổng 2 PHẢI nhận — cổng 1 đã xác thực danh tính rồi').not.toBeNull();
    expect(cong2!.noiDung, 'nội dung giữ nguyên, không dính tag').toBe('chào ní');
  });

  it('nhân viên TỰ gõ @bot vẫn hoạt động như cũ — không hồi quy', () => {
    process.env.AI_AGENT_UID_NHANVIEN = UID_NV;

    const cong1 = nhanDienLenhNhanVien({
      content: '@bot giá P10 bao nhiêu', isSelf: false, senderUid: UID_NV,
    });
    expect(cong1!.noiDung).toBe('giá P10 bao nhiêu');

    const cong2 = nhanDienLenhNhanVien({
      content: `@bot ${cong1!.noiDung}`, isSelf: true,
    });
    expect(cong2!.noiDung).toBe('giá P10 bao nhiêu');
  });

  it('KHÁCH lạ vẫn bị chặn ở cổng 1 — sửa bug không được nới bảo mật', () => {
    process.env.AI_AGENT_UID_NHANVIEN = UID_NV;

    // Khách gõ cả @bot cũng không qua: isSelf=false và UID không khai.
    expect(nhanDienLenhNhanVien({
      content: '@bot lên đơn 1000 cái', isSelf: false, senderUid: 'khach-la-999',
    })).toBeNull();
  });
});
