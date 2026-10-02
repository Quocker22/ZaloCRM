// SPDX-License-Identifier: AGPL-3.0-or-later
// hash.ts — link sâu bằng hash URL (SPEC §7): #khoi= · #pha= · #dich= · #lien-ket=A~B · #loai=
import type { LoaiLienKet } from './kieu';
import type { LuaChon } from './trang-thai';

const LOAI: LoaiLienKet[] = ['nghiep_vu', 'hoi_lai', 'su_kien', 'chan', 'ban_sao', 'crm'];
/** mã cũ (bản mẫu trước hợp đồng 02/10) — link đã chép vẫn mở được */
const LOAI_CU: Record<string, LoaiLienKet> = { nguon: 'su_kien', vong: 'hoi_lai' };
const KHOA: Record<LuaChon['kieu'], string> = { khoi: 'khoi', pha: 'pha', hang: 'dich', lien_ket: 'lien-ket', loai: 'loai' };

const ma = (s: string) => encodeURIComponent(s).replace(/%40/g, '@').replace(/%7E/gi, '~').replace(/%3A/gi, ':');

export function docHash(hash: string): LuaChon | null {
  const s = hash.replace(/^#/, '');
  const i = s.indexOf('=');
  if (i <= 0) return null;
  const khoa = s.slice(0, i);
  let gt: string;
  try { gt = decodeURIComponent(s.slice(i + 1)); } catch { return null; }
  if (!gt) return null;
  switch (khoa) {
    case 'khoi': return { kieu: 'khoi', id: gt };
    case 'pha': return { kieu: 'pha', id: gt };
    case 'dich': return { kieu: 'hang', id: gt };
    case 'lien-ket': return gt.includes('~') ? { kieu: 'lien_ket', id: gt } : null;
    case 'loai': {
      const l = LOAI_CU[gt] ?? gt;
      return (LOAI as string[]).includes(l) ? { kieu: 'loai', id: l as LoaiLienKet } : null;
    }
    default: return null;
  }
}

export function vietHash(c: LuaChon | null): string {
  if (!c) return '';
  return `#${KHOA[c.kieu]}=${ma(c.id)}`;
}
