// SPDX-License-Identifier: AGPL-3.0-or-later
// Toán bố cục theo SPEC §3 (số đo go.noti.vn): cột x0 150 bước 196 rộng 150, hàng n·38+(n−1)·4+6, khe 6/14…
import { describe, it, expect } from 'vitest';
import {
  caoHang, cheDoManHinh, cotGian, rongMuonToanManHinh, dungBoCuc, kepZoom, zoomMacDinh, zoomVuaKhung, COT_X0, COT_BUOC, HANG_DAU_TOP,
} from './bo-cuc';
import { raiCong } from './dinh-tuyen';
import { PHA, NHOM_HANG } from './cau-hinh';
import type { Khoi, MaHang, MaPha } from './kieu';

const k = (id: string, pha: MaPha, hang: MaHang): Khoi =>
  ({ id, ten: id, pha, hang, nguon_id: id, loai_nut: 'composer', ban_sao: false, che_do: 'bat', tags: [] });

describe('lưới', () => {
  it('cột: x = 150 + i·196, rộng 150; tiêu đề pha top 0 cao 26', () => {
    const bc = dungBoCuc({ pha: PHA, nhom: NHOM_HANG, khoi: [] });
    bc.cot.forEach((c, i) => { expect(c.x).toBe(COT_X0 + i * COT_BUOC); expect(c.w).toBe(150); });
    expect(bc.dauPha[0]).toEqual({ x: 150, y: 0, w: 150, h: 26 });
    expect(bc.rong).toBe(bc.phaiCotCuoi + 46);
  });

  it('chiều cao hàng: 44 với một khối, 86 với hai', () => {
    expect(caoHang(1)).toBe(44);
    expect(caoHang(2)).toBe(86);
  });

  it('hàng đầu ở top 42; khối cách mép trên 3; hai khối cùng ô cách nhau 4; ô một khối trong hàng 86 thì căn giữa', () => {
    const nhom = [{ id: 'a', ten: 'A', hang: ['nhom_goc' as MaHang], le: true }];
    const bc = dungBoCuc({ pha: PHA, nhom, khoi: [k('x', 'hoi', 'nhom_goc'), k('y', 'hoi', 'nhom_goc'), k('z', 'chot', 'nhom_goc')] });
    expect(bc.hang[0].dai.y).toBe(HANG_DAU_TOP);
    expect(bc.hang[0].dai.h).toBe(86);
    expect(bc.khoi.x.y).toBe(45);
    expect(bc.khoi.y.y).toBe(45 + 42);
    expect(bc.khoi.z.y).toBe(42 + (86 - 38) / 2);
  });

  it('khe 6 trong nhóm, 14 giữa hai mục ngoài; dải nhóm thò 3px', () => {
    const nhom = [
      { id: 'g', ten: 'G', hang: ['nhom_goc', 'dm_nguoi_go'] as MaHang[], le: false },
      { id: 'l', ten: 'L', hang: ['nv'] as MaHang[], le: true },
    ];
    const bc = dungBoCuc({ pha: PHA, nhom, khoi: [] });
    const [h1, h2, h3] = bc.hang;
    expect(h2.dai.y - (h1.dai.y + h1.dai.h)).toBe(6);
    expect(h3.dai.y - (h2.dai.y + h2.dai.h)).toBe(14);
    const g = bc.nhom[0].dai!;
    expect(g.y).toBe(h1.dai.y - 3);
    expect(g.y + g.h).toBe(h2.dai.y + h2.dai.h + 3);
    expect(bc.nhom[0].thanh).toEqual({ x: 4, y: g.y + 3, w: 20, h: g.h - 6 });
    expect(h1.nhan).toEqual({ x: 30, y: h1.dai.y + 7, w: 102, h: 30 });
  });

  it('thu gọn nhóm: dải còn 50, mỗi cột một ô tóm tắt 150×38, khối trỏ về ô tóm tắt', () => {
    const nhom = [{ id: 'g', ten: 'G', hang: ['nhom_goc', 'dm_nguoi_go'] as MaHang[], le: false }];
    const khoi = [k('a', 'hoi', 'nhom_goc'), k('b', 'hoi', 'dm_nguoi_go'), k('c', 'in', 'dm_nguoi_go')];
    const bc = dungBoCuc({ pha: PHA, nhom, khoi }, { thuGon: new Set(['g']) });
    expect(bc.nhom[0].dai!.h).toBe(50);
    expect(bc.tomTat).toHaveLength(2);
    expect(bc.tomTat[0].hinh.w).toBe(150);
    expect(bc.tomTat[0].hinh.h).toBe(38);
    expect(bc.nut.a).toBe('tom:g:hoi');
    expect(bc.nut.b).toBe('tom:g:hoi');
    expect(bc.khoi.a).toBeUndefined();
  });
});

describe('cổng nối', () => {
  it('một cổng ở giữa; nhiều cổng rải đều từ top+7 tới bottom−7 (6 cổng ⇒ bước 4.8)', () => {
    const r = { x: 0, y: 100, w: 150, h: 38 };
    expect(raiCong(r, 1)).toEqual([119]);
    const ys = raiCong(r, 6);
    expect(ys[0]).toBe(107);
    expect(ys[5]).toBe(131);
    expect(ys[1] - ys[0]).toBeCloseTo(4.8, 5);
  });
});

describe('thu phóng + màn hình', () => {
  it('vừa khung = (rộng − 24)/rộng bản đồ; % so với vừa khung; kẹp 0.5–2.4', () => {
    expect(zoomVuaKhung(1020, 1326)).toBeCloseTo(996 / 1326, 6);
    expect(zoomMacDinh(0.54)).toBe(0.75); // vừa khung 1440×900 ≈ 0.54 ⇒ mặc định 75 %, cuộn ngang
    expect(zoomMacDinh(0.9)).toBe(0.9);
    expect(kepZoom(0.1)).toBe(0.5);
    expect(kepZoom(9)).toBe(2.4);
  });

  it('cột giãn ở toàn màn hình không bao giờ hẹp hơn bình thường', () => {
    expect(cotGian(9, 1200).cotBuoc).toBe(196);
    const g = cotGian(9, rongMuonToanManHinh(2400, 700, 900));
    expect(g.cotBuoc).toBeGreaterThan(196);
    expect(g.cotRong).toBeGreaterThan(150);
    // bản đồ quá cao ⇒ zoom kẹp 0.5 ⇒ lấp ngang ở 0.5
    expect(rongMuonToanManHinh(1000, 700, 1646)).toBeCloseTo((1000 - 24) / 0.5, 6);
    // khớp mẫu đo của tham chiếu: khung 1022×700, cao 1334 ⇒ bước cột giãn (tham chiếu đo 300 với 6 pha)
    expect(cotGian(6, rongMuonToanManHinh(1022, 700, 1334)).cotBuoc).toBeGreaterThan(196);
  });

  it('chế độ màn hình: <768 điện thoại, <1024 bảng (bottom sheet), còn lại máy tính', () => {
    expect(cheDoManHinh(390)).toBe('dt');
    expect(cheDoManHinh(767)).toBe('dt');
    expect(cheDoManHinh(768)).toBe('bang');
    expect(cheDoManHinh(1023)).toBe('bang');
    expect(cheDoManHinh(1024)).toBe('may');
  });
});
