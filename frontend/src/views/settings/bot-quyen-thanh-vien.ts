// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-thanh-vien.ts — hàm THUẦN của ngăn "Thành viên nhóm" (trang Quyền bot, docs/77 §3.3):
// nhãn từng người (Nhân viên / Nick của nhóm / Người ngoài / Nick CRM khác), câu "danh sách lấy từ
// đâu", và cảnh báo "người ngoài làm bot im".
//
// Nhãn đi theo đúng cách bot đếm người (báo cáo backend, vòng sửa 1): uid có trong danh sách nhân viên ⇒
// nhân viên (kể cả người công ty, mọi trạng thái); uid là nick của CHÍNH nhóm ⇒ nick của nhóm; còn lại —
// kể cả một nick CRM khác chưa xếp — là người ngoài.
import type { ChucNangNhom, NhomView, ThanhVien, ThanhVienNhom } from '@/api/bot-quyen';
import { dinhDangGioVN } from './may-in-nhat-ky';
import { nhanTrangThai, nhanVai, type Vai } from './bot-quyen-luat';
import { tenNhomHienThi, tenNick } from './bot-quyen-nhom';

export type MauChipThanhVien = 'nv' | 'xanh' | 'vang' | 'do' | 'xam' | 'info';

export interface ChipThanhVien {
  chu: string;
  mau: MauChipThanhVien;
}

const MAU_TRANG_THAI: Readonly<Record<string, MauChipThanhVien>> = { hoat_dong: 'xanh', khoa: 'vang', nghi: 'do' };

export function chipThanhVien(tv: ThanhVien): ChipThanhVien[] {
  const chip: ChipThanhVien[] = [];
  if (tv.loai === 'nhan_vien' && tv.nhanVien) {
    const { vai, trangThai } = tv.nhanVien;
    chip.push(vai === 'cong_ty' ? { chu: nhanVai(vai), mau: 'xam' } : { chu: `Nhân viên · ${nhanVai(vai)}`, mau: 'nv' });
    chip.push({ chu: nhanTrangThai(trangThai), mau: MAU_TRANG_THAI[trangThai] ?? 'xam' });
  } else if (tv.loai === 'nick_crm') {
    return [{ chu: 'Nick của nhóm', mau: 'info' }];
  } else {
    chip.push({ chu: 'Người ngoài', mau: 'do' });
  }
  if (tv.laNickCrm) chip.push({ chu: 'Nick CRM khác', mau: 'xam' });
  return chip;
}

/** Người ngoài mà là một nick CRM của công ty ⇒ gợi ý "Là người công ty" (không phải khách). */
export function goiYCongTy(tv: ThanhVien): boolean {
  return tv.loai === 'nguoi_ngoai' && tv.laNickCrm;
}

/** Điền sẵn hộp thêm nhân viên (BotQuyenNhanVienDialog) khi thêm từ ngăn thành viên nhóm. */
export interface MauNhanVien {
  zaloUid?: string;
  tenGoi?: string;
  /** Uid lấy từ Zalo — không cho sửa tay. */
  khoaUid?: boolean;
  /** "Là người công ty": vai cố định, không chọn. */
  vaiCoDinh?: Vai;
  /** Vai chọn sẵn (vẫn đổi được) — "Chờ gán" (tab Nhân viên). */
  vai?: Vai;
  /** Cho chọn vai "người công ty" dù uid lấy sẵn (mặc định ẩn — ngăn thành viên có nút riêng). */
  choPhepCongTy?: boolean;
  tieuDe?: string;
  /** Dòng phụ dưới tiêu đề. */
  nguon?: string;
}

/**
 * "Đặt làm nhân viên" / "Là người công ty (không dùng bot)" từ một thành viên. Uid là uid mà NICK CỦA NHÓM
 * nhìn thấy (Zalo cấp uid theo từng nick) — ghi rõ nick để người dùng biết (báo cáo backend, lưu ý 1).
 */
export function mauTuThanhVien(
  tv: ThanhVien,
  nhom: Pick<NhomView, 'tenNhom' | 'nick'>,
  kieu: 'nhan_vien' | 'cong_ty',
): MauNhanVien {
  const ten = tenThanhVien(tv);
  const mau: MauNhanVien = {
    zaloUid: tv.zaloUid,
    tenGoi: tv.ten?.trim() ?? '',
    khoaUid: true,
    tieuDe: kieu === 'cong_ty' ? `“${ten}” là người công ty (không dùng bot)` : `Đặt “${ten}” làm nhân viên`,
    nguon: `Thành viên nhóm “${tenNhomHienThi(nhom)}” · uid theo nick ${tenNick(nhom.nick)}`,
  };
  if (kieu === 'cong_ty') mau.vaiCoDinh = 'cong_ty';
  return mau;
}

export function tenThanhVien(tv: Pick<ThanhVien, 'ten' | 'zaloUid'>): string {
  return tv.ten?.trim() || tv.zaloUid;
}

/** "dd/MM/yyyy HH:mm" giờ VN. */
function gioPhut(luc: string | null): string | null {
  if (!luc) return null;
  const s = dinhDangGioVN(luc, { coNam: true });
  return s === '—' ? null : s.slice(0, 16);
}

export function chuNguonThanhVien(kq: Pick<ThanhVienNhom, 'nguon' | 'nguonLuc' | 'loiZalo'>): { chu: string; phu: string | null } {
  const luc = gioPhut(kq.nguonLuc);
  if (kq.nguon === 'da_quet') {
    return {
      chu: luc ? `Theo lần quét lúc ${luc}` : 'Theo lần quét gần nhất',
      phu: 'Người vào nhóm sau lần quét này chưa có trong danh sách — bấm "Đọc lại từ Zalo" để cập nhật.',
    };
  }
  if (kq.nguon === 'zalo') return { chu: luc ? `Đọc từ Zalo lúc ${luc}` : 'Đọc từ Zalo', phu: null };
  const chuaNhan = 'Người chưa từng nhắn trong nhóm sẽ không có trong danh sách.';
  return {
    chu: 'Theo người đã nhắn trong nhóm',
    phu: kq.loiZalo ? `Không đọc được danh sách từ Zalo: ${kq.loiZalo}. ${chuaNhan}` : chuaNhan,
  };
}

/** Cảnh báo khi người ngoài làm bot im (nhóm Khách thì bot vốn đã im — không cảnh báo). */
export function canhBaoNguoiNgoai(soNguoiNgoai: number, chucNang: ChucNangNhom | null): string | null {
  if (!(soNguoiNgoai > 0) || chucNang === 'khach') return null;
  return `Nhóm có ${soNguoiNgoai} người ngoài — bot sẽ im trong nhóm này cho tới khi anh/chị xếp họ là nhân viên hoặc người công ty, hoặc đổi nhóm sang Khách.`;
}
