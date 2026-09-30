// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { goDuoc, moTaBangChung, moTaDeXuat, nhanNguonUid } from './bot-quyen-uid';

describe('bot-quyen-uid', () => {
  it('nhãn nguồn uid', () => {
    expect(nhanNguonUid('chon')).toBe('');
    expect(nhanNguonUid('zalo_global_id')).toBe('globalId Zalo trùng');
    expect(nhanNguonUid('chu_xac_nhan')).toBe('chủ xác nhận');
    expect(nhanNguonUid('la')).toBe('tự nhận ra');
  });

  it('câu đề xuất nêu uid, nick, số tin trùng', () => {
    expect(moTaDeXuat({ zaloUid: '3835588809400259343', nick: { id: 'vt', ten: 'Vận Tải Minh Thức', zaloUid: null }, soTin: 236 }))
      .toBe('Đề xuất: uid 3835588809400259343 trên nick Vận Tải Minh Thức có vẻ là cùng người — bằng chứng: 236 tin trùng');
    expect(moTaDeXuat({ zaloUid: 'x', nick: null, soTin: null })).toContain('nick chưa rõ');
    expect(moTaDeXuat({ zaloUid: 'y', nick: null, soTin: null, bangChung: { nguon: 'sdt_ten', sdtDuoi: '…222', ten: 'Hưng' } }))
      .toBe('Đề xuất: uid y trên nick chưa rõ có vẻ là cùng người — bằng chứng: SĐT …222 + tên Zalo “Hưng” khớp');
  });

  it('bằng chứng: globalId + uid gốc + lúc đọc; tin chung; không có', () => {
    expect(moTaBangChung({ nguon: 'zalo_global_id', bangChung: { globalId: 'G1', uidGoc: 'u1', layLuc: '2026-09-30T10:11:12.000Z' } }))
      .toBe('globalId G1 · trùng uid u1 · đọc lúc 2026-09-30 10:11');
    expect(moTaBangChung({ nguon: 'chu_xac_nhan', bangChung: { soTin: 3, maTin: [] } })).toBe('3 tin trùng');
    expect(moTaBangChung({ nguon: 'chon', bangChung: null })).toBe('');
  });

  it('không gỡ được uid chính', () => {
    expect(goDuoc({ zaloUid: 'a' }, 'a')).toBe(false);
    expect(goDuoc({ zaloUid: 'b' }, 'a')).toBe(true);
  });
});
