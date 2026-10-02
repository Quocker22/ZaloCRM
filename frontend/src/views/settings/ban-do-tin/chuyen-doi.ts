// SPDX-License-Identifier: AGPL-3.0-or-later
// chuyen-doi.ts — hợp đồng API (hop-dong.ts) → dữ liệu trình bày (kieu.ts). Thuần, không I/O.
//
//   ảnh chụp bot   { phienBan, composer, nguon, dem, luc }      (GET /bot-quyen/ban-do-tin)
//   luật CRM       { luat, banDo, canhBao }                     (GET /bot-quyen/luat-thong-bao)
//   CRM tự động    { crm }                                      (GET /bot-quyen/ban-do-tin/crm-tu-dong)
//
// Quy tắc (đọc trước khi sửa):
//   • pha lạ / null ⇒ cột "Quyền · hệ thống · lỗi" (giữ mã lạ ở `pha_la` để panel nói thật);
//   • `dich_goc` lạ bị bỏ (giữ ở `dich_goc_la`); rỗng ⇒ `nhom_goc` (bot không khai = gửi nơi người gõ);
//   • đích luật → HÀNG bản sao: chuc_nang → g_*, nv → nv, nguoi_gay_ra → dm_nguoi_go (`dich_tho` giữ nguyên để sửa);
//   • số đếm: `dich_kieu` quy về hàng như trên; gộp theo khối (`gui:`) và phần qua luật (`luat:`) cho cạnh bản sao.
import { HANG, HANG_THEO_CHUC_NANG, HANG_THEO_LOAI_DICH_CRM, PHA } from './cau-hinh';
import type {
  AnhChupBanDo, CanhDanToi, Composer, DemCanh, Luat, MaDich, MaHangPhu, MaPha, NutPhu, SoDem,
} from './kieu';
import {
  CHUC_NANG_NHOM, type BanDoApi, type ChucNangNhom, type DanhSachLuatApi, type DemApi, type DichLuatApi, type LuatApi,
  type MucCrmApi,
} from './hop-dong';

const MA_PHA = new Set<string>(PHA.map((p) => p.id));
const MA_DICH = new Set<string>(['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach']);

export const phaTuMa = (p: string | null | undefined): MaPha => (p && MA_PHA.has(p) ? (p as MaPha) : 'he_thong');

/** Mã đích (của bot: g_kho… / của CRM: kho, nguoi_gay_ra…) → hàng; null khi không biết. */
export function hangTuMaDich(m: string | null | undefined): MaDich | null {
  if (!m) return null;
  if (MA_DICH.has(m)) return m as MaDich;
  if ((CHUC_NANG_NHOM as readonly string[]).includes(m)) return HANG_THEO_CHUC_NANG[m as ChucNangNhom];
  if (m === 'nguoi_gay_ra') return 'dm_nguoi_go';
  if (m === 'ketoan') return 'g_ketoan';
  return null;
}

/** Một đích luật → hàng bản sao. */
export function hangTuDichLuat(d: DichLuatApi): MaDich | null {
  if (d.kieu === 'chuc_nang') return hangTuMaDich(d.gia_tri);
  if (d.kieu === 'nv') return 'nv';
  if (d.kieu === 'nguoi_gay_ra') return 'dm_nguoi_go';
  return null;
}

/** Id nguồn của bot → hàng dải Nguồn (bot hiện có nguon_may_in, nguon_odoo, nguon_lich). */
export function hangNguon(id: string): MaHangPhu {
  if (/may_in|in_an|printer/.test(id)) return 'n_may_in';
  if (/odoo/.test(id)) return 'n_odoo';
  if (/lich|hen_gio|cron/.test(id)) return 'n_lich';
  return 'n_khac';
}

const soRong = (): SoDem => ({ da_gui: 0, chan_tam_im: 0, loi: 0, bong: 0, chua_ro: 0 });

export function luatTuApi(l: LuatApi): Luat {
  const dich = [...new Set(l.dich.map(hangTuDichLuat).filter((h): h is MaDich => !!h))];
  return {
    id: l.id, loai: l.loai, dich, dich_tho: l.dich.map((d) => ({ ...d })), che_do: l.cheDo, phien_ban: l.phienBan,
    sua_boi: l.suaBoi, sua_luc: l.suaLuc,
  };
}

function composerTuApi(c: BanDoApi['composer'][number]): Composer {
  const goc: MaDich[] = [];
  const la: string[] = [];
  for (const m of c.dich_goc ?? []) {
    const h = hangTuMaDich(m);
    if (h && !goc.includes(h)) goc.push(h);
    else if (!h) la.push(m);
  }
  if (!goc.length) goc.push('nhom_goc');
  const pha = phaTuMa(c.pha);
  return {
    id: c.id,
    ten: c.ten || c.id,
    pha,
    ...(c.pha && c.pha !== pha ? { pha_la: c.pha } : {}),
    kieu: c.kieu,
    dich_goc: goc,
    ...(la.length ? { dich_goc_la: la } : {}),
    nhay_cam: [...(c.nhay_cam ?? [])],
    khi_nao: c.khi_nao ?? '',
    vi_du: c.vi_du ?? '',
    nguon_cau: c.nguon_cau ?? '',
    ...(c.ghi_chu ? { ghi_chu: c.ghi_chu } : {}),
    dan_toi: (c.dan_toi ?? []).map((d): CanhDanToi => ({ den: d.den, kieu: d.kieu, ...(d.vi_sao ? { vi_sao: d.vi_sao } : {}) })),
    de_xuat: !!c.de_xuat,
  };
}

