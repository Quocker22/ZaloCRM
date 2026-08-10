// SPDX-License-Identifier: AGPL-3.0-or-later
// Bảng trạng thái của máy gom đơn. Case đầu tiên CHÍNH LÀ bug 21:07 07/08:
// "lên đơn cho anh Hưng 10 cái nguồn NB" mà bot đi hỏi số lượng.
import { describe, it, expect } from 'vitest';
import { buocTiepTheo } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/buoc-tiep-theo.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const khach = { id: 7, ten: 'Hưng Cty A', ma: 'KH001017', dienThoai: '0901' };
const sp = { id: 3, ten: 'Nguồn NB 12V100W', gia: 185000 };

describe('buocTiepTheo — bảng trạng thái', () => {
  it('có từ khoá chưa tra → tra_cuu song song cả khách lẫn SP (kịch bản 21:07 07/08)', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', dong: [{ tuKhoa: 'nguồn NB', sl: 10 }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tra_cuu', khach: 'Hưng', sp: ['nguồn NB'] });
  });

  it('khách nhiều ứng viên → hoi_chon (KHÔNG hỏi SL vì SL đã có)', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng',
      khachUngVien: [{ ...khach, congNo: 0 }, { ...khach, id: 8, congNo: 0 }],
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_chon' });
  });

  it('đủ khách + SP nhưng thiếu SL → hoi_thieu sl', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: null, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sl' });
  });

  it('chưa nói SP nào → hoi_thieu sp', () => {
    const p: PhienGom = { khachTuKhoa: 'Hưng', khachDaChot: khach, dong: [] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sp' });
  });

  it('chưa biết khách (không từ khoá) → hoi_thieu khach', () => {
    const p: PhienGom = { khachTuKhoa: null, dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'khach' });
  });

  it('đủ hết, chưa hỏi chốt → tom_tat_cho_chot; đã hỏi chốt → tao_don', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tom_tat_cho_chot' });
    expect(buocTiepTheo({ ...p, daHoiChot: true })).toEqual({ loai: 'tao_don' });
  });

  it('tra rồi không thấy → khong_thay nêu đúng phần hỏng', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưngg', khachKhongThay: true,
      dong: [{ tuKhoa: 'abc xyz', sl: 2, khongThay: true }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'khong_thay', khach: 'Hưngg', sp: ['abc xyz'] });
  });

  it('khách đã chốt nhưng SP mới thêm chưa tra → tra_cuu chỉ SP', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Hưng', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }, { tuKhoa: 'đèn pha 50w', sl: null }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tra_cuu', sp: ['đèn pha 50w'] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CHẾ SỬA ĐƠN (spec 2026-08-08). Nguyên tắc anh Quốc chốt: rõ hết thì ghi
// THẲNG (không hỏi chốt như lên đơn); mơ hồ chỗ nào hỏi đúng chỗ đó.
describe('buocTiepTheo — chế sua', () => {
  const don = { id: 26737, ma: 'S13820', tong: 1070000 };
  const cap = { id: 1051, ten: 'cáp 16 sợi nhỏ (cuộn)', gia: 170000 };

  it('chưa biết đơn + chưa tra SP → tra_cuu cả đơn lẫn SP', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, dong: [{ tuKhoa: 'cáp 16 sợi nhỏ', sl: 1000 }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tra_cuu', sp: ['cáp 16 sợi nhỏ'], don: true });
  });

  it('nhiều đơn nháp → hoi_chon_don (chưa hỏi SP vì SP đã rõ)', () => {
    const p: PhienGom = {
      che: 'sua', khachTuKhoa: null,
      donUngVien: [don, { id: 26738, ma: 'S13821', tong: 780000 }],
      dong: [{ tuKhoa: 'cáp', sl: 1000, daChot: cap }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_chon_don' });
  });

  it('không có đơn nháp nào → khong_thay_don', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donKhongThay: true,
      dong: [{ tuKhoa: 'cáp', sl: 1000, daChot: cap }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'khong_thay_don' });
  });

  it('biết đơn + nhiều SP khớp → hoi_chon (KHÔNG ghi bừa)', () => {
    const p: PhienGom = {
      che: 'sua', khachTuKhoa: null, donSua: don,
      dong: [{ tuKhoa: 'cáp', sl: 1000, ungVien: [cap as never, { ...cap, id: 1052 } as never] }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_chon' });
  });

  it('biết đơn + SP rõ nhưng thiếu SL → hoi_thieu sl', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donSua: don,
      dong: [{ tuKhoa: 'cáp', sl: null, daChot: cap }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sl' });
  });

  it('ĐỦ RÕ → sua_don NGAY, không qua tom_tat_cho_chot', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donSua: don,
      dong: [{ tuKhoa: 'cáp', sl: 1000, daChot: cap }] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'sua_don' });
  });

  it('chế sua KHÔNG đòi khách — sửa đơn thì khách đã có sẵn trên đơn', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donSua: don,
      dong: [{ tuKhoa: 'cáp', sl: 1000, daChot: cap }] };
    expect(buocTiepTheo(p)).not.toEqual({ loai: 'hoi_thieu', thieu: 'khach' });
  });

  it('chế sua chưa nói SP nào → hoi_thieu sp', () => {
    const p: PhienGom = { che: 'sua', khachTuKhoa: null, donSua: don, dong: [] };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_thieu', thieu: 'sp' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GỠ KẸT + GIÁ NV BÁO (spec 2026-08-10, từ demo nhóm 17:00-17:23).
// Bug gốc: phiên dính SP giá 1đ, 5 lệnh liên tiếp đều trả một câu lỗi cũ —
// kể cả "lên đơn cho anh Hoàng" (khách khác hẳn).
describe('buocTiepTheo — SP chưa có giá', () => {
  const khach = { id: 7, ten: 'Anh Vấn Đà Nẵng', ma: 'KH000027', dienThoai: '0934786998' };
  const spThat = { id: 1037, ten: 'Nguồn NB Ngoài Trời 12V400W (cái)', gia: 132000 };
  const spAo = { id: 1922, ten: 'Led thanh tỏa Lixin 220V Ngoài Trời Màu Trắng', gia: 1 };

  it('dòng chốt SP giá ảo mà NV chưa báo giá → hoi_gia, KHÔNG cho tạo đơn', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Vấn', khachDaChot: khach,
      dong: [
        { tuKhoa: 'nguồn NB', sl: 10, daChot: spThat },
        { tuKhoa: 'led tỏa', sl: 300, daChot: spAo },
      ],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'hoi_gia', sp: [spAo.ten] });
  });

  it('SP giá ảo NHƯNG NV đã báo giá → cho qua, tóm tắt chốt bình thường', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Vấn', khachDaChot: khach,
      dong: [
        { tuKhoa: 'nguồn NB', sl: 10, daChot: spThat, donGia: 170000 },
        { tuKhoa: 'led tỏa', sl: 300, daChot: spAo, donGia: 13000 },
      ],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tom_tat_cho_chot' });
  });

  it('bỏ dòng SP giá ảo ra → phần còn lại chốt được ngay', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Vấn', khachDaChot: khach,
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: spThat }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tom_tat_cho_chot' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KHÁCH MỚI (bug 3 demo 17:08-17:09 10/08): NV nói "khách mới" + cho tên/SĐT,
// bot đáp "hệ thống chưa cho phép tạo khách mới trong lượt này" — máy gom đơn
// chỉ biết TRA khách, không có đường tạo.
describe('buocTiepTheo — khách mới', () => {
  const sp = { id: 3, ten: 'Nguồn NB 12V100W', gia: 78000 };

  it('tra không thấy khách + NV đã cho tên → tao_khach (không hỏi lại vòng vo)', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Chiến Tàm Xá', khachKhongThay: true, khachMoi: { ten: 'Chiến Tàm Xá', sdt: '0969810330' },
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tao_khach' });
  });

  it('tra không thấy nhưng CHƯA có thông tin khách mới → vẫn báo không thấy', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Chiến Tàm Xá', khachKhongThay: true,
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'khong_thay', khach: 'Chiến Tàm Xá', sp: [] });
  });

  it('khách đã tạo xong (khachDaChot) → chạy tiếp bình thường', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Chiến Tàm Xá',
      khachDaChot: { id: 99, ten: 'Chiến Tàm Xá', ma: 'KH003200', dienThoai: '0969810330' },
      dong: [{ tuKhoa: 'nguồn NB', sl: 10, daChot: sp }],
    };
    expect(buocTiepTheo(p)).toEqual({ loai: 'tom_tat_cho_chot' });
  });
});
