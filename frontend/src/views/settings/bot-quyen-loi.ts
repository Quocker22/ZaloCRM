// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-loi.ts — đọc lỗi axios của API quyền bot thành câu hiện cho người dùng.
// Backend trả { error: <câu tiếng Việt>, code: <MÃ> } cho mọi 4xx ⇒ hiện NGUYÊN câu đó (vd 409 ADMIN_CUOI).
// 5xx và 401 thì interceptor chung (api/index.ts) đã toast / chuyển về đăng nhập ⇒ `daBao` để trang
// không toast lần hai. 403: mọi lời gọi của trang đặt `boQuaToast403` nên trang tự báo.

export interface LoiApi {
  chu: string;
  ma: string | null;
  status: number | null;
  /** Interceptor chung đã báo (toast 5xx / chuyển trang 401) — không toast lần nữa. */
  daBao: boolean;
}

export function loiApi(e: unknown, macDinh: string): LoiApi {
  const res = (e as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } } | null)?.response;
  const status = typeof res?.status === 'number' ? res.status : null;
  if (status === null) return { chu: 'Không kết nối được máy chủ — thử lại.', ma: null, status: null, daBao: false };
  const ma = typeof res?.data?.code === 'string' ? res.data.code : null;
  if (status >= 500) return { chu: 'Máy chủ lỗi, vui lòng thử lại', ma, status, daBao: true };
  if (status === 401) return { chu: 'Phiên đăng nhập đã hết — đăng nhập lại.', ma, status, daBao: true };
  const chu = typeof res?.data?.error === 'string' && res.data.error.trim() ? res.data.error : macDinh;
  return { chu, ma, status, daBao: false };
}
