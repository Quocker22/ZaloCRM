// SPDX-License-Identifier: AGPL-3.0-or-later
// Ngăn "Thành viên nhóm" của trang Quyền bot: nhãn từng người, câu nguồn danh sách, cảnh báo người ngoài.
import { describe, it, expect } from 'vitest';
import type { ThanhVien } from '@/api/bot-quyen';
import { chipThanhVien, chuNguonThanhVien, canhBaoNguoiNgoai, tenThanhVien, goiYCongTy, mauTuThanhVien } from './bot-quyen-thanh-vien';

const tv = (them: Partial<ThanhVien>): ThanhVien => ({
  zaloUid: 'u1', ten: 'Lan', loai: 'nguoi_ngoai', laNickCrm: false, nhanVien: null, ...them,
});

describe('chipThanhVien — nhãn mỗi người', () => {
  it('nhân viên: chip vai + chip trạng thái', () => {
    const c = chipThanhVien(tv({ loai: 'nhan_vien', nhanVien: { id: 'n1', tenGoi: 'Lan', vai: 'sales', trangThai: 'hoat_dong' } }));
    expect(c.map((x) => x.chu)).toEqual(['Nhân viên · Bán hàng', 'Hoạt động']);
    expect(c[1].mau).toBe('xanh');
  });
  it('nhân viên đã nghỉ: chip trạng thái đỏ, nói nhóm sẽ im', () => {
    const c = chipThanhVien(tv({ loai: 'nhan_vien', nhanVien: { id: 'n1', tenGoi: 'Lan', vai: 'kho', trangThai: 'nghi' } }));
    expect(c.map((x) => x.chu)).toEqual(['Nhân viên · Kho', 'Đã nghỉ (nhóm có người này sẽ im)']);
    expect(c[1].mau).toBe('do');
  });
  it('người công ty: không ghi "Nhân viên ·", chỉ nhãn vai', () => {
    const c = chipThanhVien(tv({ loai: 'nhan_vien', nhanVien: { id: 'n1', tenGoi: 'Tài xế', vai: 'cong_ty', trangThai: 'hoat_dong' } }));
    expect(c[0].chu).toBe('Người công ty (không dùng bot)');
  });
  it('nick của chính nhóm: "Nick của nhóm"', () => {
    expect(chipThanhVien(tv({ loai: 'nick_crm', laNickCrm: true })).map((x) => x.chu)).toEqual(['Nick của nhóm']);
  });
  it('người ngoài: "Người ngoài" (đỏ); nếu là nick CRM khác thì thêm "Nick CRM khác"', () => {
    const a = chipThanhVien(tv({}));
    expect(a.map((x) => x.chu)).toEqual(['Người ngoài']);
    expect(a[0].mau).toBe('do');
    expect(chipThanhVien(tv({ laNickCrm: true })).map((x) => x.chu)).toEqual(['Người ngoài', 'Nick CRM khác']);
  });
  it('nick CRM khác đã xếp là người công ty: vẫn ghi "Nick CRM khác"', () => {
    const c = chipThanhVien(tv({ loai: 'nhan_vien', laNickCrm: true, nhanVien: { id: 'n2', tenGoi: 'Nick HCM', vai: 'cong_ty', trangThai: 'hoat_dong' } }));
    expect(c.map((x) => x.chu)).toEqual(['Người công ty (không dùng bot)', 'Hoạt động', 'Nick CRM khác']);
  });
  it('vai lạ (backend mới hơn) ⇒ hiện nguyên mã, không vỡ', () => {
    const c = chipThanhVien(tv({ loai: 'nhan_vien', nhanVien: { id: 'n1', tenGoi: 'X', vai: 'la', trangThai: 'la2' } }));
    expect(c.map((x) => x.chu)).toEqual(['Nhân viên · la', 'la2']);
  });
});

describe('goiYCongTy — nick CRM khác nên xếp là người công ty', () => {
  it('chỉ người ngoài là nick CRM', () => {
    expect(goiYCongTy(tv({ laNickCrm: true }))).toBe(true);
    expect(goiYCongTy(tv({}))).toBe(false);
    expect(goiYCongTy(tv({ loai: 'nick_crm', laNickCrm: true }))).toBe(false);
  });
});

