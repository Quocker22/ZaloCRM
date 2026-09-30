// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §2) — luật THUẦN: bộ giá trị enum + "hạ/khoá" (bắt buộc lý do) + admin
// hoạt động. Không I/O — service và test dùng chung.
//
// "Hạ" được định nghĩa theo NĂNG LỰC bot (bảng docs/77 §2): đổi làm MẤT ít nhất một năng lực là hạ.
// Nhờ vậy kho → ke_toan (mất `kho`) cũng là hạ dù không "thấp hơn" rõ ràng, còn sales → kho thì không.

export const CHUC_NANG_NHOM = ['admin', 'sales', 'kho', 'ke_toan', 'khach'] as const;
export type ChucNangNhom = (typeof CHUC_NANG_NHOM)[number];

export const VAI_NV = ['admin', 'sales', 'kho', 'ke_toan', 'cong_ty'] as const;
export type VaiNv = (typeof VAI_NV)[number];

export const TRANG_THAI_NV = ['hoat_dong', 'khoa', 'nghi'] as const;
export type TrangThaiNv = (typeof TRANG_THAI_NV)[number];

export const DOI_TUONG_NHAT_KY = ['nhom', 'nhan_vien'] as const;
export type DoiTuongNhatKy = (typeof DOI_TUONG_NHAT_KY)[number];

export function laChucNang(x: unknown): x is ChucNangNhom {
  return typeof x === 'string' && (CHUC_NANG_NHOM as readonly string[]).includes(x);
}
export function laVai(x: unknown): x is VaiNv {
  return typeof x === 'string' && (VAI_NV as readonly string[]).includes(x);
}
export function laTrangThai(x: unknown): x is TrangThaiNv {
  return typeof x === 'string' && (TRANG_THAI_NV as readonly string[]).includes(x);
}

/**
 * Năng lực (docs/77 §2): toan_quyen · kho · tai_chinh · nv_thuong (lên đơn/tra cứu/thông số).
 * Với NHÓM, `nv_thuong` đọc là "bot nói trong nhóm": khach và chưa xếp loại ⇒ bot im (rào Pha 1).
 */
type NangLuc = 'toan_quyen' | 'kho' | 'tai_chinh' | 'nv_thuong';
const DU: readonly NangLuc[] = ['toan_quyen', 'kho', 'tai_chinh', 'nv_thuong'];

const NANG_LUC_VAI: Record<VaiNv, readonly NangLuc[]> = {
  admin: DU,
  kho: ['kho', 'nv_thuong'],
  ke_toan: ['tai_chinh', 'nv_thuong'],
  sales: ['nv_thuong'],
  cong_ty: [], // người công ty KHÔNG dùng bot
};

const NANG_LUC_CHUC_NANG: Record<ChucNangNhom, readonly NangLuc[]> = {
  admin: DU,
  kho: ['kho', 'nv_thuong'],
  ke_toan: ['tai_chinh', 'nv_thuong'],
  sales: ['nv_thuong'],
  khach: [], // nhóm có khách — bot im phía NV
};

function matNangLuc(cu: readonly NangLuc[], moi: readonly NangLuc[]): boolean {
  return cu.some((n) => !moi.includes(n));
}

/** Đổi chức năng nhóm có làm mất năng lực không. `null` = chưa xếp loại (bot im). */
export function laHaChucNang(cu: ChucNangNhom | null, moi: ChucNangNhom | null): boolean {
  return matNangLuc(cu ? NANG_LUC_CHUC_NANG[cu] : [], moi ? NANG_LUC_CHUC_NANG[moi] : []);
}

export function laHaVai(cu: VaiNv, moi: VaiNv): boolean {
  return matNangLuc(NANG_LUC_VAI[cu], NANG_LUC_VAI[moi]);
}

/** hoat_dong > khoa > nghi — đi xuống là khoá. nghi → khoa không phải khoá (người quay lại). */
const BAC_TRANG_THAI: Record<TrangThaiNv, number> = { hoat_dong: 2, khoa: 1, nghi: 0 };
export function laHaTrangThai(cu: TrangThaiNv, moi: TrangThaiNv): boolean {
  return BAC_TRANG_THAI[moi] < BAC_TRANG_THAI[cu];
}

/** Admin tính cho luật "luôn còn ≥ 1 admin": vai admin VÀ đang hoạt động. */
export function laAdminHoatDong(nv: { vai: string; trangThai: string }): boolean {
  return nv.vai === 'admin' && nv.trangThai === 'hoat_dong';
}
