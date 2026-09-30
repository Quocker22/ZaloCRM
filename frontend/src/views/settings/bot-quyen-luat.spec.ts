// SPDX-License-Identifier: AGPL-3.0-or-later
// Luật thuần của trang "Quyền bot" (docs/77 §2–§3.3): nhãn, câu hệ quả, "hạ" ⇒ bắt buộc lý do.
// Luật "hạ" PHẢI khớp backend `bot-quyen-luat.ts` (backend vẫn chặn — đây là để chặn sớm + nói rõ).
import { describe, it, expect } from 'vitest';
import {
  CHUC_NANG, VAI, TRANG_THAI, NHAN_CHUC_NANG, NHAN_VAI, NHAN_TRANG_THAI, HE_QUA_CHUC_NANG, HE_QUA_BO_XEP_LOAI,
  laHaChucNang, laHaVai, laHaTrangThai, laKhoaKhiTao,
  canLyDoNhom, canLyDoSuaNhanVien, canLyDoTaoNhanVien, thieuLyDo,
  trangThaiBotNhom, heQuaNhanVien,
  type ChucNang, type Vai, type TrangThai,
} from './bot-quyen-luat';

describe('nhãn tiếng Việt', () => {
  it('vai, trạng thái, chức năng — đúng chữ đã chốt', () => {
    expect(NHAN_VAI).toEqual({
      admin: 'Quản trị', sales: 'Bán hàng', kho: 'Kho', ke_toan: 'Kế toán', cong_ty: 'Người công ty (không dùng bot)',
    });
    expect(NHAN_TRANG_THAI).toEqual({
      hoat_dong: 'Hoạt động', khoa: 'Khoá', nghi: 'Đã nghỉ (nhóm có người này sẽ im)',
    });
    expect(NHAN_CHUC_NANG.admin).toBe('Quản trị');
    expect(NHAN_CHUC_NANG.sales).toBe('Bán hàng');
    expect(NHAN_CHUC_NANG.khach).toBe('Khách');
    expect([...CHUC_NANG]).toEqual(['admin', 'sales', 'kho', 'ke_toan', 'khach']);
    expect([...VAI]).toEqual(['admin', 'sales', 'kho', 'ke_toan', 'cong_ty']);
    expect([...TRANG_THAI]).toEqual(['hoat_dong', 'khoa', 'nghi']);
  });

  it('câu hệ quả mỗi chức năng nhóm — nguyên văn', () => {
    expect(HE_QUA_CHUC_NANG).toEqual({
      admin: 'Mọi người trong nhóm hỏi được mọi thứ: số liệu, lãi, công nợ, kho, đơn của mọi nhân viên.',
      sales: 'Lên đơn, tra cứu, thông số. Người có vai cao hơn (admin, kế toán, kho) vẫn dùng đủ quyền của họ.',
      kho: 'Như sales, thêm quyền kho (nhập, chuyển kho) cho mọi người trong nhóm.',
      ke_toan: 'Như sales, thêm xem lãi gộp và công nợ cho mọi người trong nhóm.',
      khach: 'Nhóm có khách: bot im, không trả lời gì trong nhóm (giữ kín giá, SĐT, đơn).',
    });
    expect(HE_QUA_BO_XEP_LOAI).toBe('Bot sẽ im trong nhóm này.');
  });
});

describe('laHaChucNang — mất ít nhất một năng lực (khớp backend)', () => {
  const ha: Array<[ChucNang | null, ChucNang | null]> = [
    ['admin', 'sales'], ['admin', 'kho'], ['admin', 'ke_toan'], ['admin', 'khach'], ['admin', null],
    ['kho', 'ke_toan'], ['ke_toan', 'kho'], ['kho', 'sales'], ['ke_toan', 'sales'],
    ['sales', 'khach'], ['kho', 'khach'], ['sales', null], ['kho', null],
  ];
  const khongHa: Array<[ChucNang | null, ChucNang | null]> = [
    [null, 'admin'], [null, 'sales'], [null, 'khach'], ['sales', 'kho'], ['sales', 'ke_toan'], ['sales', 'admin'],
    ['khach', 'sales'], ['khach', 'admin'], ['khach', null], ['kho', 'admin'], ['admin', 'admin'], ['sales', 'sales'],
    ['khach', 'khach'], [null, null],
  ];
  it.each(ha)('%s → %s là HẠ', (cu, moi) => {
    expect(laHaChucNang(cu, moi)).toBe(true);
    expect(canLyDoNhom(cu, moi)).toBe(true);
  });
  it.each(khongHa)('%s → %s KHÔNG hạ', (cu, moi) => {
    expect(laHaChucNang(cu, moi)).toBe(false);
    expect(canLyDoNhom(cu, moi)).toBe(false);
  });
});

