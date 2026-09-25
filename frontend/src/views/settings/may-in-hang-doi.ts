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

/** Toast tổng kết một lần huỷ — "Đã huỷ 3/4 lệnh". Không bao giờ nói "đã huỷ" cho lệnh không huỷ. */
export function tomTatHuy(ketQua: readonly KetQuaHuy[]): { chu: string; loai: 'success' | 'warning' | 'error' } {
  const n = ketQua.length;
  const ok = ketQua.filter((k) => k.ok).length;
  if (n === 1) {
    const k = ketQua[0];
    const hd = k.soHoaDon ?? 'này';
    return k.ok
      ? { chu: `Đã huỷ lệnh in ${hd} — hoá đơn chắc chắn không in`, loai: 'success' }
      : { chu: `Không huỷ được lệnh in ${hd} — xem lý do ở dòng`, loai: 'error' };
  }
  if (ok === n) return { chu: `Đã huỷ ${ok}/${n} lệnh`, loai: 'success' };
  if (ok === 0) return { chu: `Không huỷ được ${n} lệnh — xem lý do ở từng dòng`, loai: 'error' };
  return { chu: `Đã huỷ ${ok}/${n} lệnh — ${n - ok} lệnh không huỷ được (xem từng dòng)`, loai: 'warning' };
}

/** Câu xác nhận huỷ (§6.1 + §8.10): "Hoá đơn … sẽ KHÔNG được in." */
export function cauXacNhanHuy(cacSo: readonly string[]): { tieuDe: string; noiDung: string } {
  if (cacSo.length === 1) {
    return { tieuDe: `Huỷ lệnh in ${cacSo[0]}?`, noiDung: `Hoá đơn ${cacSo[0]} sẽ KHÔNG được in.` };
  }
  const hien = cacSo.slice(0, 6).join(', ');
  const them = cacSo.length > 6 ? ` và ${cacSo.length - 6} hoá đơn khác` : '';
  return { tieuDe: `Huỷ ${cacSo.length} lệnh in đã chọn?`, noiDung: `Hoá đơn ${hien}${them} sẽ KHÔNG được in.` };
}
