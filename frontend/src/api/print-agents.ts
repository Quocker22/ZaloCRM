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
//   GET    /may-in-agents/nhat-ky-app         -> { items: NhatKyApp[], tiepTheo } (CHỈ owner/admin)
//   GET    /may-in-agents/nhat-ky-app/tai-ve  -> text/plain đính kèm (CHỈ owner/admin)
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

/**
 * Một dòng NHẬT KÝ APP (print_app_logs) — nguyên văn một dòng app Windows ghi vào file .txt
 * ở chi nhánh. `luc` là giờ của APP (máy tính shop), ISO. Không có token máy in.
 */
export interface NhatKyApp {
  id: string;
  luc: string;
  mayInId: string | null;
  mayInTen: string | null;
  /** Mã sự kiện app: vet_in, usb_doc, ket_qua, su_co, … — nhãn ở may-in-nhan.ts MA_SU_KIEN_APP. */
  suKien: string;
  noiDung: string;
  phienBan: string | null;
}

/** Tham số lọc nhật ký app. Trường rỗng/undefined không gửi đi. */
export interface ThamSoNhatKyApp {
  /** Chữ tự do; mọi từ phải có (AND), khớp không dấu. */
  q?: string;
  mayInId?: string;
  /** Mã sự kiện, nhiều mã cách nhau dấu phẩy — khớp nguyên mã. */
  suKien?: string;
  /** ISO. Thiếu cả hai thì backend lấy 24 giờ gần nhất. */
  tu?: string;
  den?: string;
  /** Trang CŨ hơn (con trỏ `tiepTheo` của trang trước). */
  truoc?: string;
  /** Dòng MỚI hơn con trỏ (tự làm mới) — trả cũ nhất trước. */
  sau?: string;
  /** Mặc định 200, tối đa 500. */
  gioiHan?: number;
}

export interface TrangNhatKyApp {
  items: NhatKyApp[];
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
/** Tham số → query string: bỏ trường rỗng/undefined, mọi giá trị thành chuỗi. */
function thanhParams(thamSo: object): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [khoa, giaTri] of Object.entries(thamSo)) {
    if (giaTri === undefined || giaTri === null || giaTri === '') continue;
    params[khoa] = String(giaTri);
  }
  return params;
}

export async function layNhatKy(
  thamSo: ThamSoNhatKy = {},
  tuyChon: { signal?: AbortSignal; ngam?: boolean } = {},
): Promise<TrangNhatKy> {
  const params = thanhParams(thamSo);
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

/**
 * Một trang nhật ký APP máy in. Mặc định mới nhất trước, "Tải thêm" = `truoc: tiepTheo`;
 * tự làm mới = `sau: <con trỏ>` (trả dòng mới hơn, CŨ nhất trước). 403 không toast toàn cục
 * (thẻ tự hiện câu báo quyền); `ngam` = lượt tự làm mới, 5xx không toast.
 */
export async function layNhatKyApp(
  thamSo: ThamSoNhatKyApp = {},
  tuyChon: { signal?: AbortSignal; ngam?: boolean } = {},
): Promise<TrangNhatKyApp> {
  const { data } = await api.get('/may-in-agents/nhat-ky-app', {
    params: thanhParams(thamSo),
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: tuyChon.ngam === true,
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    tiepTheo: typeof data?.tiepTheo === 'string' && data.tiepTheo ? data.tiepTheo : null,
  };
}

/** Tên file trong Content-Disposition (`filename*=UTF-8''…` hoặc `filename="…"`); không có → null. */
export function tenFileTuHeader(cd: unknown): string | null {
  if (typeof cd !== 'string') return null;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      // rơi xuống dạng thường
    }
  }
  const thuong = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return thuong ? thuong[1].trim() : null;
}

/**
 * Tải nhật ký app về dạng .txt (cùng bộ lọc, không con trỏ; cũ nhất trước, tối đa 200k dòng).
 * Trả Blob + tên file máy chủ đặt — người gọi tự tạo link tải. Chờ tới 2 phút: file lớn.
 * Lỗi: `response.data` là Blob (không đọc được `.error`) — người gọi xét mã HTTP.
 */
export async function taiVeNhatKyApp(
  thamSo: ThamSoNhatKyApp = {},
  tuyChon: { signal?: AbortSignal } = {},
): Promise<{ duLieu: Blob; tenFile: string }> {
  const loc = { q: thamSo.q, mayInId: thamSo.mayInId, suKien: thamSo.suKien, tu: thamSo.tu, den: thamSo.den };
  const res = await api.get('/may-in-agents/nhat-ky-app/tai-ve', {
    params: thanhParams(loc),
    responseType: 'blob',
    timeout: 120_000,
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: true,
  });
  const duLieu = res.data instanceof Blob ? res.data : new Blob([res.data ?? ''], { type: 'text/plain;charset=utf-8' });
  return { duLieu, tenFile: tenFileTuHeader(res.headers?.['content-disposition']) ?? 'nhat-ky-may-in.txt' };
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
