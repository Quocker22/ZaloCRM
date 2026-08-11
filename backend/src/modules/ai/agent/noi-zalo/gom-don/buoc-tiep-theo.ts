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
import { lechVoLy } from './gia-bat-thuong.js';

export function buocTiepTheo(p: PhienGom): HanhDong {
  // Chế SỬA (spec 08/08): đích là ĐƠN chứ không phải khách — khách đã nằm sẵn
  // trên đơn. Và khi đủ rõ thì GHI THẲNG, không hỏi chốt: nhân viên nói "sửa"
  // là đã quyết rồi, bắt gật thêm lần nữa chỉ tổ chậm.
  const laSua = p.che === 'sua';

  // Chế NHẬP HÀNG (11/08) — đơn MUA từ nhà cung cấp. Ca thật 22:09-22:11 nhóm
  // Test-AI: bot đáp "chưa có tool tạo phiếu nhập hàng ... nằm ngoài phạm vi em
  // hỗ trợ" trong khi quyền ghi purchase.order vốn đã có (đo prod: create=true,
  // write=true, 5 đơn mua thật P04517-P04521 đang chạy, 4 đơn của NCC Trung Quốc).
  //
  // Đi chung bảng trạng thái với lên đơn, KHÔNG dựng máy riêng (anh Quốc: "dựa
  // vào luồng lên đơn mà làm nhé"). Ô `khach*` mang NHÀ CUNG CẤP ở chế này.
  const laNhap = p.che === 'nhap';

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
      // Chế nhập tra NHÀ CUNG CẤP (res.partner supplier_rank>0), chế lên đơn
      // tra KHÁCH (customer_rank>0). Hai tập gần như rời nhau nhưng có tên
      // trùng nhau: prod 11/08 có "TRung Quốc" [KH001046] là khách nằm cạnh
      // "Trung Quốc" [NCC000001] là NCC. Tra nhầm tập là treo đơn sai chỗ.
      ...(khachCanTra ? (laNhap ? { ncc: khachCanTra } : { khach: khachCanTra }) : {}),
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
  //     CHẾ NHẬP KHÔNG CÓ NHÁNH NÀY. Tạo khách mới là việc bot làm được (tên
  //     là đủ, tự chống trùng); tạo NHÀ CUNG CẤP thì không — NCC gắn với điều
  //     khoản thanh toán, công nợ phải trả, mã số thuế. Bài học ca "khách rác
  //     Long" 11/08: bot tự bịa partner rồi xuất hoá đơn 21 triệu lên đó. Ở
  //     đây tra không ra thì BÁO người, để kế toán tạo trên Odoo.
  if (!laNhap && p.khachMoi?.ten && !p.khachDaChot) return { loai: 'tao_khach' };

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
  if (!laSua && !p.khachDaChot) {
    return { loai: 'hoi_thieu', thieu: laNhap ? 'ncc' : 'khach' };
  }
  if (p.dong.length === 0) return { loai: 'hoi_thieu', thieu: 'sp' };
  if (p.dong.some((d) => d.sl == null)) return { loai: 'hoi_thieu', thieu: 'sl' };

  // ── CHẾ NHẬP DỪNG Ở ĐÂY: đủ NCC + hàng + SL là GHI ─────────────────────
  //
  // Bỏ qua CẢ HAI hàng rào giá bên dưới, có chủ ý — chúng đo bằng `list_price`
  // (GIÁ BÁN), mà giá bán không nói gì về giá nhập:
  //
  //   4b `hoi_gia` — bên bán chặn SP giá 0/1đ vì bán 0đ là mất tiền thật. Bên
  //      mua thì giá nhập CHƯA CÓ là chuyện thường: ca thật 22:11 nhân viên dán
  //      13 dòng hàng phần lớn không kèm giá, và chính đơn thật P04520 trên prod
  //      (263.046.000đ, NCC Trung Quốc) đang có 3 dòng price_unit=0 nằm cạnh 2
  //      dòng 8.300đ. Bắt hỏi đủ 13 giá là dựng lại bug demo 17:17 10/08 (SP
  //      giá 1đ làm kẹt cứng cả phiên). Phiếu NHÁP, người điền giá sau trên Odoo.
  //
  //   4d `hoi_gia_lech` — so giá NV báo với giá BÁN. Giá nhập thấp hơn giá bán
  //      vài lần chính là LÃI GỘP, tức trạng thái bình thường của mọi phiếu
  //      nhập. Áp hàng rào đó vào đây là chặn hỏi vô cớ gần như mọi lượt.
  //
  // Không im lặng bù lại: `dinhDangTaoDonMua` báo rõ "N/M dòng CHƯA CÓ GIÁ NHẬP".
  if (laNhap) return { loai: 'tao_don_mua' };

  // 4b. SP chưa có giá thật trong Odoo mà NV cũng chưa báo giá → HỎI NGAY.
  //
  // Bug demo 17:17-17:23 10/08: SP giá 1đ lọt vào phiên, tới lúc tạo đơn tool
  // mới chặn — và phiên dính cứng ở đó, 5 lệnh sau đều trả một câu lỗi cũ.
  // Chặn ở đây thì nhân viên biết ngay và có đường xử (báo giá hoặc bỏ ra).
  //
  // Dòng TẶNG được miễn: hàng tặng vốn 0đ, hỏi giá của món cho không là vô nghĩa
  // và chặn cứng phiên đúng như bug 17:17 mà bước này sinh ra để tránh.
  const thieuGia = p.dong
    .filter((d) => !d.tang && d.daChot && d.daChot.gia <= NGUONG_GIA_AO && !d.donGia)
    .map((d) => d.daChot!.ten);
  if (thieuGia.length > 0) return { loai: 'hoi_gia', sp: thieuGia };

  // 4c. KHO — KHÔNG CÓ BƯỚC NÀY NỮA. Đừng thêm lại.
  //
  // Sáng 11/08 chỗ này từng hỏi "Hàng này có ở 2 kho ạ… anh/chị xuất kho nào?"
  // khi hàng nằm nhiều kho. Anh Quốc bỏ ngay chiều cùng ngày, nguyên văn:
  //   "à còn cái này, mặc định là lấy kho TT nhé, không cần hỏi nhân viên luôn,
  //    cứ lấy từ TT nào nhân viên nói sửa sang kho khác thì sửa thôi"
  //
  // Số đo hậu thuẫn: 291/300 đơn gần nhất dùng kho TT, 9 đơn dùng HCM — 97% câu
  // hỏi kho là thừa. Mua một lượt hỏi cho thứ gần như không bao giờ đổi là lỗ.
  //
  // Không đặt khoId thì Odoo tự điền kho mặc định = TT (kiểm trên prod 11/08:
  // 8 đơn gần nhất bot tạo không gửi warehouse_id đều ra kho 2). Nhân viên nói
  // kho thì `trich-slot` + `mapKho` vẫn nhận và đặt đúng — chỉ bỏ bước HỎI.

  // 4d. GIÁ LỆCH VÔ LÝ so với hệ thống → hỏi lại trước khi cho chốt.
  //
  // Bug thật 10:09:33 11/08 (nhóm Test-AI): nhân viên nói "card thu triết khấu
  // 8%", model nhét số 8 vào ô ĐƠN GIÁ. Bot in "100 × Card thu BX-V7512 = 800đ
  // (giá anh/chị báo 8đ, hệ thống 230.000đ)" — tự tay khoe con số lệch 28.750
  // lần — rồi vẫn hỏi "Em chốt lên đơn nhé?". Đơn 46 triệu còn 800đ, chỉ chờ
  // một chữ "ok".
  //
  // Đứng NGAY TRƯỚC tao_don — và từ 11/08 đây là cổng người-gác DUY NHẤT còn
  // lại trên đường lên đơn (bước hỏi chốt đã bỏ). Chỉ `giaLechDaXacNhan` —
  // nhân viên trả lời đúng câu hỏi về chính con số đó — mới mở cổng.
  //
  // Hàng rào này KHÔNG phải "bước chốt" anh Quốc bỏ. Bước chốt hỏi khi mọi thứ
  // BÌNH THƯỜNG ("đúng chưa, lên nhé?"); hàng rào này chỉ mở miệng khi phát
  // hiện BẤT THƯỜNG (lệch 28.750 lần) — trung bình gần như không bao giờ chạy.
  //
  // Ngưỡng lấy từ số đo prod, không bịa: xem gia-bat-thuong.ts (5.781 dòng đơn
  // 2026 — KHÔNG dòng nào lệch dưới 0,1 lần; ca thật này ở 0,0000348 lần).
  if (!laSua && !p.giaLechDaXacNhan) {
    const lech = p.dong
      .filter((d) => !d.tang && d.daChot && lechVoLy(d.donGia, d.daChot.gia))
      .map((d) => ({ ten: d.daChot!.ten, giaNv: d.donGia!, giaHt: d.daChot!.gia }));
    if (lech.length > 0) return { loai: 'hoi_gia_lech', lech };
  }

  // 5. Đủ hết → GHI THẲNG, cả hai chế.
  //
  //    Chế SỬA đã thế từ 08/08 (anh Quốc: "rõ ràng thì chốt luôn").
  //
  //    Chế LÊN ĐƠN theo sau ngày 11/08. Nguyên văn anh Quốc: "tôi muốn bỏ luôn
  //    cái bước chốt đơn này được không?, nếu mọi thứ đã rõ ràng thì lên đơn
  //    báo giá luôn". Hỏi lại có giữ ngoại lệ nào (giá lệch / khách vừa tạo /
  //    đơn tiền lớn) thì anh chốt: "Bỏ hoàn toàn, không hỏi gì nữa".
  //
  //    Vì sao bỏ được mà không mất an toàn: đơn tạo ra là đơn NHÁP, sửa được
  //    bằng chính máy này (chế 'sua'). Nhịp "gật rồi mới ghi" mua rất ít —
  //    mọi nhập nhằng thật (nhiều khách trùng tên, thiếu SL, SP chưa có giá,
  //    giá lệch vô lý) đều đã bị các bước 1-4d chặn TRƯỚC khi tới đây. Tới
  //    dòng này nghĩa là không còn gì để hỏi, nên câu hỏi chỉ là một lượt chờ.
  //
  //    Tóm tắt KHÔNG mất theo: orchestrator vẫn in nguyên nội dung đó, chỉ đổi
  //    từ câu hỏi sang câu thông báo kèm mã đơn (xem `taoDonVaBaoGia`).
  if (laSua) return { loai: 'sua_don' };
  return { loai: 'tao_don' };
}
