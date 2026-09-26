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
//   GET    /may-in-agents/hang-doi?mayInId=    -> { choIn, chuaXacNhan, capNhat } (CHỈ owner/admin)
//   POST   /may-in-agents/hang-doi/huy         -> { ketQua: KetQuaHuy[] } (CHỈ owner/admin)
//   POST   /may-in-agents/hang-doi/bo-theo-doi -> { ketQua: KetQuaBoTheoDoi[] } (CHỈ owner/admin)
//   GET    /may-in-agents/lich-su?trangThai=da_in|da_huy&mayInId=&truoc=
//                                              -> { items: MucLichSu[], tiepTheo, tong, tu, capNhat } (CHỈ owner/admin)
//   GET    /may-in-agents/lich-su/dem          -> { daIn, daHuy, tu, capNhat } (CHỈ owner/admin)
//
// Hàng đợi in + huỷ lệnh in: hợp đồng docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md mục 8 (v5.1).
// Lịch sử "Đã in" / "Đã huỷ": 30 ngày gần nhất theo lúc in xong / lúc huỷ (backend lich-su-in.ts).
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
  /**
   * CÁCH máy in nối với máy tính (app ≥ 0.2.8, event `thong-tin-app`). null = app offline / app
   * cũ / chưa gửi. Tuỳ chọn: backend cũ không trả các trường này.
   */
  ketNoi?: KetNoiMayIn | null;
  /** "Windows 7 SP1 (6.1.7601)". */
  heDieuHanh?: string | null;
  /** 'win7' | 'thuong' — kiểu rộng: backend mới hơn có thể thêm bản. */
  banBuild?: string | null;
  /** Phiên bản app máy in đang nối, vd "0.2.8". */
  phienBan?: string | null;
}

/**
 * Máy in nối kiểu gì (backend may-in/thong-tin-app.ts — chữ đã làm sạch, mã ngoài danh sách = null).
 * Kiểu rộng `string` cho mã: app/backend mới hơn giao diện có thể thêm loại — hiện như "không rõ".
 */
export interface KetNoiMayIn {
  /** 'usb' | 'wsd' | 'tcpip' | 'ipp' | 'chia_se' | 'khac' */
  loai: string | null;
  /** true với wsd / tcpip / ipp. */
  laMang: boolean | null;
  /** Tên cổng Windows: "USB001", "WSD-3f2a…", "IP_192.168.1.23". */
  cong: string | null;
  ip: string | null;
  /** 'cau_hinh' | 'ten_cong' | 'registry' | 'location' | 'pnpx' */
  nguonIp: string | null;
  /** "sẵn sàng (IPP)", "không trả lời"; null = chưa hỏi. */
  mayTraLoi: string | null;
  /** Câu dựng sẵn, vd "Mạng LAN (WSD) · 192.168.1.23 · máy báo sẵn sàng". */
  moTa: string | null;
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
  /** Mức do máy chủ phân loại (hợp đồng hàng đợi/huỷ v5 §5). Tuỳ chọn: backend cũ không trả. */
  mucDo?: MucDoNhatKy | string;
}

