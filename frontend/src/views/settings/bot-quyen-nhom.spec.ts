// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab Nhóm của trang Quyền bot: lọc theo nick / ẩn nhóm đã ẩn / tìm theo tên (không dấu), tên hiển thị.
import { describe, it, expect } from 'vitest';
import type { NhomView } from '@/api/bot-quyen';
import { locNhom, dsNick, tenNhomHienThi, tenDangKyPhu, tenDangKyMacDinh, tenNick, boDau, demChuaXepLoai } from './bot-quyen-nhom';

const nick = (id: string, displayName: string | null) => ({ id, displayName, zaloUid: `uid-${id}`, status: 'connected' });
const n = (them: Partial<NhomView>): NhomView => ({
  conversationId: 'c', externalThreadId: 't', tenNhom: 'Nhóm', soThanhVien: 5, lastMessageAt: null, daAn: false,
  nick: nick('a', 'Nick HN'), chucNang: null, tenDangKy: null, ghiChu: null, capNhatLuc: null, capNhatBoi: null, ...them,
});

const DS: NhomView[] = [
  n({ conversationId: '1', tenNhom: 'Sales Hà Nội', nick: nick('a', 'Nick HN'), chucNang: 'sales', tenDangKy: 'Sales HN' }),
  n({ conversationId: '2', tenNhom: 'Kho Đông Anh', nick: nick('b', 'Nick HCM') }),
  n({ conversationId: '3', tenNhom: 'Nhóm cũ', daAn: true, nick: nick('a', 'Nick HN') }),
  n({ conversationId: '4', tenNhom: null, nick: nick('c', null), chucNang: 'khach' }),
];

describe('locNhom', () => {
  it('mặc định ẩn nhóm đã ẩn', () => {
    expect(locNhom(DS, { nickId: null, hienDaAn: false, tuKhoa: '' }).map((x) => x.conversationId)).toEqual(['1', '2', '4']);
  });
  it('"Hiện nhóm đã ẩn" ⇒ hiện đủ', () => {
    expect(locNhom(DS, { nickId: null, hienDaAn: true, tuKhoa: '' })).toHaveLength(4);
  });
  it('lọc theo nick', () => {
    expect(locNhom(DS, { nickId: 'a', hienDaAn: true, tuKhoa: '' }).map((x) => x.conversationId)).toEqual(['1', '3']);
  });
  it('tìm không dấu, theo tên nhóm HOẶC tên đăng ký', () => {
    expect(locNhom(DS, { nickId: null, hienDaAn: false, tuKhoa: 'dong anh' }).map((x) => x.conversationId)).toEqual(['2']);
    expect(locNhom(DS, { nickId: null, hienDaAn: false, tuKhoa: 'sales hn' }).map((x) => x.conversationId)).toEqual(['1']);
    expect(locNhom(DS, { nickId: null, hienDaAn: false, tuKhoa: '  HÀ  nội ' }).map((x) => x.conversationId)).toEqual(['1']);
  });
});

describe('dsNick / tenNick', () => {
  it('mỗi nick một lần, sắp theo tên; không tên ⇒ uid', () => {
    expect(dsNick(DS)).toEqual([
      { id: 'b', ten: 'Nick HCM' }, { id: 'a', ten: 'Nick HN' }, { id: 'c', ten: 'uid-c' },
    ]);
    expect(tenNick({ id: 'x', displayName: null, zaloUid: null, status: '' })).toBe('Nick chưa đặt tên');
  });
});

describe('tên hiển thị', () => {
  it('tenNhomHienThi: không tên ⇒ "(nhóm chưa có tên)"', () => {
    expect(tenNhomHienThi(DS[0])).toBe('Sales Hà Nội');
    expect(tenNhomHienThi(DS[3])).toBe('(nhóm chưa có tên)');
  });
  it('tenDangKyPhu: chỉ khi khác tên nhóm và không rỗng', () => {
    expect(tenDangKyPhu(DS[0])).toBe('Sales HN');
    expect(tenDangKyPhu(n({ tenNhom: 'A', tenDangKy: 'A' }))).toBeNull();
    expect(tenDangKyPhu(n({ tenNhom: 'A', tenDangKy: '' }))).toBeNull();
    expect(tenDangKyPhu(n({ tenNhom: 'A', tenDangKy: null }))).toBeNull();
  });
  it('tenDangKyMacDinh: chưa xếp loại ⇒ tên nhóm; đã xếp ⇒ tên đăng ký hiện có (kể cả rỗng)', () => {
    expect(tenDangKyMacDinh(DS[1])).toBe('Kho Đông Anh');
    expect(tenDangKyMacDinh(DS[0])).toBe('Sales HN');
    expect(tenDangKyMacDinh(n({ chucNang: 'sales', tenDangKy: '' }))).toBe('');
    expect(tenDangKyMacDinh(n({ tenNhom: null }))).toBe('');
  });
});

describe('boDau / demChuaXepLoai', () => {
  it('bỏ dấu + chữ thường + đ → d', () => {
    expect(boDau('Đông Anh ĐẸP')).toBe('dong anh dep');
  });
  it('đếm nhóm chưa xếp loại (không tính nhóm đã ẩn)', () => {
    expect(demChuaXepLoai(DS)).toBe(1);
  });
});
