// SPDX-License-Identifier: AGPL-3.0-or-later
// HÀNG RÀO CHỐNG HỨA LÈO cho việc GỬI FILE tài liệu.
//
// Vì sao cần thêm cái này bên cạnh `khoeDaGuiAnh`: từ 11/08 bot gửi được cả
// FILE (tool `gui_tai_lieu`), không chỉ ẢNH hoá đơn. `khoeDaGuiAnh` chỉ soi
// "gửi ảnh/hình/hoá đơn" nên câu "em gửi catalog rồi nhé" lọt thẳng — đúng
// dạng bịa đã nổ hai lần trước đó (khoeDaGhi 05/08, khoeDaGuiAnh 07/08).
//
// Bắt CHẶT theo đúng mẫu `khoeDaGuiAnh`: chỉ chặn khi CHỦ NGỮ là BOT. Bot XIN
// người khác gửi tài liệu ("anh gửi tài liệu qua giúp em") là nghĩa NGƯỢC —
// chặn câu đó thì văng thông báo nội bộ ra cho khách (bug 23:38 10/08).
import { describe, it, expect } from 'vitest';
import { khoeDaGuiTaiLieu } from '../../../src/modules/ai/agent/y-dinh-dung.js';

describe('CHẶN — chủ ngữ là BOT khoe đã/đang gửi tài liệu', () => {
  it.each([
    'Dạ em gửi catalog cho anh rồi ạ',
    'Em đã gửi tài liệu P10 cho anh nhé',
    'Em gửi lại file pdf cho anh',
    'Mình gửi datasheet cho anh nha',
    'Shop gửi catalogue qua cho anh rồi',
    'Bên em đã gửi tài liệu kỹ thuật',
    'Em sẽ gửi file catalog ngay',
    'Em đang gửi tài liệu cho anh',
  ])('chặn: "%s"', (c) => expect(khoeDaGuiTaiLieu(c)).toBe(true));

  it('bắt được cả khi gõ KHÔNG DẤU', () => {
    expect(khoeDaGuiTaiLieu('em da gui tai lieu cho anh roi')).toBe(true);
  });
});

describe('KHÔNG chặn — chủ ngữ KHÔNG phải bot', () => {
  it.each([
    // Bot XIN người khác gửi — nghĩa ngược hẳn (bug 23:38:44 10/08).
    'Anh gửi tài liệu qua giúp em với ạ',
    'Chị gửi file catalog cho em xem nhé',
    'Bạn gửi pdf sang đây giúp mình',
    'Nhân viên sẽ gửi tài liệu cho anh',
  ])('cho qua: "%s"', (c) => expect(khoeDaGuiTaiLieu(c)).toBe(false));

  it.each([
    // Câu HỎI / đề nghị — vô hại, không phải lời khẳng định đã xong.
    'Anh có cần em gửi catalog không ạ',
    'Em tra được thông số trong tài liệu ạ',
    'Dạ em kiểm tra tài liệu rồi báo anh',
  ])('cho qua: "%s"', (c) => expect(khoeDaGuiTaiLieu(c)).toBe(false));

  it('rỗng / rác → false, không nổ', () => {
    expect(khoeDaGuiTaiLieu('')).toBe(false);
    expect(khoeDaGuiTaiLieu(undefined as unknown as string)).toBe(false);
  });
});

describe('KHÔNG giẫm chân hàng rào ẢNH sẵn có', () => {
  it('câu về ảnh hoá đơn KHÔNG bị hàng rào tài liệu bắt (để khoeDaGuiAnh lo)', () => {
    expect(khoeDaGuiTaiLieu('Dạ em gửi lại ảnh đơn hàng DNH36805')).toBe(false);
  });
});
