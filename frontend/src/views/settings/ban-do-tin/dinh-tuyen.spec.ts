// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { dungBoCuc } from './bo-cuc';
import { dinhTuyen, duongGapKhuc } from './dinh-tuyen';
import { PHA } from './cau-hinh';
import type { Khoi, LoaiLienKet, MaHang, MaPha, NhomHang } from './kieu';
import { anhChupMau } from './danh-muc-mau';
import { dungMoHinh } from './mo-hinh';

const k = (id: string, pha: MaPha, hang: MaHang): Khoi =>
  ({ id, ten: id, pha, hang, nguon_id: id, loai_nut: 'composer', ban_sao: false, che_do: 'bat', tags: [] });
const nhom: NhomHang[] = [
  { id: 'g', ten: 'G', hang: ['nhom_goc', 'dm_nguoi_go', 'chu_don'], le: false },
  { id: 'l', ten: 'L', hang: ['g_kho'], le: true },
];
const L = (tu: string, den: string, loai: LoaiLienKet = 'nghiep_vu') => ({ id: `${tu}~${den}`, tu, den, loai });

describe('định tuyến', () => {
  const khoi = [
    k('a', 'hoi', 'nhom_goc'), k('b', 'len_don', 'dm_nguoi_go'), k('c', 'in', 'g_kho'), k('d', 'kho', 'chu_don'),
    k('e', 'hoi', 'g_kho'), k('f', 'chot', 'nhom_goc'), k('g', 'he_thong', 'nhom_goc'),
  ];
  const bc = dungBoCuc({ pha: PHA, nhom, khoi });

  it('hai cột kề nhau ⇒ Bezier M x0,y0 C x0+22,y0 x0+22,y1 x1−2,y1', () => {
    const r = dinhTuyen(bc, [L('a', 'b')]);
    const a = bc.khoi.a, b = bc.khoi.b;
    expect(r['a~b'].hinh).toBe('cong');
    expect(r['a~b'].d).toBe(`M${a.x + 150},${a.y + 19} C${a.x + 172},${a.y + 19} ${a.x + 172},${b.y + 19} ${b.x - 2},${b.y + 19}`);
  });

  it('cách ≥ 2 cột ⇒ gấp khúc vuông góc, góc bo Q, làn nằm trong khe cột, hành lang nằm trong khe hàng', () => {
    const r = dinhTuyen(bc, [L('a', 'c'), L('b', 'd'), L('e', 'f')]);
    for (const id of ['a~c', 'b~d', 'e~f']) {
      const d = r[id];
      expect(d.hinh).toBe('gap');
      expect(d.d).toMatch(/Q/);
      expect(d.d).not.toMatch(/C/);
      const [xa, xb] = d.lan!;
      const lanTrongKhe = (x: number) => bc.cot.some((c, i) => i < bc.cot.length - 1 && x > c.x + c.w && x < bc.cot[i + 1].x);
      expect(lanTrongKhe(xa)).toBe(true);
      expect(lanTrongKhe(xb)).toBe(true);
      expect(bc.khe.some((kh) => d.hanhLang! > kh.tren && d.hanhLang! < kh.duoi)).toBe(true);
    }
  });

  it('các làn dọc và hành lang ngang không trùng nhau (đồ thị thử)', () => {
    const ds = [L('a', 'c'), L('a', 'd'), L('b', 'd'), L('e', 'f'), L('e', 'c'), L('f', 'g')];
    const r = dinhTuyen(bc, ds);
    const lan = Object.values(r).flatMap((d) => (d.hinh === 'gap' ? d.lan! : []));
    expect(new Set(lan.map((x) => x.toFixed(2))).size).toBe(lan.length);
    const hl = Object.values(r).filter((d) => d.hinh === 'gap').map((d) => d.hanhLang!.toFixed(2));
    expect(new Set(hl).size).toBe(hl.length);
  });

  it('về pha trước ⇒ vòng qua hành lang đáy, vào mép PHẢI đích (+2)', () => {
    const r = dinhTuyen(bc, [L('g', 'a', 'vong')]);
    const d = r['g~a'];
    expect(d.hinh).toBe('vong');
    expect(d.hanhLang!).toBeGreaterThan(bc.dayNoiDung);
    const cuoi = d.diem[d.diem.length - 1];
    expect(cuoi[0]).toBe(bc.khoi.a.x + 150 + 2);
    expect(d.lan![0]).toBeGreaterThan(bc.phaiCotCuoi); // từ cột cuối: làn vòng bên phải bản đồ
  });

  it('cùng cột ⇒ ra phải, vào mép phải đích', () => {
    const r = dinhTuyen(bc, [L('a', 'e')]);
    expect(r['a~e'].hinh).toBe('cung_cot');
  });

  it('bo góc: bán kính 5, còn 3 khi đoạn ngắn', () => {
    expect(duongGapKhuc([[0, 0], [20, 0], [20, 20]])).toBe('M0,0 L15,0 Q20,0 20,5 L20,20');
    expect(duongGapKhuc([[0, 0], [4, 0], [4, 20]])).toBe('M0,0 L2,0 Q4,0 4,2 L4,20');
  });

  it('dữ liệu giả lập đầy đủ: mọi đường đều có path và bong số không chồng nhau', () => {
    const a = anhChupMau();
    const mh = dungMoHinh(a);
    const bc2 = dungBoCuc(mh);
    const r = dinhTuyen(bc2, mh.lienKet);
    expect(Object.keys(r).length).toBe(mh.lienKet.length);
    const b = Object.values(r).map((d) => d.bong);
    let chong = 0;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (Math.abs(b[i].x - b[j].x) < 1 && Math.abs(b[i].y - b[j].y) < 1) chong++;
    expect(chong).toBe(0);
  });
});