function nguonTuApi(n: BanDoApi['nguon'][number]): NutPhu {
  return {
    id: n.id, ten: n.ten || n.id, pha: phaTuMa(n.pha), hang: hangNguon(n.id), mo_ta: n.mo_ta ?? '', chi_xem: true,
    dan_toi: (n.dan_toi ?? []).map((d) => ({ den: d.den, kieu: d.kieu, ...(d.vi_sao ? { vi_sao: d.vi_sao } : {}) })),
  };
}

export function crmTuApi(m: MucCrmApi): NutPhu {
  return {
    id: m.id, ten: m.ten, pha: phaTuMa(m.pha), hang: HANG_THEO_LOAI_DICH_CRM[m.loai_dich] ?? 'crm_app',
    mo_ta: m.khi_nao, chi_xem: true, crm: m,
    dan_toi: m.dan_toi.map((d) => ({ den: d.den, kieu: 'crm' as const, vi_sao: d.vi_sao })),
  };
}

/** Gộp số đếm: `gui:<composer>@<hàng>` (mọi lần) và `luat:<composer>@<hàng>` (chỉ qua luật). */
export function gopDem(dem: readonly DemApi[]): DemCanh[] {
  const m = new Map<string, DemCanh>();
  const cong = (id: string, d: DemApi) => {
    let c = m.get(id);
    if (!c) { c = { canh_id: id, d7: soRong(), h24: soRong() }; m.set(id, c); }
    const o = d.cua_so === '24h' ? c.h24 : c.d7;
    if (d.ket_qua in o) o[d.ket_qua] += d.so;
  };
  for (const d of dem) {
    const h = hangTuMaDich(d.dich_kieu);
    if (!h) continue;
    const khoi = `${d.composer}@${h}`;
    cong(`gui:${khoi}`, d);
    if (d.luat_id) cong(`luat:${khoi}`, d);
  }
  return [...m.values()];
}

/** "Nếu bật, 24 giờ qua sẽ gửi N" của MỘT luật = tổng `so` (bong, 24h) của các dòng mang luat_id đó (hợp đồng §4). */
export function bong24hCuaLuat(dem: readonly DemApi[], luatId: string): { co: boolean; so: number } {
  let co = false, so = 0;
  for (const d of dem) {
    if (d.luat_id !== luatId) continue;
    co = true;
    if (d.ket_qua === 'bong' && d.cua_so === '24h') so += d.so;
  }
  return { co, so };
}

export interface NguonAnhChup {
  banDo: BanDoApi;
  luat: DanhSachLuatApi;
  crm: MucCrmApi[] | null;
  loiCrm?: string | null;
  mau?: boolean;
}

export function dungAnhChup(v: NguonAnhChup): AnhChupBanDo {
  const composer = v.banDo.composer.map(composerTuApi);
  const coComposer = new Set(composer.map((c) => c.id));
  return {
    phien_ban: v.banDo.phienBan,
    luc: v.banDo.luc ?? null,
    mau: !!v.mau,
    composer,
    nguon: (v.banDo.nguon ?? []).filter((n) => !coComposer.has(n.id)).map(nguonTuApi),
    crm: (v.crm ?? []).map(crmTuApi),
    luat: v.luat.luat.map(luatTuApi),
    dem: gopDem(v.banDo.dem ?? []),
    dem_tho: [...(v.banDo.dem ?? [])],
    canh_bao: [...(v.luat.canhBao ?? [])],
    loi_crm: v.loiCrm ?? null,
  };
}

/** Hàng → đích luật cho CRM. `nv` cần zalo_uid ⇒ không dựng từ hàng (giữ đích nv cũ / thêm riêng). */
export function dichLuatTuHang(h: MaDich): DichLuatApi | null {
  if (h === 'dm_nguoi_go') return { kieu: 'nguoi_gay_ra', gia_tri: null };
  const cn = (Object.entries(HANG_THEO_CHUC_NANG) as [ChucNangNhom, MaDich][]).find(([, x]) => x === h)?.[0];
  return cn ? { kieu: 'chuc_nang', gia_tri: cn } : null;
}

/** Bật/tắt MỘT hàng bản sao trên danh sách đích luật hiện có (giữ nguyên các đích khác, kể cả mọi đích nv). */
export function doiHangTrongDich(dich: readonly DichLuatApi[], h: MaDich, co: boolean): DichLuatApi[] {
  const giu = dich.filter((d) => hangTuDichLuat(d) !== h);
  if (!co) return giu;
  const moi = dichLuatTuHang(h);
  return moi ? [...giu, moi] : [...dich];
}

/** Tên hàng (cho chữ trong panel). */
export const tenHang = (h: string): string => HANG[h as MaDich]?.ten ?? h;
