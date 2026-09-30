// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen.ts — API client trang Cài đặt › Hệ thống › "Quyền bot" (docs/77 §3.2–3.3).
//
// Khớp backend `backend/src/modules/bot-quyen/bot-quyen-routes.ts` (mount /bot-quyen, JWT, CHỈ owner/admin
// ở MỌI route — người khác nhận 403 CHI_ADMIN):
//   GET    /bot-quyen/nhom                         ?zaloAccountId=  -> { nhom: NhomView[] }
//   GET    /bot-quyen/nhom/:conversationId/thanh-vien ?lamMoi=1   -> ThanhVienNhom
//   PUT    /bot-quyen/nhom/:conversationId         {chucNang, tenDangKy?, ghiChu?, lyDo?} -> { botNhom, doi }
//   DELETE /bot-quyen/nhom/:conversationId         body {lyDo?}  -> { doi }
//   GET    /bot-quyen/nhan-vien                    -> { nhanVien: NhanVien[] }
//   POST   /bot-quyen/nhan-vien                    {zaloUid, tenGoi, vai, trangThai?, userId?, ghiChu?, lyDo?} -> 201 { nhanVien }
//   PUT    /bot-quyen/nhan-vien/:id                {tenGoi?, vai?, trangThai?, userId?, ghiChu?, lyDo?} -> { nhanVien, doi }
//   GET    /bot-quyen/nhat-ky                      ?limit= (mặc định 100, tối đa 500) -> { nhatKy: NhatKy[] } (mới nhất trước)
// Lỗi: { error: <câu tiếng Việt>, code: <MÃ> } — trang hiện nguyên `error` (bot-quyen-loi.ts).
//
// Mọi lời gọi đặt `boQuaToast403`: trang tự báo 403 bằng đúng câu backend (một lần), không để
// interceptor chung toast thêm. Danh sách tài khoản CRM lấy từ GET /users — cùng API trang
// "Nhân viên sai bot" (AgentOperatorsPage) đang dùng.
import { api } from '@/api/index';

export type ChucNangNhom = 'admin' | 'sales' | 'kho' | 'ke_toan' | 'khach';
export type VaiNhanVien = 'admin' | 'sales' | 'kho' | 'ke_toan' | 'cong_ty';
export type TrangThaiNhanVien = 'hoat_dong' | 'khoa' | 'nghi';

export interface NickNhom {
  id: string;
  displayName: string | null;
  zaloUid: string | null;
  status: string;
}

export interface NhomView {
  conversationId: string;
  externalThreadId: string | null;
  /** Tên nhóm trên Zalo (Conversation.groupName). */
  tenNhom: string | null;
  soThanhVien: number | null;
  lastMessageAt: string | null;
  /** Hội thoại đã xoá mềm hoặc nick đã lưu trữ — mặc định ẩn khỏi bảng. */
  daAn: boolean;
  nick: NickNhom;
  /** null = chưa xếp loại ⇒ bot im. */
  chucNang: ChucNangNhom | null;
  /** null khi chưa xếp loại. */
  tenDangKy: string | null;
  ghiChu: string | null;
  capNhatLuc: string | null;
  capNhatBoi: { id: string; fullName: string } | null;
}

export interface ThanhVien {
  zaloUid: string;
  ten: string;
  /** nick_crm = CHỈ nick của chính hội thoại này. */
  loai: 'nhan_vien' | 'nick_crm' | 'nguoi_ngoai';
  /** uid là một nick CRM bất kỳ của org (kể cả nick của nhóm). */
  laNickCrm: boolean;
  nhanVien: { id: string; tenGoi: string; vai: string; trangThai: string } | null;
}

export interface ThanhVienNhom {
  conversationId: string;
  nguon: 'da_quet' | 'zalo' | 'tin_nhan';
  /** da_quet: lúc quét · zalo: lúc đọc · tin_nhan: null. */
  nguonLuc: string | null;
  /** Vì sao không đọc được Zalo (khi nguon = tin_nhan). */
  loiZalo: string | null;
  thanhVien: ThanhVien[];
  soNguoiNgoai: number;
}

export interface NhanVien {
  id: string;
  zaloUid: string;
  tenGoi: string;
  vai: VaiNhanVien;
  trangThai: TrangThaiNhanVien;
  userId: string | null;
  user: { id: string; fullName: string } | null;
  ghiChu: string | null;
  capNhatLuc: string;
  capNhatBoi: { id: string; fullName: string } | null;
}

