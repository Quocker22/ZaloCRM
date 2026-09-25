// SPDX-License-Identifier: AGPL-3.0-or-later
// BẢNG MẪU dùng chung cho hai test mức độ log app (không phải file test):
//   - muc-do-app.test.ts    : hàm TS phanLoaiMucDoApp ra đúng mức mong đợi (luôn chạy);
//   - muc-do-app-sql.func.ts: backfill SQL của migration ra CÙNG mức trên Postgres thật
//                             (CO_DB_TEST=1) — đối chiếu TS ↔ SQL trên đúng bảng này.
// Mỗi dòng phủ một luật (dương) hoặc một ranh giới (âm) của hợp đồng hàng đợi/huỷ v5 §5 + §8.9.
// Chữ tiếng Việt NFD (tổ hợp dấu) viết bằng normalize('NFD') để chắc là NFD thật.

export interface MauMucDo {
  suKien: string;
  noiDung: string;
  mucDo: 'loi' | 'canh_bao' | 'thong_tin';
  /** Luật / ranh giới mà dòng này khoá. */
  vi: string;
}

export const MAU_MUC_DO_APP: MauMucDo[] = [
  // ── loi ──
  { suKien: 'su_co', noiDung: 'job=abc loai=het_giay gui_server=ok', mucDo: 'loi', vi: 'su_co' },
  { suKien: 'khong_in_het_giay', noiDung: 'job=abc loai=het_giay Khay trống', mucDo: 'loi', vi: 'khong_in_*' },
  { suKien: 'khong_in_hang_doi_ket', noiDung: '', mucDo: 'loi', vi: 'khong_in_* (nội dung rỗng)' },
  { suKien: 'khong_in_khong_tim_thay_may_in', noiDung: 'x', mucDo: 'loi', vi: 'khong_in_*' },
  { suKien: 'khong_in', noiDung: 'x', mucDo: 'thong_tin', vi: 'thiếu "_" cuối tiền tố → không khớp' },
  { suKien: 'ket_qua', noiDung: 'job=a hoa_don=INV/1 trang_thai=loi loai=het_giay con_trong_hang_doi=- gui_server=ok', mucDo: 'loi', vi: 'ket_qua trang_thai=loi' },
  { suKien: 'ket_qua', noiDung: 'job=a hoa_don=INV/1 trang_thai=khong_ro loai=ket_giay con_trong_hang_doi=co gui_server=ok', mucDo: 'loi', vi: 'ket_qua trang_thai=khong_ro' },
  { suKien: 'ket_qua', noiDung: 'job=a hoa_don=INV/1 trang_thai=da_in loai=- con_trong_hang_doi=- gui_server=ok', mucDo: 'thong_tin', vi: 'ket_qua da_in' },
  { suKien: 'trang_thai_may_in', noiDung: 'het_giay Khay 2 trống', mucDo: 'loi', vi: 'trang_thai_may_in khác binh_thuong/het_muc' },
  { suKien: 'trang_thai_may_in', noiDung: 'ket_giay', mucDo: 'loi', vi: 'trang_thai_may_in chỉ có mã' },
  { suKien: 'trang_thai_may_in', noiDung: '  offline\tmất kết nối', mucDo: 'loi', vi: 'từ đầu sau khoảng trắng đầu dòng, cắt ở tab' },
  { suKien: 'trang_thai_may_in', noiDung: 'binh_thuong ', mucDo: 'thong_tin', vi: 'binh_thuong' },
  { suKien: 'trang_thai_may_in', noiDung: 'binh_thuong_la het_giay', mucDo: 'loi', vi: 'so NGUYÊN từ đầu, không tiền tố' },
  { suKien: 'trang_thai_may_in', noiDung: 'het_muc sắp hết mực', mucDo: 'canh_bao', vi: 'trang_thai_may_in het_muc' },
  { suKien: 'trang_thai_may_in', noiDung: 'het_muc\nhết giấy', mucDo: 'canh_bao', vi: 'từ đầu cắt ở xuống dòng' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 USB 0x90 — khay giấy TRỐNG (máy in báo mức giấy 0)', mucDo: 'loi', vi: 'usb_doc TRỐNG' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 USB 0x90 STATUS:BUSY — máy in báo lỗi qua USB', mucDo: 'loi', vi: 'usb_doc báo lỗi' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 USB 0x30 — máy in báo hết giấy qua USB', mucDo: 'loi', vi: 'usb_doc hết giấy' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 máy in báo hết giấy'.normalize('NFD'), mucDo: 'loi', vi: 'usb_doc hết giấy viết NFD → vẫn khớp (NFC)' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 khay trống', mucDo: 'thong_tin', vi: 'phân biệt hoa thường: "trống" ≠ "TRỐNG"' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 KHONG DOC DUOC: timeout', mucDo: 'canh_bao', vi: 'usb_doc KHONG DOC DUOC' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 KHONG DOC DUOC — hết giấy', mucDo: 'loi', vi: 'lỗi thắng cảnh báo' },
  { suKien: 'usb_doc', noiDung: 'cong=USB001 USB 0x18 — bình thường', mucDo: 'thong_tin', vi: 'usb_doc bình thường' },
  { suKien: 'theo_doi_tiep_mat', noiDung: 'job=a', mucDo: 'loi', vi: 'theo_doi_tiep_mat' },
  { suKien: 'theo_doi_tiep_het_han', noiDung: 'job=a', mucDo: 'loi', vi: 'theo_doi_tiep_het_han' },
  { suKien: 'tu_choi_ket_noi', noiDung: 'unauthorized', mucDo: 'loi', vi: 'tu_choi_ket_noi' },
  { suKien: 'sumatra_qua_han', noiDung: 'job=a han=30s', mucDo: 'loi', vi: 'sumatra_qua_han' },
  { suKien: 'sumatra_loi_cho', noiDung: 'job=a', mucDo: 'loi', vi: 'sumatra_loi_cho' },
  // ── canh_bao ──
  ...['noi_that_bai', 'mat_ket_noi', 'gui_nhat_ky_loi', 'app_bo_dong', 'mat_job', 'ngat_client_cham', 'hop_thu_tran', 'theo_doi_tiep_bo', 'bo_theo_doi']
    .map((suKien) => ({ suKien, noiDung: 'ok=true x', mucDo: 'canh_bao' as const, vi: suKien })),
  { suKien: 'huy_ket_qua', noiDung: 'ok=false job=a loi=DANG_IN', mucDo: 'canh_bao', vi: '§8.9 huy_ket_qua ok=false' },
  { suKien: 'huy_ket_qua', noiDung: 'ok=true job=a cach=chua_gui', mucDo: 'thong_tin', vi: '§8.9 huy_ket_qua ok=true' },
  { suKien: 'huy_ket_qua', noiDung: 'job=a ok=false', mucDo: 'thong_tin', vi: '§8.9 ok=false phải ở ĐẦU' },
  // ── thong_tin ──
  { suKien: 'huy_yeu_cau', noiDung: 'job=a', mucDo: 'thong_tin', vi: '§8.9 huy_yeu_cau' },
  { suKien: 'huy_that_bai', noiDung: 'x', mucDo: 'thong_tin', vi: '§8.9 huy_that_bai KHÔNG phải mã app' },
  { suKien: 'vet_in', noiDung: 'job=a t=12ms KET Loi', mucDo: 'thong_tin', vi: 'vet_in' },
  { suKien: 'ket_noi', noiDung: 'server=https://x', mucDo: 'thong_tin', vi: 'ket_noi' },
  { suKien: 'nhan_job', noiDung: 'job=a hoa_don=INV/1 khach=Anh Lộc', mucDo: 'thong_tin', vi: 'nhan_job' },
  { suKien: 'SU_CO', noiDung: 'x', mucDo: 'thong_tin', vi: 'mã so NGUYÊN (phân biệt hoa thường)' },
  { suKien: 'app_bo_dong', noiDung: "App bỏ 3 dòng nhật ký (bộ đệm đầy) — it's", mucDo: 'canh_bao', vi: 'dấu nháy trong nội dung' },
];
