// SPDX-License-Identifier: AGPL-3.0-or-later
// print-agents.ts — API client trang setup máy in nhiều chi nhánh (Task 7).
//
// Khớp response backend print-agent-routes.ts (Task 6, mount /may-in-agents):
//   GET    /may-in-agents           -> { mayIn: MayIn[] }
//   GET    /may-in-agents/khos      -> { khos: Kho[] }
//   POST   /may-in-agents           -> { mayIn, token, serverUrl } (token đầy đủ CHỈ LẦN NÀY)
//   PUT    /may-in-agents/:id       -> { mayIn }
//   DELETE /may-in-agents/:id       -> { ok: true }
//   GET    /may-in-agents/nhat-ky   -> { items: NhatKy[], tiepTheo } (CHỈ owner/admin, 403 CHI_ADMIN)
//
// Nhật ký + tình trạng máy in: hợp đồng "báo sự cố máy in + nhật ký máy in" v2 (24/09/2026)
// §3.4 (`tinhTrang` trong danh sách) và §3.5 (API nhật ký). Mã → nhãn: views/settings/may-in-nhan.ts.
import { api } from '@/api/index';

export interface MayIn {
  id: string;
  ten: string;
  warehouseIds: number[];
  laMacDinh: boolean;
  tokenDuoi: string;
  online: boolean;
  /** §3.4 — sự cố/trạng thái hiện tại do app báo; null khi chưa biết hoặc app offline.
   *  Tuỳ chọn: backend cũ không trả trường này. */
  tinhTrang?: TinhTrang | null;
}

/** §3.4 — `ma` là mã §1 (vd `het_giay`), `nhan` backend dịch sẵn, `luc` ISO-8601. */
export interface TinhTrang {
  ma: string;
  nhan: string;
  luc: string;
}

/** Mức của một dòng nhật ký (§3.2 `muc_do`). */
export type MucDoNhatKy = 'loi' | 'canh_bao' | 'thong_tin';

/** Bộ lọc mức của API: ba mức trên + `loi_canh_bao` (lỗi HOẶC cảnh báo). */
export type LocMucDo = MucDoNhatKy | 'loi_canh_bao';

/** §3.5 — một dòng nhật ký. Không có token máy in (§0.3): chỉ id + tên máy. */
export interface NhatKy {
  id: string;
  /** ISO-8601 (created_at). */
  luc: string;
  /** Kiểu rộng `string`: backend mới hơn giao diện có thể thêm mức — hiện nguyên chữ, không vỡ. */
  mucDo: MucDoNhatKy | string;
  /** Mã sự kiện §3.3 hoặc mã sự cố §1. */
  loai: string;
  noiDung: string;
  soHoaDon: string | null;
  tenKhach: string | null;
  mayInId: string | null;
  mayInTen: string | null;
  printJobId: string | null;
  chiTiet: unknown;
}

/** §3.5 — tham số lọc. Trường rỗng/undefined không gửi đi. */
export interface ThamSoNhatKy {
  /** Chữ tự do; mọi từ phải có (AND), khớp không dấu. */
  q?: string;
  mayInId?: string;
  mucDo?: LocMucDo;
  loai?: string;
  /** ISO. Thiếu cả hai thì backend lấy 7 ngày gần nhất. */
  tu?: string;
  den?: string;
  /** Con trỏ `tiepTheo` của trang trước. */
  truoc?: string;
  /** Mặc định 50, tối đa 200. */
  gioiHan?: number;
}

export interface TrangNhatKy {
  items: NhatKy[];
  tiepTheo: string | null;
}

export interface Kho {
  id: number;
  ma: string;
  ten: string;
}

export interface TaoMayInPayload {
  ten: string;
  warehouseIds: number[];
  laMacDinh?: boolean;
}

export interface TaoMayInKetQua {
  mayIn: MayIn;
  token: string;
  serverUrl: string;
}

/** `ngam`: lượt tự làm mới — lỗi 5xx không toast chung (xem boQuaToast5xx). */
export async function layDanhSach(tuyChon: { ngam?: boolean } = {}): Promise<MayIn[]> {
  const { data } = await api.get('/may-in-agents', { boQuaToast5xx: tuyChon.ngam === true });
  return data?.mayIn ?? [];
}

export async function layKhos(): Promise<Kho[]> {
  const { data } = await api.get('/may-in-agents/khos');
  return data?.khos ?? [];
}

export async function tao(payload: TaoMayInPayload): Promise<TaoMayInKetQua> {
  const { data } = await api.post('/may-in-agents', payload);
  return data;
}

export async function sua(id: string, payload: TaoMayInPayload): Promise<MayIn> {
  const { data } = await api.put(`/may-in-agents/${id}`, payload);
  return data?.mayIn;
}

export async function xoa(id: string): Promise<void> {
  await api.delete(`/may-in-agents/${id}`);
}

/**
 * §3.5 — một trang nhật ký máy in (mới nhất trước). Tải thêm: gọi lại với `truoc = tiepTheo`.
 * `signal` để huỷ yêu cầu cũ khi bộ lọc đổi. 403 KHÔNG bật toast toàn cục (`boQuaToast403`):
 * người gọi tự ẩn mục nhật ký — người không phải admin không thấy lỗi đỏ.
 */
export async function layNhatKy(
  thamSo: ThamSoNhatKy = {},
  tuyChon: { signal?: AbortSignal; ngam?: boolean } = {},
): Promise<TrangNhatKy> {
  const params: Record<string, string> = {};
  for (const [khoa, giaTri] of Object.entries(thamSo)) {
    if (giaTri === undefined || giaTri === null || giaTri === '') continue;
    params[khoa] = String(giaTri);
  }
  const { data } = await api.get('/may-in-agents/nhat-ky', {
    params,
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: tuyChon.ngam === true,
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    tiepTheo: typeof data?.tiepTheo === 'string' && data.tiepTheo ? data.tiepTheo : null,
  };
}

/** Mã HTTP của lỗi axios (không có phản hồi — mất mạng, bị huỷ — thì undefined). */
export function maHttpCuaLoi(e: unknown): number | undefined {
  return (e as { response?: { status?: number } } | null)?.response?.status;
}

/** Lỗi do chính ta huỷ yêu cầu (AbortController) — không phải lỗi để hiện. */
export function laYeuCauDaHuy(e: unknown): boolean {
  const loi = e as { code?: string; name?: string } | null;
  return loi?.code === 'ERR_CANCELED' || loi?.name === 'CanceledError' || loi?.name === 'AbortError';
}
