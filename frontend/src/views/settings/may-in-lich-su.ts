// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-lich-su.ts — hàm THUẦN cho hai thẻ "Đã in" / "Đã huỷ" (PrintAgentHistoryPanel.vue) và
// số trên thẻ (PrintAgentLogPanel.vue). Backend: GET /may-in-agents/lich-su (lich-su-in.ts) —
// 30 ngày gần nhất theo LÚC in xong / LÚC huỷ.
//
// "Đã huỷ" = huỷ CHẮC CHẮN (hoá đơn không in). "Bỏ khỏi hàng đợi" KHÔNG phải huỷ và không nằm
// ở thẻ này (hợp đồng hàng đợi/huỷ v5.1 §8.5, §8.10) — xem ở Nhật ký in.
//
// Không đụng Vue/DOM/axios để test được bằng vitest môi trường node (may-in-lich-su.spec.ts).
import type { DemLichSu, MucLichSu, TrangThaiLichSu } from '@/api/print-agents';
import { dinhDangGioVN, thoiGianTuongDoi } from './may-in-nhat-ky';

/** Cửa sổ lịch sử — cùng hạn giữ nhật ký (backend SO_NGAY_LICH_SU). */
export const SO_NGAY_LICH_SU = 30;

export interface ChuLichSu {
  /** Chữ trên thẻ. */
  the: string;
  bieuTuongThe: string;
  /** Dòng phụ dưới tiêu đề mục khi thẻ đang chọn. */
  moTa: string;
  /** Tiêu đề cột giờ kết thúc. */
  cotKetThuc: string;
  /** Tooltip của cột giờ kết thúc — giờ đó là giờ GÌ. */
  tieuDeCotKetThuc: string;
  /** Nhãn cột giờ kết thúc ở khung hẹp (không có đầu cột). */
  nhanKetThuc: string;
  rong: string;
  chip: { chu: string; bieuTuong: string; mau: 'xanh-la' | 'xam' };
  /** Câu dưới chip khi dòng không có lý do riêng. */
  phu: string;
}

export const CHU_LICH_SU: Readonly<Record<TrangThaiLichSu, ChuLichSu>> = {
  da_in: {
    the: 'Đã in',
    bieuTuongThe: 'mdi-printer-check',
    moTa: `Hoá đơn đã in xong · ${SO_NGAY_LICH_SU} ngày gần nhất · tự làm mới 15 giây`,
    cotKetThuc: 'In lúc',
    // Không phải giờ giấy rơi ra khay: app báo sau khi máy in xong (hoặc kết quả đến trễ).
    tieuDeCotKetThuc: 'Giờ hệ thống nhận xác nhận in xong (giờ Việt Nam)',
    nhanKetThuc: 'In lúc ',
    rong: `Chưa có hoá đơn nào in xong trong ${SO_NGAY_LICH_SU} ngày gần nhất.`,
    chip: { chu: 'Đã in', bieuTuong: 'mdi-check-circle-outline', mau: 'xanh-la' },
    phu: 'Máy in đã báo in xong',
  },
  da_huy: {
    the: 'Đã huỷ',
    bieuTuongThe: 'mdi-cancel',
    moTa: `Lệnh in đã huỷ trước khi gửi — hoá đơn chắc chắn không in · ${SO_NGAY_LICH_SU} ngày gần nhất · tự làm mới 15 giây`,
    cotKetThuc: 'Huỷ lúc',
    tieuDeCotKetThuc: 'Giờ lệnh in bị huỷ (giờ Việt Nam)',
    nhanKetThuc: 'Huỷ lúc ',
    rong: `Không có lệnh in nào bị huỷ trong ${SO_NGAY_LICH_SU} ngày gần nhất.`,
    chip: { chu: 'Đã huỷ', bieuTuong: 'mdi-cancel', mau: 'xam' },
    phu: 'Hoá đơn chắc chắn không in',
  },
};

/** Trạng thái lạ (backend mới hơn) → chữ của "Đã in" không hợp; dùng nguyên mã, chip xám. */
export function chipLichSu(trangThai: string): ChuLichSu['chip'] {
  if (trangThai === 'da_in' || trangThai === 'da_huy') return CHU_LICH_SU[trangThai].chip;
  return { chu: trangThai || '—', bieuTuong: 'mdi-circle-outline', mau: 'xam' };
}

/** "1.234" — nhóm nghìn kiểu Việt, không phụ thuộc ICU của trình duyệt. */
export function dinhDangSo(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Số trên thẻ "Đã in (1.234)": chưa biết (backend cũ, lỗi) → chuỗi rỗng — thẻ chỉ hiện chữ. */
export function soTrenThe(dem: DemLichSu | null | undefined, trangThai: TrangThaiLichSu): string {
  if (!dem) return '';
  const n = trangThai === 'da_in' ? dem.daIn : dem.daHuy;
  return typeof n === 'number' && Number.isFinite(n) ? ` (${dinhDangSo(n)})` : '';
}

/**
 * Dòng trạng thái trên thanh công cụ: "12 hoá đơn", "50/1.234 hoá đơn" (đang hiện một phần),
 * "50+ hoá đơn" (chưa biết tổng); kèm "· cập nhật HH:mm:ss" (giờ VN) khi có.
 */
export function dongTrangThaiLichSu(
  soDangHien: number,
  tong: number | null,
  coThem: boolean,
  lucCapNhat: number | null,
): string {
  let dem: string;
  if (tong === null) dem = `${dinhDangSo(soDangHien)}${coThem ? '+' : ''} hoá đơn`;
  else if (soDangHien < tong) dem = `${dinhDangSo(soDangHien)}/${dinhDangSo(tong)} hoá đơn`;
  else dem = `${dinhDangSo(tong)} hoá đơn`;
  return lucCapNhat ? `${dem} · cập nhật ${dinhDangGioVN(lucCapNhat).slice(6)}` : dem;
}

/** Giờ VN "dd/MM HH:mm:ss" + "12 phút trước". */
export function mocGio(iso: string | null | undefined, bayGio: number): { gio: string; tuongDoi: string } {
  return { gio: dinhDangGioVN(iso), tuongDoi: thoiGianTuongDoi(iso, bayGio) };
}

/**
 * Dòng CÒN trong cửa sổ 30 ngày (`tu` = mốc đầu máy chủ trả) — tự làm mới bỏ các dòng cũ ở
 * cuối đã quá hạn thay vì để chúng nằm lại tới lần tải lại. `tu` vắng → giữ nguyên.
 */
export function locTrongCuaSo<T extends Pick<MucLichSu, 'ketThuc'>>(ds: readonly T[], tu: string | null | undefined): T[] {
  if (!tu) return [...ds];
  const moc = new Date(tu).getTime();
  if (!Number.isFinite(moc)) return [...ds];
  return ds.filter((m) => {
    const t = new Date(m.ketThuc).getTime();
    return !Number.isFinite(t) || t >= moc;
  });
}
