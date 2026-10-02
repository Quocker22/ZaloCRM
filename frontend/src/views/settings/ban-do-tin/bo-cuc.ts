// SPDX-License-Identifier: AGPL-3.0-or-later
// bo-cuc.ts — toán bố cục bản đồ (toạ độ GỐC, zoom = 1) theo tham-chieu-noti/SPEC.md §3.
// Tính MỘT lần cho mỗi (dữ liệu, nhóm thu gọn, bề rộng cột) — trạng thái chọn/rê không làm tính lại.
import type { Khoi, MaHang, MaPha, MoHinh, NhomHang } from './kieu';

export const KHOI_RONG = 150;
export const KHOI_CAO = 38;
export const KHOI_KHE = 4;
export const COT_X0 = 150;
export const COT_BUOC = 196;
export const DAU_PHA_CAO = 26;
export const HANG_DAU_TOP = 42;
export const KHE_TRONG_NHOM = 6;
export const KHE_NGOAI = 14;
export const DAI_NHOM_LE = 3;
export const NHOM_THU_GON_CAO = 50;
export const LAN_VONG_RONG = 38; // vùng làn vòng bên phải: lastRight+8 … +38

export interface HinhChuNhat { x: number; y: number; w: number; h: number }

export interface CotBoCuc { pha: MaPha; x: number; w: number }

export interface HangBoCuc {
  id: MaHang;
  nhom: string;
  dai: HinhChuNhat; // dải hàng
  nhan: HinhChuNhat; // nhãn hàng
  soKhoiToiDa: number;
}

export interface NhomBoCuc {
  id: string;
  le: boolean;
  thuGon: boolean;
  dai: HinhChuNhat | null; // dải nhóm (null với hàng lẻ)
  thanh: HinhChuNhat | null; // thanh nhóm dọc
  nhanThuGon: HinhChuNhat | null;
}

export interface OTomTat {
  id: string; // tom:<nhóm>:<pha>
  nhom: string;
  pha: MaPha;
  hinh: HinhChuNhat;
  khoi: string[];
  hang: MaHang[];
}

/** Khe ngang giữa hai hàng — hành lang cho đường gấp khúc. */
export interface KheHang { tren: number; duoi: number }

export interface BoCuc {
  cot: CotBoCuc[];
  cotRong: number;
  cotBuoc: number;
  rong: number;
  cao: number;
  dauPha: HinhChuNhat[];
  nhom: NhomBoCuc[];
  hang: HangBoCuc[];
  /** khối đang hiện → hình */
  khoi: Record<string, HinhChuNhat>;
  /** ô tóm tắt của nhóm thu gọn */
  tomTat: OTomTat[];
  /** khối → nút vẽ (chính nó, hoặc ô tóm tắt khi nhóm thu gọn) */
  nut: Record<string, string>;
  /** nút → hình (khối + ô tóm tắt) */
  hinhNut: Record<string, HinhChuNhat>;
  /** nút → chỉ số cột */
  cotNut: Record<string, number>;
  khe: KheHang[];
  dayNoiDung: number;
  phaiCotCuoi: number;
  nhanVong: HinhChuNhat;
}

export const caoHang = (n: number): number => n * KHOI_CAO + (n - 1) * KHOI_KHE + 6;

export interface TuyChonBoCuc {
  thuGon?: ReadonlySet<string>;
  cotRong?: number;
  cotBuoc?: number;
}

