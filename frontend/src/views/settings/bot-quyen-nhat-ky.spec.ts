// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký quyền bot: mỗi dòng đọc thành MỘT câu dựng từ trước/sau (+ lý do).
import { describe, it, expect } from 'vitest';
import type { NhatKy } from '@/api/bot-quyen';
import { cauNhatKy } from './bot-quyen-nhat-ky';

const nk = (them: Partial<NhatKy>): NhatKy => ({
  id: 'k1', luc: '2026-09-30T02:00:00.000Z', aiId: 'u1', ai: { id: 'u1', fullName: 'Nguyễn A' }, tuDong: false,
  doiTuong: 'nhom', doiTuongId: 'c1', tenDoiTuong: 'Sales HN', truoc: null, sau: null, lyDo: null, ...them,
});
const nhom = (chucNang: string, tenDangKy = '', ghiChu: string | null = null) => ({ chucNang, tenDangKy, ghiChu });
const nv = (them: Record<string, unknown> = {}) => ({
  zaloUid: '555', tenGoi: 'Lan', vai: 'sales', trangThai: 'hoat_dong', userId: null, ghiChu: null, ...them,
});

describe('cauNhatKy — nhóm', () => {
  it('đổi chức năng + lý do (ví dụ đã chốt)', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales'), sau: nhom('admin'), lyDo: 'nhóm quản lý' }))).toBe(
      'Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: nhóm quản lý',
    );
  });
  it('xếp loại lần đầu', () => {
    expect(cauNhatKy(nk({ sau: nhom('khach') }))).toBe('Nguyễn A xếp nhóm “Sales HN” là Khách');
  });
  it('bỏ xếp loại ⇒ nói bot im', () => {
    expect(cauNhatKy(nk({ truoc: nhom('kho'), sau: null, lyDo: 'nhóm cũ' }))).toBe(
      'Nguyễn A bỏ xếp loại nhóm “Sales HN” (trước là Kho) — bot im trong nhóm — lý do: nhóm cũ',
    );
  });
  it('chỉ đổi tên đăng ký / ghi chú', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales', 'Sales HN'), sau: nhom('sales', 'Bán hàng HN', 'ca sáng') }))).toBe(
      'Nguyễn A sửa nhóm “Sales HN”: tên đăng ký từ “Sales HN” sang “Bán hàng HN”; ghi chú từ “(trống)” sang “ca sáng”',
    );
  });
  it('đổi chức năng kèm đổi tên đăng ký', () => {
    expect(cauNhatKy(nk({ truoc: nhom('sales', 'A'), sau: nhom('ke_toan', 'B') }))).toBe(
      'Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Kế toán; tên đăng ký từ “A” sang “B”',
    );
  });
  it('nhóm mất tên Zalo ⇒ dùng tên đăng ký; người làm đã bị xoá', () => {
    expect(cauNhatKy(nk({ tenDoiTuong: null, ai: null, sau: nhom('sales', 'Kho HCM') }))).toBe(
      'Người dùng đã bị xoá xếp nhóm “Kho HCM” là Bán hàng',
    );
  });
});

describe('cauNhatKy — mặc định TỰ ĐỔI (góp ý chủ (4))', () => {
  it('sales → khach có lý do: câu không có người làm, nói rõ "(mặc định)"', () => {
    expect(cauNhatKy(nk({
      aiId: 'tu_dong', ai: null, tuDong: true,
      truoc: { chucNang: 'sales', macDinh: true }, sau: { chucNang: 'khach', macDinh: true },
      lyDo: 'có người ngoài vào nhóm: Lạ Văn A',
    }))).toBe('Nhóm “Sales HN”: Nhóm nhân viên (mặc định) → Khách (mặc định) — có người ngoài vào nhóm: Lạ Văn A');
  });
  it('khach → sales', () => {
    expect(cauNhatKy(nk({
      aiId: 'tu_dong', ai: null, tuDong: true,
      truoc: { chucNang: 'khach', macDinh: true }, sau: { chucNang: 'sales', macDinh: true }, lyDo: 'mọi thành viên đều là nhân viên',
    }))).toBe('Nhóm “Sales HN”: Khách (mặc định) → Nhóm nhân viên (mặc định) — mọi thành viên đều là nhân viên');
  });
});

describe('cauNhatKy — nhân viên', () => {
  it('thêm nhân viên', () => {
    expect(cauNhatKy(nk({ doiTuong: 'nhan_vien', doiTuongId: 'n1', tenDoiTuong: 'Lan', sau: nv() }))).toBe(
      'Nguyễn A thêm nhân viên “Lan” (Zalo 555) với vai Bán hàng, trạng thái Hoạt động',
    );
  });
  it('thêm người công ty kèm lý do', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Tài xế', sau: nv({ tenGoi: 'Tài xế', vai: 'cong_ty' }), lyDo: 'tài xế giao hàng',
    }))).toBe(
      'Nguyễn A thêm nhân viên “Tài xế” (Zalo 555) với vai Người công ty (không dùng bot), trạng thái Hoạt động — lý do: tài xế giao hàng',
    );
  });
  it('hạ vai + khoá', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan', truoc: nv({ vai: 'admin' }), sau: nv({ trangThai: 'khoa' }), lyDo: 'nghỉ phép',
    }))).toBe('Nguyễn A đổi nhân viên “Lan”: vai từ Quản trị sang Bán hàng; trạng thái từ Hoạt động sang Khoá — lý do: nghỉ phép');
  });
  it('đổi tên gọi, liên kết tài khoản CRM (tra tên), ghi chú', () => {
    const tenNguoiDung = (id: string) => (id === 'crm1' ? 'Trần B' : null);
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan Anh',
      truoc: nv(), sau: nv({ tenGoi: 'Lan Anh', userId: 'crm1', ghiChu: 'ca tối' }),
    }), { tenNguoiDung })).toBe(
      'Nguyễn A đổi nhân viên “Lan Anh”: tên gọi từ “Lan” sang “Lan Anh”; tài khoản CRM từ (không liên kết) sang Trần B; ghi chú từ “(trống)” sang “ca tối”',
    );
  });
  it('tài khoản CRM không còn trong danh sách ⇒ ghi rõ', () => {
    expect(cauNhatKy(nk({
      doiTuong: 'nhan_vien', tenDoiTuong: 'Lan', truoc: nv({ userId: 'mat' }), sau: nv(),
    }))).toBe('Nguyễn A đổi nhân viên “Lan”: tài khoản CRM từ (tài khoản không còn) sang (không liên kết)');
  });
});
