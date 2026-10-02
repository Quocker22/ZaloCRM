// SPDX-License-Identifier: AGPL-3.0-or-later
// CHO KHÁCH (docs/79 T5) — hàm THUẦN của hợp đồng bot ↔ CRM (docs/may-in/HOP-DONG-CHO-KHACH.md):
//   • chuanMoTa / bamMoTa: chuẩn hoá `description_sale` rồi sha256 — duyệt mô tả gắn với ĐÚNG băm này (K2: sửa mô tả sau khi
//     duyệt ⇒ băm khác ⇒ duyệt không còn hiệu lực). Bot và CRM PHẢI chuẩn hoá giống hệt — CRM tự tính lại băm của mọi SP bot gửi
//     và từ chối danh mục khi lệch (400 MO_TA_BAM_LECH), nên cách chuẩn hoá lệch lộ ra ngay ở lần đẩy đầu, không âm thầm.
//   • docDanhMuc: kiểm hình danh mục bot đẩy (POST /api/public/cho-khach/danh-muc) — sai ở BẤT KỲ đâu ⇒ 400, giữ bản cũ.
//   • dungDuyetCongKhai: payload GET /api/public/cho-khach/duyet (sắp tất định, phien_ban = sha256 JSON chuẩn).
import { createHash } from 'node:crypto';
import { jsonChuan } from './bot-quyen-cong-khai.js';

export class LoiChoKhach extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** Mẫu nội dung tài liệu (để người duyệt nhìn) — CRM cắt còn chừng này ký tự. */
export const CAT_MAU_NOI_DUNG = 300;
export const TOI_DA_TAI_LIEU = 5000;
export const TOI_DA_SAN_PHAM = 20000;
const TOI_DA_MO_TA = 20000;
const DANG_ID_TAI_LIEU = /^[A-Za-z0-9_-]{1,64}$/;
export const DANG_BAM = /^[0-9a-f]{64}$/;

/**
 * Khoảng trắng của hợp đồng — liệt kê TƯỜNG MINH (không dùng `\s` / `trim()`: JS và Python khác nhau ở vài ký tự hiếm).
 * Bot dùng đúng lớp này (hợp đồng §3).
 */
const RE_KHOANG_TRANG = /[\t\v\f \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

/**
 * Chuẩn hoá mô tả trước khi băm: NFC → CRLF/CR thành LF → mỗi dòng gộp mọi khoảng trắng (lớp RE_KHOANG_TRANG) thành MỘT
 * dấu cách rồi bỏ dấu cách hai đầu → bỏ dòng rỗng → nối bằng LF. Rỗng ⇒ '' (SP không có mô tả).
 */
export function chuanMoTa(s: string | null | undefined): string {
  if (typeof s !== 'string') return '';
  return s.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
    .map((d) => d.replace(RE_KHOANG_TRANG, ' ').replace(/^ | $/g, ''))
    .filter((d) => d.length > 0)
    .join('\n');
}

/** sha256 (hex thường) của UTF-8 `chuanMoTa(s)`; null khi không có mô tả. */
export function bamMoTa(s: string | null | undefined): string | null {
  const c = chuanMoTa(s);
  return c ? createHash('sha256').update(c, 'utf8').digest('hex') : null;
}

export interface TaiLieuDanhMuc {
  id: string;
  tieu_de: string;
  loai: string | null;
  nguon: string | null;
  so_doan: number;
  cap_nhat_luc: string | null;
  mau_noi_dung: string | null;
}

export interface SanPhamDanhMuc {
  product_id: number;
  ma: string | null;
  ten: string;
  mo_ta_ban: string | null;
  mo_ta_bam: string | null;
}

export interface DanhMucChoKhach {
  phien_ban: string;
  tai_lieu: TaiLieuDanhMuc[];
  san_pham: SanPhamDanhMuc[];
}

function sai(msg: string): never {
  throw new LoiChoKhach(400, 'DANH_MUC_KHONG_HOP_LE', msg);
}

function laObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function chuoiTuyChon(x: unknown, ten: string, toiDa: number): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string') sai(`${ten} phải là chuỗi hoặc null`);
  const t = x.trim();
  if (t.length > toiDa) sai(`${ten} dài quá ${toiDa} ký tự`);
  return t || null;
}

function chuoiBatBuoc(x: unknown, ten: string, toiDa: number): string {
  const t = chuoiTuyChon(x, ten, toiDa);
  if (!t) sai(`${ten} bắt buộc`);
  return t;
}

function catKyTu(s: string, n: number): string {
  const a = Array.from(s);
  return a.length > n ? a.slice(0, n).join('') : s;
}

function docTaiLieu(x: unknown, i: number): TaiLieuDanhMuc {
  if (!laObj(x)) sai(`tai_lieu[${i}] phải là object`);
  if (typeof x.id !== 'string' || !DANG_ID_TAI_LIEU.test(x.id)) sai(`tai_lieu[${i}].id phải khớp [A-Za-z0-9_-]{1,64}`);
  const soDoan = x.so_doan;
  if (typeof soDoan !== 'number' || !Number.isInteger(soDoan) || soDoan < 0 || soDoan > 1_000_000) {
    sai(`tai_lieu[${i}].so_doan phải là số nguyên ≥ 0`);
  }
  let capNhat: string | null = null;
  if (x.cap_nhat_luc !== undefined && x.cap_nhat_luc !== null) {
    if (typeof x.cap_nhat_luc !== 'string' || Number.isNaN(Date.parse(x.cap_nhat_luc))) {
      sai(`tai_lieu[${i}].cap_nhat_luc phải là ngày ISO 8601 hoặc null`);
    }
    capNhat = new Date(x.cap_nhat_luc).toISOString();
  }
  let mau: string | null = null;
  if (x.mau_noi_dung !== undefined && x.mau_noi_dung !== null) {
    if (typeof x.mau_noi_dung !== 'string') sai(`tai_lieu[${i}].mau_noi_dung phải là chuỗi hoặc null`);
    mau = catKyTu(x.mau_noi_dung.trim(), CAT_MAU_NOI_DUNG) || null;
  }
  return {
    id: x.id,
    tieu_de: chuoiBatBuoc(x.tieu_de, `tai_lieu[${i}].tieu_de`, 500),
    loai: chuoiTuyChon(x.loai, `tai_lieu[${i}].loai`, 64),
    nguon: chuoiTuyChon(x.nguon, `tai_lieu[${i}].nguon`, 64),
    so_doan: soDoan as number,
    cap_nhat_luc: capNhat,
    mau_noi_dung: mau,
  };
}