describe('laHaVai / laHaTrangThai / laKhoaKhiTao (khớp backend)', () => {
  it('vai: admin → bất kỳ, X → cong_ty, kho ↔ ke_toan, kho → sales là hạ; sales → kho, cong_ty → sales thì không', () => {
    for (const v of ['sales', 'kho', 'ke_toan', 'cong_ty'] as Vai[]) expect(laHaVai('admin', v)).toBe(true);
    for (const v of ['admin', 'sales', 'kho', 'ke_toan'] as Vai[]) expect(laHaVai(v, 'cong_ty')).toBe(true);
    expect(laHaVai('kho', 'ke_toan')).toBe(true);
    expect(laHaVai('ke_toan', 'kho')).toBe(true);
    expect(laHaVai('kho', 'sales')).toBe(true);
    expect(laHaVai('sales', 'kho')).toBe(false);
    expect(laHaVai('sales', 'admin')).toBe(false);
    expect(laHaVai('cong_ty', 'sales')).toBe(false);
    expect(laHaVai('cong_ty', 'cong_ty')).toBe(false);
    expect(laHaVai('admin', 'admin')).toBe(false);
  });

  it('trạng thái: hoat_dong > khoa > nghi — đi xuống là khoá; nghi → khoa không phải', () => {
    expect(laHaTrangThai('hoat_dong', 'khoa')).toBe(true);
    expect(laHaTrangThai('hoat_dong', 'nghi')).toBe(true);
    expect(laHaTrangThai('khoa', 'nghi')).toBe(true);
    expect(laHaTrangThai('nghi', 'khoa')).toBe(false);
    expect(laHaTrangThai('khoa', 'hoat_dong')).toBe(false);
    expect(laHaTrangThai('hoat_dong', 'hoat_dong')).toBe(false);
  });

  it('tạo NV: cong_ty hoặc trạng thái ≠ hoạt động ⇒ cần lý do', () => {
    expect(laKhoaKhiTao('cong_ty', 'hoat_dong')).toBe(true);
    expect(laKhoaKhiTao('sales', 'khoa')).toBe(true);
    expect(laKhoaKhiTao('admin', 'nghi')).toBe(true);
    expect(laKhoaKhiTao('sales', 'hoat_dong')).toBe(false);
    expect(laKhoaKhiTao('admin', 'hoat_dong')).toBe(false);
    expect(canLyDoTaoNhanVien('cong_ty', 'hoat_dong')).toBe(true);
    expect(canLyDoTaoNhanVien('kho', 'hoat_dong')).toBe(false);
  });

  it('sửa NV: hạ vai HOẶC khoá ⇒ cần lý do; nâng/giữ thì không', () => {
    const nv = (vai: Vai, trangThai: TrangThai) => ({ vai, trangThai });
    expect(canLyDoSuaNhanVien(nv('admin', 'hoat_dong'), nv('sales', 'hoat_dong'))).toBe(true);
    expect(canLyDoSuaNhanVien(nv('sales', 'hoat_dong'), nv('sales', 'khoa'))).toBe(true);
    expect(canLyDoSuaNhanVien(nv('sales', 'hoat_dong'), nv('admin', 'nghi'))).toBe(true);
    expect(canLyDoSuaNhanVien(nv('sales', 'hoat_dong'), nv('cong_ty', 'hoat_dong'))).toBe(true);
    expect(canLyDoSuaNhanVien(nv('sales', 'hoat_dong'), nv('kho', 'hoat_dong'))).toBe(false);
    expect(canLyDoSuaNhanVien(nv('sales', 'khoa'), nv('sales', 'hoat_dong'))).toBe(false);
    expect(canLyDoSuaNhanVien(nv('sales', 'nghi'), nv('sales', 'khoa'))).toBe(false);
    expect(canLyDoSuaNhanVien(nv('admin', 'hoat_dong'), nv('admin', 'hoat_dong'))).toBe(false);
  });
});

describe('thieuLyDo — lý do rỗng / chỉ khoảng trắng khi bắt buộc thì chặn', () => {
  it('bắt buộc + rỗng/khoảng trắng/null ⇒ thiếu; có chữ ⇒ đủ; không bắt buộc ⇒ không bao giờ thiếu', () => {
    expect(thieuLyDo(true, '')).toBe(true);
    expect(thieuLyDo(true, '   \n ')).toBe(true);
    expect(thieuLyDo(true, null)).toBe(true);
    expect(thieuLyDo(true, undefined)).toBe(true);
    expect(thieuLyDo(true, 'NV nghỉ việc')).toBe(false);
    expect(thieuLyDo(false, '')).toBe(false);
  });
});

describe('trangThaiBotNhom — chữ trạng thái bot của một nhóm', () => {
  it('chưa xếp loại ⇒ đỏ "Bot đang im — chưa xếp loại"', () => {
    expect(trangThaiBotNhom(null)).toMatchObject({ chu: 'Bot đang im — chưa xếp loại', mau: 'do' });
  });
  it('khach ⇒ "Nhóm có khách — bot im"', () => {
    expect(trangThaiBotNhom('khach')).toMatchObject({ chu: 'Nhóm có khách — bot im', mau: 'vang' });
  });
  it('nhóm nội bộ ⇒ "Bot trả lời trong nhóm"', () => {
    for (const c of ['admin', 'sales', 'kho', 'ke_toan'] as ChucNang[]) {
      expect(trangThaiBotNhom(c)).toMatchObject({ chu: 'Bot trả lời trong nhóm', mau: 'xanh' });
    }
  });
});

describe('heQuaNhanVien — câu "bot sẽ làm gì" với người này', () => {
  it('nghỉ ⇒ nhóm có người này im; khoá / người công ty ⇒ bot không nhận lệnh', () => {
    expect(heQuaNhanVien('sales', 'nghi')).toContain('im trong mọi nhóm có người này');
    expect(heQuaNhanVien('admin', 'khoa')).toContain('không nhận lệnh');
    expect(heQuaNhanVien('cong_ty', 'hoat_dong')).toContain('không nhận lệnh');
    expect(heQuaNhanVien('cong_ty', 'hoat_dong')).toContain('không làm nhóm im');
  });
  it('vai đang hoạt động ⇒ nói năng lực', () => {
    expect(heQuaNhanVien('admin', 'hoat_dong')).toContain('lãi');
    expect(heQuaNhanVien('sales', 'hoat_dong')).toContain('Lên đơn');
    expect(heQuaNhanVien('kho', 'hoat_dong')).toContain('kho');
    expect(heQuaNhanVien('ke_toan', 'hoat_dong')).toContain('công nợ');
    expect(heQuaNhanVien(null, 'hoat_dong')).toBe('');
  });
});
