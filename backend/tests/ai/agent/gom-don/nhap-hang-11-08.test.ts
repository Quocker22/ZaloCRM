// SPDX-License-Identifier: AGPL-3.0-or-later
// CA THẬT 22:09-22:11 ngày 11/08/2026 (nhóm Test-AI) — bot từ chối việc nó LÀM ĐƯỢC.
//
//   22:09 NV : "@bot rồi tạo phiếu nhập hàng giúp tôi luôn"
//         Bot: "em hiện chỉ có tool lên đơn BÁN và quản lý tồn, chưa có tool tạo
//               phiếu nhập hàng (mua hàng) — em không thể tạo phiếu nhập kho được ạ."
//   22:11 NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10 full
//               out: 10.000 tấm..."   (danh sách 13 dòng hàng)
//         Bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
//
// Bot nói SAI. Đo quyền trên prod 11/08 bằng chính tài khoản bot_zalo:
//   purchase.order       write=true create=true
//   purchase.order.line  write=true create=true
//   stock.picking        write=true create=true
// và 5 đơn mua thật đang nằm đó (P04517-P04521), 4 đơn của NCC "Trung Quốc".
// Thiếu là thiếu TOOL + thiếu chỗ trong máy gom đơn, không thiếu quyền.
//
// VÌ SAO BÁM MÁY GOM ĐƠN (anh Quốc 11/08: "dựa vào luồng lên đơn mà làm nhé,
// tại hiện tại luồng lên đơn khá ok rồi"): ca thật trải QUA HAI LƯỢT — 22:09
// nói ý định, 22:11 mới dán danh sách hàng. Không có phiên gom (TTL 15') thì
// lượt sau lại hỏi lại từ đầu. Nhập hàng là cùng một bài toán slot-form với
// lên đơn, chỉ đổi khách→NCC và giá bán→giá nhập.
import { describe, it, expect } from 'vitest';
import { buocTiepTheo } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/buoc-tiep-theo.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

/** NCC thật trên prod: id=314, NCC000001, supplier_rank=5. */
const NCC = { id: 314, ten: 'Trung Quốc', ma: 'NCC000001' };
/** NCC thứ hai cũng khớp "Trung Quốc" trên prod — ca nhiều ứng viên THẬT. */
const NCC_2 = { id: 21, ten: 'Trung Quốc- Kho Cô Lỳ', ma: 'NCC000290' };

const SP_MAN_HINH = { id: 901, ten: 'Màn hình LED P10 full out', gia: 0 };

