// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-hang-doi.ts — hàm THUẦN cho thẻ "Hàng đợi in" (PrintAgentQueuePanel.vue) và chip
// "N đang chờ" trên thẻ máy in (PrintAgentsPage.vue). Hợp đồng docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md
// mục 8 (v5.1): huỷ CHẮC CHẮN chỉ khi lệnh còn chờ (`huy = chac_chan`); lệnh đã xuống máy in thì
// không huỷ được từ xa; "Bỏ khỏi hàng đợi" KHÔNG chặn việc in và KHÔNG BAO GIỜ được gọi là "đã huỷ".
//
// Không đụng Vue/DOM/axios để test được bằng vitest môi trường node (may-in-hang-doi.spec.ts).
import type { HangDoiIn, KetQuaHuy, MucHangDoi } from '@/api/print-agents';
import { dinhDangGioVN, thoiGianTuongDoi } from './may-in-nhat-ky';

/**
 * Lý do KHÔNG huỷ được, theo trạng thái (§8.2 nguyên văn — cùng chữ backend huy-lenh-in.ts
 * NOI_DUNG_HUY). Nút "Vì sao không huỷ được?" hiện câu này.
 */
export const LY_DO_KHONG_HUY = {
  dangIn: 'Hoá đơn đang được gửi/in ở máy in — không huỷ được nữa. Nếu không cần tờ này: bỏ tờ in ra.',
  chuaXacNhan:
    "Hoá đơn đã gửi xuống máy in nhưng chưa xác nhận đã in — có thể đang nằm trong bộ nhớ máy in, không huỷ được từ xa. Muốn bỏ hẳn: xoá lệnh trong hàng đợi Windows (nếu còn), tắt máy in 10 giây (MỌI hoá đơn trong bộ nhớ máy sẽ mất) → bật lại → kiểm khay → in lại cái cần. Rồi bấm 'Bỏ khỏi hàng đợi'.",
  khac: 'Lệnh in này không còn ở trạng thái chờ — không huỷ được. Làm mới hàng đợi để xem trạng thái hiện tại.',
} as const;

export function lyDoKhongHuy(m: Pick<MucHangDoi, 'trangThai'>): string {
  if (m.trangThai === 'dang_gui' || m.trangThai === 'da_gui') return LY_DO_KHONG_HUY.dangIn;
  if (m.trangThai === 'khong_ro') return LY_DO_KHONG_HUY.chuaXacNhan;
  return LY_DO_KHONG_HUY.khac;
}

/** Câu xác nhận "Bỏ khỏi hàng đợi" — nói rõ nó KHÔNG chặn việc in (§8.5, §8.10). */
export const CAU_BO_THEO_DOI =
  'Việc này KHÔNG chặn việc in: nếu hoá đơn còn nằm trong máy in, nó vẫn có thể in ra. Hệ thống KHÔNG biết hoá đơn đã in hay chưa — kiểm khay giấy trước khi in lại. Bỏ khỏi hàng đợi chỉ để danh sách gọn.';

export type MauChip = 'cam' | 'xanh' | 'xam' | 'vang';

/** Chip trạng thái của một mục (chữ + màu + biểu tượng — không chỉ dựa vào màu). */
export function chipTrangThaiHangDoi(m: Pick<MucHangDoi, 'trangThai' | 'tamGiu'>): {
  chu: string;
  mau: MauChip;
  bieuTuong: string;
} {
  if (m.trangThai === 'cho_in' && m.tamGiu) return { chu: 'Tạm giữ', mau: 'cam', bieuTuong: 'mdi-pause-circle-outline' };
  if (m.trangThai === 'cho_in') return { chu: 'Chờ in', mau: 'xam', bieuTuong: 'mdi-clock-outline' };
  if (m.trangThai === 'dang_gui') return { chu: 'Đang gửi', mau: 'xanh', bieuTuong: 'mdi-send-clock-outline' };
  if (m.trangThai === 'da_gui') return { chu: 'Đã gửi máy in', mau: 'xanh', bieuTuong: 'mdi-printer-outline' };
  if (m.trangThai === 'khong_ro') return { chu: 'Chưa xác nhận', mau: 'vang', bieuTuong: 'mdi-help-circle-outline' };
  return { chu: m.trangThai || '—', mau: 'xam', bieuTuong: 'mdi-circle-outline' };
}

/** Khoá máy của một mục — mục không rõ máy gom về khoá rỗng. */
export const khoaMay = (m: Pick<MucHangDoi, 'mayInId'>): string => m.mayInId ?? '';

/**
 * Chip "N đang chờ" trên thẻ máy (§8.6): CHỈ đếm nhóm `choIn`; `tamGiu` = có ít nhất một
 * hoá đơn máy đó đang tạm giữ (chip cam), còn lại xanh.
 */
