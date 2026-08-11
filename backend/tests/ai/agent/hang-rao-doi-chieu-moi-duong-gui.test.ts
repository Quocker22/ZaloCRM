// SPDX-License-Identifier: AGPL-3.0-or-later
// HÀNG RÀO GỬI FILE/ẢNH phải đối chiếu với MỌI ĐƯỜNG GỬI THẬT, không chỉ một tool.
//
// CA THẬT 21:47:52 và 21:50:21 ngày 11/08/2026 — anh Quốc hỏi "ủa này là sao":
//
//   NV : "@bot báo cáo các sản phẩm bán ra hôm nay"
//   Bot: "Dạ khoản này em chưa xử lý được, anh/chị xem giúp em với ạ."
//
// Nhưng bot ĐÃ LÀM ĐÚNG. Log cho thấy nó tra ra kết quả chuẩn — ngày đúng
// (11/08/2026), số mã đúng (7 mã, khớp kiểm chứng prod) — rồi câu trả lời
// HOÀN CHỈNH bị hàng rào vứt đi:
//
//   lyDo: 'Model nói đã gửi tài liệu ("Dạ, báo cáo theo ngày hôm nay
//          (11/08/2026) có 7 mã sản phẩm bán ra, xếp theo số ") nhưng KHÔNG
//          file nào được lấy về.'
//
// GỐC LỖI: `khoeDaGuiTaiLieu` có chữ "file" trong danh sách, nhưng caller chỉ
// đối chiếu với MỘT bằng chứng — `taiLieuDaLay` (tool `gui_tai_lieu`). File
// Excel báo cáo đi ĐƯỜNG HOÀN TOÀN KHÁC: các tool báo cáo tự sinh Excel qua
// `xuatExcel`/`TepBaoCao` rồi luồng nhân viên gửi bằng `guiFile`. Bot nói
// "em gửi file Excel" là ĐÚNG SỰ THẬT, mà hàng rào không biết đường đó tồn tại.
//
// SỐ ĐO TỪ LOG PROD 24h (11/08/2026, `docker logs zalo-crm-app --since 24h`):
//   - 3/3 lượt bị chặn ("dở dang") đều là CHẶN NHẦM, cả ba cùng ca báo cáo này
//   - 0 lượt bắt được ca bịa thật
//   - 0 lượt `khoeDaChuyenSale` kích hoạt (đúng/sai đều chưa có dữ liệu)
// Tức hàng rào tài liệu đang HẠI 100%, LỢI 0%. Đó là lý do phải sửa gấp.
//
// NGUYÊN TẮC SAU KHI SỬA: lượt đó CÓ sinh ra file/ảnh BẤT KỲ (Excel báo cáo,
// PNG bảng, PDF tài liệu, ảnh hoá đơn) thì câu "em gửi file" là THẬT → cho qua.
// Chỉ chặn khi khoe mà TUYỆT ĐỐI không có gì được sinh ra.
import { describe, it, expect } from 'vitest';
import { coBangChungGuiFile, khoeDaGuiTaiLieu, khoeDaGuiAnh } from '../../../src/modules/ai/agent/y-dinh-dung.js';

/** Câu THẬT bot trả về lúc 21:47:52 ngày 11/08/2026, cắt đúng như trong log. */
const CAU_THAT_2147 =
  'Dạ, báo cáo theo ngày hôm nay (11/08/2026) có 7 mã sản phẩm bán ra, xếp theo số lượng bán';

describe('CA THẬT 21:47:52 11/08 — báo cáo có Excel thật thì PHẢI cho qua', () => {
  it('có tepBaoCao (Excel) → coBangChungGuiFile = true', () => {
    expect(
      coBangChungGuiFile({
        tepBaoCao: [{ tenFile: 'bao-cao.xlsx', loai: 'file', moTa: 'Đầy đủ 7 dòng' }],
      }),
    ).toBe(true);
  });

  it('câu thật 21:47 + có Excel → KHÔNG bị chặn', () => {
    // Hàng rào văn bản vẫn có thể nhận ra chữ "file"/"báo cáo", nhưng caller
    // phải cho qua vì bằng chứng CÓ THẬT. Đây là điều kiện chặn đầy đủ.
    const biChan =
      khoeDaGuiTaiLieu(CAU_THAT_2147) &&
      !coBangChungGuiFile({
        tepBaoCao: [{ tenFile: 'bao-cao.xlsx', loai: 'file', moTa: 'Đầy đủ 7 dòng' }],
      });
    expect(biChan).toBe(false);
  });

  it('bot nói thẳng "em gửi file Excel báo cáo" + có Excel → cho qua', () => {
    const traLoi = 'Dạ em gửi file Excel báo cáo bán ra hôm nay cho anh ạ';
    const biChan =
      khoeDaGuiTaiLieu(traLoi) &&
      !coBangChungGuiFile({
        tepBaoCao: [{ tenFile: 'bao-cao.xlsx', loai: 'file', moTa: '7 dòng' }],
      });
    expect(biChan).toBe(false);
  });
});

