// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ não máy trạng thái gom đơn — HÀM THUẦN: phiên vào, hành động ra. Không I/O,
// không import prisma/odoo/logger, để test được từng ô của bảng trạng thái.
//
// Thứ tự ưu tiên là hợp đồng hành vi (test khoá từng dòng):
//   tra cứu → báo không thấy → hỏi chọn → hỏi thiếu (khách→SP→SL) → chốt → tạo.
// "Slot đã có không bao giờ hỏi lại" nằm ngay trong cấu trúc: câu hỏi SL chỉ
// sinh ra khi thật sự có dòng sl == null — không phụ thuộc model nhớ hay quên.
import type { PhienGom, HanhDong } from './kieu.js';
import { NGUONG_GIA_AO } from '../../../odoo/tools/tra-san-pham.js';

export function buocTiepTheo(p: PhienGom): HanhDong {
  // Chế SỬA (spec 08/08): đích là ĐƠN chứ không phải khách — khách đã nằm sẵn
  // trên đơn. Và khi đủ rõ thì GHI THẲNG, không hỏi chốt: nhân viên nói "sửa"
  // là đã quyết rồi, bắt gật thêm lần nữa chỉ tổ chậm.
  const laSua = p.che === 'sua';

  // 1. Còn từ khoá CHƯA TRA (chưa chốt/ứng viên/không-thấy) → tra hết một lượt,
  //    khách/đơn và mọi dòng SP đi song song — nhập nhằng lộ ra ngay câu hỏi đầu.
  // Nhân viên nói RÕ "khách mới" → KHÔNG tra khách cũ nữa.
  //
  // Bug thật 18:59 10/08: "lên đơn cho anh Tuấn KHÁCH HÀNG MỚI 0909485949 Hóc
  // môn" — model trích đúng khachMoi, nhưng máy vẫn tra "Tuấn" rồi liệt kê 10
  // anh Tuấn cũ bắt chọn. Người ta đã nói là khách mới thì tạo luôn, bắt chọn
  // từ danh sách người khác là phản tác dụng.
  const khachCanTra =
    !laSua && !p.khachMoi && p.khachTuKhoa && !p.khachDaChot && !p.khachUngVien && !p.khachKhongThay
      ? p.khachTuKhoa
      : undefined;
  const donCanTra = laSua && !p.donSua && !p.donUngVien && !p.donKhongThay;
  const spCanTra = p.dong
    .filter((d) => !d.daChot && !d.ungVien && !d.khongThay)
    .map((d) => d.tuKhoa);
  if (khachCanTra || donCanTra || spCanTra.length > 0) {
    return {
      loai: 'tra_cuu',
      ...(khachCanTra ? { khach: khachCanTra } : {}),
      ...(donCanTra ? { don: true } : {}),
      sp: spCanTra,
    };
  }

  // 2s. Chế sửa: không có đơn nháp nào để sửa → báo ngay, đừng hỏi vòng vo.
  if (laSua && p.donKhongThay) return { loai: 'khong_thay_don' };

  // 2a. Có thông tin khách mới mà chưa chốt khách → TẠO. Hai ngả tới đây:
  //     (a) NV nói thẳng "khách mới" → không tra, tạo luôn (18:59 10/08);
  //     (b) tra không ra nhưng NV đã cho tên (17:08 10/08).
  //     Đứng TRƯỚC nhánh "không thấy" để không báo không-thấy khi đã đủ thông tin.
  if (p.khachMoi?.ten && !p.khachDaChot) return { loai: 'tao_khach' };

  // 2. Tra rồi mà không thấy → báo ngay, đừng bắt NV chờ đến cuối mới biết.
  const spKhongThay = p.dong.filter((d) => d.khongThay).map((d) => d.tuKhoa);
  if (p.khachKhongThay || spKhongThay.length > 0) {
    return {
      loai: 'khong_thay',
      ...(p.khachKhongThay && p.khachTuKhoa ? { khach: p.khachTuKhoa } : {}),
      sp: spKhongThay,
    };
  }

  // 3s. Chế sửa: nhiều đơn nháp trong hội thoại → cho NV chọn đơn nào.
  //     Đứng TRƯỚC hỏi chọn SP: sửa nhầm đơn tai hại hơn nhầm SP.
  if (laSua && p.donUngVien?.length) return { loai: 'hoi_chon_don' };

  // 3. Nhập nhằng → hỏi chọn MỘT lần, gộp cả khách lẫn SP trong một tin.
  if (p.khachUngVien?.length || p.dong.some((d) => d.ungVien?.length)) {
    return { loai: 'hoi_chon' };
  }

  // 4. Thiếu slot → hỏi đúng MỘT slot. Chế lên đơn: khách trước (quyết định
  //    giá/công nợ), rồi SP, rồi SL. Chế sửa: bỏ qua khách — đơn đã có khách.
  if (!laSua && !p.khachDaChot) return { loai: 'hoi_thieu', thieu: 'khach' };
  if (p.dong.length === 0) return { loai: 'hoi_thieu', thieu: 'sp' };
  if (p.dong.some((d) => d.sl == null)) return { loai: 'hoi_thieu', thieu: 'sl' };

  // 4b. SP chưa có giá thật trong Odoo mà NV cũng chưa báo giá → HỎI NGAY.
  //
  // Bug demo 17:17-17:23 10/08: SP giá 1đ lọt vào phiên, tới lúc tạo đơn tool
  // mới chặn — và phiên dính cứng ở đó, 5 lệnh sau đều trả một câu lỗi cũ.
  // Chặn ở đây thì nhân viên biết ngay và có đường xử (báo giá hoặc bỏ ra).
  const thieuGia = p.dong
    .filter((d) => d.daChot && d.daChot.gia <= NGUONG_GIA_AO && !d.donGia)
    .map((d) => d.daChot!.ten);
  if (thieuGia.length > 0) return { loai: 'hoi_gia', sp: thieuGia };

  // 5. Đủ hết.
  //    Chế SỬA: ghi thẳng — không cổng chốt (anh Quốc chốt 08/08: "rõ ràng thì
  //    chốt luôn"). An toàn vẫn còn: tool sua_don chỉ đụng đơn nháp, và mọi
  //    nhập nhằng đã bị chặn ở các bước trên.
  if (laSua) return { loai: 'sua_don' };
  //    Chế LÊN ĐƠN: hỏi chốt một lần; NV gật rồi (daHoiChot + xác nhận,
  //    orchestrator kiểm phần xác nhận) thì tạo đơn.
  return p.daHoiChot ? { loai: 'tao_don' } : { loai: 'tom_tat_cho_chot' };
}
