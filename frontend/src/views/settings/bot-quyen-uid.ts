// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-uid.ts — hàm THUẦN cho uid / đề xuất / bằng chứng của nhân viên (tab Nhân viên, docs/77 §8b-an-toàn).
//   chon            = uid chủ chọn (lúc gán / thêm tay)
//   zalo_global_id  = máy nối: globalId CRM đọc TRỰC TIẾP từ Zalo trùng (chắc — mọi vai)
//   chu_xac_nhan    = chủ bấm "Nối" một đề xuất tin chung
// Đề xuất (tin chung — bằng chứng phụ) KHÔNG bao giờ tự áp: chủ "Nối" / "Không phải".
import type { DeXuatUid, UidNhanVien } from '@/api/bot-quyen';

export function nhanNguonUid(nguon: string): string {
  if (nguon === 'chon') return '';
  if (nguon === 'zalo_global_id') return 'globalId Zalo trùng';
  if (nguon === 'chu_xac_nhan') return 'chủ xác nhận';
  return 'tự nhận ra';
}

/**
 * "Đề xuất: uid X trên nick Y có vẻ là cùng người — bằng chứng: N tin trùng" (tin chung) hoặc "… SĐT …222 + tên Zalo “Hưng”
 * khớp" (nick khác findUser SĐT nhân viên — globalId của uid chủ chọn chưa đọc được nên chưa tự nối).
 */
export function moTaDeXuat(d: Pick<DeXuatUid, 'zaloUid' | 'nick' | 'soTin'> & { bangChung?: unknown }): string {
  const nick = d.nick ? `nick ${d.nick.ten}` : 'nick chưa rõ';
  const b = (d.bangChung && typeof d.bangChung === 'object' ? d.bangChung : {}) as Record<string, unknown>;
  const bc = b.nguon === 'sdt_ten'
    ? `SĐT ${typeof b.sdtDuoi === 'string' ? b.sdtDuoi : ''} + tên Zalo “${typeof b.ten === 'string' ? b.ten : '?'}” khớp`
    : d.soTin ? `${d.soTin} tin trùng` : 'tin trùng (chưa đo lại)';
  return `Đề xuất: uid ${d.zaloUid} trên ${nick} có vẻ là cùng người — bằng chứng: ${bc}`;
}

/** Tooltip bằng chứng của một uid (globalId + lúc đọc / số tin). Rỗng khi không có. */
export function moTaBangChung(u: Pick<UidNhanVien, 'nguon' | 'bangChung'>): string {
  const b = (u.bangChung && typeof u.bangChung === 'object' ? u.bangChung : {}) as Record<string, unknown>;
  if (u.nguon === 'zalo_global_id' && typeof b.globalId === 'string') {
    const luc = typeof b.layLuc === 'string' ? ` · đọc lúc ${b.layLuc.slice(0, 16).replace('T', ' ')}` : '';
    const goc = typeof b.uidGoc === 'string' ? ` · trùng uid ${b.uidGoc}` : '';
    return `globalId ${b.globalId}${goc}${luc}`;
  }
  if (typeof b.soTin === 'number') return `${b.soTin} tin trùng`;
  return '';
}

/** Có gỡ được uid này không (uid chính — uid lúc gán — thì không). */
export function goDuoc(u: Pick<UidNhanVien, 'zaloUid'>, uidChinh: string): boolean {
  return u.zaloUid !== uidChinh;
}
