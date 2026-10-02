// SPDX-License-Identifier: AGPL-3.0-or-later
// THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — luật THUẦN: đọc + kiểm cứng luật đích và ảnh chụp bản đồ tin. Không I/O.
//
// Luật cứng (thuc-thi.md §1 + §5 P0-5) — KHÔNG BAO GIỜ là dữ liệu chủ sửa được:
//   • composer phải có trong ảnh chụp danh mục MỚI NHẤT bot gửi lên (composer lạ ⇒ 400);
//   • composer `kieu = khoa` (🔒, ví dụ thẻ đơn có mã chốt) không định tuyến được ⇒ 400;
//   • `nhom_goc` không bao giờ là đích: nơi gốc luôn ngầm định, bản sao gửi lại nơi gốc = gửi đôi ⇒ 400;
//   • nhóm KHÁCH không nhận composer có dữ liệu nhạy cảm (giá/SĐT/tiền/lãi — `nhay_cam` khác rỗng) ⇒ 400.
// Đọc công khai cho bot (`ghepLuatCongKhai`) áp lại đúng các luật này với HỢP của ảnh chụp hiện tại và sổ nhạy cảm dính
// (`danhMucHop` — Codex v1 #1: bỏ composer khỏi ảnh chụp không được làm mất nhãn) — đích vi phạm bị bỏ và nêu trong
// `canh_bao`; composer không có trong cả hai ⇒ bỏ MỌI đích (fail closed). Bot vẫn tự rào lần nữa.
// Hình dạng ảnh chụp = hợp đồng docs/78 hop-dong-ban-do-tin.md (Codex v1 #7) — đổi ở đây thì đổi cả tài liệu đó.
import { createHash } from 'node:crypto';
import { CHUC_NANG_NHOM, laChucNang } from './bot-quyen-luat.js';
import { jsonChuan } from './bot-quyen-cong-khai.js';

export const CHE_DO = ['tat', 'bong', 'bat'] as const;
export type CheDo = (typeof CHE_DO)[number];

export const KIEU_COMPOSER = ['khoa', 'ban_sao', 'thuan'] as const;
export type KieuComposer = (typeof KIEU_COMPOSER)[number];

/** Ai soạn tin (bổ sung 02/10) — nhãn khối Mã/Model/Mẫu/Ảnh trên bản đồ. */
export const AI_SOAN = ['ma', 'model', 'mau', 'anh'] as const;
export type AiSoan = (typeof AI_SOAN)[number];

export const KIEU_DICH = ['chuc_nang', 'nv', 'nguoi_gay_ra'] as const;
export type KieuDich = (typeof KIEU_DICH)[number];

export interface Dich {
  kieu: KieuDich;
  /** chuc_nang: một CHUC_NANG_NHOM · nv: zalo_uid của BotNhanVien · nguoi_gay_ra: null. */
  gia_tri: string | null;
}

/** Kiểu cạnh `dan_toi` — đúng `KIEU_LIEN_KET` của bot (lednelia_donhang/thong_bao/danh_muc.py). */
export const KIEU_CANH = ['nghiep_vu', 'hoi_lai', 'su_kien', 'chan'] as const;
export type KieuCanh = (typeof KIEU_CANH)[number];

export interface CanhDanToi {
  /** id composer hoặc id nguồn giả (`nguon[]`) trong CÙNG ảnh chụp. */
  den: string;
  kieu: KieuCanh;
  vi_sao?: string;
}

export interface ComposerAnh {
  id: string;
  ten: string | null;
  pha: string | null;
  kieu: KieuComposer;
  de_xuat: boolean;
  dich_goc: string[];
  nhay_cam: string[];
  khi_nao: string | null;
  vi_du: string | null;
  nguon_cau: string | null;
  ghi_chu: string | null;
  dan_toi: CanhDanToi[];
  /** Bổ sung 02/10 — bắt buộc trong ảnh chụp mới; `null` chỉ ở bản lưu cũ / `chi_trong_so_dinh`. */
  ai_soan: AiSoan | null;
  /** Vì sao đích cố định — chỉ khi `kieu = khoa` (dòng 🔒 trong panel). */
  ly_do_khoa: string | null;
  /** Gợi ý cấu hình (vd "Ứng viên: thêm nhóm Kế toán"). */
  goi_y: string | null;
  /** Chỉ trong `danhMucHop`: composer không còn trong ảnh chụp hiện tại, metadata lấy từ sổ dính. */
  chi_trong_so_dinh?: boolean;
}

/** Nguồn giả (máy in, Odoo, lịch…) — chỉ để vẽ cạnh vào composer. */
export interface NguonAnh {
  id: string;
  ten: string | null;
  pha: string | null;
  mo_ta: string | null;
  dan_toi: CanhDanToi[];
}

/** = CHECK tin_gui_so.ket_qua của bot (`bo` = nội dung rỗng cho đích, bot so_gui.KET_QUA). */
export const KET_QUA_DEM = ['da_gui', 'chan_tam_im', 'loi', 'bong', 'chua_ro', 'bo'] as const;
export const CUA_SO_DEM = ['24h', '7d'] as const;

