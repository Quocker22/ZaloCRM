// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab Nhóm — MẶC ĐỊNH chức năng nhóm (docs/77 §8): chip "mặc định" + lý do ("toàn nhân viên" / "có 2 người ngoài"),
// nhóm chưa biết đủ thành viên ⇒ "Chưa xếp loại — bot im" kèm vì sao; chủ xếp tường minh ⇒ chip "cố định".
import { describe, it, expect } from 'vitest';
import type { MacDinhNhom } from '@/api/bot-quyen';
import { nhanChucNangNhom, lyDoMacDinh, cauMacDinh, heQuaVeMacDinh, demBotIm } from './bot-quyen-mac-dinh';

const md = (them: Partial<MacDinhNhom> = {}): MacDinhNhom => ({
  chucNang: 'sales', lyDo: 'toan_nhan_vien', soThanhVien: 4, soNguoiNgoai: 0, soNickKhac: 0, soNguoiNghi: 0,
  nguoiNgoai: [], docLuc: '2026-09-30T08:00:00Z', loiDoc: null, thuLuc: null, thuLaiSau: null, khongTra: false, ...them,
});
const khach = (them: Partial<MacDinhNhom> = {}) => md({ chucNang: 'khach', lyDo: 'co_nguoi_ngoai', soNguoiNgoai: 2, ...them });

describe('lyDoMacDinh', () => {
  it('toàn nhân viên / có N người ngoài (+ chi tiết nick khác, người nghỉ)', () => {
    expect(lyDoMacDinh(md())).toBe('toàn nhân viên (4 người)');
    expect(lyDoMacDinh(khach())).toBe('có 2 người ngoài');
    expect(lyDoMacDinh(khach({ soNguoiNgoai: 3, soNickKhac: 1, soNguoiNghi: 1 }))).toBe('có 3 người ngoài (1 nick CRM khác, 1 người đã nghỉ)');
  });
  it('chưa có mặc định: nói vì sao', () => {
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'chua_doc' }))).toBe('chưa đọc được danh sách thành viên');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'thieu_danh_sach' }))).toBe('Zalo chưa trả đủ danh sách thành viên');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'dang_doc_lai' }))).toBe('thành viên vừa đổi — đang đọc lại danh sách');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'chua_doc', loiDoc: 'rate limit' }))).toBe('chưa đọc được danh sách thành viên (lỗi: rate limit)');
  });
  it('review 30/09: danh sách quá cũ (sales > 6 giờ) / hội thoại ẩn / Zalo không trả nhóm (dừng) / hẹn thử lại', () => {
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'qua_cu' }))).toBe('danh sách thành viên đã cũ hơn 6 giờ — chờ đọc lại');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'da_an' }))).toBe('hội thoại đã ẩn / nick đã lưu trữ — không tính mặc định');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'dang_doc_lai', khongTra: true, loiDoc: 'Zalo không trả' })))
      .toBe('Zalo không trả nhóm này (nick đã rời / nhóm giải tán?) — dừng đọc tới khi có người vào/ra hoặc nick nối lại');
    expect(lyDoMacDinh(md({ chucNang: null, lyDo: 'dang_doc_lai', loiDoc: 'rate limit', thuLaiSau: '2026-09-30T08:05:00Z' })))
      .toMatch(/^thành viên vừa đổi — đang đọc lại danh sách \(lỗi: rate limit; thử lại lúc \d{2}:\d{2}\)$/);
  });
});

describe('nhanChucNangNhom', () => {
  it('chủ xếp ⇒ nhãn chức năng + cố định, không lý do mặc định', () => {
    expect(nhanChucNangNhom({ chucNang: 'admin', chucNangHieuLuc: 'admin', laMacDinh: false, macDinh: khach() }))
      .toEqual({ chu: 'Quản trị', mau: 'nv', macDinh: false, coDinh: true, lyDo: null });
  });
  it('mặc định sales ⇒ "Nhóm nhân viên (mặc định)" + lý do', () => {
    expect(nhanChucNangNhom({ chucNang: null, chucNangHieuLuc: 'sales', laMacDinh: true, macDinh: md() }))
      .toEqual({ chu: 'Nhóm nhân viên (mặc định)', mau: 'nv', macDinh: true, coDinh: false, lyDo: 'toàn nhân viên (4 người)' });
  });
  it('mặc định khách ⇒ "Khách (mặc định)" + lý do', () => {
    expect(nhanChucNangNhom({ chucNang: null, chucNangHieuLuc: 'khach', laMacDinh: true, macDinh: khach() }))
      .toMatchObject({ chu: 'Khách (mặc định)', mau: 'vang', macDinh: true, lyDo: 'có 2 người ngoài' });
  });
  it('không xếp, không mặc định ⇒ "Chưa xếp loại" + vì sao', () => {
    expect(nhanChucNangNhom({ chucNang: null, chucNangHieuLuc: null, laMacDinh: true, macDinh: md({ chucNang: null, lyDo: 'chua_doc' }) }))
      .toEqual({ chu: 'Chưa xếp loại', mau: 'rong', macDinh: false, coDinh: false, lyDo: 'chưa đọc được danh sách thành viên' });
  });
});

describe('cauMacDinh / heQuaVeMacDinh / demBotIm', () => {
  it('câu mặc định cho hộp xếp loại', () => {
    expect(cauMacDinh(md())).toBe('Nhóm nhân viên — toàn nhân viên (4 người)');
    expect(cauMacDinh(khach())).toBe('Khách (bot im) — có 2 người ngoài');
    expect(cauMacDinh(md({ chucNang: null, lyDo: 'chua_doc' }))).toBe('chưa có — chưa đọc được danh sách thành viên (bot im)');
  });
  it('hệ quả "Theo mặc định"', () => {
    expect(heQuaVeMacDinh(md())).toContain('Nhóm nhân viên — toàn nhân viên');
    expect(heQuaVeMacDinh(md())).toContain('người ngoài vào');
  });
  it('đếm nhóm bot im theo chức năng HIỆU LỰC (không xếp + không mặc định), bỏ nhóm đã ẩn', () => {
    const g = (hl: 'sales' | 'khach' | null, daAn = false) => ({ chucNangHieuLuc: hl, daAn });
    expect(demBotIm([g('sales'), g(null), g(null, true), g('khach')])).toBe(1);
  });
});