describe('mauTuThanhVien — điền sẵn hộp thêm nhân viên từ một thành viên nhóm', () => {
  const nhom = { tenNhom: 'Sales HN', nick: { id: 'a', displayName: 'Nick HN', zaloUid: '900', status: 'connected' } };
  it('"Đặt làm nhân viên": uid khoá, tên gọi = tên thành viên, vai để người dùng chọn', () => {
    expect(mauTuThanhVien(tv({ zaloUid: '555', ten: 'Chị Lan' }), nhom, 'nhan_vien')).toEqual({
      zaloUid: '555', tenGoi: 'Chị Lan', khoaUid: true, tieuDe: 'Đặt “Chị Lan” làm nhân viên',
      nguon: 'Thành viên nhóm “Sales HN” · uid theo nick Nick HN',
    });
  });
  it('"Là người công ty": vai cố định cong_ty', () => {
    const m = mauTuThanhVien(tv({ zaloUid: '901', ten: 'Nick HCM', laNickCrm: true }), nhom, 'cong_ty');
    expect(m.vaiCoDinh).toBe('cong_ty');
    expect(m.tieuDe).toBe('“Nick HCM” là người công ty (không dùng bot)');
  });
  it('thành viên không tên ⇒ tên gọi trống (người dùng tự gõ), tiêu đề dùng uid', () => {
    const m = mauTuThanhVien(tv({ zaloUid: '777', ten: '' }), nhom, 'nhan_vien');
    expect(m.tenGoi).toBe('');
    expect(m.tieuDe).toBe('Đặt “777” làm nhân viên');
  });
});

describe('tenThanhVien', () => {
  it('không có tên ⇒ dùng uid', () => {
    expect(tenThanhVien(tv({ ten: '  ' }))).toBe('u1');
    expect(tenThanhVien(tv({}))).toBe('Lan');
  });
});

describe('chuNguonThanhVien — danh sách lấy từ đâu', () => {
  it('da_quet ⇒ "Theo lần quét lúc …" (giờ VN)', () => {
    const n = chuNguonThanhVien({ nguon: 'da_quet', nguonLuc: '2026-09-30T02:05:00.000Z', loiZalo: null });
    expect(n.chu).toBe('Theo lần quét lúc 30/09/2026 09:05');
  });
  it('zalo ⇒ "Đọc từ Zalo lúc …"', () => {
    const n = chuNguonThanhVien({ nguon: 'zalo', nguonLuc: '2026-09-30T02:05:00.000Z', loiZalo: null });
    expect(n.chu).toBe('Đọc từ Zalo lúc 30/09/2026 09:05');
    expect(n.phu).toBeNull();
  });
  it('tin_nhan ⇒ "Theo người đã nhắn trong nhóm" + lý do Zalo lỗi', () => {
    const n = chuNguonThanhVien({ nguon: 'tin_nhan', nguonLuc: null, loiZalo: 'Zalo không trả lời sau 10 giây' });
    expect(n.chu).toBe('Theo người đã nhắn trong nhóm');
    expect(n.phu).toContain('Zalo không trả lời sau 10 giây');
    expect(n.phu).toContain('chưa từng nhắn');
  });
});

describe('canhBaoNguoiNgoai', () => {
  it('có người ngoài và nhóm không phải Khách ⇒ câu cảnh báo nguyên văn', () => {
    expect(canhBaoNguoiNgoai(2, 'sales')).toBe(
      'Nhóm có 2 người ngoài — bot sẽ im trong nhóm này cho tới khi anh/chị xếp họ là nhân viên hoặc người công ty, hoặc đổi nhóm sang Khách.',
    );
    expect(canhBaoNguoiNgoai(1, null)).toContain('Nhóm có 1 người ngoài');
  });
  it('nhóm Khách hoặc không có người ngoài ⇒ không cảnh báo', () => {
    expect(canhBaoNguoiNgoai(3, 'khach')).toBeNull();
    expect(canhBaoNguoiNgoai(0, 'admin')).toBeNull();
  });
});