export function dungBoCuc(mh: Pick<MoHinh, 'pha' | 'nhom' | 'khoi'>, tc: TuyChonBoCuc = {}): BoCuc {
  const cotRong = tc.cotRong ?? KHOI_RONG;
  const cotBuoc = tc.cotBuoc ?? COT_BUOC;
  const thuGon = tc.thuGon ?? new Set<string>();
  const viTriPha: Record<string, number> = Object.fromEntries(mh.pha.map((p, i) => [p.id, i]));
  const cot: CotBoCuc[] = mh.pha.map((p, i) => ({ pha: p.id, x: COT_X0 + i * cotBuoc, w: cotRong }));
  const phaiCotCuoi = cot[cot.length - 1].x + cotRong;
  const daiHangPhai = phaiCotCuoi + 4;
  const daiNhomPhai = phaiCotCuoi + 8;
  const rong = phaiCotCuoi + 8 + LAN_VONG_RONG;

  // ô: hàng → pha → khối (giữ thứ tự mô hình)
  const o: Record<string, Record<string, Khoi[]>> = {};
  for (const k of mh.khoi) ((o[k.hang] ??= {})[k.pha] ??= []).push(k);

  const hang: HangBoCuc[] = [];
  const nhom: NhomBoCuc[] = [];
  const khoi: Record<string, HinhChuNhat> = {};
  const tomTat: OTomTat[] = [];
  const nut: Record<string, string> = {};
  const hinhNut: Record<string, HinhChuNhat> = {};
  const cotNut: Record<string, number> = {};
  const daiHang: HinhChuNhat[] = [];

  const datKhoiTrongHang = (h: MaHang, top: number, cao: number) => {
    for (const [pha, ds] of Object.entries(o[h] ?? {})) {
      const ci = viTriPha[pha];
      const caoKhoi = ds.length * KHOI_CAO + (ds.length - 1) * KHOI_KHE;
      const dem = (cao - caoKhoi) / 2; // 3 khi ô đầy; căn giữa khi ô ít khối hơn hàng
      ds.forEach((k, i) => {
        const r = { x: cot[ci].x, y: top + dem + i * (KHOI_CAO + KHOI_KHE), w: cotRong, h: KHOI_CAO };
        khoi[k.id] = r; nut[k.id] = k.id; hinhNut[k.id] = r; cotNut[k.id] = ci;
      });
    }
  };
  const soKhoiToiDa = (h: MaHang) => Math.max(1, ...Object.values(o[h] ?? {}).map((d) => d.length));

  let y = HANG_DAU_TOP;
  mh.nhom.forEach((g: NhomHang, gi) => {
    if (gi > 0) y += KHE_NGOAI;
    if (g.le) {
      const h = g.hang[0];
      const n = soKhoiToiDa(h);
      const c = caoHang(n);
      const dai = { x: COT_X0 - 6, y, w: daiHangPhai - (COT_X0 - 6), h: c };
      hang.push({ id: h, nhom: g.id, dai, nhan: { x: 30, y: y + (c - 30) / 2, w: 102, h: 30 }, soKhoiToiDa: n });
      daiHang.push(dai);
      datKhoiTrongHang(h, y, c);
      nhom.push({ id: g.id, le: true, thuGon: false, dai: null, thanh: null, nhanThuGon: null });
      y += c;
      return;
    }
    if (thuGon.has(g.id)) {
      const c = caoHang(1);
      const dai = { x: 0, y: y - DAI_NHOM_LE, w: daiNhomPhai, h: NHOM_THU_GON_CAO };
      nhom.push({
        id: g.id, le: false, thuGon: true, dai,
        thanh: { x: 4, y: y, w: 20, h: 44 },
        nhanThuGon: { x: 30, y: y + (c - 30) / 2, w: 102, h: 30 },
      });
      daiHang.push({ x: COT_X0 - 6, y, w: daiHangPhai - (COT_X0 - 6), h: c });
      mh.pha.forEach((p, ci) => {
        const ds = g.hang.flatMap((h) => o[h]?.[p.id] ?? []);
        if (!ds.length) return;
        const id = `tom:${g.id}:${p.id}`;
        const r = { x: cot[ci].x, y: y + 3, w: cotRong, h: KHOI_CAO };
        const hangCo = g.hang.filter((h) => (o[h]?.[p.id] ?? []).length);
        tomTat.push({ id, nhom: g.id, pha: p.id, hinh: r, khoi: ds.map((k) => k.id), hang: hangCo });
        hinhNut[id] = r; cotNut[id] = ci;
        for (const k of ds) nut[k.id] = id;
      });
      y += c;
      return;
    }
    const top = y;
    g.hang.forEach((h, hi) => {
      if (hi > 0) y += KHE_TRONG_NHOM;
      const n = soKhoiToiDa(h);
      const c = caoHang(n);
      const dai = { x: COT_X0 - 6, y, w: daiHangPhai - (COT_X0 - 6), h: c };
      hang.push({ id: h, nhom: g.id, dai, nhan: { x: 30, y: y + (c - 30) / 2, w: 102, h: 30 }, soKhoiToiDa: n });
      daiHang.push(dai);
      datKhoiTrongHang(h, y, c);
      y += c;
    });
    const dai = { x: 0, y: top - DAI_NHOM_LE, w: daiNhomPhai, h: y - top + 2 * DAI_NHOM_LE };
    nhom.push({ id: g.id, le: false, thuGon: false, dai, thanh: { x: 4, y: dai.y + 3, w: 20, h: dai.h - 6 }, nhanThuGon: null });
  });
  const dayNoiDung = y;

  // Khe giữa các dải hàng (gồm khe dưới tiêu đề pha)
  const khe: KheHang[] = [{ tren: DAU_PHA_CAO, duoi: HANG_DAU_TOP - DAI_NHOM_LE }];
  for (let i = 1; i < daiHang.length; i++) {
    const tren = daiHang[i - 1].y + daiHang[i - 1].h;
    const duoi = daiHang[i].y;
    if (duoi - tren >= 4) khe.push({ tren, duoi });
  }

  return {
    cot, cotRong, cotBuoc, rong, cao: dayNoiDung + 40,
    dauPha: cot.map((c) => ({ x: c.x, y: 0, w: cotRong, h: DAU_PHA_CAO })),
    nhom, hang, khoi, tomTat, nut, hinhNut, cotNut, khe, dayNoiDung, phaiCotCuoi,
    nhanVong: { x: 4, y: dayNoiDung + 8, w: 260, h: 12 },
  };
}

