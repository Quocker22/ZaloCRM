// SPDX-License-Identifier: AGPL-3.0-or-later
// hop-dong.ts — hình dữ liệu ĐÚNG NHƯ API trả (docs/may-in/HOP-DONG-BAN-DO-TIN.md §2–§5 + backend bot-thong-bao-*.ts,
// bot-crm-tu-dong.ts). Trang không vẽ thẳng từ đây — `chuyen-doi.ts` dựng `AnhChupBanDo` (kieu.ts) từ các hình này.
// Đổi hợp đồng = đổi file này + chuyen-doi.ts + test round-trip (chuyen-doi.spec.ts).

/** Kiểu cạnh `dan_toi` — đúng KIEU_CANH của CRM / KIEU_LIEN_KET của bot. `ban_sao` KHÔNG khai ở đây (sinh từ luật). */
export const KIEU_CANH_HOP_DONG = ['nghiep_vu', 'hoi_lai', 'su_kien', 'chan'] as const;
export type KieuCanhHopDong = (typeof KIEU_CANH_HOP_DONG)[number];

export interface CanhApi {
  den: string;
  kieu: KieuCanhHopDong;
  vi_sao?: string;
}

export interface ComposerApi {
  id: string;
  kieu: 'khoa' | 'ban_sao' | 'thuan';
  nhay_cam: string[];
  ten: string | null;
  pha: string | null;
  de_xuat: boolean;
  dich_goc: string[];
  khi_nao: string | null;
  vi_du: string | null;
  nguon_cau: string | null;
  ghi_chu: string | null;
  dan_toi: CanhApi[];
}

export interface NguonApi {
  id: string;
  ten: string | null;
  pha: string | null;
  mo_ta: string | null;
  dan_toi: CanhApi[];
}

export const KET_QUA_DEM = ['da_gui', 'chan_tam_im', 'loi', 'bong', 'chua_ro'] as const;
export type KetQuaDem = (typeof KET_QUA_DEM)[number];

/** Một dòng số đếm — §4: một dòng mỗi (cạnh, kết quả, cửa sổ). */
export interface DemApi {
  khoa_canh: string;
  composer: string;
  dich_kieu: string;
  luat_id: string | null;
  ket_qua: KetQuaDem;
  cua_so: '24h' | '7d';
  so: number;
}

/** GET /bot-quyen/ban-do-tin → { banDo } */
export interface BanDoApi {
  phienBan: string;
  composer: ComposerApi[];
  nguon: NguonApi[];
  dem: DemApi[];
  luc: string;
}

export type CheDoApi = 'tat' | 'bong' | 'bat';

/** Đích luật: chuc_nang = nhóm theo chức năng; nv = zalo_uid NV bot; nguoi_gay_ra = người gõ của sự kiện. */
export interface DichLuatApi {
  kieu: 'chuc_nang' | 'nv' | 'nguoi_gay_ra';
  gia_tri: string | null;
}

export interface LuatApi {
  id: string;
  loai: string;
  dich: DichLuatApi[];
  cheDo: CheDoApi;
  dieuKien: Record<string, unknown>;
  gomGiay: number;
  lich: Record<string, unknown> | null;
  phienBan: number;
  suaBoi: string | null;
  suaLuc: string;
}

/** GET /bot-quyen/luat-thong-bao */
export interface DanhSachLuatApi {
  luat: LuatApi[];
  banDo: { phienBan: string; luc: string } | null;
  /** đúng cảnh báo bot nhận khi đọc luật (đích/luật CRM sẽ bỏ khi phát) */
  canhBao: string[];
}

/** Chức năng nhóm hợp lệ làm đích luật (CHUC_NANG_NHOM của CRM). */
export const CHUC_NANG_NHOM = ['admin', 'sales', 'kho', 'ke_toan', 'khach'] as const;
export type ChucNangNhom = (typeof CHUC_NANG_NHOM)[number];

/** Mục của GET /bot-quyen/ban-do-tin/crm-tu-dong → { crm } */
export interface MucCrmApi {
  id: string;
  ten: string;
  pha: string;
  loai_dich: 'nguoi_truc' | 'sale_phu_trach' | 'nhom_zalo' | 'ung_dung' | 'bot';
  bat: boolean;
  ly_do_tat: string | null;
  khi_nao: string;
  nguon_ma: string;
  chinh_o: string | null;
  dich: { ten: string; loai: 'nhom' | 'ca_nhan' | 'ung_dung' | 'bot'; bat: boolean }[];
  ghi_chu: string | null;
  dan_toi: { den: string; vi_sao: string }[];
}
