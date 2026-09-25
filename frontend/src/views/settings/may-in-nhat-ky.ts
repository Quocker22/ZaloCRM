// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-nhat-ky.ts — hàm THUẦN cho trang Máy in (chip tình trạng + mục "Nhật ký máy in").
//
// Không đụng Vue/DOM/axios để test được bằng vitest môi trường node
// (may-in-nhat-ky.spec.ts). Giờ hiển thị và khoảng lọc tính theo GIỜ VIỆT NAM
// (UTC+7, không có giờ mùa hè) theo hợp đồng nhật ký máy in §5 — không theo múi giờ
// của trình duyệt: máy tính shop đặt sai múi giờ vẫn ra đúng "Hôm nay".
import { kieuMucDo, mucDoCua, nhanCua } from './may-in-nhan';

const PHUT_MS = 60_000;
const GIO_MS = 60 * PHUT_MS;
const NGAY_MS = 24 * GIO_MS;
/** Việt Nam: UTC+7 cố định. */
export const LECH_GIO_VN_MS = 7 * GIO_MS;

function thanhMs(luc: string | number | Date | null | undefined): number | null {
  if (luc === null || luc === undefined || luc === '') return null;
  const ms = luc instanceof Date ? luc.getTime() : new Date(luc).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const hai = (n: number) => String(n).padStart(2, '0');

/**
 * Giờ VN của một mốc: "dd/MM HH:mm:ss" (bảng nhật ký), hoặc "dd/MM/yyyy HH:mm:ss" khi `coNam`;
 * `coMs` thêm ".SSS" (nhật ký app — nhiều dòng trong cùng một giây). Mốc hỏng → "—".
 */
export function dinhDangGioVN(
  luc: string | number | Date | null | undefined,
  tuyChon: { coNam?: boolean; coMs?: boolean } = {},
): string {
  const ms = thanhMs(luc);
  if (ms === null) return '—';
  const d = new Date(ms + LECH_GIO_VN_MS); // đọc bằng getUTC* = đồng hồ treo tường ở VN
  const ngay = `${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}`;
  const phanMs = tuyChon.coMs ? `.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : '';
  const gio = `${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())}:${hai(d.getUTCSeconds())}${phanMs}`;
  return tuyChon.coNam ? `${ngay}/${d.getUTCFullYear()} ${gio}` : `${ngay} ${gio}`;
}

/**
 * Thời gian tương đối tiếng Việt so với mốc `bayGio` (ms): "vừa xong", "3 phút trước",
 * "2 giờ trước", "5 ngày trước"; quá 30 ngày thì ra ngày "dd/MM/yyyy".
 * Mốc ở TƯƠNG LAI (đồng hồ máy lệch) cũng coi là "vừa xong" — không in "-2 phút trước".
 */
export function thoiGianTuongDoi(luc: string | number | Date | null | undefined, bayGio: number): string {
  const ms = thanhMs(luc);
  if (ms === null) return '';
  const lech = bayGio - ms;
  if (lech < PHUT_MS) return 'vừa xong';
  if (lech < GIO_MS) return `${Math.floor(lech / PHUT_MS)} phút trước`;
  if (lech < NGAY_MS) return `${Math.floor(lech / GIO_MS)} giờ trước`;
  if (lech < 31 * NGAY_MS) return `${Math.floor(lech / NGAY_MS)} ngày trước`;
  return dinhDangGioVN(ms, { coNam: true }).slice(0, 10);
}

// ── Khoảng thời gian lọc ────────────────────────────────────────────────────

export type KhoangNhatKy = 'hom_nay' | '7_ngay' | '30_ngay';

export const LUA_CHON_KHOANG: ReadonlyArray<{ value: KhoangNhatKy; title: string }> = [
  { value: 'hom_nay', title: 'Hôm nay' },
  { value: '7_ngay', title: '7 ngày' },
  { value: '30_ngay', title: '30 ngày' },
];

const SO_NGAY: Readonly<Record<KhoangNhatKy, number>> = { hom_nay: 1, '7_ngay': 7, '30_ngay': 30 };

/** Mốc UTC (ms) của 00:00:00 giờ VN của ngày chứa `ms`. */
export function dauNgayVN(ms: number): number {
  return Math.floor((ms + LECH_GIO_VN_MS) / NGAY_MS) * NGAY_MS - LECH_GIO_VN_MS;
}

/**
 * `tu`/`den` (ISO) gửi API nhật ký, theo NGÀY LỊCH giờ VN:
 *   Hôm nay  = 00:00 hôm nay → hết hôm nay;
 *   7 ngày   = 00:00 của 6 ngày trước → hết hôm nay (hôm nay + 6 ngày trước);
 *   30 ngày  = tương tự, 30 ngày lịch.
 * `den` = 23:59:59.999 hôm nay chứ không phải "bây giờ": đồng hồ trình duyệt chậm hơn máy
 * chủ vài phút thì vẫn không mất các dòng mới nhất, và cặp (tu, den) giữ nguyên suốt cả ngày
 * nên lượt tự làm mới biết là cùng khoảng để gộp dòng mới thay vì tải lại từ đầu.
 */
export function khoangThoiGian(chon: KhoangNhatKy, bayGio: number = Date.now()): { tu: string; den: string } {
  const soNgay = SO_NGAY[chon] ?? SO_NGAY['7_ngay'];
  const dauHomNay = dauNgayVN(bayGio);
  return {
    tu: new Date(dauHomNay - (soNgay - 1) * NGAY_MS).toISOString(),
    den: new Date(dauHomNay + NGAY_MS - 1).toISOString(),
  };
}

// ── Ô tìm kiếm ──────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá chữ gõ vào ô tìm: chữ thường, bỏ dấu (kể cả đ → d), gộp khoảng trắng.
 * Backend cũng bỏ dấu `q` (§3.5) — làm thêm ở đây để hai lần gõ "Lộc  Beco" và "loc beco"
 * là CÙNG một truy vấn (không gọi lại API vô ích) và không phụ thuộc backend.
 */
export function chuanHoaTuKhoa(chu: string | null | undefined): string {
  return (chu ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tự làm mới: gộp trang mới nhất vào danh sách đang xem ──────────────────

/**
 * Gộp trang ĐẦU vừa tải lại (mới nhất trước) vào danh sách đang hiện, giữ các trang đã
 * "Tải thêm" phía dưới.
 *   - có dòng trùng id → chỉ chèn lên đầu các dòng mới (đứng trước dòng trùng đầu tiên);
 *   - KHÔNG trùng dòng nào (danh sách cũ rỗng, hoặc hơn một trang dòng mới → có thể hở giữa)
 *     → `datLai: true`: thay cả danh sách bằng trang mới, người gọi thay luôn con trỏ `tiepTheo`.
 */
export function gopTrangMoi<T extends { id: string }>(cu: readonly T[], trangDau: readonly T[]): { ds: T[]; datLai: boolean } {
  const idCu = new Set(cu.map((d) => d.id));
  const viTriTrung = trangDau.findIndex((d) => idCu.has(d.id));
  if (cu.length === 0 || viTriTrung < 0) return { ds: [...trangDau], datLai: true };
  return { ds: [...trangDau.slice(0, viTriTrung), ...cu], datLai: false };
}

/** Nối trang "Tải thêm" vào cuối, bỏ dòng đã có (gộp tự làm mới có thể làm hai trang chồng mép). */
export function noiTrangSau<T extends { id: string }>(cu: readonly T[], trangSau: readonly T[]): T[] {
  const idCu = new Set(cu.map((d) => d.id));
  return [...cu, ...trangSau.filter((d) => !idCu.has(d.id))];
}

// ── Chi tiết một dòng ──────────────────────────────────────────────────────

const KHOA_BI_MAT = /token|password|mat_?khau|secret/i;

/**
 * `chiTiet` in đẹp (JSON thụt 2). Rỗng → "". Chuỗi giữ nguyên.
 * Phòng thủ thêm §0.3 (không lộ token): khoá nào tên giống token/mật khẩu thì che —
 * backend vốn không được ghi, nhưng giao diện không in ra nếu lỡ có.
 */
export function chiTietDep(chiTiet: unknown): string {
  if (chiTiet === null || chiTiet === undefined || chiTiet === '') return '';
  if (typeof chiTiet === 'string') return chiTiet;
  try {
    return JSON.stringify(chiTiet, (khoa, giaTri) => (khoa && KHOA_BI_MAT.test(khoa) ? '••••' : giaTri), 2) ?? '';
  } catch {
    return String(chiTiet);
  }
}

// ── Chip tình trạng máy in (cột Trạng thái) ─────────────────────────────────

export interface ChipTinhTrang {
  /** "Hết giấy · 3 phút trước" */
  chu: string;
  mau: string;
  bieuTuong: string;
  /** Tooltip: nhãn + giờ VN đầy đủ. */
  tieuDe: string;
}

/**
 * Chip cho `MayIn.tinhTrang` (§3.4). null khi không có tình trạng hoặc máy bình thường
 * (mức `thong_tin` — cột đã có Online/Offline). Mã lạ vẫn hiện (xám) với nhãn backend gửi.
 * `bayGio` = lúc tải danh sách máy in → chữ "3 phút trước" cập nhật khi tải lại danh sách.
 */
export function chipTinhTrang(
  tinhTrang: { ma: string; nhan?: string | null; luc?: string | null } | null | undefined,
  bayGio: number,
): ChipTinhTrang | null {
  if (!tinhTrang || !tinhTrang.ma) return null;
  const mucDo = mucDoCua(tinhTrang.ma);
  if (mucDo === 'thong_tin') return null;
  const kieu = kieuMucDo(mucDo);
  // Mã biết thì dùng nhãn chung của giao diện; mã lạ thì nhãn backend dịch sẵn, rồi mới tới mã.
  const nhan = mucDo ? nhanCua(tinhTrang.ma) : (tinhTrang.nhan || tinhTrang.ma);
  const tuongDoi = thoiGianTuongDoi(tinhTrang.luc, bayGio);
  return {
    chu: tuongDoi ? `${nhan} · ${tuongDoi}` : nhan,
    mau: kieu.mau,
    bieuTuong: kieu.bieuTuong,
    tieuDe: tinhTrang.luc ? `${nhan} — từ ${dinhDangGioVN(tinhTrang.luc, { coNam: true })}` : nhan,
  };
}
