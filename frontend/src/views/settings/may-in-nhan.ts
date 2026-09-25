// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-nhan.ts — NGUỒN NHÃN DUY NHẤT của giao diện máy in: mã → nhãn tiếng Việt + mức.
//
// Theo hợp đồng "báo sự cố máy in + nhật ký máy in" (v2, 24/09/2026):
//   §1   mã sự cố / trạng thái máy in (app PC gửi lên; cũng là `tinhTrang.ma` trong danh sách máy in)
//   §3.3 mã sự kiện nhật ký backend ghi (`print_logs.loai`)
// Nhãn §1 chép NGUYÊN VĂN hợp đồng (app PC dùng cùng nhãn). Nhãn §3.3 hợp đồng chỉ có
// "khi nào" → dùng cùng câu với MA_SU_KIEN của backend (backend/.../may-in/nhat-ky.ts).
// Mã lạ (backend mới hơn giao diện) thì hiện NGUYÊN MÃ, không bao giờ nuốt: người đọc
// nhật ký vẫn thấy có chuyện gì.
//
// Thêm mã mới: thêm MỘT dòng vào bảng dưới — trang Máy in, chip trạng thái và nhật ký đều
// đọc từ đây. Đừng viết nhãn rời trong .vue.

export type MucDo = 'loi' | 'canh_bao' | 'thong_tin';

export interface MoTaMa {
  nhan: string;
  mucDo: MucDo;
}

/** §1 — sự cố / trạng thái máy in. Thứ tự = thứ tự hợp đồng. */
export const MA_SU_CO: Readonly<Record<string, MoTaMa>> = {
  het_giay: { nhan: 'Hết giấy', mucDo: 'loi' },
  ket_giay: { nhan: 'Kẹt giấy', mucDo: 'loi' },
  offline: { nhan: 'Máy in offline / mất kết nối máy in', mucDo: 'loi' },
  mo_nap: { nhan: 'Nắp máy in đang mở', mucDo: 'loi' },
  het_muc: { nhan: 'Hết mực / sắp hết mực', mucDo: 'canh_bao' },
  can_xu_ly: { nhan: 'Máy in cần người xử lý', mucDo: 'loi' },
  loi_may_in: { nhan: 'Máy in báo lỗi', mucDo: 'loi' },
  khong_tim_thay_may_in: { nhan: 'Không tìm thấy máy in trong Windows', mucDo: 'loi' },
  loi_sumatra: { nhan: 'Không gọi được / SumatraPDF lỗi', mucDo: 'loi' },
  loi_pdf: { nhan: 'File PDF hỏng', mucDo: 'loi' },
  khong_xac_nhan: { nhan: 'Đã gửi máy in nhưng không xác nhận được đã in', mucDo: 'loi' },
  binh_thuong: { nhan: 'Máy in bình thường (đã hết sự cố)', mucDo: 'thong_tin' },
};

/** §3.3 — sự kiện nhật ký backend ghi (ngoài các mã §1 ở trên). */
export const MA_SU_KIEN: Readonly<Record<string, MoTaMa>> = {
  nhan_job: { nhan: 'Nhận lệnh in', mucDo: 'thong_tin' },
  gui_may_in: { nhan: 'Đã gửi xuống máy in', mucDo: 'thong_tin' },
  da_in: { nhan: 'Đã in', mucDo: 'thong_tin' },
  loi_thu_lai: { nhan: 'In lỗi — sẽ thử lại', mucDo: 'canh_bao' },
  app_offline_thu_lai: { nhan: 'App máy in chưa kết nối — sẽ thử lại', mucDo: 'canh_bao' },
  loi_odoo: { nhan: 'Odoo không trả PDF', mucDo: 'canh_bao' },
  khong_co_may_in: { nhan: 'Không tìm được máy in cho hoá đơn', mucDo: 'loi' },
  that_bai: { nhan: 'In thất bại (quá số lần thử)', mucDo: 'loi' },
  khong_ro: { nhan: 'Không rõ đã in chưa', mucDo: 'loi' },
  het_gio_cho: { nhan: 'App máy in không trả lời', mucDo: 'loi' },
  ket_qua_tre: { nhan: 'Kết quả in đến trễ', mucDo: 'thong_tin' },
  app_ket_noi: { nhan: 'App máy in kết nối', mucDo: 'thong_tin' },
  // Thông tin (25/09): máy HN rớt-nối vài lần/giờ — mất kết nối THẬT là app_offline_lau.
  app_mat_ket_noi: { nhan: 'App máy in mất kết nối', mucDo: 'thong_tin' },
  app_offline_lau: { nhan: 'App máy in mất kết nối quá 2 phút', mucDo: 'canh_bao' },
  // Cầu dao: máy đang lỗi thì hoá đơn chờ ở hàng đợi, máy hết lỗi thì tự in tiếp.
  tam_giu: { nhan: 'Tạm giữ hoá đơn — máy in đang lỗi', mucDo: 'canh_bao' },
  cho_may_in: { nhan: 'Hoá đơn chờ máy in hết lỗi', mucDo: 'thong_tin' },
  tiep_tuc_in: { nhan: 'Máy in hoạt động lại — tiếp tục in', mucDo: 'thong_tin' },
};

