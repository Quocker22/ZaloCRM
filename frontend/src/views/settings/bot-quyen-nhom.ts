// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-nhom.ts — hàm THUẦN của tab Nhóm (trang Quyền bot): lọc theo nick, ẩn nhóm đã ẩn, tìm theo
// tên (không dấu), tên hiển thị. Danh sách nạp MỘT lần (GET /bot-quyen/nhom không lọc) rồi lọc tại chỗ —
// nhờ vậy ô "Nick" luôn đủ mọi nick có nhóm.
import type { NhomView, NickNhom } from '@/api/bot-quyen';

/** Chữ thường, bỏ dấu, đ → d, gộp khoảng trắng. */
export function boDau(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function tenNick(nick: NickNhom): string {
  return nick.displayName?.trim() || nick.zaloUid || 'Nick chưa đặt tên';
}

export function tenNhomHienThi(n: Pick<NhomView, 'tenNhom'>): string {
  return n.tenNhom?.trim() || '(nhóm chưa có tên)';
}

/** Tên đăng ký (tên bot dùng khi nhắc tới nhóm) — chỉ hiện khi khác tên nhóm Zalo. */
export function tenDangKyPhu(n: Pick<NhomView, 'tenNhom' | 'tenDangKy'>): string | null {
  const t = n.tenDangKy?.trim();
  if (!t || t === n.tenNhom?.trim()) return null;
  return t;
}

/** Giá trị mặc định ô "Tên đăng ký": chưa xếp loại ⇒ tên nhóm; đã xếp ⇒ tên đăng ký đang có (kể cả rỗng). */
export function tenDangKyMacDinh(n: Pick<NhomView, 'chucNang' | 'tenNhom' | 'tenDangKy'>): string {
  if (n.chucNang) return n.tenDangKy ?? '';
  return n.tenNhom?.trim() ?? '';
}

export function dsNick(ds: NhomView[]): Array<{ id: string; ten: string }> {
  const m = new Map<string, string>();
  for (const n of ds) if (!m.has(n.nick.id)) m.set(n.nick.id, tenNick(n.nick));
  return [...m.entries()].map(([id, ten]) => ({ id, ten })).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));
}

export interface BoLocNhom {
  nickId: string | null;
  hienDaAn: boolean;
  tuKhoa: string;
}

export function locNhom(ds: NhomView[], boLoc: BoLocNhom): NhomView[] {
  const q = boDau(boLoc.tuKhoa ?? '');
  return ds.filter((n) => {
    if (!boLoc.hienDaAn && n.daAn) return false;
    if (boLoc.nickId && n.nick.id !== boLoc.nickId) return false;
    if (!q) return true;
    return boDau(`${n.tenNhom ?? ''} ${n.tenDangKy ?? ''}`).includes(q);
  });
}

/** Nhóm đang hiện (chưa ẩn) mà chưa xếp loại — bot đang im ở đó. */
export function demChuaXepLoai(ds: NhomView[]): number {
  return ds.filter((n) => !n.daAn && !n.chucNang).length;
}