/** Một dòng số đếm theo CẠNH (bot tin_gui_so): khoá cạnh = `<composer>→<dich_kieu>|<luat_id|goc>`. */
export interface DemCanh {
  khoa_canh: string;
  composer: string;
  dich_kieu: string;
  luat_id: string | null;
  ket_qua: (typeof KET_QUA_DEM)[number];
  cua_so: (typeof CUA_SO_DEM)[number];
  so: number;
}

export interface AnhChup {
  phien_ban: string;
  composer: ComposerAnh[];
  nguon: NguonAnh[];
  dem: DemCanh[];
}

/** Khoá cạnh của số đếm — `goc` = gửi ở nơi gốc (không qua luật). */
export function khoaCanh(composer: string, dichKieu: string, luatId: string | null): string {
  return `${composer}→${dichKieu}|${luatId ?? 'goc'}`;
}

/** Lỗi kiểm — routes đổi thành HTTP (cùng hình {error, code} như LoiBotQuyen). */
export class LoiLuatThongBao extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'LoiLuatThongBao';
  }
}

const sai = (code: string, msg: string): LoiLuatThongBao => new LoiLuatThongBao(400, code, msg);

export const TRAN = {
  composer: 300,
  nguon: 50,
  danToi: 60,
  dem: 5000,
  dich: 20,
  jsonNho: 4096,
  gomGiay: 86_400,
  nhayCam: 20,
  echoIds: 200,
  echoDai: 200,
} as const;

const RE_ID = /^[a-z][a-z0-9_.]{0,63}$/;
const RE_NHAN = /^[a-z][a-z0-9_]{0,31}$/;

function laObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function chuTuyChon(x: unknown, ten: string, dai: number): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string') throw sai('ANH_CHUP_KHONG_HOP_LE', `${ten} phải là chuỗi`);
  return x.slice(0, dai);
}

// ── Ảnh chụp bản đồ tin (bot → CRM) ─────────────────────────────────────────

const TRUONG_DEM = ['khoa_canh', 'composer', 'dich_kieu', 'luat_id', 'ket_qua', 'cua_so', 'so'] as const;

function docDanToi(x: unknown, chu: string): CanhDanToi[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.length > TRAN.danToi) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `${chu}: dan_toi phải là mảng ≤ ${TRAN.danToi} cạnh`);
  }
  const ra = new Map<string, CanhDanToi>();
  for (const e of x) {
    // Hai dạng: {den, kieu, vi_sao?} (hợp đồng) hoặc cặp [den, kieu] (xuat_json của bot 02/10).
    const o = Array.isArray(e) ? { den: e[0], kieu: e[1], ...(e.length > 2 ? { la: true } : {}) } : e;
    if (!laObj(o) || 'la' in o) throw sai('ANH_CHUP_KHONG_HOP_LE', `${chu}: mỗi cạnh dan_toi là {den, kieu} hoặc [den, kieu]`);
    if (typeof o.den !== 'string' || !RE_ID.test(o.den)) throw sai('ANH_CHUP_KHONG_HOP_LE', `${chu}: dan_toi.den không hợp lệ`);
    if (typeof o.kieu !== 'string' || !(KIEU_CANH as readonly string[]).includes(o.kieu)) {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `${chu}: dan_toi.kieu phải là ${KIEU_CANH.join('|')}`);
    }
    const viSao = chuTuyChon(o.vi_sao, 'vi_sao', 500);
    ra.set(`${o.den}|${o.kieu}`, { den: o.den, kieu: o.kieu as KieuCanh, ...(viSao ? { vi_sao: viSao } : {}) });
  }
  return [...ra.values()];
}

function docDichGoc(x: unknown, chu: string): string[] {
  if (x === undefined || x === null) return [];
  const mang = typeof x === 'string' ? [x] : x;
  if (!Array.isArray(mang) || mang.length > TRAN.dich || mang.some((d) => typeof d !== 'string' || !RE_NHAN.test(d))) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `${chu}: dich_goc phải là mảng mã đích (a-z_)`);
  }
  return [...new Set(mang as string[])];
}