/**
 * Mã sự kiện của NHẬT KÝ APP (bảng print_app_logs — từng dòng app Windows ghi ra file .txt,
 * xem backend may-in/nhat-ky-app.ts). Khác hai bảng trên: đây là log THÔ, không có mức —
 * chỉ có nhãn + tông màu chip. `app_bo_dong` do backend ghi khi app báo đã bỏ dòng.
 * Mã lạ (app mới hơn giao diện) → chip xám, hiện nguyên mã.
 */
export type TongSuKienApp = 'do' | 'vang' | 'xanh_la' | 'xanh' | 'tim' | 'xam';

export const MA_SU_KIEN_APP: Readonly<Record<string, { nhan: string; tong: TongSuKienApp }>> = {
  vet_in: { nhan: 'Vết in', tong: 'xam' },
  usb_doc: { nhan: 'Đọc trạng thái máy in qua USB', tong: 'tim' },
  usb_khay: { nhan: 'Khay giấy (đọc qua USB)', tong: 'tim' },
  ket_qua: { nhan: 'Kết quả in', tong: 'xanh_la' },
  su_co: { nhan: 'Sự cố máy in', tong: 'do' },
  trang_thai_may_in: { nhan: 'Trạng thái máy in', tong: 'xanh' },
  nhan_job: { nhan: 'Nhận lệnh in', tong: 'xanh' },
  ket_noi: { nhan: 'Kết nối máy chủ', tong: 'xanh_la' },
  mat_ket_noi: { nhan: 'Mất kết nối máy chủ', tong: 'vang' },
  app_bo_dong: { nhan: 'App bỏ dòng nhật ký (bộ đệm đầy)', tong: 'vang' },
};

/** Nhãn + tông chip của một mã sự kiện nhật ký app. Mã lạ → nhãn = chính mã, xám. */
export function kieuSuKienApp(ma: string | null | undefined): { nhan: string; tong: TongSuKienApp } {
  if (ma && Object.prototype.hasOwnProperty.call(MA_SU_KIEN_APP, ma)) return MA_SU_KIEN_APP[ma];
  return { nhan: ma || '—', tong: 'xam' };
}

function moTa(ma: string | null | undefined): MoTaMa | null {
  if (!ma) return null;
  // hasOwn: mã do máy khác gửi lên — "constructor"/"__proto__" không được lọt thành nhãn.
  if (Object.prototype.hasOwnProperty.call(MA_SU_CO, ma)) return MA_SU_CO[ma];
  if (Object.prototype.hasOwnProperty.call(MA_SU_KIEN, ma)) return MA_SU_KIEN[ma];
  return null;
}

/** Nhãn tiếng Việt của một mã (§1 hoặc §3.3). Mã lạ → chính mã đó; rỗng → "—". */
export function nhanCua(ma: string | null | undefined): string {
  if (!ma) return '—';
  return moTa(ma)?.nhan ?? ma;
}

/** Mức mặc định của một mã theo hợp đồng; mã lạ → null (giao diện tự chọn màu trung tính). */
export function mucDoCua(ma: string | null | undefined): MucDo | null {
  return moTa(ma)?.mucDo ?? null;
}

interface KieuMucDo {
  nhan: string;
  /** Màu theme Vuetify cho v-chip. */
  mau: string;
  /** Icon kèm chip — để không chỉ dựa vào màu (người mù màu vẫn phân biệt được). */
  bieuTuong: string;
}

const KIEU_MUC_DO: Readonly<Record<MucDo, KieuMucDo>> = {
  loi: { nhan: 'Lỗi', mau: 'error', bieuTuong: 'mdi-alert-circle' },
  canh_bao: { nhan: 'Cảnh báo', mau: 'warning', bieuTuong: 'mdi-alert' },
  thong_tin: { nhan: 'Thông tin', mau: 'info', bieuTuong: 'mdi-information-outline' },
};

const KIEU_LA: KieuMucDo = { nhan: '', mau: 'grey', bieuTuong: 'mdi-help-circle-outline' };

/** Nhãn + màu + icon của một mức (`loi` | `canh_bao` | `thong_tin`); mức lạ → xám, nhãn = chính nó. */
export function kieuMucDo(mucDo: string | null | undefined): KieuMucDo {
  if (mucDo && Object.prototype.hasOwnProperty.call(KIEU_MUC_DO, mucDo)) {
    return KIEU_MUC_DO[mucDo as MucDo];
  }
  return { ...KIEU_LA, nhan: mucDo || '—' };
}
