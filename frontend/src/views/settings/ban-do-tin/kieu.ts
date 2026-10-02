// SPDX-License-Identifier: AGPL-3.0-or-later
// kieu.ts — kiểu dữ liệu TRÌNH BÀY của trang "Bản đồ tin" (docs/78 §3 C3).
//
// Dữ liệu vào là ĐÚNG hợp đồng (hop-dong.ts: ảnh chụp bot + luật CRM + lớp CRM tự động); `chuyen-doi.ts` dựng
// `AnhChupBanDo` dưới đây: mã pha/đích lạ quy về hàng đã biết, luật quy về hàng bản sao, số đếm gộp theo khối.

import type { AiSoan, DemApi, DichLuatApi, MucCrmApi } from './hop-dong';

/** Mã pha = mã cột trên sơ đồ, theo thứ tự trái → phải. */
export type MaPha =
  | 'hoi' | 'len_don' | 'chot' | 'xuat_hd' | 'in' | 'thu_tien' | 'kho' | 'bao_cao' | 'he_thong';

/** Mã đích (hàng) — khớp `dich_goc` của composer và `dich_kieu` của số đếm. */
export type MaDich =
  | 'nhom_goc' | 'dm_nguoi_go' | 'nguoi_giu_ma' | 'chu_don'
  | 'g_kho' | 'g_admin' | 'g_ketoan' | 'g_sales' | 'g_kythuat'
  | 'nv' | 'g_khach';

/** Hàng nguồn (dải "Nguồn") và hàng CRM tự động (theo `loai_dich` của API) — không phải đích của luật. */
export type MaHangPhu =
  | 'n_may_in' | 'n_odoo' | 'n_lich' | 'n_khac'
  | 'crm_truc' | 'crm_sale' | 'crm_nhom' | 'crm_app' | 'crm_bot';

export type MaHang = MaDich | MaHangPhu;

/** khoa: đích cố định · ban_sao: nơi gốc giữ, THÊM bản sao được · thuan: tin thông báo, thêm đích tự do. */
export type KieuComposer = 'khoa' | 'ban_sao' | 'thuan';

export type CheDo = 'tat' | 'bong' | 'bat';

/** Sáu loại đường nối (mã dùng cho `#loai=`). Bốn loại đầu = `dan_toi.kieu` của hợp đồng; ban_sao sinh từ luật CRM;
 *  crm = lớp CRM tự động (GET /ban-do-tin/crm-tu-dong). */
export type LoaiLienKet = 'nghiep_vu' | 'hoi_lai' | 'su_kien' | 'chan' | 'ban_sao' | 'crm';

export interface CanhDanToi {
  den: string;
  kieu: LoaiLienKet;
  /** Vì sao nối — hiện ở panel liên kết. */
  vi_sao?: string;
}

export interface Composer {
  id: string;
  ten: string;
  pha: MaPha;
  /** mã pha bot gửi khi KHÔNG khớp cột nào (vẽ ở cột Hệ thống) */
  pha_la?: string;
  kieu: KieuComposer;
  dich_goc: MaDich[];
  /** mã đích gốc bot gửi mà trang chưa biết (không vẽ được) */
  dich_goc_la?: string[];
  /** nhãn hợp đồng: gia sdt tien doanh_so lai … */
  nhay_cam: string[];
  khi_nao: string;
  vi_du: string;
  nguon_cau: string;
  ghi_chu?: string;
  dan_toi: CanhDanToi[];
  de_xuat: boolean;
  /** ai soạn tin — nhãn khối Mã/Model/Mẫu/Ảnh; null = ảnh chụp cũ chưa khai */
  ai_soan: AiSoan | null;
  /** vì sao đích cố định (bot khai, chỉ composer khoá) — dòng 🔒 trong panel */
  ly_do_khoa?: string;
  /** gợi ý cấu hình bot khai — dòng 💡 trong panel */
  goi_y?: string;
}

