// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-luat.ts — luật THUẦN của trang "Quyền bot" (docs/77 §2–§3.3): nhãn tiếng Việt, câu hệ quả
// ("bot sẽ làm gì khác đi"), và luật "hạ ⇒ bắt buộc lý do".
//
// Luật "hạ" CHÉP ĐÚNG backend `backend/src/modules/bot-quyen/bot-quyen-luat.ts`: đổi làm MẤT ít nhất
// một năng lực bot là hạ (bảng năng lực docs/77 §2). Backend vẫn chặn (400 THIEU_LY_DO) — ở đây để chặn
// sớm và nói rõ trong hộp thoại. Sửa một bên thì sửa cả hai (bot-quyen-luat.spec.ts khoá bảng).
//
// Không đụng Vue/DOM/axios — test bằng vitest môi trường node.

export const CHUC_NANG = ['admin', 'sales', 'kho', 'ke_toan', 'khach'] as const;
export type ChucNang = (typeof CHUC_NANG)[number];

export const VAI = ['admin', 'sales', 'kho', 'ke_toan', 'cong_ty'] as const;
export type Vai = (typeof VAI)[number];

export const TRANG_THAI = ['hoat_dong', 'khoa', 'nghi'] as const;
export type TrangThai = (typeof TRANG_THAI)[number];

export const NHAN_CHUC_NANG: Readonly<Record<ChucNang, string>> = {
  admin: 'Quản trị',
  sales: 'Bán hàng',
  kho: 'Kho',
  ke_toan: 'Kế toán',
  khach: 'Khách',
};

/** Câu hệ quả hiện dưới mỗi lựa chọn trong hộp "Xếp loại nhóm" — TRƯỚC khi lưu. */
export const HE_QUA_CHUC_NANG: Readonly<Record<ChucNang, string>> = {
  admin: 'Mọi người trong nhóm hỏi được mọi thứ: số liệu, lãi, công nợ, kho, đơn của mọi nhân viên.',
  sales: 'Lên đơn, tra cứu, thông số. Người có vai cao hơn (admin, kế toán, kho) vẫn dùng đủ quyền của họ.',
  kho: 'Như sales, thêm quyền kho (nhập, chuyển kho) cho mọi người trong nhóm.',
  ke_toan: 'Như sales, thêm xem lãi gộp và công nợ cho mọi người trong nhóm.',
  khach: 'Nhóm có khách: bot im, không trả lời gì trong nhóm (giữ kín giá, SĐT, đơn).',
};

export const HE_QUA_BO_XEP_LOAI = 'Bot sẽ im trong nhóm này.';

export const NHAN_VAI: Readonly<Record<Vai, string>> = {
  admin: 'Quản trị',
  sales: 'Bán hàng',
  kho: 'Kho',
  ke_toan: 'Kế toán',
  cong_ty: 'Người công ty (không dùng bot)',
};

export const NHAN_TRANG_THAI: Readonly<Record<TrangThai, string>> = {
  hoat_dong: 'Hoạt động',
  khoa: 'Khoá',
  nghi: 'Đã nghỉ (nhóm có người này sẽ im)',
};

/** Nhãn an toàn cho mã lạ (backend mới hơn giao diện) — hiện nguyên mã, không vỡ. */
export function nhanChucNang(x: string | null | undefined): string {
  if (!x) return 'Chưa xếp loại';
  return (NHAN_CHUC_NANG as Record<string, string>)[x] ?? x;
}
export function nhanVai(x: string | null | undefined): string {
  return x ? ((NHAN_VAI as Record<string, string>)[x] ?? x) : '—';
}
export function nhanTrangThai(x: string | null | undefined): string {
  return x ? ((NHAN_TRANG_THAI as Record<string, string>)[x] ?? x) : '—';
}

// ── "Hạ" = mất năng lực (docs/77 §2) ─────────────────────────────────────────

type NangLuc = 'toan_quyen' | 'kho' | 'tai_chinh' | 'nv_thuong';
const DU: readonly NangLuc[] = ['toan_quyen', 'kho', 'tai_chinh', 'nv_thuong'];

const NANG_LUC_VAI: Readonly<Record<Vai, readonly NangLuc[]>> = {
  admin: DU,
  kho: ['kho', 'nv_thuong'],
  ke_toan: ['tai_chinh', 'nv_thuong'],
  sales: ['nv_thuong'],
  cong_ty: [],
};

/** Với NHÓM, `nv_thuong` = "bot nói trong nhóm": khach và chưa xếp loại ⇒ bot im. */
const NANG_LUC_CHUC_NANG: Readonly<Record<ChucNang, readonly NangLuc[]>> = {
  admin: DU,
  kho: ['kho', 'nv_thuong'],
  ke_toan: ['tai_chinh', 'nv_thuong'],
  sales: ['nv_thuong'],
  khach: [],
};

function matNangLuc(cu: readonly NangLuc[], moi: readonly NangLuc[]): boolean {
  return cu.some((n) => !moi.includes(n));
}

