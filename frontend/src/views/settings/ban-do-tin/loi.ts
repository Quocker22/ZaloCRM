// SPDX-License-Identifier: AGPL-3.0-or-later
// loi.ts — lỗi API trang Bản đồ tin (không phụ thuộc axios/router — giả lập + test thuần import được).
// Server trả { error: <câu tiếng Việt>, code: <MÃ> }; trang hiện NGUYÊN VĂN `error`.

/** Lỗi API giữ nguyên câu + mã của server. */
export class LoiBanDoTin extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = 'LoiBanDoTin';
    this.status = status;
    this.code = code;
  }
}

export function loiTuApi(e: unknown): LoiBanDoTin {
  if (e instanceof LoiBanDoTin) return e;
  const r = (e as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } })?.response;
  if (r) {
    const chu = typeof r.data?.error === 'string' && r.data.error ? r.data.error : `Lỗi máy chủ (HTTP ${r.status ?? '?'})`;
    return new LoiBanDoTin(chu, r.status ?? null, typeof r.data?.code === 'string' ? r.data.code : null);
  }
  return new LoiBanDoTin(e instanceof Error && e.message ? `Không gọi được máy chủ: ${e.message}` : 'Lỗi không rõ', null, null);
}