/** Khối nguồn (máy in, Odoo, lịch) hoặc khối CRM tự động — chỉ xem. */
export interface NutPhu {
  id: string;
  ten: string;
  pha: MaPha;
  hang: MaHangPhu;
  mo_ta: string;
  dan_toi: CanhDanToi[];
  chi_xem: true;
  /** chỉ với mục CRM: bản gốc API (bật/tắt, lý do, đích, chỉnh ở đâu) */
  crm?: MucCrmApi;
}

export interface Luat {
  id: string;
  /** composer id */
  loai: string;
  /** Hàng BẢN SAO luật thêm (không gồm nơi gốc — nơi gốc luôn ngầm định). */
  dich: MaDich[];
  /** Đích đúng như CRM lưu (giữ zalo_uid của đích NV khi sửa). */
  dich_tho: DichLuatApi[];
  che_do: CheDo;
  phien_ban: number;
  sua_boi?: string | null;
  sua_luc?: string;
}

export interface SoDem { da_gui: number; chan_tam_im: number; loi: number; bong: number; chua_ro: number; bo: number }

/** Số đếm đã gộp: `gui:<khối>` (mọi lần gửi tới khối) · `luat:<khối>` (chỉ phần qua luật — cạnh bản sao). */
export interface DemCanh {
  canh_id: string;
  d7: SoDem;
  h24: SoDem;
}

export interface AnhChupBanDo {
  /** phien_ban danh mục bot (chuỗi) */
  phien_ban: string;
  /** lúc CRM nhận ảnh chụp */
  luc: string | null;
  /** true khi dữ liệu là bản giả lập (client-mau) — trang hiện nhãn "Dữ liệu mẫu". */
  mau: boolean;
  composer: Composer[];
  nguon: NutPhu[];
  crm: NutPhu[];
  luat: Luat[];
  dem: DemCanh[];
  /** dòng số đếm gốc (panel tính "24h sẽ gửi" theo luật) */
  dem_tho: DemApi[];
  /** cảnh báo CRM sẽ bỏ đích/luật khi phát cho bot (GET /luat-thong-bao → canhBao) */
  canh_bao: string[];
  /** lớp CRM tự động không tải được — vẫn vẽ phần bot */
  loi_crm: string | null;
}

// ─── Mô hình đã dựng (mo-hinh.ts) ───────────────────────────────────────

export interface Pha {
  id: MaPha;
  ma: string; // "P1"…
  ten: string;
  cau_hoi: string;
}

export interface Hang {
  id: MaHang;
  ten: string;
  phu?: string;
  icon: string;
  nhom: string;
}

export interface NhomHang {
  id: string;
  ten: string;
  hang: MaHang[];
  /** Một hàng ⇒ vẽ như hàng lẻ (không có thanh nhóm dọc), giống tham chiếu. */
  le: boolean;
  chi_xem?: boolean;
}

export type TagKhoi = 'Khoá' | 'Nhạy cảm' | 'Mới' | 'Bóng' | 'Tắt' | 'Nguồn' | 'CRM';

export interface Khoi {
  /** `<composer>@<hàng>` */
  id: string;
  ten: string;
  pha: MaPha;
  hang: MaHang;
  /** composer id / nút phụ id */
  nguon_id: string;
  loai_nut: 'composer' | 'nguon' | 'crm';
  /** Khối là bản sao theo luật (không phải nơi gốc). */
  ban_sao: boolean;
  che_do: CheDo;
  tags: TagKhoi[];
  /** ai soạn (chỉ khối composer có khai) — nhãn riêng, luôn hiện, không tính vào `tags` */
  soan: AiSoan | null;
}

export interface LienKet {
  /** `tu~den` */
  id: string;
  so: number;
  tu: string;
  den: string;
  loai: LoaiLienKet;
  vi_sao: string;
  dem?: DemCanh;
}

export interface MoHinh {
  pha: Pha[];
  nhom: NhomHang[];
  hang: Record<string, Hang>;
  khoi: Khoi[];
  khoiTheoId: Record<string, Khoi>;
  lienKet: LienKet[];
  lienKetTheoId: Record<string, LienKet>;
  vao: Record<string, LienKet[]>;
  ra: Record<string, LienKet[]>;
  composer: Record<string, Composer>;
  nutPhu: Record<string, NutPhu>;
  demKhoi: Record<string, DemCanh>;
}
