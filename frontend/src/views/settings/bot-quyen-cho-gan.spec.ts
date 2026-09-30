// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab Nhân viên — "Chờ gán — người đã nhắn cho shop" (docs/77 §8): chữ "ở đâu" của từng người, mẫu hộp gán.
import { describe, it, expect } from 'vitest';
import type { NguoiDaNhan } from '@/api/bot-quyen';
import { moTaNoi, moTaUid, mauGan, nhanVienCungTen, tomTatTin } from './bot-quyen-cho-gan';
import type { NhanVien } from '@/api/bot-quyen';

const u = (them: Partial<NguoiDaNhan> = {}): NguoiDaNhan => ({
  zaloUid: '123', ten: 'Trần Hưng', luc: null, soNoi: 1, dangSaiBot: false, tinCuoi: null,
  uids: [{ zaloUid: '123', nick: { id: 'n1', ten: 'LED HN' } }],
  anTen: false, anTinCuoi: false, redacted: false,
  noi: [{ conversationId: 'g1', loai: 'nhom', tenNhom: 'Sales HN', nick: { id: 'n1', ten: 'LED HN' }, luc: null }], ...them,
});

describe('moTaNoi', () => {
  it('nhóm / tin riêng + nick; nơi thêm đếm gọn', () => {
    expect(moTaNoi(u())).toEqual(['Nhóm “Sales HN” · nick LED HN']);
    expect(moTaNoi(u({
      soNoi: 5,
      noi: [
        { conversationId: 'd', loai: 'rieng', tenNhom: null, nick: { id: 'n2', ten: 'LED HCM' }, luc: null },
        { conversationId: 'g', loai: 'nhom', tenNhom: null, nick: { id: 'n1', ten: 'LED HN' }, luc: null },
      ],
    }))).toEqual(['Tin riêng · nick LED HCM', 'Nhóm (chưa có tên) · nick LED HN', '+3 nơi khác']);
  });
});

describe('tomTatTin', () => {
  it('chữ; không chữ ⇒ loại tin; không có ⇒ gạch', () => {
    expect(tomTatTin(u({ tinCuoi: { noiDung: 'alo em', loai: 'text', luc: '2026-09-30T08:00:00Z' } }))).toBe('alo em');
    expect(tomTatTin(u({ tinCuoi: { noiDung: '', loai: 'image', luc: '2026-09-30T08:00:00Z' } }))).toBe('[ảnh]');
    expect(tomTatTin(u({ tinCuoi: { noiDung: '', loai: 'sticker', luc: '2026-09-30T08:00:00Z' } }))).toBe('[sticker]');
    expect(tomTatTin(u())).toBe('—');
    expect(tomTatTin(u({ anTinCuoi: true, redacted: true }))).toBe('▒▒▒ (nick Riêng tư)');
  });
});

describe('mauGan', () => {
  it('uid khoá, tên Zalo, vai chọn sẵn, nói rõ uid theo nick nào', () => {
    expect(mauGan(u(), 'kho')).toEqual({
      zaloUid: '123', tenGoi: 'Trần Hưng', khoaUid: true, vai: 'kho', choPhepCongTy: true,
      tieuDe: 'Gán “Trần Hưng” làm nhân viên', nguon: 'Đã nhắn ở Nhóm “Sales HN” · uid theo nick LED HN',
    });
  });
  it('tên chưa rõ ⇒ để trống cho người gán điền', () => {
    expect(mauGan(u({ ten: '(chưa rõ tên)' }), 'sales').tenGoi).toBe('');
  });
});

describe('nick Riêng tư (review P1-3)', () => {
  it('tên bị che ⇒ hộp gán không điền tên che, tiêu đề dùng uid', () => {
    const m = mauGan(u({ ten: '(ẩn — nick Riêng tư)', anTen: true, redacted: true }), 'sales');
    expect(m.tenGoi).toBe('');
    expect(m.tieuDe).toBe('Gán “123” làm nhân viên');
  });
});

describe('nhiều uid (docs/77 §8b)', () => {
  const hai = u({ uids: [{ zaloUid: '123', nick: { id: 'n1', ten: 'LED HN' } }, { zaloUid: '456', nick: { id: 'n2', ten: 'LED HCM' } }] });
  it('moTaUid: uid · nick', () => {
    expect(moTaUid(hai)).toEqual(['123 · nick LED HN', '456 · nick LED HCM']);
  });
  it('mauGan gửi kèm uid ở nick khác và nói rõ', () => {
    const m = mauGan(hai, 'sales');
    expect(m.zaloUid).toBe('123');
    expect(m.zaloUidsKem).toEqual(['456']);
    expect(m.nguon).toContain('Cùng một người ở 2 nick');
    expect(mauGan(u(), 'sales').zaloUidsKem).toBeUndefined();
  });
  it('nhanVienCungTen: so không dấu; tên bị che ⇒ không gợi ý', () => {
    const nv = [{ id: 'a', tenGoi: 'Tran Hung' }, { id: 'b', tenGoi: 'Viết Quốc' }] as NhanVien[];
    expect(nhanVienCungTen(u(), nv).map((x) => x.id)).toEqual(['a']);
    expect(nhanVienCungTen(u({ anTen: true }), nv)).toEqual([]);
  });
});
