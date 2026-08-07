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
