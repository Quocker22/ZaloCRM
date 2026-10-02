// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-cho-khach.ts — API client tab "Cho khách" của trang Quyền bot (docs/79 T5).
//
// Khớp backend `backend/src/modules/bot-quyen/bot-cho-khach-routes.ts` (mount /bot-quyen, JWT, CHỈ owner/admin):
//   GET  /bot-quyen/cho-khach/tai-lieu           -> { kho, taiLieu: TaiLieuChoKhach[], duyetNgoaiDanhMuc: string[] }  (kho tri thức CRM)
//   GET  /bot-quyen/cho-khach/tai-lieu/:id/toan-van -> { id, tieuDe, nguon, noiDungBam, doan: string[], dauHieuNoiBo }
//   POST /bot-quyen/cho-khach/tai-lieu/duyet     {taiLieu: [{id, noiDungBam}], lyDo?} -> { doi }  (409 TAI_LIEU_DA_DOI)
//   POST /bot-quyen/cho-khach/tai-lieu/bo-duyet  {ids, lyDo?} -> { doi }
//   GET  /bot-quyen/cho-khach/mo-ta              ?loc=co_mo_ta|da_duyet|doi_sau_duyet|tat_ca -> { danhMuc, sanPham, dem }
//   POST /bot-quyen/cho-khach/mo-ta/duyet        {sanPham: [{productId, moTaBam}], lyDo?} -> { doi }  (409 MO_TA_DA_DOI)
//   POST /bot-quyen/cho-khach/mo-ta/bo-duyet     {productIds, lyDo?} -> { doi }
// Lỗi: { error, code } — hiện nguyên `error` (bot-quyen-loi.ts).
import { api } from '@/api/index';

export interface DanhMucMoc {
  phienBan: string;
  luc: string;
}

export interface NguoiDuyet {
  id: string;
  fullName: string;
}

/** khong_noi_dung = tài liệu rỗng (không duyệt được); doi_sau_duyet = nội dung khác lúc duyệt (bot thôi dùng). */
export type TrangThaiTaiLieu = 'khong_noi_dung' | 'chua_duyet' | 'da_duyet' | 'doi_sau_duyet';

export interface TaiLieuChoKhach {
  id: string;
  tieuDe: string;
  loai: string | null;
  nguon: string | null;
  soDoan: number;
  capNhatLuc: string | null;
  /** ≤ 300 ký tự đầu — để người duyệt nhìn. */
  mauNoiDung: string | null;
  /** Lý do "có vẻ nội bộ" CRM xét trên TOÀN VĂN (vắng ở backend cũ ⇒ frontend tự xét tiêu đề + mẫu). */
  dauHieuNoiBo?: string[];
  /** sha256 nội dung đầy đủ CRM tính từ kho tri thức (hợp đồng §3b); null = rỗng. Duyệt gửi ĐÚNG băm này. */
  noiDungBam: string | null;
  trangThai: TrangThaiTaiLieu;
  noiDungBamDaDuyet: string | null;
  /** = trangThai 'da_duyet'. */
  choKhach: boolean;
  duyetBoi: NguoiDuyet | null;
  duyetLuc: string | null;
}

export interface KhoMoc {
  soTaiLieu: number;
  luc: string;
}

export interface DsTaiLieuChoKhach {
  /** Kho tri thức CRM (null = chưa tải / backend cũ). */
  kho: KhoMoc | null;
  taiLieu: TaiLieuChoKhach[];
  /** Đã duyệt nhưng không còn trong kho tri thức (bot không dùng nữa) — có thể bỏ duyệt. */
  duyetNgoaiDanhMuc: string[];
}

export interface ToanVanTaiLieu {
  id: string;
  tieuDe: string;
  nguon: string;
  noiDungBam: string | null;
  doan: string[];
  dauHieuNoiBo: string[];
}

