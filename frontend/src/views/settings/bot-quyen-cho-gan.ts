// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-cho-gan.ts — hàm THUẦN của "Chờ gán — người đã nhắn cho shop" (tab Nhân viên, docs/77 §8).
// Backend: GET /bot-quyen/nguoi-da-nhan (bot-quyen-nguoi-da-nhan.ts) — người đã nhắn (tin riêng + nhóm) chưa có trong
// danh sách nhân viên. Zalo cấp uid KHÁC nhau cho mỗi nick ⇒ luôn nói rõ "uid theo nick nào"; cùng người ở nhiều nick
// là MỘT dòng mang mọi uid (docs/77 §8b) — gán gửi hết.
import type { NguoiDaNhan, NhanVien, NoiNhan, VaiNhanVien } from '@/api/bot-quyen';
import type { MauNhanVien } from './bot-quyen-thanh-vien';

function motNoi(n: NoiNhan): string {
  const noi = n.loai === 'nhom' ? `Nhóm ${n.tenNhom?.trim() ? `“${n.tenNhom.trim()}”` : '(chưa có tên)'}` : 'Tin riêng';
  return `${noi} · nick ${n.nick.ten}`;
}

export function moTaNoi(u: Pick<NguoiDaNhan, 'noi' | 'soNoi'>): string[] {
  const ds = u.noi.map(motNoi);
  if (u.soNoi > u.noi.length) ds.push(`+${u.soNoi - u.noi.length} nơi khác`);
  return ds;
}

const NHAN_LOAI_TIN: Readonly<Record<string, string>> = {
  image: '[ảnh]', sticker: '[sticker]', file: '[tệp]', voice: '[ghi âm]', video: '[video]', link: '[link]',
};

export function tomTatTin(u: Pick<NguoiDaNhan, 'tinCuoi'> & Partial<Pick<NguoiDaNhan, 'anTinCuoi'>>): string {
  const t = u.tinCuoi;
  if (!t) return u.anTinCuoi ? '▒▒▒ (nick Riêng tư)' : '—';
  if (t.noiDung.trim()) return t.noiDung.trim();
  return NHAN_LOAI_TIN[t.loai] ?? `[${t.loai}]`;
}

/** "uid · nick" cho từng uid của người (sắp theo tên nick). */
export function moTaUid(u: { uids?: Array<{ zaloUid: string; nick: { ten: string } | null }> }): string[] {
  return (u.uids ?? []).map((x) => `${x.zaloUid} · ${x.nick ? `nick ${x.nick.ten}` : 'nick chưa rõ'}`);
}

/** Nhân viên có tên gọi trùng (không dấu) — gợi ý "cùng người với nhân viên đã có" (chỉ gợi ý, người bấm quyết). */
export function nhanVienCungTen(u: Pick<NguoiDaNhan, 'ten' | 'anTen'>, ds: readonly NhanVien[]): NhanVien[] {
  if (u.anTen) return [];
  const bo = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
  const t = bo(u.ten);
  return t ? ds.filter((nv) => bo(nv.tenGoi) === t) : [];
}

/**
 * Nhân viên được backend GỢI Ý vì cùng globalId (§8b-an-toàn P0: globalId trong bảng CRM ghi được ⇒ CHỈ gợi ý, không bao
 * giờ tự áp; người bấm quyết).
 */
export function nhanVienGoiYGlobalId(u: Pick<NguoiDaNhan, 'goiYNhanVien'>, ds: readonly NhanVien[]): NhanVien[] {
  const id = new Set((u.goiYNhanVien ?? []).map((g) => g.id));
  return ds.filter((nv) => id.has(nv.id));
}

export function mauGan(u: NguoiDaNhan, vai: VaiNhanVien): MauNhanVien {
  const ten = u.anTen || u.ten === '(chưa rõ tên)' ? '' : u.ten.trim();
  const noi = u.noi[0];
  const kem = (u.uids ?? []).map((x) => x.zaloUid).filter((x) => x !== u.zaloUid);
  return {
    zaloUid: u.zaloUid,
    ...(kem.length > 0 ? { zaloUidsKem: kem } : {}),
    tenGoi: ten,
    khoaUid: true,
    vai,
    choPhepCongTy: true,
    tieuDe: `Gán “${ten || u.zaloUid}” làm nhân viên`,
    nguon: kem.length > 0
      ? `Cùng một người ở ${kem.length + 1} nick — gán cả ${kem.length + 1} uid: ${moTaUid(u).join('; ')}`
      : noi ? `Đã nhắn ở ${motNoi(noi).replace(' · nick ', ' · uid theo nick ')}` : `uid ${u.zaloUid}`,
  };
}