/** `null` = chưa xếp loại (bot im); `moi = null` = bỏ xếp loại. */
export function laHaChucNang(cu: ChucNang | null, moi: ChucNang | null): boolean {
  return matNangLuc(cu ? NANG_LUC_CHUC_NANG[cu] : [], moi ? NANG_LUC_CHUC_NANG[moi] : []);
}

export function laHaVai(cu: Vai, moi: Vai): boolean {
  return matNangLuc(NANG_LUC_VAI[cu], NANG_LUC_VAI[moi]);
}

const BAC_TRANG_THAI: Readonly<Record<TrangThai, number>> = { hoat_dong: 2, khoa: 1, nghi: 0 };
/** hoat_dong > khoa > nghi — đi xuống là khoá. nghi → khoa không phải khoá (người quay lại). */
export function laHaTrangThai(cu: TrangThai, moi: TrangThai): boolean {
  return BAC_TRANG_THAI[moi] < BAC_TRANG_THAI[cu];
}

/** Tạo NV đã khoá/nghỉ hoặc là người công ty ⇒ bot khoá Zalo đó ngay khi đồng bộ ⇒ cần lý do. */
export function laKhoaKhiTao(vai: Vai, trangThai: TrangThai): boolean {
  return vai === 'cong_ty' || trangThai !== 'hoat_dong';
}

// ── Khi nào bắt buộc lý do (đúng các chỗ backend trả 400 THIEU_LY_DO) ───────

/** PUT /nhom (moi = chức năng mới) và DELETE /nhom (moi = null). */
export function canLyDoNhom(cu: ChucNang | null, moi: ChucNang | null): boolean {
  return laHaChucNang(cu, moi);
}

/** PUT /nhan-vien/:id — hạ vai HOẶC trạng thái đi xuống. */
export function canLyDoSuaNhanVien(
  truoc: { vai: Vai; trangThai: TrangThai },
  sau: { vai: Vai; trangThai: TrangThai },
): boolean {
  return laHaVai(truoc.vai, sau.vai) || laHaTrangThai(truoc.trangThai, sau.trangThai);
}

/** POST /nhan-vien. */
export function canLyDoTaoNhanVien(vai: Vai, trangThai: TrangThai): boolean {
  return laKhoaKhiTao(vai, trangThai);
}

/** Bắt buộc mà rỗng / chỉ khoảng trắng (backend trim rồi mới xét). */
export function thieuLyDo(can: boolean, lyDo: string | null | undefined): boolean {
  return can && !(lyDo ?? '').trim();
}

export const CAU_CAN_LY_DO_NHOM = 'Cần ghi lý do — thay đổi này làm bot bớt quyền trong nhóm.';
export const CAU_CAN_LY_DO_NHAN_VIEN = 'Cần ghi lý do — hạ vai, khoá hoặc cho nghỉ làm bot bớt quyền của người này.';
export const CAU_CAN_LY_DO_TAO_NHAN_VIEN =
  'Cần ghi lý do — thêm người công ty, hoặc người đang khoá / đã nghỉ, sẽ làm bot khoá Zalo này.';

// ── Chữ trạng thái bot của một nhóm ──────────────────────────────────────────

export type MauTrangThai = 'do' | 'vang' | 'xanh';

export function trangThaiBotNhom(chucNang: ChucNang | null): { chu: string; mau: MauTrangThai; bieuTuong: string } {
  if (!chucNang) return { chu: 'Bot đang im — chưa xếp loại', mau: 'do', bieuTuong: 'mdi-volume-off' };
  // Rào Pha 1: nhóm có khách ⇒ bot im phía NV (đợt sau mới cho khách hỏi thông số).
  if (chucNang === 'khach') return { chu: 'Nhóm có khách — bot im', mau: 'vang', bieuTuong: 'mdi-account-lock-outline' };
  return { chu: 'Bot trả lời trong nhóm', mau: 'xanh', bieuTuong: 'mdi-message-reply-text-outline' };
}

// ── Câu "bot sẽ làm gì" với MỘT nhân viên (hộp thêm / sửa) ────────────────────

const HE_QUA_VAI: Readonly<Record<Exclude<Vai, 'cong_ty'>, string>> = {
  admin:
    'Hỏi được mọi thứ: số liệu, lãi, công nợ, kho, đơn của mọi nhân viên. Hỏi trong nhóm nội bộ thì bot trả lời ngay trong nhóm (mọi người trong nhóm cùng đọc).',
  sales: 'Lên đơn, tra cứu, hỏi thông số qua bot.',
  kho: 'Như Bán hàng, thêm quyền kho (nhập, chuyển kho).',
  ke_toan: 'Như Bán hàng, thêm xem lãi gộp và công nợ.',
};

export function heQuaNhanVien(vai: Vai | null, trangThai: TrangThai): string {
  if (trangThai === 'nghi') return 'Bot không nhận lệnh của người này, và sẽ im trong mọi nhóm có người này.';
  if (trangThai === 'khoa') return 'Bot tạm không nhận lệnh của người này. Người này không làm nhóm im.';
  if (!vai) return '';
  if (vai === 'cong_ty') {
    return 'Bot không nhận lệnh của người này, nhưng người này không làm nhóm im (không phải người ngoài).';
  }
  return HE_QUA_VAI[vai];
}