describe('MỌI ĐƯỜNG GỬI THẬT đều tính là bằng chứng', () => {
  it('Excel báo cáo (tepBaoCao loai=file)', () => {
    expect(coBangChungGuiFile({ tepBaoCao: [{ tenFile: 'a.xlsx', loai: 'file', moTa: '' }] })).toBe(true);
  });

  it('ảnh bảng báo cáo (tepBaoCao loai=anh — từ bangRaAnh khi xuất Excel lỗi)', () => {
    expect(coBangChungGuiFile({ tepBaoCao: [{ tenFile: 'a.png', loai: 'anh', moTa: '' }] })).toBe(true);
  });

  it('PDF tài liệu (tool gui_tai_lieu)', () => {
    expect(coBangChungGuiFile({ taiLieu: [{ tieuDe: 'Datasheet P10', duongDanCucBo: '/tmp/p10.pdf' }] })).toBe(true);
  });

  it('ảnh hoá đơn (tool gui_hoa_don)', () => {
    expect(coBangChungGuiFile({ coAnhHoaDon: true })).toBe(true);
  });

  it('KHÔNG có gì cả → false', () => {
    expect(coBangChungGuiFile({})).toBe(false);
    expect(coBangChungGuiFile({ tepBaoCao: [], taiLieu: [], coAnhHoaDon: false })).toBe(false);
  });
});

describe('CHỨC NĂNG CHÍNH KHÔNG ĐƯỢC HỎNG — bot bịa vẫn phải bị chặn', () => {
  it('bot nói "em gửi tài liệu" mà KHÔNG có gì → VẪN CHẶN', () => {
    const traLoi = 'Dạ em đã gửi tài liệu kỹ thuật P10 cho anh rồi ạ';
    const biChan = khoeDaGuiTaiLieu(traLoi) && !coBangChungGuiFile({});
    expect(biChan).toBe(true);
  });

  it('bot bịa "em gửi catalog" mà không có file → VẪN CHẶN', () => {
    const traLoi = 'Dạ em gửi catalog cho anh rồi ạ';
    expect(khoeDaGuiTaiLieu(traLoi) && !coBangChungGuiFile({})).toBe(true);
  });

  it('bot bịa "em gửi file Excel" mà KHÔNG sinh file nào → VẪN CHẶN', () => {
    // Đây là ca nguy hiểm nhất của bug 21:47: nới hàng rào không được nới
    // thành "cứ nói file là cho qua". Không có bằng chứng thì vẫn chặn.
    const traLoi = 'Dạ em gửi file Excel báo cáo cho anh nhé';
    expect(khoeDaGuiTaiLieu(traLoi) && !coBangChungGuiFile({})).toBe(true);
  });

  it('bot bịa "em gửi lại ảnh đơn hàng" mà không có ảnh nào → VẪN CHẶN', () => {
    // Bug thật 07/08/2026 DNH36805 — chạy 0 tool, ảnh không hề được gửi.
    const traLoi = 'Dạ, em gửi lại ảnh đơn hàng DNH36805 cho anh ạ';
    expect(khoeDaGuiAnh(traLoi) && !coBangChungGuiFile({})).toBe(true);
  });
});

describe('HÀNG RÀO ẢNH cũng cùng bệnh — ảnh bảng báo cáo là ảnh THẬT', () => {
  it('bot nói "em gửi ảnh báo cáo" + có ảnh bảng (bangRaAnh) → cho qua', () => {
    // `bangRaAnh` sinh PNG khi xuất Excel lỗi hoặc cờ AI_BAO_CAO_CHI_ANH=1.
    // Ảnh đó là ảnh THẬT, đi qua guiAnh — không phải ảnh hoá đơn gui_hoa_don.
    const traLoi = 'Dạ em gửi ảnh báo cáo bán hàng hôm nay cho anh ạ';
    const biChan =
      khoeDaGuiAnh(traLoi) &&
      !coBangChungGuiFile({ tepBaoCao: [{ tenFile: 'bc.png', loai: 'anh', moTa: '' }] });
    expect(biChan).toBe(false);
  });

  it('bot nói gửi ảnh hoá đơn + có ảnh hoá đơn thật → cho qua', () => {
    const traLoi = 'Dạ em gửi lại ảnh đơn hàng DNH36805 cho anh ạ';
    const biChan = khoeDaGuiAnh(traLoi) && !coBangChungGuiFile({ coAnhHoaDon: true });
    expect(biChan).toBe(false);
  });
});