export function demChoInTheoMay(hd: HangDoiIn | null | undefined): Map<string, { soLuong: number; tamGiu: boolean }> {
  const m = new Map<string, { soLuong: number; tamGiu: boolean }>();
  for (const x of hd?.choIn ?? []) {
    const k = khoaMay(x);
    const c = m.get(k) ?? { soLuong: 0, tamGiu: false };
    c.soLuong += 1;
    c.tamGiu ||= x.tamGiu;
    m.set(k, c);
  }
  return m;
}

/** "Chờ từ": giờ VN của lúc tạo lệnh + "12 phút trước". */
export function choTu(m: Pick<MucHangDoi, 'tao'>, bayGio: number): { gio: string; tuongDoi: string } {
  return { gio: dinhDangGioVN(m.tao), tuongDoi: thoiGianTuongDoi(m.tao, bayGio) };
}

/**
 * Toast tổng kết một lần huỷ — "Đã huỷ 3/4 lệnh". Chỉ đếm "đã huỷ" các id có kết quả ok:true
 * từ máy chủ; `tuChoi` = số id máy chủ TỪ CHỐI cả yêu cầu (4xx — chắc chắn chưa huỷ), `chuaRo`
 * = số id không có câu trả lời sau mọi lần gửi lại (không biết — không nói đã huỷ).
 */
export function tomTatHuy(
  ketQua: readonly KetQuaHuy[],
  them: { tuChoi?: number; chuaRo?: number } = {},
): { chu: string; loai: 'success' | 'warning' | 'error' } {
  const tuChoi = them.tuChoi ?? 0;
  const chuaRo = them.chuaRo ?? 0;
  const n = ketQua.length + tuChoi + chuaRo;
  const ok = ketQua.filter((k) => k.ok).length;
  const khong = ketQua.length - ok;
  if (n === 1) {
    if (chuaRo) return { chu: 'Chưa rõ kết quả huỷ — không liên lạc được máy chủ (xem dòng)', loai: 'error' };
    if (tuChoi) return { chu: 'Chưa huỷ — máy chủ từ chối yêu cầu (xem dòng)', loai: 'error' };
    const k = ketQua[0];
    const hd = k.soHoaDon ?? 'này';
    return k.ok
      ? { chu: `Đã huỷ lệnh in ${hd} — hoá đơn chắc chắn không in`, loai: 'success' }
      : { chu: `Không huỷ được lệnh in ${hd} — xem lý do ở dòng`, loai: 'error' };
  }
  if (ok === n) return { chu: `Đã huỷ ${ok}/${n} lệnh`, loai: 'success' };
  if (khong === n) return { chu: `Không huỷ được ${n} lệnh — xem lý do ở từng dòng`, loai: 'error' };
  const phan = [
    khong ? `${khong} lệnh không huỷ được` : '',
    tuChoi ? `${tuChoi} lệnh chưa huỷ (máy chủ từ chối)` : '',
    chuaRo ? `${chuaRo} lệnh chưa rõ kết quả (mất liên lạc máy chủ)` : '',
  ].filter(Boolean).join(', ');
  return { chu: `Đã huỷ ${ok}/${n} lệnh — ${phan} (xem từng dòng)`, loai: ok === 0 ? 'error' : 'warning' };
}

/** Số hoá đơn hiện ngay trong hộp xác nhận; nhiều hơn thì có nút "Xem đủ danh sách". */
export const SO_HIEN_NGAY = 6;

/**
 * Câu xác nhận huỷ (§6.1 + §8.10): "Hoá đơn … sẽ KHÔNG được in." Hộp xác nhận phải cho thấy ĐÚNG
 * những gì sẽ bị huỷ: tới SO_HIEN_NGAY số thì liệt kê trong câu; nhiều hơn thì câu nêu số lượng,
 * `hienNgay` là phần đầu, `conLai` > 0 → giao diện có nút mở đủ danh sách (không "và N khác" câm).
 */
export function cauXacNhanHuy(cacSo: readonly string[]): {
  tieuDe: string;
  noiDung: string;
  hienNgay: string[];
  conLai: number;
} {
  if (cacSo.length === 1) {
    return { tieuDe: `Huỷ lệnh in ${cacSo[0]}?`, noiDung: `Hoá đơn ${cacSo[0]} sẽ KHÔNG được in.`, hienNgay: [...cacSo], conLai: 0 };
  }
  if (cacSo.length <= SO_HIEN_NGAY) {
    return {
      tieuDe: `Huỷ ${cacSo.length} lệnh in đã chọn?`,
      noiDung: `Hoá đơn ${cacSo.join(', ')} sẽ KHÔNG được in.`,
      hienNgay: [...cacSo],
      conLai: 0,
    };
  }
  return {
    tieuDe: `Huỷ ${cacSo.length} lệnh in đã chọn?`,
    noiDung: `${cacSo.length} hoá đơn dưới đây sẽ KHÔNG được in:`,
    hienNgay: cacSo.slice(0, SO_HIEN_NGAY),
    conLai: cacSo.length - SO_HIEN_NGAY,
  };
}

