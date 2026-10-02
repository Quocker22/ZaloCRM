// SPDX-License-Identifier: AGPL-3.0-or-later
// dinh-tuyen.ts — định tuyến đường nối (SPEC §4.2): Bezier cho hai cột kề nhau, gấp khúc vuông góc bo 5px qua
// làn dọc (khe cột) + hành lang ngang (khe hàng) khi xa hơn, vòng về pha trước đi vòng phải/đáy.
// Tính một lần cho mỗi bố cục; trạng thái chọn/rê KHÔNG gọi lại.
import type { BoCuc, HinhChuNhat } from './bo-cuc';
import type { LienKet } from './kieu';

export type HinhDuong = 'cong' | 'gap' | 'cung_cot' | 'vong';

export interface DuongVe {
  id: string;
  d: string;
  hinh: HinhDuong;
  bong: { x: number; y: number };
  /** điểm gấp (để test: làn/hành lang) */
  diem: [number, number][];
  lan?: number[];
  hanhLang?: number;
}

const BUOC_LAN = 2.4;
const BUOC_HANH_LANG = 1.5;
const BUOC_LAN_VONG = 5;
const KHOANG_BONG = 18;

type Diem = [number, number];

/** Chuỗi path gấp khúc, mỗi góc bo bằng Q bán kính 5 (3 khi đoạn ngắn). */
export function duongGapKhuc(diemVao: Diem[]): string {
  const p: Diem[] = [];
  for (const d of diemVao) {
    const t = p[p.length - 1];
    if (t && Math.abs(t[0] - d[0]) < 0.01 && Math.abs(t[1] - d[1]) < 0.01) continue;
    p.push(d);
  }
  // bỏ điểm thẳng hàng
  const q: Diem[] = [];
  for (const d of p) {
    while (q.length >= 2) {
      const a = q[q.length - 2], b = q[q.length - 1];
      const cungX = Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - d[0]) < 0.01;
      const cungY = Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - d[1]) < 0.01;
      if (cungX || cungY) q.pop(); else break;
    }
    q.push(d);
  }
  const f = (n: number) => +n.toFixed(2);
  let s = `M${f(q[0][0])},${f(q[0][1])}`;
  for (let i = 1; i < q.length - 1; i++) {
    const a = q[i - 1], b = q[i], c = q[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(l1, l2) >= 10 ? 5 : Math.min(3, l1 / 2, l2 / 2);
    const u1: Diem = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1];
    const u2: Diem = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2];
    s += ` L${f(b[0] - u1[0] * r)},${f(b[1] - u1[1] * r)} Q${f(b[0])},${f(b[1])} ${f(b[0] + u2[0] * r)},${f(b[1] + u2[1] * r)}`;
  }
  const z = q[q.length - 1];
  s += ` L${f(z[0])},${f(z[1])}`;
  return s;
}

export function duongCong(x0: number, y0: number, x1: number, y1: number): string {
  const f = (n: number) => +n.toFixed(2);
  return `M${f(x0)},${f(y0)} C${f(x0 + 22)},${f(y0)} ${f(x0 + 22)},${f(y1)} ${f(x1)},${f(y1)}`;
}

