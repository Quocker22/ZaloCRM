// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot — "Chờ gán — người đã nhắn cho shop" (docs/77 §8): gom theo uid, loại người đã gán / nick của org, đánh dấu
// "đang sai bot" và xếp lên đầu, tìm không dấu, phân trang. Luật THUẦN — không cần DB.
import { describe, it, expect } from 'vitest';
import {
  gomTheoUid, locVaPhanTrang, boDau, tenHienThi, xemNoiTheo, TEN_AN, type DongGom,
} from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';

const d = (uid: string, cid: string, phut: number, them: Partial<DongGom> = {}): DongGom => ({
  uid, conversation_id: cid, loai: 'user', luc: new Date(Date.UTC(2026, 8, 30, 8, phut)), ten: null, ten_nhom: null,
  nick_id: 'n1', nick_ten: 'LED HN', nick_rieng_tu: false, nick_chu: 'chu-n1', ...them,
});

describe('gomTheoUid', () => {
  it('một uid nhiều nơi ⇒ một ứng viên, nơi mới nhất trước, tên mới nhất có nghĩa', () => {
    const ds = gomTheoUid([
      d('u1', 'dm1', 1, { ten: 'Tên cũ' }),
      d('u1', 'g1', 5, { loai: 'group', ten: 'Tên mới', ten_nhom: 'Nhóm Sales' }),
      d('u1', 'g2', 3, { loai: 'group', ten: null, ten_nhom: 'Nhóm Kho' }),
    ]);
    expect(ds).toHaveLength(1);
    expect(tenHienThi(ds[0], () => true)).toEqual({ ten: 'Tên mới', an: false });
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

describe('riêng tư (review P1-3) — nick privacyMode=main', () => {
  const RT = { nick_id: 'n9', nick_ten: 'LED Sếp', nick_rieng_tu: true, nick_chu: 'sep' };
  const ds = gomTheoUid([
    d('u1', 'g-rt', 9, { loai: 'group', ten: 'Bí Mật', ...RT }),
    d('u1', 'dm1', 1, { ten: 'Tên công khai' }),
    d('u2', 'g-rt', 8, { loai: 'group', ten: 'Chỉ Ở Nick Sếp', ...RT }),
  ]);
  const co = (x: string[]) => new Set(x);
  const nguoiKhac = xemNoiTheo({ viewerUserId: 'admin', orgId: 'o', privacyUnlocked: true });
  const chuChuaMo = xemNoiTheo({ viewerUserId: 'sep', orgId: 'o', privacyUnlocked: false });
  const chuDaMo = xemNoiTheo({ viewerUserId: 'sep', orgId: 'o', privacyUnlocked: true });

  it('người xem không phải chủ nick (kể cả admin đã mở PIN của mình) ⇒ tên từ nick riêng tư không dùng; lấy nơi khác', () => {
    const kq = locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: nguoiKhac });
    const u1 = kq.ungVien.find((u) => u.zaloUid === 'u1')!;
    const u2 = kq.ungVien.find((u) => u.zaloUid === 'u2')!;
    expect(u1).toMatchObject({ ten: 'Tên công khai', anTen: false });
    expect(u1.noiXemDuoc?.conversationId).toBe('dm1'); // tin cuối lấy ở nơi xem được, không ở nhóm riêng tư
    expect(u2).toMatchObject({ ten: TEN_AN, anTen: true, noiXemDuoc: null });
    expect(u2.noi[0]).toEqual({ conversationId: 'g-rt', loai: 'nhom', tenNhom: null, nick: { id: 'n9', ten: 'LED Sếp' }, luc: u2.noi[0].luc });
    expect(Object.keys(u2.noi[0])).not.toContain('ten'); // không trả dữ liệu thô
  });
  it('chủ nick CHƯA mở khoá cũng bị che; đã mở khoá thì thấy', () => {
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: chuChuaMo }).ungVien.find((u) => u.zaloUid === 'u2'))
      .toMatchObject({ ten: TEN_AN, anTen: true });
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: chuDaMo }).ungVien.find((u) => u.zaloUid === 'u2'))
      .toMatchObject({ ten: 'Chỉ Ở Nick Sếp', anTen: false });
  });
  it('tìm theo tên bị che KHÔNG ra (không dò được tên); tìm theo uid vẫn ra', () => {
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: nguoiKhac, tuKhoa: 'nick sep' }).tong).toBe(0);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: nguoiKhac, tuKhoa: 'bi mat' }).tong).toBe(0);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: nguoiKhac, tuKhoa: 'u2' }).tong).toBe(1);
    expect(locVaPhanTrang(ds, { loaiTru: co([]), dangSaiBot: co([]), xem: chuDaMo, tuKhoa: 'nick sep' }).tong).toBe(1);
  });
});