// ── Gửi yêu cầu: chia lô, phân loại lỗi, câu "từ chối" / "chưa rõ" ─────────────

/** Trần id mỗi yêu cầu (backend TRAN_ID_MOT_YEU_CAU) — nhiều hơn thì gửi nhiều lô NỐI TIẾP. */
export const TRAN_ID_MOT_LO = 50;

export function chiaLo<T>(ds: readonly T[], co = TRAN_ID_MOT_LO): T[][] {
  const lo: T[][] = [];
  for (let i = 0; i < ds.length; i += co) lo.push(ds.slice(i, i + co));
  return lo;
}

/**
 * Lỗi của một lần gọi huỷ / bỏ theo dõi:
 *   - `tu_choi`: máy chủ TRẢ LỜI 4xx (trừ 408/429) — yêu cầu bị từ chối cả lô, CHẮC CHẮN không đổi gì;
 *   - `thu_lai`: không có trả lời (mất mạng, hết giờ), 5xx, 408, 429 — KHÔNG biết đã tới máy chủ
 *     chưa → gửi lại (an toàn: huỷ lặp trả "đã huỷ trước đó", bỏ theo dõi lặp trả "đã bỏ trước đó").
 */
export function phanLoaiLoiGoi(e: unknown): { loai: 'tu_choi'; ma: number } | { loai: 'thu_lai' } {
  const ma = (e as { response?: { status?: number } } | null)?.response?.status;
  if (typeof ma === 'number' && ma >= 400 && ma < 500 && ma !== 408 && ma !== 429) return { loai: 'tu_choi', ma };
  return { loai: 'thu_lai' };
}

/** Câu cho lệnh bị TỪ CHỐI (chắc chắn chưa đổi gì). */
export function cauTuChoi(ma: number, viec: 'huy' | 'bo'): string {
  const chua = viec === 'huy' ? 'CHƯA huỷ gì — hoá đơn vẫn ở hàng đợi' : 'CHƯA bỏ khỏi hàng đợi';
  if (ma === 403) return `Chỉ chủ sở hữu hoặc quản trị viên được làm việc này — ${chua}.`;
  if (ma === 401) return `Phiên đăng nhập đã hết — ${chua}. Đăng nhập lại rồi thử lại.`;
  return `Máy chủ từ chối yêu cầu (mã ${ma}) — ${chua}. Thử lại, hoặc chọn ít lệnh hơn.`;
}

/** Hết mọi lần gửi lại mà không có câu trả lời — KHÔNG BAO GIỜ suy "biến mất = đã huỷ". */
export const CAU_CHUA_RO_HUY = 'Chưa rõ — không liên lạc được máy chủ. Xem Nhật ký in để biết hoá đơn đã huỷ hay đã in.';
export const CAU_CHUA_RO_BO = 'Chưa rõ — không liên lạc được máy chủ. Xem Nhật ký in để biết đã bỏ khỏi hàng đợi chưa.';

/** Khoảng chờ trước mỗi lần GỬI LẠI (tăng dần) — tổng 1 + 3 lượt. */
export const TRE_GUI_LAI_MS: readonly number[] = [1_000, 2_000, 4_000];

/** Trạng thái còn nằm trong hàng đợi hiện (GET /hang-doi). */
export const TRANG_THAI_TRONG_HANG_DOI: ReadonlySet<string> = new Set(['cho_in', 'dang_gui', 'da_gui', 'khong_ro']);

/**
 * Thông báo LỖI của một dòng còn đúng không (§ LOW 8): thông báo mô tả lệnh ở trạng thái
 * `trangThaiLuc`; snapshot mới cho trạng thái `hienTai` (undefined = không còn trong hàng đợi).
 * Trạng thái đổi → thông báo cũ sai sự thật (vd "đang in, không huỷ được nữa" trong khi lệnh đã
 * về "Tạm giữ" và huỷ được) → bỏ.
 */
export function thongBaoConDung(trangThaiLuc: string | null | undefined, hienTai: string | undefined): boolean {
  if (trangThaiLuc && TRANG_THAI_TRONG_HANG_DOI.has(trangThaiLuc)) return hienTai === trangThaiLuc;
  return hienTai === undefined; // mô tả trạng thái ngoài hàng đợi (đã in, đã kết thúc, không tìm thấy)
}