/** Rải đều n cổng dọc cạnh từ top+7 tới bottom−7 (một cổng ⇒ giữa). */
export function raiCong(r: HinhChuNhat, n: number): number[] {
  if (n <= 1) return [r.y + r.h / 2];
  const a = r.y + 7, b = r.y + r.h - 7;
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

const tam = (r: HinhChuNhat) => r.y + r.h / 2;

export function dinhTuyen(bc: BoCuc, lienKet: Pick<LienKet, 'id' | 'tu' | 'den' | 'loai'>[]): Record<string, DuongVe> {
  const soCot = bc.cot.length;
  interface Viec { id: string; s: string; t: string; cs: number; ct: number; hinh: HinhDuong }
  const viec: Viec[] = [];
  for (const l of lienKet) {
    const s = bc.nut[l.tu], t = bc.nut[l.den];
    if (!s || !t || s === t) continue;
    const cs = bc.cotNut[s], ct = bc.cotNut[t];
    let hinh: HinhDuong;
    if (ct === cs + 1) hinh = 'cong';
    else if (ct > cs + 1) hinh = 'gap';
    else if (ct === cs) hinh = 'cung_cot';
    else hinh = 'vong';
    viec.push({ id: l.id, s, t, cs, ct, hinh });
  }

  // ── Cổng: cạnh phải (ra + vào-từ-phải), cạnh trái (vào) — sắp theo y đầu kia để bớt cắt nhau
  const congPhai: Record<string, { id: string; k: number; vai: 'ra' | 'vao' }[]> = {};
  const congTrai: Record<string, { id: string; k: number }[]> = {};
  for (const v of viec) {
    const hs = bc.hinhNut[v.s], ht = bc.hinhNut[v.t];
    (congPhai[v.s] ??= []).push({ id: v.id, k: tam(ht) + (v.hinh === 'vong' ? 1e4 : 0), vai: 'ra' });
    if (v.hinh === 'cung_cot' || v.hinh === 'vong') (congPhai[v.t] ??= []).push({ id: v.id, k: tam(hs) + 2e4, vai: 'vao' });
    else (congTrai[v.t] ??= []).push({ id: v.id, k: tam(hs) });
  }
  const yRa: Record<string, number> = {};
  const yVao: Record<string, number> = {};
  for (const [n, ds] of Object.entries(congPhai)) {
    ds.sort((a, b) => a.k - b.k);
    const ys = raiCong(bc.hinhNut[n], ds.length);
    ds.forEach((c, i) => { if (c.vai === 'ra') yRa[c.id] = ys[i]; else yVao[c.id] = ys[i]; });
  }
  for (const [n, ds] of Object.entries(congTrai)) {
    ds.sort((a, b) => a.k - b.k);
    const ys = raiCong(bc.hinhNut[n], ds.length);
    ds.forEach((c, i) => { yVao[c.id] = ys[i]; });
  }

  // ── Làn dọc trong khe cột i (giữa cột i và i+1): trái → phải cho đường "sau nguồn", phải → trái cho "trước đích"
  const lanTrai: number[] = Array(soCot).fill(0);
  const lanPhai: number[] = Array(soCot).fill(0);
  const gapTrai = (i: number) => bc.cot[i].x + bc.cotRong;
  const gapPhai = (i: number) => (i + 1 < soCot ? bc.cot[i + 1].x : bc.phaiCotCuoi + 8);
  const layLanTrai = (i: number): number => {
    if (i >= soCot - 1) return layLanVong();
    const max = Math.floor((gapPhai(i) - gapTrai(i) - 6) / 2 / BUOC_LAN);
    const k = lanTrai[i]++ % Math.max(1, max);
    return gapTrai(i) + 3 + k * BUOC_LAN;
  };
  const layLanPhai = (i: number): number => {
    const max = Math.floor((gapPhai(i) - gapTrai(i) - 6) / 2 / BUOC_LAN);
    const k = lanPhai[i]++ % Math.max(1, max);
    return gapPhai(i) - 3 - k * BUOC_LAN;
  };
  let lanVong = 0;
  const layLanVong = (): number => bc.phaiCotCuoi + 10 + (lanVong++ % 6) * BUOC_LAN_VONG;

  // ── Hành lang ngang trong khe hàng: lệch quanh tâm khe 0, +1.5, −1.5, +3…
  const hanhLangDem: number[] = bc.khe.map(() => 0);
  const layHanhLang = (ki: number): number => {
    const k = bc.khe[ki];
    const tamKhe = (k.tren + k.duoi) / 2;
    const max = Math.max(0, Math.floor((k.duoi - k.tren - 2) / 2 / BUOC_HANH_LANG));
    const n = hanhLangDem[ki]++ % (2 * max + 1);
    const lech = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * BUOC_HANH_LANG;
    return tamKhe + lech;
  };
  const chonKhe = (ys: number, yt: number): number => {
    let tot = 0, diem = Infinity;
    bc.khe.forEach((k, i) => {
      const c = (k.tren + k.duoi) / 2;
      const d = (Math.abs(c - ys) + Math.abs(c - yt)) * 1000 + Math.abs(c - ys);
      if (d < diem) { diem = d; tot = i; }
    });
    return tot;
  };
  let dayDem = 0;
  const layHanhLangDay = (): number => bc.dayNoiDung + 12 + (dayDem++ % 10) * BUOC_HANH_LANG;

  // ── Bong số trên hành lang: rải để không chồng
  const bongDaDat: { x: number; y: number }[] = [];
  const datBong = (x: number, y: number, xMax: number): { x: number; y: number } => {
    let cx = x;
    for (let lan = 0; lan < 40; lan++) {
      if (!bongDaDat.some((b) => Math.abs(b.x - cx) < KHOANG_BONG && Math.abs(b.y - y) < KHOANG_BONG)) break;
      cx += KHOANG_BONG;
      if (cx > xMax) { cx = x; break; }
    }
    const b = { x: cx, y };
    bongDaDat.push(b);
    return b;
  };

  // Thứ tự gán làn ổn định: theo cột nguồn rồi theo độ dài (đường ngắn nằm sát mép cột)
  const xep = [...viec].sort((a, b) => a.cs - b.cs || Math.abs(a.ct - a.cs) - Math.abs(b.ct - b.cs));
  const kq: Record<string, DuongVe> = {};
  for (const v of xep) {
    const hs = bc.hinhNut[v.s], ht = bc.hinhNut[v.t];
    const x0 = hs.x + hs.w, ys = yRa[v.id], yt = yVao[v.id];
    if (v.hinh === 'cong') {
      const x1 = ht.x - 2;
      const bx = 0.125 * x0 + 0.75 * (x0 + 22) + 0.125 * x1;
      kq[v.id] = { id: v.id, hinh: 'cong', d: duongCong(x0, ys, x1, yt), bong: datBong(bx, (ys + yt) / 2, bx), diem: [[x0, ys], [x1, yt]] };
    } else if (v.hinh === 'gap') {
      const xa = layLanTrai(v.cs);
      const xb = layLanPhai(v.ct - 1);
      const ki = chonKhe(ys, yt);
      const yc = layHanhLang(ki);
      const x1 = ht.x - 2;
      const diem: Diem[] = [[x0, ys], [xa, ys], [xa, yc], [xb, yc], [xb, yt], [x1, yt]];
      kq[v.id] = { id: v.id, hinh: 'gap', d: duongGapKhuc(diem), bong: datBong(xa + 14, yc, xb - 10), diem, lan: [xa, xb], hanhLang: yc };
    } else if (v.hinh === 'cung_cot') {
      const xa = layLanTrai(v.cs);
      const x1 = ht.x + ht.w + 2;
      const diem: Diem[] = [[x0, ys], [xa, ys], [xa, yt], [x1, yt]];
      kq[v.id] = { id: v.id, hinh: 'cung_cot', d: duongGapKhuc(diem), bong: datBong(xa, (ys + yt) / 2, xa), diem, lan: [xa] };
    } else {
      // vòng: ra phải → làn sau cột nguồn (hoặc làn vòng bên phải bản đồ) → hành lang đáy → trái tới khe phải cột đích → lên → mép PHẢI đích
      const xa = v.cs >= soCot - 1 ? layLanVong() : layLanTrai(v.cs);
      const yd = layHanhLangDay();
      const xb = layLanTrai(v.ct);
      const x1 = ht.x + ht.w + 2;
      const diem: Diem[] = [[x0, ys], [xa, ys], [xa, yd], [xb, yd], [xb, yt], [x1, yt]];
      kq[v.id] = { id: v.id, hinh: 'vong', d: duongGapKhuc(diem), bong: datBong(xb + 14, yd, xa - 10), diem, lan: [xa, xb], hanhLang: yd };
    }
  }
  return kq;
}
