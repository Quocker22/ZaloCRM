// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-nhat-ky.ts — dựng MỘT câu tiếng Việt cho mỗi dòng nhật ký quyền bot (docs/77 §3.3 tab Nhật ký),
// từ ảnh chụp trước/sau của backend:
//   nhom      = { chucNang, tenDangKy, ghiChu }
//   nhan_vien = { zaloUid, tenGoi, vai, trangThai, userId, ghiChu }
// truoc = null ⇒ vừa tạo; sau = null ⇒ bỏ xếp loại (chỉ nhóm — nhân viên không xoá cứng).
// Ví dụ: "Nguyễn A đổi nhóm “Sales HN” từ Bán hàng sang Quản trị — lý do: …".
import type { NhatKy } from '@/api/bot-quyen';
import { nhanChucNang, nhanTrangThai, nhanVai } from './bot-quyen-luat';

type Anh = Record<string, unknown> | null;

function chuoi(a: Anh, k: string): string | null {
  const v = a?.[k];
  return typeof v === 'string' ? v : null;
}

/** “x” — rỗng/null ⇒ “(trống)”. */
function trich(x: string | null): string {
  return `“${x && x.trim() ? x : '(trống)'}”`;
}

function doi(ten: string, a: string, b: string): string {
  return `${ten} từ ${a} sang ${b}`;
}

function cauNhom(ai: string, e: NhatKy): string {
  const truoc = e.truoc;
  const sau = e.sau;
  const ten = e.tenDoiTuong?.trim() || chuoi(sau, 'tenDangKy')?.trim() || chuoi(truoc, 'tenDangKy')?.trim() || '(nhóm chưa có tên)';
  const nhom = `nhóm “${ten}”`;
  if (!truoc && sau) return `${ai} xếp ${nhom} là ${nhanChucNang(chuoi(sau, 'chucNang'))}`;
  if (truoc && !sau) return `${ai} bỏ xếp loại ${nhom} (trước là ${nhanChucNang(chuoi(truoc, 'chucNang'))}) — bot im trong nhóm`;
  if (!truoc || !sau) return `${ai} thay đổi ${nhom}`;

  const khac: string[] = [];
  if ((chuoi(truoc, 'tenDangKy') ?? '') !== (chuoi(sau, 'tenDangKy') ?? '')) {
    khac.push(doi('tên đăng ký', trich(chuoi(truoc, 'tenDangKy')), trich(chuoi(sau, 'tenDangKy'))));
  }
  if ((chuoi(truoc, 'ghiChu') ?? '') !== (chuoi(sau, 'ghiChu') ?? '')) {
    khac.push(doi('ghi chú', trich(chuoi(truoc, 'ghiChu')), trich(chuoi(sau, 'ghiChu'))));
  }
  const cnCu = chuoi(truoc, 'chucNang');
  const cnMoi = chuoi(sau, 'chucNang');
  if (cnCu !== cnMoi) {
    const dau = `${ai} đổi ${nhom} từ ${nhanChucNang(cnCu)} sang ${nhanChucNang(cnMoi)}`;
    return khac.length ? `${dau}; ${khac.join('; ')}` : dau;
  }
  return khac.length ? `${ai} sửa ${nhom}: ${khac.join('; ')}` : `${ai} lưu ${nhom} (không đổi gì)`;
}

function cauNhanVien(ai: string, e: NhatKy, tenNguoiDung: (id: string) => string | null): string {
  const truoc = e.truoc;
  const sau = e.sau;
  const ten = e.tenDoiTuong?.trim() || chuoi(sau, 'tenGoi') || chuoi(truoc, 'tenGoi') || chuoi(sau ?? truoc, 'zaloUid') || '(không tên)';
  const nv = `nhân viên “${ten}”`;
  if (!truoc && sau) {
    const uid = chuoi(sau, 'zaloUid');
    return `${ai} thêm ${nv}${uid ? ` (Zalo ${uid})` : ''} với vai ${nhanVai(chuoi(sau, 'vai'))}, trạng thái ${nhanTrangThai(chuoi(sau, 'trangThai'))}`;
  }
  if (!truoc || !sau) return `${ai} thay đổi ${nv}`;

  const taiKhoan = (id: string | null) => (id ? (tenNguoiDung(id) ?? '(tài khoản không còn)') : '(không liên kết)');
  const khac: string[] = [];
  if (chuoi(truoc, 'tenGoi') !== chuoi(sau, 'tenGoi')) {
    khac.push(doi('tên gọi', trich(chuoi(truoc, 'tenGoi')), trich(chuoi(sau, 'tenGoi'))));
  }
  if (chuoi(truoc, 'vai') !== chuoi(sau, 'vai')) {
    khac.push(doi('vai', nhanVai(chuoi(truoc, 'vai')), nhanVai(chuoi(sau, 'vai'))));
  }
  if (chuoi(truoc, 'trangThai') !== chuoi(sau, 'trangThai')) {
    khac.push(doi('trạng thái', nhanTrangThai(chuoi(truoc, 'trangThai')), nhanTrangThai(chuoi(sau, 'trangThai'))));
  }
  if ((chuoi(truoc, 'userId') ?? null) !== (chuoi(sau, 'userId') ?? null)) {
    khac.push(doi('tài khoản CRM', taiKhoan(chuoi(truoc, 'userId')), taiKhoan(chuoi(sau, 'userId'))));
  }
  if ((chuoi(truoc, 'ghiChu') ?? '') !== (chuoi(sau, 'ghiChu') ?? '')) {
    khac.push(doi('ghi chú', trich(chuoi(truoc, 'ghiChu')), trich(chuoi(sau, 'ghiChu'))));
  }
  return khac.length ? `${ai} đổi ${nv}: ${khac.join('; ')}` : `${ai} lưu ${nv} (không đổi gì)`;
}

export function cauNhatKy(e: NhatKy, tuy: { tenNguoiDung?: (id: string) => string | null } = {}): string {
  const ai = e.ai?.fullName?.trim() || 'Người dùng đã bị xoá';
  const than = e.doiTuong === 'nhom'
    ? cauNhom(ai, e)
    : e.doiTuong === 'nhan_vien'
      ? cauNhanVien(ai, e, tuy.tenNguoiDung ?? (() => null))
      : `${ai} thay đổi ${e.doiTuong}`;
  const lyDo = e.lyDo?.trim();
  return lyDo ? `${than} — lý do: ${lyDo}` : than;
}