function docSanPham(x: unknown, i: number): SanPhamDanhMuc {
  if (!laObj(x)) sai(`san_pham[${i}] phải là object`);
  const pid = x.product_id;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1) sai(`san_pham[${i}].product_id phải là số nguyên dương`);
  let moTa: string | null = null;
  if (x.mo_ta_ban !== undefined && x.mo_ta_ban !== null) {
    if (typeof x.mo_ta_ban !== 'string') sai(`san_pham[${i}].mo_ta_ban phải là chuỗi hoặc null`);
    if (x.mo_ta_ban.length > TOI_DA_MO_TA) sai(`san_pham[${i}].mo_ta_ban dài quá ${TOI_DA_MO_TA} ký tự`);
    moTa = x.mo_ta_ban;
  }
  const bamGui = x.mo_ta_bam === undefined ? null : x.mo_ta_bam;
  if (bamGui !== null && (typeof bamGui !== 'string' || !DANG_BAM.test(bamGui))) {
    sai(`san_pham[${i}].mo_ta_bam phải là 64 ký tự hex thường hoặc null`);
  }
  const bam = bamMoTa(moTa);
  if (bam !== bamGui) {
    throw new LoiChoKhach(
      400, 'MO_TA_BAM_LECH',
      `san_pham[${i}] (product_id ${pid}): mo_ta_bam không khớp băm CRM tính từ mo_ta_ban (${bam ?? 'null'}) — xem cách chuẩn hoá ở hợp đồng §3`,
    );
  }
  return {
    product_id: pid as number,
    ma: chuoiTuyChon(x.ma, `san_pham[${i}].ma`, 128),
    ten: chuoiBatBuoc(x.ten, `san_pham[${i}].ten`, 500),
    mo_ta_ban: bam ? moTa : null,
    mo_ta_bam: bam,
  };
}

/** Kiểm + chuẩn hoá danh mục bot đẩy lên. Trường lạ bỏ qua (không lưu). */
export function docDanhMuc(body: unknown): DanhMucChoKhach {
  if (!laObj(body)) sai('Thân phải là object JSON');
  const phienBan = body.phien_ban;
  if (typeof phienBan !== 'string' || phienBan.length < 1 || phienBan.length > 128) sai('phien_ban là chuỗi 1–128 ký tự');
  if (!Array.isArray(body.tai_lieu)) sai('tai_lieu phải là mảng');
  if (!Array.isArray(body.san_pham)) sai('san_pham phải là mảng');
  if (body.tai_lieu.length > TOI_DA_TAI_LIEU) sai(`tai_lieu tối đa ${TOI_DA_TAI_LIEU} phần tử`);
  if (body.san_pham.length > TOI_DA_SAN_PHAM) sai(`san_pham tối đa ${TOI_DA_SAN_PHAM} phần tử`);
  const taiLieu = body.tai_lieu.map(docTaiLieu);
  const sanPham = body.san_pham.map(docSanPham);
  const idTl = new Set<string>();
  for (const t of taiLieu) {
    if (idTl.has(t.id)) sai(`tai_lieu: id "${t.id}" trùng`);
    idTl.add(t.id);
  }
  const idSp = new Set<number>();
  for (const s of sanPham) {
    if (idSp.has(s.product_id)) sai(`san_pham: product_id ${s.product_id} trùng`);
    idSp.add(s.product_id);
  }
  return { phien_ban: phienBan, tai_lieu: taiLieu, san_pham: sanPham };
}

export interface DuyetCongKhai {
  phien_ban: string;
  /** phien_ban của danh mục CRM đang giữ (bot so để biết CRM đã có danh mục mới nhất chưa); null = chưa nhận danh mục nào. */
  danh_muc_phien_ban: string | null;
  tai_lieu_cho_khach: string[];
  mo_ta_da_duyet: Array<{ product_id: number; mo_ta_bam: string }>;
}

/** Payload công khai — sắp tất định để phien_ban chỉ đổi khi nội dung đổi. */
export function dungDuyetCongKhai(
  taiLieu: readonly string[], moTa: ReadonlyArray<{ productId: number; moTaBam: string }>, danhMucPhienBan: string | null,
): DuyetCongKhai {
  const tl = [...new Set(taiLieu)].sort();
  const mt = moTa.map((m) => ({ product_id: m.productId, mo_ta_bam: m.moTaBam })).sort((a, b) => a.product_id - b.product_id);
  const phien_ban = createHash('sha256').update(jsonChuan({ tai_lieu_cho_khach: tl, mo_ta_da_duyet: mt })).digest('hex');
  return { phien_ban, danh_muc_phien_ban: danhMucPhienBan, tai_lieu_cho_khach: tl, mo_ta_da_duyet: mt };
}
