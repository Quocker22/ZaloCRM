// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-cho-gan.ts — hàm THUẦN của "Chờ gán — người đã nhắn cho shop" (tab Nhân viên, docs/77 §8).
// Backend: GET /bot-quyen/nguoi-da-nhan (bot-quyen-nguoi-da-nhan.ts) — người đã nhắn (tin riêng + nhóm) chưa có trong
// danh sách nhân viên. Zalo cấp uid KHÁC nhau cho mỗi nick ⇒ luôn nói rõ "uid theo nick nào".
import type { NguoiDaNhan, NoiNhan, VaiNhanVien } from '@/api/bot-quyen';
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

export function mauGan(u: NguoiDaNhan, vai: VaiNhanVien): MauNhanVien {
  const ten = u.anTen || u.ten === '(chưa rõ tên)' ? '' : u.ten.trim();
  const noi = u.noi[0];
  return {
    zaloUid: u.zaloUid,
    tenGoi: ten,
    khoaUid: true,
    vai,
    choPhepCongTy: true,
    tieuDe: `Gán “${ten || u.zaloUid}” làm nhân viên`,
    nguon: noi ? `Đã nhắn ở ${motNoi(noi).replace(' · nick ', ' · uid theo nick ')}` : `uid ${u.zaloUid}`,
  };
}