/** Tham số lọc nhật ký app. Trường rỗng/undefined không gửi đi. */
export interface ThamSoNhatKyApp {
  /** Chữ tự do; mọi từ phải có (AND), khớp không dấu. */
  q?: string;
  mayInId?: string;
  /** Mã sự kiện, nhiều mã cách nhau dấu phẩy — khớp nguyên mã. */
  suKien?: string;
  /** Lọc mức (`loi_canh_bao` = lỗi HOẶC cảnh báo). */
  mucDo?: LocMucDo;
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

// ── Hàng đợi in + huỷ lệnh in (v5.1 §8.2, §8.5, §8.6) ─────────────────────────

/** Một lệnh in đang chờ / chưa xác nhận. Không có token máy in — chỉ id + tên máy. */
export interface MucHangDoi {
  id: string;
  soHoaDon: string;
  tenKhach: string | null;
  mayInId: string | null;
  mayInTen: string | null;
  trangThai: 'cho_in' | 'dang_gui' | 'da_gui' | 'khong_ro' | string;
  nhom: 'cho_in' | 'chua_xac_nhan';
  /** Câu cho người đọc, vd "Tạm giữ — máy in Hết giấy (từ 18:45)". */
  lyDo: string;
  /** cho_in + máy in đó đang lỗi (hệ thống giữ, tự in khi máy hết lỗi). */
  tamGiu: boolean;
  lanThu: number;
  /** ISO */
  tao: string;
  capNhat: string;
  /** `chac_chan` = huỷ được chắc chắn (chưa gửi); `khong` = không huỷ được từ xa. */
  huy: 'chac_chan' | 'khong' | string;
}

export interface HangDoiIn {
  /** Đang/sẽ in (cho_in ∪ dang_gui ∪ da_gui), cũ trước. */
  choIn: MucHangDoi[];
  /** Đã gửi xuống máy in nhưng chưa xác nhận đã in (3 ngày gần nhất). */
  chuaXacNhan: MucHangDoi[];
  capNhat: string;
}

// ── Lịch sử in "Đã in" / "Đã huỷ" (30 ngày gần nhất) ─────────────────────────

/** `da_huy` = huỷ CHẮC CHẮN (không in). "Bỏ khỏi hàng đợi" (bo_qua) KHÔNG nằm ở đây. */
export type TrangThaiLichSu = 'da_in' | 'da_huy';

/** Một lệnh in đã in xong / đã huỷ. Không có token máy in — chỉ id + tên máy. */
export interface MucLichSu {
  id: string;
  soHoaDon: string;
  tenKhach: string | null;
  mayInId: string | null;
  mayInTen: string | null;
  trangThai: TrangThaiLichSu | string;
  /** ISO — lúc tạo lệnh in. */
  tao: string;
  /** ISO — lúc in xong (`da_in`) / lúc huỷ (`da_huy`). */
  ketThuc: string;
  /** `da_huy`: "Đã huỷ bởi ZaloCRM (Chị Hoa)"…; `da_in`: thường null. */
  lyDo: string | null;
}

export interface TrangLichSu {
  /** Mới kết thúc trước. */
  items: MucLichSu[];
  /** Con trỏ trang sau; null = hết. */
  tiepTheo: string | null;
  /** Tổng số lệnh khớp bộ lọc trong 30 ngày — chỉ trang đầu; trang sau null. */
  tong: number | null;
  /** ISO — mốc đầu cửa sổ 30 ngày. */
  tu: string | null;
}

/** Số trên hai thẻ "Đã in (N)" / "Đã huỷ (N)" — cả org, 30 ngày. */
export interface DemLichSu {
  daIn: number;
  daHuy: number;
}

export type MaLoiHuy = 'DANG_IN' | 'CHUA_XAC_NHAN' | 'DA_IN' | 'DA_KET_THUC' | 'KHONG_TIM_THAY';

export interface KetQuaHuy {
  id: string;
  soHoaDon: string | null;
  ok: boolean;
  trangThaiMoi: string | null;
  cach?: 'chua_gui' | 'da_huy_truoc' | string;
  loi?: MaLoiHuy | string;
  /** Câu đầy đủ cho người đọc: vì sao + việc cần làm. */
  noiDung: string;
}

export interface KetQuaBoTheoDoi {
  id: string;
  ok: boolean;
  noiDung: string;
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

/**
 * Hàng đợi in của org (mọi máy, hoặc một máy `mayInId`). 403 không toast toàn cục (mục tự ẩn);
 * `ngam` = nhịp tự làm mới — 5xx không toast.
 */
export async function layHangDoi(
  thamSo: { mayInId?: string } = {},
  tuyChon: { signal?: AbortSignal; ngam?: boolean } = {},
): Promise<HangDoiIn> {
  const { data } = await api.get('/may-in-agents/hang-doi', {
    params: thanhParams(thamSo),
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: tuyChon.ngam === true,
  });
  return {
    choIn: Array.isArray(data?.choIn) ? data.choIn : [],
    chuaXacNhan: Array.isArray(data?.chuaXacNhan) ? data.chuaXacNhan : [],
    capNhat: typeof data?.capNhat === 'string' ? data.capNhat : new Date().toISOString(),
  };
}

/**
 * Một trang lịch sử "Đã in" / "Đã huỷ" (30 ngày gần nhất, mới kết thúc trước). Tải thêm: gọi lại
 * với `truoc = tiepTheo`. 403 không toast toàn cục (thẻ tự hiện câu báo quyền); `ngam` = nhịp tự
 * làm mới — 5xx không toast.
 */
export async function layLichSuIn(
  thamSo: { trangThai: TrangThaiLichSu; mayInId?: string; truoc?: string; gioiHan?: number },
  tuyChon: { signal?: AbortSignal; ngam?: boolean } = {},
): Promise<TrangLichSu> {
  const { data } = await api.get('/may-in-agents/lich-su', {
    params: thanhParams(thamSo),
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: tuyChon.ngam === true,
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    tiepTheo: typeof data?.tiepTheo === 'string' && data.tiepTheo ? data.tiepTheo : null,
    tong: typeof data?.tong === 'number' ? data.tong : null,
    tu: typeof data?.tu === 'string' ? data.tu : null,
  };
}

/**
 * Số trên hai thẻ "Đã in" / "Đã huỷ" (cả org, 30 ngày). Gọi NGẦM (nhịp trang): không bao giờ
 * toast — lỗi thì thẻ chỉ không hiện số. Backend cũ (404) / dữ liệu lạ → null.
 */
export async function layDemLichSuIn(tuyChon: { signal?: AbortSignal } = {}): Promise<DemLichSu | null> {
  const { data } = await api.get('/may-in-agents/lich-su/dem', {
    signal: tuyChon.signal,
    boQuaToast403: true,
    boQuaToast5xx: true, // 404 (backend cũ) vốn không toast
  });
  return typeof data?.daIn === 'number' && typeof data?.daHuy === 'number' ? { daIn: data.daIn, daHuy: data.daHuy } : null;
}

/**
 * Huỷ lệnh in (1..50 id) — CHỈ huỷ chắc chắn lệnh chưa gửi; kết quả từng id đúng thứ tự.
 * Lỗi mạng/5xx: người gọi coi là "chưa rõ" và tải lại hàng đợi (không bao giờ tự cho là đã huỷ).
 */
export async function huyLenhIn(ids: string[]): Promise<KetQuaHuy[]> {
  // Người gọi tự báo lỗi tại dòng + tự gửi lại → không toast chung; hết giờ 15 s để kịp gửi lại.
  const { data } = await api.post('/may-in-agents/hang-doi/huy', { ids }, {
    timeout: MS_HET_GIO_THAO_TAC, boQuaToast5xx: true, boQuaToast403: true,
  });
  return Array.isArray(data?.ketQua) ? data.ketQua : [];
}

/** Bỏ khỏi hàng đợi lệnh CHƯA XÁC NHẬN — KHÔNG chặn việc in, không biết đã in hay chưa. */
export async function boTheoDoiLenhIn(ids: string[]): Promise<KetQuaBoTheoDoi[]> {
  const { data } = await api.post('/may-in-agents/hang-doi/bo-theo-doi', { ids }, {
    timeout: MS_HET_GIO_THAO_TAC, boQuaToast5xx: true, boQuaToast403: true,
  });
  return Array.isArray(data?.ketQua) ? data.ketQua : [];
}

/** Hết giờ một lần gửi huỷ / bỏ theo dõi (mặc định axios 30 s quá lâu cho người đang đứng chờ). */
const MS_HET_GIO_THAO_TAC = 15_000;

/** Mã HTTP của lỗi axios (không có phản hồi — mất mạng, bị huỷ — thì undefined). */
export function maHttpCuaLoi(e: unknown): number | undefined {
  return (e as { response?: { status?: number } } | null)?.response?.status;
}

/** Lỗi do chính ta huỷ yêu cầu (AbortController) — không phải lỗi để hiện. */
export function laYeuCauDaHuy(e: unknown): boolean {
  const loi = e as { code?: string; name?: string } | null;
  return loi?.code === 'ERR_CANCELED' || loi?.name === 'CanceledError' || loi?.name === 'AbortError';
}
