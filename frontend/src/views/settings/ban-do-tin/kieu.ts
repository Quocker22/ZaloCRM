// SPDX-License-Identifier: AGPL-3.0-or-later
// kieu.ts — kiểu dữ liệu trang "Bản đồ tin" (docs/78 §3 C3).
//
// Hợp đồng danh mục composer (bot đẩy sang CRM, docs/78 B4):
//   { id, ten, pha, kieu: khoa|ban_sao|thuan, dich_goc[], nhay_cam[], khi_nao, vi_du, nguon_cau, dan_toi: [{den, kieu}] }
// + luật (bản sao) + số đếm 7 ngày { canh_id, so, chan, bong }.
// Trang chỉ đọc qua client (`@/api/ban-do-tin`); bản giả lập ở `client-mau.ts`.

/** Mã pha = mã cột trên sơ đồ, theo thứ tự trái → phải. */
export type MaPha =
  | 'hoi' | 'len_don' | 'chot' | 'xuat_hd' | 'in' | 'thu_tien' | 'kho' | 'bao_cao' | 'he_thong';

/** Mã đích (hàng) — khớp `dich` trong luật (`luat-chu-chon-02-10.json`). */
export type MaDich =
  | 'nhom_goc' | 'dm_nguoi_go' | 'nguoi_giu_ma' | 'chu_don'
  | 'g_kho' | 'g_admin' | 'g_ketoan' | 'g_sales' | 'g_kythuat'
  | 'nv' | 'g_khach';

/** Hàng nguồn (dải "Nguồn") và hàng CRM tự động — không phải đích của luật. */
export type MaHangPhu = 'n_may_in' | 'n_odoo' | 'n_lich' | 'crm_sale' | 'crm_hen' | 'crm_nhom' | 'crm_he_thong';

export type MaHang = MaDich | MaHangPhu;

/** khoa: đích cố định · ban_sao: nơi gốc khoá, THÊM bản sao được · thuan: đổi đích tự do. */
export type KieuComposer = 'khoa' | 'ban_sao' | 'thuan';

/** Ai soạn chữ — hiện thành tag trên khối. */
export type NguoiSoan = 'ma' | 'model' | 'mau' | 'anh';

export type CheDo = 'tat' | 'bong' | 'bat';

/** Sáu loại đường nối (mã dùng cho `#loai=`). */
export type LoaiLienKet = 'nghiep_vu' | 'ban_sao' | 'nguon' | 'vong' | 'chan' | 'crm';

/** Loại cạnh khai trong `dan_toi` (ban_sao sinh từ luật, không khai tay). */
export type KieuCanh = Exclude<LoaiLienKet, 'ban_sao'>;

export interface CanhDanToi {
  den: string;
  kieu: KieuCanh;
  /** Vì sao nối — hiện ở panel liên kết. */
  vi_sao?: string;
}

export interface Composer {
  id: string;
  ten: string;
  pha: MaPha;
  kieu: KieuComposer;
  dich_goc: MaDich[];
  nhay_cam: string[];
  khi_nao: string;
  vi_du: string;
  nguon_cau: string;
  ghi_chu?: string;
  dan_toi: CanhDanToi[];
  /** Phần trình bày (bot không bắt buộc gửi): ai soạn, lý do khoá, gợi ý, đề xuất mới, chế độ mặc định. */
  soan?: NguoiSoan;
  ai_soan?: string;
  ly_do_khoa?: string;
  goi_y?: string;
  de_xuat?: boolean;
  che_do?: CheDo;
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
}

export interface Luat {
  id: string;
  /** composer id */
  loai: string;
  /** Danh sách đích HIỆU LỰC (gồm cả nơi gốc với composer ban_sao) — cùng dạng luật chủ chọn 02/10. */
  dich: MaDich[];
  che_do: CheDo;
  phien_ban: number;
  nguoi_sua?: string;
  luc?: string;
}

export interface DemCanh {
  /** `tu~den` (id khối) cho đường nối; `gui:<id khối>` cho số tin của một khối. */
  canh_id: string;
  so: number;
  chan: number;
  bong: number;
  /** Chỉ với `gui:` — số tin chạy bóng trong 24 giờ qua ("nếu bật, 24h qua sẽ gửi N"). */
  bong_24h?: number;
}

export interface DongNhatKy {
  luc: string;
  nguoi: string;
  noi_dung: string;
}

export interface AnhChupBanDo {
  phien_ban: number;
  /** true khi dữ liệu là bản giả lập (client-mau) — trang hiện nhãn "Dữ liệu mẫu". */
  mau: boolean;
  composer: Composer[];
  nguon: NutPhu[];
  crm: NutPhu[];
  luat: Luat[];
  dem_7_ngay: DemCanh[];
  nhat_ky: DongNhatKy[];
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

export type TagKhoi = 'Mã' | 'Model' | 'Mẫu' | 'Ảnh' | 'Mới' | 'Bóng' | 'Nguồn' | 'CRM';

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
