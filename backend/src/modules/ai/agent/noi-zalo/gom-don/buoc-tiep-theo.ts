// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ não máy trạng thái gom đơn — HÀM THUẦN: phiên vào, hành động ra. Không I/O,
// không import prisma/odoo/logger, để test được từng ô của bảng trạng thái.
//
// Thứ tự ưu tiên là hợp đồng hành vi (test khoá từng dòng):
//   tra cứu → báo không thấy → hỏi chọn → hỏi thiếu (khách→SP→SL) → chốt → tạo.
// "Slot đã có không bao giờ hỏi lại" nằm ngay trong cấu trúc: câu hỏi SL chỉ
// sinh ra khi thật sự có dòng sl == null — không phụ thuộc model nhớ hay quên.
import type { PhienGom, HanhDong } from './kieu.js';

export function buocTiepTheo(p: PhienGom): HanhDong {
  // 1. Còn từ khoá CHƯA TRA (chưa chốt/ứng viên/không-thấy) → tra hết một lượt,
  //    khách và mọi dòng SP đi song song — nhập nhằng lộ ra ngay câu hỏi đầu.
  const khachCanTra =
    p.khachTuKhoa && !p.khachDaChot && !p.khachUngVien && !p.khachKhongThay
      ? p.khachTuKhoa
      : undefined;
  const spCanTra = p.dong
    .filter((d) => !d.daChot && !d.ungVien && !d.khongThay)
    .map((d) => d.tuKhoa);
  if (khachCanTra || spCanTra.length > 0) {
    return { loai: 'tra_cuu', ...(khachCanTra ? { khach: khachCanTra } : {}), sp: spCanTra };
  }

  // 2. Tra rồi mà không thấy → báo ngay, đừng bắt NV chờ đến cuối mới biết.
  const spKhongThay = p.dong.filter((d) => d.khongThay).map((d) => d.tuKhoa);
  if (p.khachKhongThay || spKhongThay.length > 0) {
    return {
      loai: 'khong_thay',
      ...(p.khachKhongThay && p.khachTuKhoa ? { khach: p.khachTuKhoa } : {}),
      sp: spKhongThay,
    };
  }

  // 3. Nhập nhằng → hỏi chọn MỘT lần, gộp cả khách lẫn SP trong một tin.
  if (p.khachUngVien?.length || p.dong.some((d) => d.ungVien?.length)) {
    return { loai: 'hoi_chon' };
  }

  // 4. Thiếu slot → hỏi đúng MỘT slot. Khách trước (quyết định giá/công nợ),
  //    rồi SP, rồi SL.
  if (!p.khachDaChot) return { loai: 'hoi_thieu', thieu: 'khach' };
  if (p.dong.length === 0) return { loai: 'hoi_thieu', thieu: 'sp' };
  if (p.dong.some((d) => d.sl == null)) return { loai: 'hoi_thieu', thieu: 'sl' };

  // 5. Đủ hết: hỏi chốt một lần; NV gật rồi (daHoiChot + xác nhận, orchestrator
  //    kiểm phần xác nhận) thì tạo đơn.
  return p.daHoiChot ? { loai: 'tao_don' } : { loai: 'tom_tat_cho_chot' };
}