/** Cột giãn ở toàn màn hình (SPEC §7 — một mẫu đo 1022×700): giãn bước cột tới khi bản đồ rộng đúng `rongMuon`
 *  (toạ độ gốc). Rộng bản đồ = COT_X0 + (n−1)·b + w(b) + 8 + LAN_VONG_RONG, với w(b) = 150 + (b − 196)·0.5. */
export function cotGian(soPha: number, rongMuon: number): { cotRong: number; cotBuoc: number } {
  const b = (rongMuon - COT_X0 - 8 - LAN_VONG_RONG - KHOI_RONG + COT_BUOC * 0.5) / (soPha - 1 + 0.5);
  const cotBuoc = Math.max(COT_BUOC, Math.min(360, b));
  return { cotBuoc, cotRong: Math.round(KHOI_RONG + (cotBuoc - COT_BUOC) * 0.5) };
}

/** Rộng bản đồ muốn có ở toàn màn hình: zoom vừa CHIỀU CAO (kẹp ≥ 0.5) rồi lấp đủ chiều ngang ở zoom đó. */
export function rongMuonToanManHinh(khungRong: number, khungCao: number, banDoCao: number): number {
  const z = kepZoom((khungCao - 20) / banDoCao);
  return (khungRong - 24) / z;
}

// ─── Thu phóng (SPEC §7, tokens.thu_phong) ──────────────────────────────
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.4;
export const kepZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** Vừa khung = khớp chiều NGANG: (rộng khung − 24) / rộng bản đồ. */
export const zoomVuaKhung = (khungRong: number, banDoRong: number): number => kepZoom((khungRong - 24) / banDoRong);
/** Vừa cả hai chiều (toàn màn hình). */
export const zoomVuaHaiChieu = (khungRong: number, khungCao: number, banDoRong: number, banDoCao: number): number =>
  kepZoom(Math.min((khungRong - 24) / banDoRong, (khungCao - 20) / banDoCao));
export const phanTramZoom = (z: number, vua: number): number => Math.round((z / vua) * 100);

/** Bề rộng màn hình → chế độ trang (SPEC §8). */
export type CheDoManHinh = 'may' | 'bang' | 'dt';
export const cheDoManHinh = (rong: number): CheDoManHinh => (rong < 768 ? 'dt' : rong < 1024 ? 'bang' : 'may');