function docDem(d: unknown, i: number): DemCanh {
  if (!laObj(d)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}] phải là object`);
  for (const k of Object.keys(d)) {
    if (!(TRUONG_DEM as readonly string[]).includes(k)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}]: trường lạ ${k.slice(0, 40)}`);
  }
  if (typeof d.composer !== 'string' || !RE_ID.test(d.composer)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].composer không hợp lệ`);
  if (typeof d.dich_kieu !== 'string' || !RE_NHAN.test(d.dich_kieu)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].dich_kieu không hợp lệ`);
  if (d.luat_id !== null && (typeof d.luat_id !== 'string' || !d.luat_id || d.luat_id.length > 64)) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].luat_id phải là chuỗi ≤ 64 hoặc null`);
  }
  if (typeof d.ket_qua !== 'string' || !(KET_QUA_DEM as readonly string[]).includes(d.ket_qua)) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].ket_qua phải là ${KET_QUA_DEM.join('|')}`);
  }
  if (typeof d.cua_so !== 'string' || !(CUA_SO_DEM as readonly string[]).includes(d.cua_so)) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].cua_so phải là ${CUA_SO_DEM.join('|')}`);
  }
  if (typeof d.so !== 'number' || !Number.isInteger(d.so) || d.so < 0) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].so (số nguyên ≥ 0) bắt buộc`);
  const luatId = d.luat_id as string | null;
  if (d.khoa_canh !== khoaCanh(d.composer, d.dich_kieu, luatId)) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].khoa_canh phải là "${khoaCanh(d.composer, d.dich_kieu, luatId)}"`);
  }
  return {
    khoa_canh: d.khoa_canh as string, composer: d.composer, dich_kieu: d.dich_kieu, luat_id: luatId,
    ket_qua: d.ket_qua as DemCanh['ket_qua'], cua_so: d.cua_so as DemCanh['cua_so'], so: d.so,
  };
}

/**
 * Kiểm + chuẩn hoá ảnh chụp bot gửi theo hợp đồng (docs/78 hop-dong-ban-do-tin.md). Chỉ giữ trường đã biết (không lưu nội
 * dung tin thật — `vi_du` là câu MẪU do bot khai). `pha`/`dich` ở gốc (bảng tên pha/đích của bot) được nhận và BỎ QUA.
 */
export function docAnhChup(body: unknown): AnhChup {
  if (!laObj(body)) throw sai('ANH_CHUP_KHONG_HOP_LE', 'Thân yêu cầu phải là object');
  const pb = body.phien_ban;
  if (typeof pb !== 'string' || !pb.trim() || pb.length > 128) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', 'phien_ban phải là chuỗi 1–128 ký tự');
  }
  if (!Array.isArray(body.composer) || body.composer.length === 0 || body.composer.length > TRAN.composer) {
    throw sai('ANH_CHUP_KHONG_HOP_LE', `composer phải là mảng 1–${TRAN.composer} phần tử`);
  }
  const daCo = new Set<string>();
  const composer = body.composer.map((c, i): ComposerAnh => {
    if (!laObj(c)) throw sai('ANH_CHUP_KHONG_HOP_LE', `composer[${i}] phải là object`);
    if (typeof c.id !== 'string' || !RE_ID.test(c.id)) throw sai('ANH_CHUP_KHONG_HOP_LE', `composer[${i}].id không hợp lệ`);
    if (daCo.has(c.id)) throw sai('ANH_CHUP_KHONG_HOP_LE', `composer trùng id ${c.id}`);
    daCo.add(c.id);
    if (typeof c.kieu !== 'string' || !(KIEU_COMPOSER as readonly string[]).includes(c.kieu)) {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `composer ${c.id}: kieu phải là ${KIEU_COMPOSER.join('|')}`);
    }
    const nc = c.nhay_cam ?? [];
    if (!Array.isArray(nc) || nc.length > TRAN.nhayCam || nc.some((x) => typeof x !== 'string' || !RE_NHAN.test(x))) {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `composer ${c.id}: nhay_cam phải là mảng nhãn (a-z_)`);
    }
    if (c.de_xuat !== undefined && c.de_xuat !== null && typeof c.de_xuat !== 'boolean') {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `composer ${c.id}: de_xuat phải là true/false`);
    }
    if (typeof c.ai_soan !== 'string' || !(AI_SOAN as readonly string[]).includes(c.ai_soan)) {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `composer ${c.id}: ai_soan (bắt buộc) phải là ${AI_SOAN.join('|')}`);
    }
    const lyDoKhoa = chuTuyChon(c.ly_do_khoa, `composer ${c.id}: ly_do_khoa`, 1000) || null;
    if (lyDoKhoa && c.kieu !== 'khoa') {
      throw sai('ANH_CHUP_KHONG_HOP_LE', `composer ${c.id}: ly_do_khoa chỉ dùng khi kieu = khoa`);
    }
    return {
      id: c.id,
      ten: chuTuyChon(c.ten, 'ten', 200),
      pha: chuTuyChon(c.pha, 'pha', 64),
      kieu: c.kieu as KieuComposer,
      de_xuat: c.de_xuat === true,
      dich_goc: docDichGoc(c.dich_goc, `composer ${c.id}`),
      nhay_cam: [...new Set(nc as string[])].sort(),
      khi_nao: chuTuyChon(c.khi_nao, 'khi_nao', 2000) || null,
      vi_du: chuTuyChon(c.vi_du, 'vi_du', 4000) || null,
      nguon_cau: chuTuyChon(c.nguon_cau, 'nguon_cau', 1000) || null,
      ghi_chu: chuTuyChon(c.ghi_chu, 'ghi_chu', 4000) || null,
      dan_toi: docDanToi(c.dan_toi, `composer ${c.id}`),
      ai_soan: c.ai_soan as AiSoan,
      ly_do_khoa: lyDoKhoa,
      goi_y: chuTuyChon(c.goi_y, `composer ${c.id}: goi_y`, 1000) || null,
    };
  });
  const nguonVao = body.nguon ?? [];
  if (!Array.isArray(nguonVao) || nguonVao.length > TRAN.nguon) throw sai('ANH_CHUP_KHONG_HOP_LE', `nguon phải là mảng ≤ ${TRAN.nguon}`);
  const nguon = nguonVao.map((n, i): NguonAnh => {
    if (!laObj(n) || typeof n.id !== 'string' || !RE_ID.test(n.id)) throw sai('ANH_CHUP_KHONG_HOP_LE', `nguon[${i}].id không hợp lệ`);
    if (daCo.has(n.id)) throw sai('ANH_CHUP_KHONG_HOP_LE', `nguon ${n.id} trùng id composer/nguồn khác`);
    daCo.add(n.id);
    return {
      id: n.id, ten: chuTuyChon(n.ten, 'ten', 200), pha: chuTuyChon(n.pha, 'pha', 64), mo_ta: chuTuyChon(n.mo_ta, 'mo_ta', 2000),
      dan_toi: docDanToi(n.dan_toi, `nguon ${n.id}`),
    };
  });
  // Mọi cạnh phải trỏ tới khối có trong CÙNG ảnh chụp (bản đồ không có đường cụt).
  for (const k of [...composer, ...nguon]) {
    for (const e of k.dan_toi) {
      if (!daCo.has(e.den)) throw sai('ANH_CHUP_KHONG_HOP_LE', `${k.id}: dan_toi tới "${e.den}" không có trong ảnh chụp`);
    }
  }
  const demVao = body.dem ?? [];
  if (!Array.isArray(demVao) || demVao.length > TRAN.dem) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem phải là mảng ≤ ${TRAN.dem}`);
  const daDem = new Set<string>();
  const dem = demVao.map((d, i) => {
    const r = docDem(d, i);
    const k = `${r.khoa_canh}|${r.ket_qua}|${r.cua_so}`;
    if (daDem.has(k)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}] trùng (khoa_canh, ket_qua, cua_so)`);
    daDem.add(k);
    return r;
  });
  return { phien_ban: pb.trim(), composer, nguon, dem };
}

/**
 * `luat_id` của số đếm = `id` luật CRM (`bot_luat_thong_bao.id`, GET luật trả kèm từ 02/10). TƯƠNG THÍCH MỘT BẢN: bot cũ gửi
 * `loai` (id composer) vào `luat_id` ⇒ đổi sang id của luật mang loai đó + viết lại `khoa_canh`. Id khớp trước (id là uuid,
 * loai theo RE_ID — không chồng nhau, nhưng id vẫn thắng nếu có). `luat_id` lạ (luật đã xoá, số 7 ngày còn) ⇒ giữ nguyên.
 * Sau khi đổi, hai dòng cùng (khoa_canh, ket_qua, cua_so) ⇒ gộp (cộng `so`, vị trí lần đầu). `doiTuLoai` = số dòng đã đổi
 * (để ghi log khi bot còn gửi dạng cũ — gỡ nhánh này ở bản sau).
 */
export function chuanLuatIdDem(
  dem: readonly DemCanh[], luat: ReadonlyArray<{ id: string; loai: string }>,
): { dem: DemCanh[]; doiTuLoai: number } {
  const ids = new Set(luat.map((l) => l.id));
  const theoLoai = new Map(luat.map((l) => [l.loai, l.id]));
  const ra = new Map<string, DemCanh>();
  let doiTuLoai = 0;
  for (const d of dem) {
    let r = d;
    if (d.luat_id !== null && !ids.has(d.luat_id) && theoLoai.has(d.luat_id)) {
      const id = theoLoai.get(d.luat_id)!;
      r = { ...d, luat_id: id, khoa_canh: khoaCanh(d.composer, d.dich_kieu, id) };
      doiTuLoai++;
    }
    const k = `${r.khoa_canh}|${r.ket_qua}|${r.cua_so}`;
    const cu = ra.get(k);
    ra.set(k, cu ? { ...cu, so: cu.so + r.so } : r);
  }
  return { dem: [...ra.values()], doiTuLoai };
}

/**
 * Thân `POST /api/public/ban-do-tin/doi-soat-echo` — `{echo_ids: string[]}` (≤ 200, mỗi chuỗi 1–200 ký tự sau khi cắt khoảng
 * trắng — CRM lưu `clientEchoId` đã cắt). Khử trùng, giữ thứ tự. Sai hình ⇒ 400 DOI_SOAT_KHONG_HOP_LE.
 */
export function docDoiSoatEcho(body: unknown): string[] {
  const x = laObj(body) ? body.echo_ids : undefined;
  if (!Array.isArray(x) || x.length > TRAN.echoIds) {
    throw sai('DOI_SOAT_KHONG_HOP_LE', `echo_ids phải là mảng ≤ ${TRAN.echoIds} chuỗi`);
  }
  const ra = new Set<string>();
  for (const e of x) {
    const t = typeof e === 'string' ? e.trim() : '';
    if (!t || t.length > TRAN.echoDai) throw sai('DOI_SOAT_KHONG_HOP_LE', `mỗi echo_id là chuỗi 1–${TRAN.echoDai} ký tự`);
    ra.add(t);
  }
  return [...ra];
}

/** Danh mục composer từ cột jsonb đã lưu (đã qua `docAnhChup` lúc lưu). */
export function danhMucTuAnh(composer: unknown): Map<string, ComposerAnh> {
  const m = new Map<string, ComposerAnh>();
  if (!Array.isArray(composer)) return m;
  for (const c of composer) {
    if (!laObj(c) || typeof c.id !== 'string') continue;
    const nc = Array.isArray(c.nhay_cam) ? c.nhay_cam.filter((x): x is string => typeof x === 'string') : [];
    // Bản lưu trước 02/10 không có ai_soan/ly_do_khoa/goi_y ⇒ null (không đoán).
    const aiSoan = typeof c.ai_soan === 'string' && (AI_SOAN as readonly string[]).includes(c.ai_soan) ? (c.ai_soan as AiSoan) : null;
    m.set(c.id, {
      ...(c as unknown as ComposerAnh), nhay_cam: nc, ai_soan: aiSoan,
      ly_do_khoa: typeof c.ly_do_khoa === 'string' ? c.ly_do_khoa : null, goi_y: typeof c.goi_y === 'string' ? c.goi_y : null,
    });
  }
  return m;
}

/**
 * HỢP ảnh chụp hiện tại với sổ dính (Codex v1 #1) — metadata dùng để KIỂM CỨNG (ghi luật lẫn phát luật cho bot):
 *   • composer hiện tại: nhãn nhạy cảm = nhãn hiện tại ∪ nhãn trong sổ; khoá nếu sổ đã từng khoá;
 *   • composer KHÔNG còn trong ảnh chụp nhưng có trong sổ: vẫn có mặt (`chi_trong_so_dinh`) với nhãn/khoá của sổ;
 *   • không có ở cả hai: vắng mặt ⇒ người dùng metadata phải coi là KHÔNG an toàn (fail closed).
 * null = chưa từng có ảnh chụp lẫn sổ.
 * Giới hạn đã biết: ảnh chụp ĐẦU TIÊN được tin (sổ rỗng) — xem hop-dong-ban-do-tin.md §An toàn (khoá riêng của bot).
 */
export function danhMucHop(composer: unknown, dinh: unknown): Map<string, ComposerAnh> | null {
  if (composer == null && (dinh == null || (laObj(dinh) && Object.keys(dinh).length === 0))) return null;
  const m = danhMucTuAnh(composer);
  if (laObj(dinh)) {
    for (const [id, v] of Object.entries(dinh)) {
      if (!laObj(v)) continue;
      const nhan = Array.isArray(v.nhay_cam) ? v.nhay_cam.filter((x): x is string => typeof x === 'string') : [];
      const khoa = v.khoa === true;
      const c = m.get(id);
      if (c) {
        m.set(id, { ...c, nhay_cam: [...new Set([...c.nhay_cam, ...nhan])].sort(), kieu: khoa ? 'khoa' : c.kieu });
      } else {
        m.set(id, {
          id, ten: null, pha: null, kieu: khoa ? 'khoa' : 'ban_sao', de_xuat: false, dich_goc: [], nhay_cam: [...new Set(nhan)].sort(),
          khi_nao: null, vi_du: null, nguon_cau: null, ghi_chu: null, dan_toi: [], ai_soan: null, ly_do_khoa: null, goi_y: null,
          chi_trong_so_dinh: true,
        });
      }
    }
  }
  return m;
}

// ── Luật (chủ sửa trên CRM) ─────────────────────────────────────────────────

export interface LuatVao {
  dich?: Dich[];
  cheDo?: CheDo;
  dieuKien?: Record<string, unknown>;
  gomGiay?: number;
  lich?: Record<string, unknown> | null;
}

function jsonNho(x: unknown, ten: string, choPhepNull: boolean): Record<string, unknown> | null {
  if (x === null && choPhepNull) return null;
  if (!laObj(x)) throw sai('DU_LIEU_KHONG_HOP_LE', `${ten} phải là object${choPhepNull ? ' hoặc null' : ''}`);
  if (JSON.stringify(x).length > TRAN.jsonNho) throw sai('DU_LIEU_KHONG_HOP_LE', `${ten} lớn quá ${TRAN.jsonNho} ký tự`);
  return x;
}

/** Đọc hình dạng các ô luật (chưa xét danh mục composer). undefined = không gửi (giữ nguyên khi sửa). */
export function docLuatVao(b: Record<string, unknown>): LuatVao {
  const ra: LuatVao = {};
  if (b.dich !== undefined) ra.dich = docDich(b.dich);
  if (b.cheDo !== undefined) {
    if (typeof b.cheDo !== 'string' || !(CHE_DO as readonly string[]).includes(b.cheDo)) {
      throw sai('DU_LIEU_KHONG_HOP_LE', `cheDo phải là ${CHE_DO.join('|')}`);
    }
    ra.cheDo = b.cheDo as CheDo;
  }
  if (b.dieuKien !== undefined) ra.dieuKien = jsonNho(b.dieuKien, 'dieuKien', false)!;
  if (b.gomGiay !== undefined) {
    if (typeof b.gomGiay !== 'number' || !Number.isInteger(b.gomGiay) || b.gomGiay < 0 || b.gomGiay > TRAN.gomGiay) {
      throw sai('DU_LIEU_KHONG_HOP_LE', `gomGiay phải là số nguyên 0–${TRAN.gomGiay}`);
    }
    ra.gomGiay = b.gomGiay;
  }
  if (b.lich !== undefined) ra.lich = jsonNho(b.lich, 'lich', true);
  return ra;
}

/** Mảng đích → dạng chuẩn (khử trùng, sắp xếp). `nhom_goc` và kiểu lạ ⇒ 400. */
export function docDich(x: unknown): Dich[] {
  if (!Array.isArray(x)) throw sai('DICH_KHONG_HOP_LE', 'dich phải là mảng');
  if (x.length > TRAN.dich) throw sai('DICH_KHONG_HOP_LE', `dich tối đa ${TRAN.dich} phần tử`);
  const ra = new Map<string, Dich>();
  for (const d of x) {
    if (!laObj(d)) throw sai('DICH_KHONG_HOP_LE', 'Mỗi đích phải là object {kieu, gia_tri}');
    if (d.kieu === 'nhom_goc') {
      throw sai('DICH_NHOM_GOC', 'Nơi gốc luôn nhận tin — không thêm "nhóm gốc" làm đích bản sao (sẽ gửi đôi)');
    }
    let dich: Dich;
    if (d.kieu === 'chuc_nang') {
      if (!laChucNang(d.gia_tri)) {
        throw sai('DICH_KHONG_HOP_LE', `Chức năng nhóm phải là một trong ${CHUC_NANG_NHOM.join(', ')}`);
      }
      dich = { kieu: 'chuc_nang', gia_tri: d.gia_tri };
    } else if (d.kieu === 'nv') {
      if (typeof d.gia_tri !== 'string' || !d.gia_tri.trim() || d.gia_tri.length > 64) {
        throw sai('DICH_KHONG_HOP_LE', 'Đích nhân viên cần zalo_uid (gia_tri)');
      }
      dich = { kieu: 'nv', gia_tri: d.gia_tri.trim() };
    } else if (d.kieu === 'nguoi_gay_ra') {
      if (d.gia_tri !== undefined && d.gia_tri !== null) throw sai('DICH_KHONG_HOP_LE', 'nguoi_gay_ra không nhận gia_tri');
      dich = { kieu: 'nguoi_gay_ra', gia_tri: null };
    } else {
      throw sai('DICH_KHONG_HOP_LE', `Kiểu đích phải là ${KIEU_DICH.join('|')}`);
    }
    ra.set(`${dich.kieu}:${dich.gia_tri ?? ''}`, dich);
  }
  return [...ra.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, d]) => d);
}

// ── Nhạy cảm DÍNH (tự rà P1-5) ──────────────────────────────────────────────

/** Sổ dính: id composer → nhãn nhạy cảm + đã từng khoá. Chỉ CỘNG, không bao giờ bớt qua API công khai. */
export type SoDinh = Record<string, { nhay_cam: string[]; khoa: boolean }>;

/**
 * Ảnh chụp do bot gửi bằng khoá API — khoá lộ là ai cũng gửi được "danh mục" gỡ nhãn nhạy cảm để mở đường bản sao vào
 * nhóm khách. Nên: với id composer ĐÃ có trong sổ, ảnh chụp mới phải giữ mọi nhãn cũ và không đổi khoa → định tuyến được.
 * Vắng mặt trong ảnh chụp mới KHÔNG xoá khỏi sổ (bỏ ra rồi thêm lại không lách được). Bớt nhạy cảm thật = việc của người
 * vận hành trên DB (sửa `composer_dinh`), có nhật ký riêng.
 */
export function kiemNhayCamDinh(dinh: unknown, composer: readonly ComposerAnh[]): { viPham: string[]; dinh: SoDinh } {
  const cu: SoDinh = {};
  if (laObj(dinh)) {
    for (const [id, v] of Object.entries(dinh)) {
      if (!laObj(v)) continue;
      cu[id] = {
        nhay_cam: Array.isArray(v.nhay_cam) ? v.nhay_cam.filter((x): x is string => typeof x === 'string') : [],
        khoa: v.khoa === true,
      };
    }
  }
  const viPham: string[] = [];
  const moi: SoDinh = { ...cu };
  for (const c of composer) {
    const truoc = cu[c.id];
    if (truoc) {
      const mat = truoc.nhay_cam.filter((n) => !c.nhay_cam.includes(n));
      if (mat.length > 0) viPham.push(`${c.id}: bỏ nhãn nhạy cảm ${mat.join(', ')}`);
      if (truoc.khoa && c.kieu !== 'khoa') viPham.push(`${c.id}: mở khoá (khoa → ${c.kieu})`);
    }
    const nhayCam = [...new Set([...(truoc?.nhay_cam ?? []), ...c.nhay_cam])].sort();
    const khoa = (truoc?.khoa ?? false) || c.kieu === 'khoa';
    if (nhayCam.length > 0 || khoa) moi[c.id] = { nhay_cam: nhayCam, khoa };
  }
  return { viPham, dinh: moi };
}

/**
 * Lý do một đích KHÔNG được phép cho composer này (null = được). Dùng cả lúc ghi lẫn lúc phát cho bot.
 * Chỉ xét được những gì CRM biết: đích `nv` (zalo_uid còn trong org lúc lưu — kiemTheoDanhMuc) và `nguoi_gay_ra` (người
 * gõ của từng sự kiện) có thể hết hợp lệ SAU khi lưu (NV nghỉ, bị khoá, người gây ra là khách) — bot KIỂM LẠI quyền +
 * tạm im của người nhận SÁT LÚC GỬI (thuc-thi.md §5 P0-5); CRM không hứa đích nv/nguoi_gay_ra còn đúng ở thời điểm phát.
 */
export function lyDoCam(c: ComposerAnh, d: Dich): string | null {
  if (d.kieu === 'chuc_nang' && d.gia_tri === 'khach' && c.nhay_cam.length > 0) {
    return `Tin "${c.ten ?? c.id}" có dữ liệu nhạy cảm (${c.nhay_cam.join(', ')}) — không gửi vào nhóm khách`;
  }
  return null;
}

/**
 * Kiểm luật theo danh mục: composer có, không khoá, mọi đích hợp lệ (nhóm khách + nhạy cảm ⇒ 400; NV phải có trong
 * danh sách NV của org). `danhMuc` null = bot chưa gửi ảnh chụp ⇒ 409 (không có metadata để kiểm cứng).
 */
export function kiemTheoDanhMuc(
  loai: string,
  dich: Dich[],
  danhMuc: Map<string, ComposerAnh> | null,
  uidNv: ReadonlySet<string>,
): ComposerAnh {
  if (!danhMuc) {
    throw new LoiLuatThongBao(
      409, 'CHUA_CO_BAN_DO',
      'Bot chưa gửi danh mục tin (bản đồ tin) lên CRM nên chưa kiểm được luật — chưa sửa được luật thông báo. Chờ bot đồng bộ (≤ 5 phút) rồi thử lại.',
    );
  }
  const c = danhMuc.get(loai);
  if (!c || c.chi_trong_so_dinh) throw sai('COMPOSER_LA', `Không có loại tin "${loai}" trong danh mục bot gửi lên`);
  if (c.kieu === 'khoa') {
    throw sai('COMPOSER_KHOA', `Tin "${c.ten ?? c.id}" chỉ gửi ở nơi gốc (🔒) — không định tuyến được`);
  }
  for (const d of dich) {
    const ly = lyDoCam(c, d);
    if (ly) throw sai('LO_DU_LIEU_NHOM_KHACH', ly);
    if (d.kieu === 'nv' && !uidNv.has(d.gia_tri!)) {
      throw sai('NV_KHONG_CO', `Không có nhân viên bot với zalo_uid ${d.gia_tri} trong tổ chức`);
    }
  }
  return c;
}

// ── Payload công khai cho bot ───────────────────────────────────────────────

export interface LuatCongKhai {
  /** id luật CRM — bot ghi vào `tin_gui_so.luat_id` và gửi lại ở `dem[].luat_id` của ảnh chụp. */
  id: string;
  loai: string;
  dich: Dich[];
  che_do: CheDo;
  dieu_kien: Record<string, unknown>;
  gom_giay: number;
  lich: Record<string, unknown> | null;
  phien_ban: number;
}

export interface LuatBotDoc {
  /** sha256 JSON chuẩn của `luat` (+ `canh_bao`) — cùng dữ liệu ⇒ cùng chuỗi. */
  phien_ban: string;
  luat: LuatCongKhai[];
  /** Luật/đích bị CRM bỏ khi phát vì vi phạm luật cứng theo ảnh chụp hiện tại. */
  canh_bao: string[];
}

/**
 * Dòng DB → payload bot. Áp lại luật cứng với `danhMuc` = HỢP ảnh chụp hiện tại + sổ dính (`danhMucHop`, Codex v1 #1):
 * `nhom_goc` (SQL tay) / nhóm khách + nhạy cảm ⇒ bỏ đích; composer khoá ⇒ bỏ cả luật; composer KHÔNG có trong danh mục
 * (hay chưa có ảnh chụp nào) ⇒ bỏ MỌI đích (fail closed — không biết nhãn thì không phát), luật vẫn trả với `dich: []`.
 */
export function ghepLuatCongKhai(
  rows: ReadonlyArray<{
    id: string; loai: string; dich: unknown; cheDo: string; dieuKien: unknown; gomGiay: number; lich: unknown; phienBan: number;
  }>,
  danhMuc: Map<string, ComposerAnh> | null,
): LuatBotDoc {
  const canh_bao: string[] = [];
  const luat: LuatCongKhai[] = [];
  for (const r of [...rows].sort((a, b) => (a.loai < b.loai ? -1 : a.loai > b.loai ? 1 : 0))) {
    const c = danhMuc?.get(r.loai) ?? null;
    if (c?.kieu === 'khoa') {
      canh_bao.push(`${r.loai}: composer khoá — bỏ cả luật`);
      continue;
    }
    const dich: Dich[] = [];
    const vao = Array.isArray(r.dich) ? r.dich : [];
    if (!c && vao.length > 0) {
      canh_bao.push(`${r.loai}: loại tin không có trong danh mục bot gửi lên (cả sổ nhạy cảm) — bỏ mọi đích (${vao.length})`);
    }
    for (const d of c ? vao : []) {
      if (!laObj(d) || d.kieu === 'nhom_goc' || !(KIEU_DICH as readonly string[]).includes(String(d.kieu))) {
        canh_bao.push(`${r.loai}: bỏ đích không hợp lệ ${JSON.stringify(d).slice(0, 80)}`);
        continue;
      }
      const dd: Dich = { kieu: d.kieu as KieuDich, gia_tri: typeof d.gia_tri === 'string' ? d.gia_tri : null };
      const ly = lyDoCam(c!, dd);
      if (ly) {
        canh_bao.push(`${r.loai}: bỏ đích ${dd.kieu}:${dd.gia_tri ?? ''} — ${ly}`);
        continue;
      }
      dich.push(dd);
    }
    luat.push({
      id: r.id,
      loai: r.loai,
      dich,
      che_do: (CHE_DO as readonly string[]).includes(r.cheDo) ? (r.cheDo as CheDo) : 'tat',
      dieu_kien: laObj(r.dieuKien) ? r.dieuKien : {},
      gom_giay: r.gomGiay,
      lich: laObj(r.lich) ? r.lich : null,
      phien_ban: r.phienBan,
    });
  }
  const phien_ban = createHash('sha256').update(jsonChuan({ luat, canh_bao })).digest('hex');
  return { phien_ban, luat, canh_bao };
}

// ── Gieo luật chủ chọn 02/10 (script quản trị — scripts/gieo-luat-thong-bao.ts) ──

/**
 * Luật chủ chọn 02/10 (docs/78 luat-chu-chon-02-10.json, dịch theo thuc-thi.md §5 P0-5): bản sao hoá đơn → nhóm kế toán,
 * bản sao in → nhóm kho. `nhom_goc` của bản mẫu BỎ (nơi gốc luôn ngầm định). KHÔNG gieo bằng migration: migration chạy
 * trước khi bot gửi ảnh chụp (không kiểm cứng được), chạm MỌI org, và bật thẳng `bat` — ở đây đi qua ĐÚNG service
 * (kiểm theo ảnh chụp + nhật ký), từng org, mặc định `bong` để chủ xem số bóng rồi mới bật.
 */
export const LUAT_CHU_CHON_02_10: ReadonlyArray<{ loai: string; dich: Dich[] }> = [
  { loai: 'xuat_hoa_don_tool', dich: [{ kieu: 'chuc_nang', gia_tri: 'ke_toan' }] },
  { loai: 'in_sau_chot', dich: [{ kieu: 'chuc_nang', gia_tri: 'kho' }] },
];

/** `--org <id> [--che-do tat|bong|bat]` (cả dạng `--org=<id>`). Mặc định `bong`. Ném Error khi thiếu/sai. */
export function docThamSoGieo(argv: readonly string[]): { orgId: string; cheDo: CheDo } {
  const gt = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--(org|che-do)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Tham số lạ: ${a.slice(0, 40)} — dùng --org <id> [--che-do tat|bong|bat]`);
    const v = m[2] ?? argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`--${m[1]} thiếu giá trị`);
    gt.set(m[1], v.trim());
  }
  const orgId = gt.get('org');
  if (!orgId) throw new Error('Thiếu --org <id>');
  const cheDo = gt.get('che-do') ?? 'bong';
  if (!(CHE_DO as readonly string[]).includes(cheDo)) throw new Error(`--che-do phải là ${CHE_DO.join('|')}`);
  return { orgId, cheDo: cheDo as CheDo };
}
