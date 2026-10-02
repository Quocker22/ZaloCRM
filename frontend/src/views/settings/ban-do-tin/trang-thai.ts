// SPDX-License-Identifier: AGPL-3.0-or-later
// trang-thai.ts — trạng thái chọn/rê → tập liên quan + độ đục (SPEC §5, tokens.trang_thai).
// Thuần: trang chỉ đọc tập kết quả để đặt class; lớp đường nền đổi độ đục bằng MỘT class ở thẻ <svg>.
import type { LoaiLienKet, MoHinh } from './kieu';

export type LuaChon =
  | { kieu: 'khoi'; id: string }
  | { kieu: 'pha'; id: string }
  | { kieu: 'hang'; id: string }
  | { kieu: 'lien_ket'; id: string }
  | { kieu: 'loai'; id: LoaiLienKet };

export interface TrangThaiNhap {
  chon: LuaChon | null;
  /** khối đang rê chuột (xem trước) */
  tro: string | null;
  /** dòng liên kết đang rê trong panel */
  troDong: string | null;
}

export type CheDoNoi = 'nghi' | 'tro' | 'chon';

export interface Badge { chu: string; kieu: 'xem' | 'vao' | 'ra' }

export interface KetQuaTrangThai {
  che: CheDoNoi;
  /** liên kết được làm nổi (vẽ lại ở lớp đường nổi) */
  noi: Set<string>;
  /** khối nằm trong lựa chọn hoặc là đầu của liên kết nổi */
  khoiSang: Set<string>;
  /** khối là chính lựa chọn (viền brand) */
  khoiChon: Set<string>;
  badge: Record<string, Badge>;
  phaSang: Set<string>;
  hangSang: Set<string>;
  troDong: string | null;
  chay: boolean;
}

export const DO_DUC = {
  nghi: { duong: 0.35 },
  tro: { duongNen: 0.1, duongNoi: 1, heSo: 1.35, khoiKhac: 0.4 },
  chon: { duongNen: 0.06, duongNoi: 1, heSo: 1.45, khoiKhac: 0.14 },
  troDong: { duongTro: 1, heSoTro: 2.2, duongKhac: 0.25 },
} as const;

export function tinhTrangThai(mh: MoHinh, tt: TrangThaiNhap): KetQuaTrangThai {
  const kq: KetQuaTrangThai = {
    che: 'nghi', noi: new Set(), khoiSang: new Set(), khoiChon: new Set(), badge: {},
    phaSang: new Set(), hangSang: new Set(), troDong: null, chay: false,
  };
  const ma = (id: string) => mh.pha.find((p) => p.id === mh.khoiTheoId[id]?.pha)?.ma ?? '';
  const chon = tt.chon;
  if (chon) {
    kq.che = 'chon';
    kq.chay = true;
    let tap: string[] = [];
    if (chon.kieu === 'khoi') tap = mh.khoiTheoId[chon.id] ? [chon.id] : [];
    else if (chon.kieu === 'pha') tap = mh.khoi.filter((k) => k.pha === chon.id).map((k) => k.id);
    else if (chon.kieu === 'hang') tap = mh.khoi.filter((k) => k.hang === chon.id).map((k) => k.id);
    if (chon.kieu === 'lien_ket') {
      const l = mh.lienKetTheoId[chon.id];
      if (l) {
        kq.noi.add(l.id);
        kq.khoiSang.add(l.tu).add(l.den);
        kq.khoiChon.add(l.tu).add(l.den);
        kq.badge[l.tu] = { chu: `Điểm đi · ${ma(l.tu)}`, kieu: 'vao' };
        kq.badge[l.den] = { chu: `Điểm đến · ${ma(l.den)}`, kieu: 'ra' };
      }
    } else if (chon.kieu === 'loai') {
      for (const l of mh.lienKet) if (l.loai === chon.id) { kq.noi.add(l.id); kq.khoiSang.add(l.tu).add(l.den); }
    } else {
      const trongTap = new Set(tap);
      for (const id of tap) {
        kq.khoiSang.add(id);
        kq.khoiChon.add(id);
        for (const l of mh.vao[id] ?? []) { kq.noi.add(l.id); kq.khoiSang.add(l.tu); if (!trongTap.has(l.tu)) kq.badge[l.tu] ??= { chu: `Đầu vào · ${ma(l.tu)}`, kieu: 'vao' }; }
        for (const l of mh.ra[id] ?? []) { kq.noi.add(l.id); kq.khoiSang.add(l.den); if (!trongTap.has(l.den)) kq.badge[l.den] = { chu: `Đầu ra · ${ma(l.den)}`, kieu: 'ra' }; }
      }
      if (chon.kieu === 'khoi' && tap.length) kq.badge[chon.id] = { chu: 'Đang xem', kieu: 'xem' };
    }
    if (tt.troDong && kq.noi.has(tt.troDong)) kq.troDong = tt.troDong;
  } else if (tt.tro && mh.khoiTheoId[tt.tro]) {
    kq.che = 'tro';
    kq.khoiSang.add(tt.tro);
    for (const l of mh.vao[tt.tro] ?? []) { kq.noi.add(l.id); kq.khoiSang.add(l.tu); }
    for (const l of mh.ra[tt.tro] ?? []) { kq.noi.add(l.id); kq.khoiSang.add(l.den); }
  }
  for (const id of kq.khoiSang) {
    const k = mh.khoiTheoId[id];
    if (k) { kq.phaSang.add(k.pha); kq.hangSang.add(k.hang); }
  }
  return kq;
}

/** Độ đục + hệ số rộng của một đường ở lớp NỔI. */
export function doDucDuongNoi(kq: KetQuaTrangThai, id: string): { opacity: number; heSo: number } {
  if (kq.troDong) return id === kq.troDong ? { opacity: 1, heSo: DO_DUC.troDong.heSoTro } : { opacity: DO_DUC.troDong.duongKhac, heSo: DO_DUC.chon.heSo };
  return kq.che === 'tro' ? { opacity: 1, heSo: DO_DUC.tro.heSo } : { opacity: 1, heSo: DO_DUC.chon.heSo };
}

/** Độ đục lớp đường NỀN (mọi đường) theo chế độ. */
export const doDucDuongNen = (che: CheDoNoi): number =>
  che === 'nghi' ? DO_DUC.nghi.duong : che === 'tro' ? DO_DUC.tro.duongNen : DO_DUC.chon.duongNen;

/** Độ đục + xám của khối. */
export function doDucKhoi(kq: KetQuaTrangThai, id: string): { opacity: number; xam: boolean } {
  if (kq.che === 'nghi' || kq.khoiSang.has(id)) return { opacity: 1, xam: false };
  return kq.che === 'tro' ? { opacity: DO_DUC.tro.khoiKhac, xam: false } : { opacity: DO_DUC.chon.khoiKhac, xam: true };
}