export interface NhatKy {
  id: string;
  luc: string;
  aiId: string;
  ai: { id: string; fullName: string } | null;
  doiTuong: 'nhom' | 'nhan_vien' | string;
  doiTuongId: string;
  tenDoiTuong: string | null;
  /** null = vừa tạo. nhom: {chucNang, tenDangKy, ghiChu} · nhan_vien: {zaloUid, tenGoi, vai, trangThai, userId, ghiChu}. */
  truoc: Record<string, unknown> | null;
  /** null = bỏ xếp loại. */
  sau: Record<string, unknown> | null;
  lyDo: string | null;
}

export interface NguoiDungCrm {
  id: string;
  fullName: string;
}

export interface LuuNhomPayload {
  chucNang: ChucNangNhom;
  tenDangKy?: string;
  ghiChu?: string | null;
  lyDo?: string;
}

export interface TaoNhanVienPayload {
  zaloUid: string;
  tenGoi: string;
  vai: VaiNhanVien;
  trangThai?: TrangThaiNhanVien;
  userId?: string;
  ghiChu?: string;
  lyDo?: string;
}

export interface SuaNhanVienPayload {
  tenGoi?: string;
  vai?: VaiNhanVien;
  trangThai?: TrangThaiNhanVien;
  /** null = bỏ liên kết. */
  userId?: string | null;
  /** null = xoá ghi chú. */
  ghiChu?: string | null;
  lyDo?: string;
}

const CAU_HINH = { boQuaToast403: true } as const;

export async function layDanhSachNhom(): Promise<NhomView[]> {
  const { data } = await api.get('/bot-quyen/nhom', CAU_HINH);
  return data?.nhom ?? [];
}

export async function layThanhVienNhom(conversationId: string, tuy: { lamMoi?: boolean } = {}): Promise<ThanhVienNhom> {
  const { data } = await api.get(`/bot-quyen/nhom/${encodeURIComponent(conversationId)}/thanh-vien`, {
    ...CAU_HINH,
    params: tuy.lamMoi ? { lamMoi: '1' } : undefined,
  });
  return data;
}

export async function luuChucNangNhom(conversationId: string, payload: LuuNhomPayload): Promise<{ doi: boolean }> {
  const { data } = await api.put(`/bot-quyen/nhom/${encodeURIComponent(conversationId)}`, payload, CAU_HINH);
  return { doi: data?.doi !== false };
}

export async function boXepLoaiNhom(conversationId: string, lyDo?: string): Promise<{ doi: boolean }> {
  const { data } = await api.delete(`/bot-quyen/nhom/${encodeURIComponent(conversationId)}`, {
    ...CAU_HINH,
    data: lyDo ? { lyDo } : {},
  });
  return { doi: data?.doi !== false };
}

export async function layDanhSachNhanVien(): Promise<NhanVien[]> {
  const { data } = await api.get('/bot-quyen/nhan-vien', CAU_HINH);
  return data?.nhanVien ?? [];
}

export async function themNhanVien(payload: TaoNhanVienPayload): Promise<NhanVien> {
  const { data } = await api.post('/bot-quyen/nhan-vien', payload, CAU_HINH);
  return data?.nhanVien;
}

export async function suaNhanVien(id: string, payload: SuaNhanVienPayload): Promise<{ nhanVien: NhanVien; doi: boolean }> {
  const { data } = await api.put(`/bot-quyen/nhan-vien/${encodeURIComponent(id)}`, payload, CAU_HINH);
  return { nhanVien: data?.nhanVien, doi: data?.doi !== false };
}

export async function layNhatKy(limit = 200): Promise<NhatKy[]> {
  const { data } = await api.get('/bot-quyen/nhat-ky', { ...CAU_HINH, params: { limit } });
  return data?.nhatKy ?? [];
}

/** Tài khoản CRM của org — cùng GET /users mà trang "Nhân viên sai bot" dùng. */
export async function layNguoiDungCrm(): Promise<NguoiDungCrm[]> {
  const { data } = await api.get('/users', CAU_HINH);
  const ds: Array<{ id: string; fullName?: string; name?: string }> = data?.users ?? data ?? [];
  return ds.map((u) => ({ id: u.id, fullName: u.fullName ?? u.name ?? u.id }));
}