export type TrangThaiMoTa = 'khong_mo_ta' | 'chua_duyet' | 'da_duyet' | 'doi_sau_duyet';
export type LocMoTa = 'co_mo_ta' | 'da_duyet' | 'doi_sau_duyet' | 'tat_ca';

export interface MoTaSanPham {
  productId: number;
  ma: string | null;
  ten: string;
  moTaBan: string | null;
  moTaBam: string | null;
  trangThai: TrangThaiMoTa;
  moTaBamDaDuyet: string | null;
  duyetBoi: NguoiDuyet | null;
  duyetLuc: string | null;
}

export interface DemMoTa {
  coMoTa: number;
  daDuyet: number;
  doiSauDuyet: number;
  chuaDuyet: number;
  tong: number;
}

export interface DsMoTa {
  danhMuc: DanhMucMoc | null;
  sanPham: MoTaSanPham[];
  dem: DemMoTa;
}

const CAU_HINH = { boQuaToast403: true } as const;

export async function layTaiLieuChoKhach(): Promise<DsTaiLieuChoKhach> {
  const { data } = await api.get('/bot-quyen/cho-khach/tai-lieu', CAU_HINH);
  return { kho: data?.kho ?? null, taiLieu: data?.taiLieu ?? [], duyetNgoaiDanhMuc: data?.duyetNgoaiDanhMuc ?? [] };
}

export async function layToanVanTaiLieu(id: string): Promise<ToanVanTaiLieu> {
  const { data } = await api.get(`/bot-quyen/cho-khach/tai-lieu/${encodeURIComponent(id)}/toan-van`, CAU_HINH);
  return {
    id: data?.id ?? id, tieuDe: data?.tieuDe ?? '', nguon: data?.nguon ?? '', noiDungBam: data?.noiDungBam ?? null,
    doan: Array.isArray(data?.doan) ? data.doan : [], dauHieuNoiBo: Array.isArray(data?.dauHieuNoiBo) ? data.dauHieuNoiBo : [],
  };
}

export async function duyetTaiLieuChoKhach(taiLieu: Array<{ id: string; noiDungBam: string }>, lyDo?: string): Promise<{ doi: number }> {
  const { data } = await api.post('/bot-quyen/cho-khach/tai-lieu/duyet', { taiLieu, ...(lyDo ? { lyDo } : {}) }, CAU_HINH);
  return { doi: Number(data?.doi ?? 0) };
}

export async function boDuyetTaiLieuChoKhach(ids: string[], lyDo?: string): Promise<{ doi: number }> {
  const { data } = await api.post('/bot-quyen/cho-khach/tai-lieu/bo-duyet', { ids, ...(lyDo ? { lyDo } : {}) }, CAU_HINH);
  return { doi: Number(data?.doi ?? 0) };
}

export async function layMoTaChoKhach(loc: LocMoTa = 'co_mo_ta'): Promise<DsMoTa> {
  const { data } = await api.get('/bot-quyen/cho-khach/mo-ta', { ...CAU_HINH, params: { loc } });
  return {
    danhMuc: data?.danhMuc ?? null,
    sanPham: data?.sanPham ?? [],
    dem: data?.dem ?? { coMoTa: 0, daDuyet: 0, doiSauDuyet: 0, chuaDuyet: 0, tong: 0 },
  };
}

export async function duyetMoTaChoKhach(sanPham: Array<{ productId: number; moTaBam: string }>, lyDo?: string): Promise<{ doi: number }> {
  const { data } = await api.post('/bot-quyen/cho-khach/mo-ta/duyet', { sanPham, ...(lyDo ? { lyDo } : {}) }, CAU_HINH);
  return { doi: Number(data?.doi ?? 0) };
}

export async function boDuyetMoTaChoKhach(productIds: number[], lyDo?: string): Promise<{ doi: number }> {
  const { data } = await api.post('/bot-quyen/cho-khach/mo-ta/bo-duyet', { productIds, ...(lyDo ? { lyDo } : {}) }, CAU_HINH);
  return { doi: Number(data?.doi ?? 0) };
}
