// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-mac-dinh.ts — chữ của MẶC ĐỊNH chức năng nhóm (docs/77 §8) trên tab Nhóm. Hàm THUẦN.
//
// Mặc định do backend tính (bot-quyen-mac-dinh.ts): toàn nhân viên ⇒ `sales` ("Nhóm nhân viên"), có người không phải
// nhân viên ⇒ `khach`, chưa biết đủ danh sách thành viên ⇒ không có (bot im). Chủ xếp tường minh luôn thắng.
import type { ChucNangNhom, MacDinhNhom, NhomView } from '@/api/bot-quyen';
import { NHAN_CHUC_NANG } from './bot-quyen-luat';

const NHAN_MAC_DINH: Readonly<Record<'sales' | 'khach', string>> = { sales: 'Nhóm nhân viên', khach: 'Khách' };

/** Vì sao mặc định là vậy / vì sao chưa có. */
export function lyDoMacDinh(md: MacDinhNhom): string {
  if (md.chucNang === 'sales') return `toàn nhân viên (${md.soThanhVien} người)`;
  if (md.chucNang === 'khach') {
    const chiTiet = [
      md.soNickKhac > 0 ? `${md.soNickKhac} nick CRM khác` : '',
      md.soNguoiNghi > 0 ? `${md.soNguoiNghi} người đã nghỉ` : '',
    ].filter(Boolean);
    return `có ${md.soNguoiNgoai} người ngoài${chiTiet.length ? ` (${chiTiet.join(', ')})` : ''}`;
  }
  const goc = md.lyDo === 'thieu_danh_sach' ? 'Zalo chưa trả đủ danh sách thành viên'
    : md.lyDo === 'dang_doc_lai' ? 'thành viên vừa đổi — đang đọc lại danh sách'
      : 'chưa đọc được danh sách thành viên';
  return md.loiDoc ? `${goc} (lỗi: ${md.loiDoc})` : goc;
}

export interface NhanChucNang {
  chu: string;
  mau: 'nv' | 'vang' | 'rong';
  /** Giá trị đang dùng là MẶC ĐỊNH (chip "mặc định"). */
  macDinh: boolean;
  /** Chủ đã xếp tường minh (chip "cố định"). */
  coDinh: boolean;
  lyDo: string | null;
}

export function nhanChucNangNhom(
  n: Pick<NhomView, 'chucNang' | 'chucNangHieuLuc' | 'laMacDinh' | 'macDinh'>,
): NhanChucNang {
  if (n.chucNang) {
    return { chu: NHAN_CHUC_NANG[n.chucNang], mau: n.chucNang === 'khach' ? 'vang' : 'nv', macDinh: false, coDinh: true, lyDo: null };
  }
  const md = n.macDinh;
  if (md.chucNang) {
    return {
      chu: `${NHAN_MAC_DINH[md.chucNang]} (mặc định)`, mau: md.chucNang === 'khach' ? 'vang' : 'nv',
      macDinh: true, coDinh: false, lyDo: lyDoMacDinh(md),
    };
  }
  return { chu: 'Chưa xếp loại', mau: 'rong', macDinh: false, coDinh: false, lyDo: lyDoMacDinh(md) };
}

/** "Mặc định (theo thành viên): …" — hộp xếp loại. */
export function cauMacDinh(md: MacDinhNhom): string {
  if (md.chucNang === 'sales') return `${NHAN_MAC_DINH.sales} — ${lyDoMacDinh(md)}`;
  if (md.chucNang === 'khach') return `${NHAN_MAC_DINH.khach} (bot im) — ${lyDoMacDinh(md)}`;
  return `chưa có — ${lyDoMacDinh(md)} (bot im)`;
}

/** Hệ quả khi chọn "Theo mặc định" (bỏ xếp tường minh). */
export function heQuaVeMacDinh(md: MacDinhNhom): string {
  return `Bot tự theo thành viên nhóm — hiện là: ${cauMacDinh(md)}. Có người ngoài vào thì nhóm tự thành Khách (bot im); `
    + 'chưa đọc được danh sách thành viên thì bot im.';
}

/** Số nhóm đang hiện mà bot im vì chưa xếp loại (không xếp + không có mặc định). */
export function demBotIm(ds: ReadonlyArray<{ chucNangHieuLuc: ChucNangNhom | null; daAn: boolean }>): number {
  return ds.filter((n) => !n.daAn && !n.chucNangHieuLuc).length;
}
