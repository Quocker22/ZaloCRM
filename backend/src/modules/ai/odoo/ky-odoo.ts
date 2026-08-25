// SPDX-License-Identifier: AGPL-3.0-or-later
// KỲ của bot → THAM SỐ KỲ của dashboard Odoo (incokit.report_time_range_mixin).
//
// Web "Báo cáo › Tổng quan" nhận time_preset (today/yesterday/last_7_days/
// this_month/last_month) HOẶC custom + date_from/date_to. Bot có bộ từ khoá
// tiếng Việt riêng (ky-thoi-gian.ts) rộng hơn (quý này, năm nay, N tháng qua,
// từ-đến ngày). Chỗ này dịch: preset nào Odoo có sẵn thì giao Odoo tự tính
// (nó dùng tz user), còn lại đổi sang custom.
//
// BẪY ĐÃ ĐO (mixin._resolve_range, 25/08): custom là [date_from, date_to)
// — date_to LOẠI TRỪ. Bot tính kỳ bao gồm cả hai đầu, nên date_to phải cộng
// thêm 1 ngày, không thì mất trọn ngày cuối kỳ (kỳ "hôm 20/7" ra rỗng).
//
// BẪY THỨ HAI (bao-cao-ban-hang.ts): custom mà thiếu ngày → Odoo trả rows
// RỖNG không báo lỗi → bot nói "0đ". Ở đây custom LUÔN kèm đủ hai ngày.
import { chonKy, type DauVaoKy, type Ky } from './ky-thoi-gian.js';

export interface ThamSoKyOdoo {
  time_preset: string;
  date_from?: string;
  date_to?: string;
  /** Kỳ bot đã chốt (bao gồm hai đầu) — để nêu trong text. */
  ky: Ky;
}

const PRESET_SAN: Record<string, string> = {
  hom_nay: 'today',
  hom_qua: 'yesterday',
  thang_nay: 'this_month',
  thang_truoc: 'last_month',
};

/** Cộng 1 ngày cho 'YYYY-MM-DD' (lịch UTC phẳng — chuỗi ngày không mang tz). */
function congMotNgay(ngay: string): string {
  const d = new Date(`${ngay}T00:00:00Z`);
  return new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
}

export function thamSoKyOdoo(
  dauVao: DauVaoKy,
  bayGio: Date = new Date(),
  macDinh: 'hom_nay' | 'thang_nay' = 'thang_nay',
): ThamSoKyOdoo {
  const ky = chonKy(dauVao, bayGio, macDinh);
  const khongCoNgay = !dauVao.tu_ngay && !dauVao.den_ngay;
  // Không nói gì → từ khoá mặc định (tháng này) — preset Odoo có sẵn.
  const tuKhoa = (dauVao.ky ?? '') || (khongCoNgay ? macDinh : '');
  // Preset Odoo có sẵn và NV không nêu ngày cụ thể → giao Odoo tự tính.
  if (khongCoNgay && PRESET_SAN[tuKhoa] && !ky.canhBao) {
    return { time_preset: PRESET_SAN[tuKhoa], ky };
  }
  return { time_preset: 'custom', date_from: ky.tu, date_to: congMotNgay(ky.den), ky };
}
