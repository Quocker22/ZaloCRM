// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-goi.ts — hàm THUẦN cho ô "Gọi là" (anh / chị) của nhân viên (tab Nhân viên, docs/79 T1).
// `goi` là giá trị NGƯỜI GIỮ TRANG đã chọn (bot dùng). `goiGoiY` chỉ là GỢI Ý CRM đọc từ giới tính Zalo của mọi uid người đó:
//   khoa_tay      = NV đã XÁC NHẬN giới tính trên CRM (đổi ô giới tính / nút "Xác nhận" — có dấu gioi_tinh_xac_nhan_luc;
//                   khoá cũ không dấu KHÔNG tính) — được "Áp gợi ý đã xác nhận" hàng loạt (qua hộp liệt kê từng người);
//   zalo_tu_dien  = Zalo tự điền, chưa ai xác nhận (Zalo có thể trả "Nam" mặc định) — chỉ bấm "Dùng" từng người.
// Không bao giờ tự áp; áp hàng loạt KHÔNG đè người đã chọn.
import type { GoiNv, NhanVien } from '@/api/bot-quyen';

type CoGoi = Pick<NhanVien, 'goi' | 'goiGoiY' | 'goiNguon' | 'goiGoiYLyDo'>;

export const DS_GOI: ReadonlyArray<{ title: string; value: '' | GoiNv }> = [
  { title: '— chưa chọn', value: '' },
  { title: 'Anh', value: 'anh' },
  { title: 'Chị', value: 'chi' },
];

export function nhanGoi(g: GoiNv | null | undefined): string {
  return g === 'anh' ? 'Anh' : g === 'chi' ? 'Chị' : '';
}

/** "Gợi ý: Anh (theo giới tính Zalo đã xác nhận)" · "… (theo Zalo tự điền — chưa ai xác nhận)" · '' khi không có. */
export function cauGoiY(nv: CoGoi): string {
  if (!nv.goiGoiY) return '';
  const nguon = nv.goiNguon === 'khoa_tay' ? 'theo giới tính Zalo đã xác nhận' : 'theo Zalo tự điền — chưa ai xác nhận';
  return `Gợi ý: ${nhanGoi(nv.goiGoiY)} (${nguon})`;
}

/** Vì sao không gợi ý — chỉ nói khi có điều cần người giữ trang biết (mâu thuẫn / giới "khác"). */
export function cauKhongGoiY(nv: CoGoi): string {
  if (nv.goiGoiYLyDo === 'mau_thuan_khoa_tay') return 'Giới tính đã xác nhận mâu thuẫn giữa các nick — chọn tay';
  if (nv.goiGoiYLyDo === 'mau_thuan_zalo') return 'Giới tính Zalo mâu thuẫn giữa các nick — chọn tay';
  if (nv.goiGoiYLyDo === 'khoa_tay_khac') return 'Giới tính đã xác nhận không phải Nam/Nữ — chọn tay';
  return '';
}

/** Có gợi ý KHÁC giá trị đang chọn ⇒ hiện chip + nút "Dùng". */
export function coGoiYKhac(nv: CoGoi): boolean {
  return !!nv.goiGoiY && nv.goiGoiY !== nv.goi;
}

/** Dòng được "Áp gợi ý đã xác nhận": gợi ý từ khoá tay + CHƯA chọn. */
export function dongApHangLoat<T extends CoGoi>(ds: readonly T[]): T[] {
  return ds.filter((nv) => nv.goiNguon === 'khoa_tay' && !!nv.goiGoiY && !nv.goi);
}