describe('máy gom đơn — chế NHẬP HÀNG (ca thật 22:09-22:11 11/08)', () => {
  it('mới nói "tạo phiếu nhập hàng", chưa có gì → HỎI NHÀ CUNG CẤP', () => {
    // Đúng lượt 22:09. Máy phải nhận việc và hỏi tiếp, KHÔNG được từ chối.
    const p: PhienGom = { che: 'nhap', khachTuKhoa: null, dong: [] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'ncc' });
  });

  it('có tên NCC chưa tra → tra_cuu (tra NCC, không tra khách hàng)', () => {
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      dong: [{ tuKhoa: 'P10 full out', sl: 10000 }],
    };
    expect(buocTiepTheo(p)).toEqual({
      loai: 'tra_cuu', ncc: 'Trung Quốc', sp: ['P10 full out'],
    });
  });

  it('nhiều NCC khớp "Trung Quốc" → hỏi chọn, KHÔNG tự nhặt', () => {
    // Trên prod "Trung Quốc" ra ĐÚNG 2 NCC (id=314 và id=21). Tự chọn là rủi
    // ro treo cả đơn nhập vào sai nhà cung cấp.
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachUngVien: [{ ...NCC, dienThoai: null, congNo: 0 }, { ...NCC_2, dienThoai: null, congNo: 0 }],
      dong: [{ tuKhoa: 'P10', sl: 10000, daChot: SP_MAN_HINH }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_chon' });
  });

  it('có NCC nhưng CHƯA có hàng → hỏi hàng (lượt 22:09 → 22:11)', () => {
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachDaChot: { ...NCC, dienThoai: null }, dong: [],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sp' });
  });

  it('thiếu SỐ LƯỢNG một dòng → hỏi SL', () => {
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachDaChot: { ...NCC, dienThoai: null },
      dong: [{ tuKhoa: 'P10', sl: null, daChot: SP_MAN_HINH }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sl' });
  });

  it('ĐỦ NCC + hàng + SL → TẠO PHIẾU NHẬP LUÔN, không hỏi chốt', () => {
    // Nhất quán với việc anh Quốc bỏ bước chốt cho lên đơn (commit 7d568b90).
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachDaChot: { ...NCC, dienThoai: null },
      dong: [{ tuKhoa: 'P10', sl: 10000, daChot: SP_MAN_HINH }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don_mua' });
  });

  it('KHÔNG CÓ GIÁ NHẬP vẫn tạo phiếu — KHÔNG hỏi giá', () => {
    // ĐÂY LÀ KHÁC BIỆT LỚN NHẤT so với đơn BÁN. Bên bán, SP giá 0/1đ mà NV
    // chưa báo giá thì máy chặn lại hỏi (`hoi_gia`) — vì bán 0đ là mất tiền.
    //
    // Nhập hàng thì ngược: giá nhập là giá NCC báo, thường chưa có lúc tạo
    // phiếu. Ca thật 22:11 nhân viên dán 13 dòng hàng, phần lớn không kèm giá.
    // Và chính đơn THẬT P04520 trên prod (263 triệu, NCC Trung Quốc) đang có 3
    // dòng price_unit=0 nằm cạnh 2 dòng 8.300đ — nghiệp vụ vốn đã như vậy.
    //
    // Nên: để TRỐNG cho người điền sau. Phiếu nháp, sửa được trên Odoo.
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachDaChot: { ...NCC, dienThoai: null },
      // gia=0 trong Odoo (chưa có giá bán) VÀ nhân viên không báo giá nhập
      dong: [{ tuKhoa: 'P10', sl: 10000, daChot: SP_MAN_HINH }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don_mua' });
  });

  it('KHÔNG áp hàng rào giá lệch của đơn bán vào đơn mua', () => {
    // `lechVoLy` so giá NV báo với `list_price` = GIÁ BÁN. Giá nhập thấp hơn
    // giá bán nhiều lần là chuyện BÌNH THƯỜNG (đó chính là lãi gộp) — áp hàng
    // rào đó vào đơn mua thì phiếu nhập nào cũng bị chặn hỏi vô cớ.
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'Trung Quốc',
      khachDaChot: { ...NCC, dienThoai: null },
      dong: [{
        tuKhoa: 'P10', sl: 10000,
        daChot: { id: 901, ten: 'Màn hình P10', gia: 2_000_000 },
        donGia: 800_000, // giá NHẬP, thấp hơn giá bán 2,5 lần — hoàn toàn hợp lý
      }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don_mua' });
  });

  it('NCC tra không thấy → báo ngay, KHÔNG tự tạo NCC mới', () => {
    // Bài học ca "khách rác Long" 11/08: bot tự bịa partner rồi xuất hoá đơn
    // 21 triệu lên đó. Chế nhập KHÔNG có nhánh `tao_khach` tương ứng.
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'NCC Không Có Thật', khachKhongThay: true,
      dong: [{ tuKhoa: 'P10', sl: 100, daChot: SP_MAN_HINH }],
    };
    const hd = buocTiepTheo(p);
    expect(hd.loai).toBe('khong_thay');
    if (hd.loai === 'khong_thay') expect(hd.khach).toBe('NCC Không Có Thật');
  });

  it('nhân viên khai "khách mới" trong chế NHẬP → KHÔNG tạo partner', () => {
    // Chế 'len' có nhánh tao_khach. Chế 'nhap' TUYỆT ĐỐI không: tạo NCC là
    // việc của kế toán, không phải của bot.
    const p: PhienGom = {
      che: 'nhap', khachTuKhoa: 'NCC lạ',
      khachMoi: { ten: 'NCC lạ' },
      dong: [{ tuKhoa: 'P10', sl: 100, daChot: SP_MAN_HINH }],
    };
    expect(buocTiepTheo(p).loai).not.toBe('tao_khach');
  });
});

describe('chế nhập KHÔNG phá chế lên đơn / sửa đơn', () => {
  it('chế "len" (mặc định) vẫn ra tao_don như cũ', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng',
      khachDaChot: { id: 7, ten: 'Hưng', ma: 'KH1', dienThoai: '09' },
      dong: [{ tuKhoa: 'nguồn', sl: 10, daChot: { id: 3, ten: 'Nguồn NB', gia: 185000 } }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_don' });
  });

  it('chế "sua" vẫn ra sua_don như cũ', () => {
    const p: PhienGom = {
      che: 'sua', khachTuKhoa: null,
      donSua: { id: 1, ma: 'S13820', tong: 100000 },
      dong: [{ tuKhoa: 'nguồn', sl: 10, daChot: { id: 3, ten: 'Nguồn NB', gia: 185000 } }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'sua_don' });
  });
});
