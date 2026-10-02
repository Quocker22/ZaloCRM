// SPDX-License-Identifier: AGPL-3.0-or-later
// THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — luật THUẦN: đọc + kiểm cứng luật đích và ảnh chụp bản đồ tin. Không I/O.
//
// Luật cứng (thuc-thi.md §1 + §5 P0-5) — KHÔNG BAO GIỜ là dữ liệu chủ sửa được:
//   • composer phải có trong ảnh chụp danh mục MỚI NHẤT bot gửi lên (composer lạ ⇒ 400);
//   • composer `kieu = khoa` (🔒, ví dụ thẻ đơn có mã chốt) không định tuyến được ⇒ 400;
//   • `nhom_goc` không bao giờ là đích: nơi gốc luôn ngầm định, bản sao gửi lại nơi gốc = gửi đôi ⇒ 400;
//   • nhóm KHÁCH không nhận composer có dữ liệu nhạy cảm (giá/SĐT/tiền/lãi — `nhay_cam` khác rỗng) ⇒ 400.
// Đọc công khai cho bot (`ghepLuatCongKhai`) áp lại đúng các luật này với ảnh chụp hiện tại (ảnh chụp có thể đổi SAU khi
// luật được lưu) — đích vi phạm bị bỏ và nêu trong `canh_bao`; bot vẫn tự rào lần nữa.
import { createHash } from 'node:crypto';
import { CHUC_NANG_NHOM, laChucNang } from './bot-quyen-luat.js';
import { jsonChuan } from './bot-quyen-cong-khai.js';

export const CHE_DO = ['tat', 'bong', 'bat'] as const;
export type CheDo = (typeof CHE_DO)[number];

export const KIEU_COMPOSER = ['khoa', 'ban_sao', 'thuan'] as const;
export type KieuComposer = (typeof KIEU_COMPOSER)[number];

export const KIEU_DICH = ['chuc_nang', 'nv', 'nguoi_gay_ra'] as const;
export type KieuDich = (typeof KIEU_DICH)[number];

export interface Dich {
  kieu: KieuDich;
  /** chuc_nang: một CHUC_NANG_NHOM · nv: zalo_uid của BotNhanVien · nguoi_gay_ra: null. */
  gia_tri: string | null;
}

export interface ComposerAnh {
  id: string;
  ten: string | null;
  pha: string | null;
  kieu: KieuComposer;
  dich_goc: string | null;
  nhay_cam: string[];
  mo_ta_khi_nao: string | null;
  vi_du: string | null;
}

export interface AnhChup {
  phien_ban: string;
  composer: ComposerAnh[];
  dem: Array<Record<string, string | number | null>>;
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
  dem: 5000,
  dich: 20,
  jsonNho: 4096,
  gomGiay: 86_400,
  nhayCam: 20,
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

/** Kiểm + chuẩn hoá ảnh chụp bot gửi. Chỉ giữ trường đã biết (không lưu nội dung tin). */
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
    return {
      id: c.id,
      ten: chuTuyChon(c.ten, 'ten', 200),
      pha: chuTuyChon(c.pha, 'pha', 64),
      kieu: c.kieu as KieuComposer,
      dich_goc: chuTuyChon(c.dich_goc, 'dich_goc', 64),
      nhay_cam: [...new Set(nc as string[])].sort(),
      mo_ta_khi_nao: chuTuyChon(c.mo_ta_khi_nao, 'mo_ta_khi_nao', 2000),
      vi_du: chuTuyChon(c.vi_du, 'vi_du', 2000),
    };
  });
  const demVao = body.dem ?? [];
  if (!Array.isArray(demVao) || demVao.length > TRAN.dem) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem phải là mảng ≤ ${TRAN.dem}`);
  const dem = demVao.map((d, i) => {
    if (!laObj(d)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}] phải là object`);
    const khoa = Object.keys(d);
    if (khoa.length > 12) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}] quá nhiều trường`);
    const ra: Record<string, string | number | null> = {};
    for (const k of khoa) {
      if (!RE_NHAN.test(k)) throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}]: tên trường ${k.slice(0, 40)} không hợp lệ`);
      const v = d[k];
      if (v === null) ra[k] = null;
      else if (typeof v === 'string' && v.length <= 128) ra[k] = v;
      else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) ra[k] = v;
      else throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].${k}: chỉ nhận chuỗi ≤ 128, số nguyên ≥ 0 hoặc null`);
    }
    if (typeof ra.so !== 'number') throw sai('ANH_CHUP_KHONG_HOP_LE', `dem[${i}].so (số nguyên ≥ 0) bắt buộc`);
    return ra;
  });
  return { phien_ban: pb.trim(), composer, dem };
}

/** Danh mục composer từ cột jsonb đã lưu (đã qua `docAnhChup` lúc lưu). */
export function danhMucTuAnh(composer: unknown): Map<string, ComposerAnh> {
  const m = new Map<string, ComposerAnh>();
  if (!Array.isArray(composer)) return m;
  for (const c of composer) if (laObj(c) && typeof c.id === 'string') m.set(c.id, c as unknown as ComposerAnh);
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
  if (!c) throw sai('COMPOSER_LA', `Không có loại tin "${loai}" trong danh mục bot gửi lên`);
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
 * Dòng DB → payload bot. Áp lại luật cứng với ảnh chụp HIỆN TẠI: `nhom_goc` (SQL tay) / nhóm khách + nhạy cảm ⇒ bỏ đích;
 * composer khoá ⇒ bỏ cả luật. Composer không còn trong danh mục: giữ (bot tự bỏ loại nó không biết). Không có ảnh chụp ⇒
 * chỉ bỏ `nhom_goc`.
 */
export function ghepLuatCongKhai(
  rows: ReadonlyArray<{
    loai: string; dich: unknown; cheDo: string; dieuKien: unknown; gomGiay: number; lich: unknown; phienBan: number;
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
    for (const d of Array.isArray(r.dich) ? r.dich : []) {
      if (!laObj(d) || d.kieu === 'nhom_goc' || !(KIEU_DICH as readonly string[]).includes(String(d.kieu))) {
        canh_bao.push(`${r.loai}: bỏ đích không hợp lệ ${JSON.stringify(d).slice(0, 80)}`);
        continue;
      }
      const dd: Dich = { kieu: d.kieu as KieuDich, gia_tri: typeof d.gia_tri === 'string' ? d.gia_tri : null };
      const ly = c ? lyDoCam(c, dd) : null;
      if (ly) {
        canh_bao.push(`${r.loai}: bỏ đích ${dd.kieu}:${dd.gia_tri ?? ''} — ${ly}`);
        continue;
      }
      dich.push(dd);
    }
    luat.push({
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
