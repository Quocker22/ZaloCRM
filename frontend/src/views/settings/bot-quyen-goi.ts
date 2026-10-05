// SPDX-License-Identifier: AGPL-3.0-or-later
// bot-quyen-goi.ts — hàm THUẦN cho ô "Gọi là" (anh / chị) của nhân viên (tab Nhân viên, docs/79 T1; TỰ ĐỘNG 05/10).
// `goi` = giá trị người giữ trang CHỌN TAY (anh | chi) — luôn thắng; null = "Tự động": bot dùng `goiGoiY` (CRM tính từ giới
// tính của mọi uid người đó). Nguồn gợi ý, từ chắc tới kém chắc:
//   khoa_tay      = NV đã XÁC NHẬN giới tính trên CRM (có dấu gioi_tinh_xac_nhan_luc);
//   zalo_tu_dien  = Contact.gender Zalo tự điền, chưa ai xác nhận;
//   zalo_ho_so    = giới tính hồ sơ Zalo CRM tự đọc (NV chỉ thấy trong nhóm, không có Contact).
// Zalo có thể trả "Nam" mặc định cho hồ sơ ẩn giới ⇒ chủ chọn tay để đè khi sai.
import type { GoiNv, NhanVien } from '@/api/bot-quyen';

type CoGoi = Pick<NhanVien, 'goi' | 'goiGoiY' | 'goiNguon' | 'goiGoiYLyDo'>;

export function nhanGoi(g: GoiNv | null | undefined): string {
  return g === 'anh' ? 'Anh' : g === 'chi' ? 'Chị' : '';
}

const NGUON_NGAN: Readonly<Record<string, string>> = {
  khoa_tay: 'đã xác nhận', zalo_tu_dien: 'theo Zalo', zalo_ho_so: 'theo hồ sơ Zalo',
};

/** Mục "Tự động" của ô chọn: "Tự động — Anh (theo Zalo)" · "Tự động — “anh/chị”" khi chưa biết giới. */
export function cauTuDong(nv: CoGoi): string {
  if (!nv.goiGoiY) return 'Tự động — “anh/chị”';
  return `Tự động — ${nhanGoi(nv.goiGoiY)} (${NGUON_NGAN[nv.goiNguon ?? ''] ?? 'theo Zalo'})`;
}

/** Mục của ô chọn cho MỘT người: Tự động (giá trị '') · Anh · Chị. */
export function dsGoiCua(nv: CoGoi): Array<{ title: string; value: '' | GoiNv }> {
  return [{ title: cauTuDong(nv), value: '' }, { title: 'Anh', value: 'anh' }, { title: 'Chị', value: 'chi' }];
}

/** Giá trị bot đang dùng: chọn tay ?? gợi ý ?? null (bot gọi "anh/chị"). */
export function goiDangDung(nv: CoGoi): GoiNv | null {
  return nv.goi ?? nv.goiGoiY ?? null;
}

/** "Gợi ý: Anh (theo giới tính Zalo đã xác nhận)" · … · '' khi không có. */
export function cauGoiY(nv: CoGoi): string {
  if (!nv.goiGoiY) return '';
  const nguon = nv.goiNguon === 'khoa_tay' ? 'theo giới tính Zalo đã xác nhận'
    : nv.goiNguon === 'zalo_ho_so' ? 'theo hồ sơ Zalo' : 'theo Zalo tự điền — chưa ai xác nhận';
  return `Gợi ý: ${nhanGoi(nv.goiGoiY)} (${nguon})`;
}

/** Vì sao không gợi ý — chỉ nói khi có điều cần người giữ trang biết (mâu thuẫn / giới "khác"). */
export function cauKhongGoiY(nv: CoGoi): string {
  if (nv.goiGoiYLyDo === 'mau_thuan_khoa_tay') return 'Giới tính đã xác nhận mâu thuẫn giữa các nick — chọn tay';
  if (nv.goiGoiYLyDo === 'mau_thuan_zalo') return 'Giới tính Zalo mâu thuẫn giữa các nick — chọn tay';
  if (nv.goiGoiYLyDo === 'mau_thuan_ho_so') return 'Hồ sơ Zalo mâu thuẫn giới tính giữa các nick — chọn tay';
  if (nv.goiGoiYLyDo === 'khoa_tay_khac') return 'Giới tính đã xác nhận không phải Nam/Nữ — chọn tay';
  return '';
}

/** Đã CHỌN TAY mà gợi ý tự động KHÁC ⇒ hiện chip + nút "Về tự động". */
export function coGoiYKhac(nv: CoGoi): boolean {
  return !!nv.goi && !!nv.goiGoiY && nv.goiGoiY !== nv.goi;
}
