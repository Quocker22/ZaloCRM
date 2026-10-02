// SPDX-License-Identifier: AGPL-3.0-or-later
// tim.ts — tìm không dấu trên khối, đích và liên kết (SPEC §7 ô tìm). Sơ đồ KHÔNG bị lọc khi gõ.
import type { MoHinh } from './kieu';
import type { LuaChon } from './trang-thai';

export const boDau = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export interface KetQuaTim {
  nhom: 'Khối' | 'Đích' | 'Liên kết';
  chu: string;
  phu: string;
  chon: LuaChon;
}

export function timKiem(mh: MoHinh, q: string, toiDa = 12): KetQuaTim[] {
  const k = boDau(q.trim());
  if (!k) return [];
  const kq: KetQuaTim[] = [];
  const phaTen = Object.fromEntries(mh.pha.map((p) => [p.id, `${p.ma} ${p.ten}`]));
  for (const b of mh.khoi) {
    if (kq.length >= toiDa) break;
    if (boDau(`${b.ten} ${b.nguon_id}`).includes(k)) kq.push({ nhom: 'Khối', chu: b.ten, phu: `${phaTen[b.pha]} · ${mh.hang[b.hang].ten}`, chon: { kieu: 'khoi', id: b.id } });
  }
  for (const h of Object.values(mh.hang)) {
    if (boDau(h.ten).includes(k)) kq.push({ nhom: 'Đích', chu: h.ten, phu: 'cả hàng', chon: { kieu: 'hang', id: h.id } });
  }
  let soLk = 0;
  for (const l of mh.lienKet) {
    if (soLk >= 6) break;
    const a = mh.khoiTheoId[l.tu], b = mh.khoiTheoId[l.den];
    if (boDau(`${a.ten} ${b.ten} ${l.vi_sao}`).includes(k)) {
      kq.push({ nhom: 'Liên kết', chu: `${l.so}. ${a.ten} → ${b.ten}`, phu: l.vi_sao, chon: { kieu: 'lien_ket', id: l.id } });
      soLk++;
    }
  }
  return kq;
}
