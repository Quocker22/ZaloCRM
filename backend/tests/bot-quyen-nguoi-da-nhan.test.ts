// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot — "Chờ gán — người đã nhắn cho shop" (docs/77 §8): gom theo uid, loại người đã gán / nick của org, đánh dấu
// "đang sai bot" và xếp lên đầu, tìm không dấu, phân trang. Luật THUẦN — không cần DB.
import { describe, it, expect } from 'vitest';
import { gomTheoUid, locVaPhanTrang, boDau, type DongGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';

const d = (uid: string, cid: string, phut: number, them: Partial<DongGom> = {}): DongGom => ({
  uid, conversation_id: cid, loai: 'user', luc: new Date(Date.UTC(2026, 8, 30, 8, phut)), ten: null, ten_nhom: null,
  nick_id: 'n1', nick_ten: 'LED HN', ...them,
});

describe('gomTheoUid', () => {
  it('một uid nhiều nơi ⇒ một ứng viên, nơi mới nhất trước, tên mới nhất có nghĩa', () => {
    const ds = gomTheoUid([
      d('u1', 'dm1', 1, { ten: 'Tên cũ' }),
      d('u1', 'g1', 5, { loai: 'group', ten: 'Tên mới', ten_nhom: 'Nhóm Sales' }),
      d('u1', 'g2', 3, { loai: 'group', ten: null, ten_nhom: 'Nhóm Kho' }),
    ]);
    expect(ds).toHaveLength(1);
    expect(ds[0].ten).toBe('Tên mới');
    expect(ds[0].noi.map((n) => n.conversationId)).toEqual(['g1', 'g2', 'dm1']);
    expect(ds[0].noi[0]).toMatchObject({ loai: 'nhom', tenNhom: 'Nhóm Sales', nick: { id: 'n1', ten: 'LED HN' } });
    expect(ds[0].noi[2]).toMatchObject({ loai: 'rieng', tenNhom: null });
    expect(ds[0].luc?.getUTCMinutes()).toBe(5);
  });
  it('uid khác (cùng người ở hai nick) ⇒ hai ứng viên, mỗi cái nói rõ nick', () => {
    const ds = gomTheoUid([d('u1', 'dm1', 1), d('u9', 'dm2', 2, { nick_id: 'n2', nick_ten: 'LED HCM' })]);
    expect(ds.map((u) => [u.zaloUid, u.noi[0].nick.ten])).toEqual([['u1', 'LED HN'], ['u9', 'LED HCM']]);
  });
});

describe('locVaPhanTrang', () => {
  const ds = gomTheoUid([
    d('u1', 'a', 1, { ten: 'Nguyễn Văn Đức' }),
    d('u2', 'b', 9, { ten: 'Trần Hưng' }),
    d('u3', 'c', 5, { ten: 'Lê Lan' }),
    d('nick-hcm', 'd', 8, { ten: 'LED HCM' }),
    d('u4', 'e', 2, { ten: 'Phạm Mỹ' }),
  ]);
  const co = (uids: string[]) => new Set(uids);

  it('bỏ uid đã là NV + nick của org; đang sai bot lên đầu, rồi mới nhắn trước', () => {
    const kq = locVaPhanTrang(ds, { loaiTru: co(['u3', 'nick-hcm']), dangSaiBot: co(['u4']) });
    expect(kq.ungVien.map((u) => u.zaloUid)).toEqual(['u4', 'u2', 'u1']);
    expect(kq.ungVien[0].dangSaiBot).toBe(true);
    expect(kq.tong).toBe(3);
  });
  it('tìm không dấu theo tên, hoặc theo uid', () => {
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), tuKhoa: 'duc' }).ungVien.map((u) => u.zaloUid)).toEqual(['u1']);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), tuKhoa: 'TRAN  hung' }).ungVien.map((u) => u.zaloUid)).toEqual(['u2']);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), tuKhoa: 'u3' }).ungVien.map((u) => u.zaloUid)).toEqual(['u3']);
  });
  it('phân trang: trang ngoài phạm vi kẹp về trang cuối; moiTrang kẹp 1..100', () => {
    const kq = locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), moiTrang: 2, trang: 9 });
    expect(kq).toMatchObject({ tong: 5, trang: 3, moiTrang: 2 });
    expect(kq.ungVien).toHaveLength(1);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), moiTrang: 5000 }).moiTrang).toBe(100);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), moiTrang: 0 }).moiTrang).toBe(30);
  });
  it('chỉ giữ 3 nơi nhưng đếm đủ', () => {
    const nhieu = gomTheoUid([1, 2, 3, 4, 5].map((i) => d('u1', `c${i}`, i)));
    const kq = locVaPhanTrang(nhieu, { loaiTru: co([]), dangSaiBot: co([]) });
    expect(kq.ungVien[0].noi).toHaveLength(3);
    expect(kq.ungVien[0].soNoi).toBe(5);
  });
  it('boDau', () => {
    expect(boDau('  Đặng   Thị Ánh ')).toBe('dang thi anh');
  });
});
