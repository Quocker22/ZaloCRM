// SPDX-License-Identifier: AGPL-3.0-or-later
// cau-hinh.ts — khung cố định của bản đồ: pha (cột), hàng/nhóm hàng (đích), sáu loại đường nối.
// Không chứa dữ liệu composer — cái đó đến từ client (bot đẩy danh mục, docs/78 B4).
import type { Hang, LoaiLienKet, MaDich, MaHang, MaHangPhu, NhomHang, Pha, TagKhoi } from './kieu';
import type { AiSoan, ChucNangNhom, MucCrmApi } from './hop-dong';

export const PHA: Pha[] = [
  { id: 'hoi', ma: 'P1', ten: 'Hỏi & tra cứu', cau_hoi: 'NV hỏi gì thì bot trả lời ở đâu?' },
  { id: 'len_don', ma: 'P2', ten: 'Lên đơn', cau_hoi: 'NV gõ đơn — bot dựng thẻ, hỏi lại, ảnh báo giá.' },
  { id: 'chot', ma: 'P3', ten: 'Chốt', cau_hoi: 'Ai giữ mã chốt, Odoo xác nhận lúc nào?' },
  { id: 'xuat_hd', ma: 'P4', ten: 'Xuất HĐ', cau_hoi: 'Hoá đơn đi tới ai sau khi chốt?' },
  { id: 'in', ma: 'P5', ten: 'In', cau_hoi: 'Lệnh in đã ra máy chưa, in xong báo ai?' },
  { id: 'thu_tien', ma: 'P6', ten: 'Thu tiền', cau_hoi: 'Bill chuyển khoản thành phiếu thu thế nào?' },
  { id: 'kho', ma: 'P7', ten: 'Kho', cau_hoi: 'Phiếu nhập/chuyển kho được xác nhận ở đâu?' },
  { id: 'bao_cao', ma: 'P8', ten: 'Báo cáo định kỳ', cau_hoi: 'Số liệu nào tự gửi, giờ nào, cho ai?' },
  { id: 'he_thong', ma: 'P9', ten: 'Quyền · hệ thống · lỗi', cau_hoi: 'Bot im, lỗi, tin hỏng — ai được biết?' },
];

export const HANG: Record<MaHang, Hang> = {
  nhom_goc: { id: 'nhom_goc', ten: 'Nơi người gõ', phu: 'nhóm hoặc tin riêng gốc', icon: 'message-square', nhom: 'theo_luot' },
  dm_nguoi_go: { id: 'dm_nguoi_go', ten: 'Tin riêng người gõ', icon: 'user', nhom: 'theo_luot' },
  nguoi_giu_ma: { id: 'nguoi_giu_ma', ten: 'Người giữ mã chốt', icon: 'key-round', nhom: 'theo_luot' },
  chu_don: { id: 'chu_don', ten: 'Tin riêng chủ đơn', icon: 'user-check', nhom: 'theo_luot' },
  g_kho: { id: 'g_kho', ten: 'Kho', icon: 'warehouse', nhom: 'chuc_nang' },
  g_admin: { id: 'g_admin', ten: 'Admin', icon: 'shield-check', nhom: 'chuc_nang' },
  g_ketoan: { id: 'g_ketoan', ten: 'Kế toán', icon: 'calculator', nhom: 'chuc_nang' },
  g_sales: { id: 'g_sales', ten: 'Sales', icon: 'badge-dollar-sign', nhom: 'chuc_nang' },
  g_kythuat: { id: 'g_kythuat', ten: 'Kỹ thuật', phu: 'sự cố bot', icon: 'wrench', nhom: 'chuc_nang' },
  nv: { id: 'nv', ten: 'Một NV chỉ định', phu: 'tin riêng', icon: 'user-round', nhom: 'nguoi' },
  g_khach: { id: 'g_khach', ten: 'Nhóm khách', phu: 'chỉ tin công khai', icon: 'users', nhom: 'khach' },
  n_may_in: { id: 'n_may_in', ten: 'Máy in', icon: 'printer', nhom: 'nguon' },
  n_odoo: { id: 'n_odoo', ten: 'Odoo', icon: 'database', nhom: 'nguon' },
  n_lich: { id: 'n_lich', ten: 'Lịch', icon: 'calendar-clock', nhom: 'nguon' },
  n_khac: { id: 'n_khac', ten: 'Nguồn khác', icon: 'database', nhom: 'nguon' },
  crm_truc: { id: 'crm_truc', ten: 'Người trực / kỹ thuật', phu: 'nơi nhận báo của CRM', icon: 'shield-check', nhom: 'crm' },
  crm_sale: { id: 'crm_sale', ten: 'Sale / NV', phu: 'tin riêng từ nick hệ thống', icon: 'badge-dollar-sign', nhom: 'crm' },
  crm_nhom: { id: 'crm_nhom', ten: 'Nhóm Zalo', icon: 'users', nhom: 'crm' },
  crm_app: { id: 'crm_app', ten: 'Ứng dụng CRM', phu: 'trong trang / điện thoại', icon: 'bot', nhom: 'crm' },
  crm_bot: { id: 'crm_bot', ten: 'Sổ cho bot', phu: 'CRM ghi, bot đọc', icon: 'database', nhom: 'crm' },
};

export const NHOM_HANG: NhomHang[] = [
  { id: 'nguon', ten: 'Nguồn', hang: ['n_may_in', 'n_odoo', 'n_lich', 'n_khac'], le: false, chi_xem: true },
  { id: 'theo_luot', ten: 'Theo lượt', hang: ['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don'], le: false },
  { id: 'chuc_nang', ten: 'Nhóm theo chức năng', hang: ['g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat'], le: false },
  { id: 'nguoi', ten: 'Người cụ thể', hang: ['nv'], le: true },
  { id: 'khach', ten: 'Khách', hang: ['g_khach'], le: true },
  { id: 'crm', ten: 'CRM tự động', hang: ['crm_truc', 'crm_sale', 'crm_nhom', 'crm_app', 'crm_bot'], le: false, chi_xem: true },
];

/** Hàng chỉ hiện khi có khối (hàng dự phòng cho mã lạ). */
export const HANG_AN_KHI_TRONG: ReadonlySet<MaHang> = new Set<MaHang>(['n_khac']);

/** Hàng luật CRM thêm được làm BẢN SAO — đúng các kiểu đích CRM nhận (chuc_nang / nv / nguoi_gay_ra).
 *  `nhom_goc` không bao giờ (nơi gốc luôn ngầm định); `nguoi_giu_ma`, `chu_don`, `g_kythuat` CRM chưa có kiểu đích. */
export const DICH_LUAT: MaDich[] = ['dm_nguoi_go', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'nv', 'g_khach'];

/** chức năng nhóm CRM ↔ hàng */
export const HANG_THEO_CHUC_NANG: Record<ChucNangNhom, MaDich> = {
  kho: 'g_kho', admin: 'g_admin', ke_toan: 'g_ketoan', sales: 'g_sales', khach: 'g_khach',
};
export const CHUC_NANG_THEO_HANG: Partial<Record<MaDich, ChucNangNhom>> = Object.fromEntries(
  Object.entries(HANG_THEO_CHUC_NANG).map(([c, h]) => [h, c]),
) as Partial<Record<MaDich, ChucNangNhom>>;

/** loai_dich của lớp CRM tự động ↔ hàng */
export const HANG_THEO_LOAI_DICH_CRM: Record<MucCrmApi['loai_dich'], MaHangPhu> = {
  nguoi_truc: 'crm_truc', sale_phu_trach: 'crm_sale', nhom_zalo: 'crm_nhom', ung_dung: 'crm_app', bot: 'crm_bot',
};

/** Nhãn nhạy cảm của hợp đồng → chữ hiện cho người đọc. */
export const TEN_NHAY_CAM: Record<string, string> = { gia: 'giá', sdt: 'SĐT', tien: 'tiền', doanh_so: 'doanh số', lai: 'lãi' };
export const tenNhayCam = (ds: readonly string[]): string => ds.map((n) => TEN_NHAY_CAM[n] ?? n).join(', ');

export const LA_DICH = (h: string): h is MaDich =>
  ['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach'].includes(h);

export interface KieuDuong {
  id: LoaiLienKet;
  ten: string;
  /** tên biến CSS màu nét (ở `ban-do-tin.css`, có cả sáng lẫn tối) */
  mau: string;
  rong: number;
  dash: string | null;
  mo_ta: string;
}

/** Sáu loại đường — độ rộng/nét đứt theo SPEC §4.1 (ánh xạ: audience→nghiệp vụ, traffic→bản sao,
 *  content→sự kiện từ nguồn, loop→hỏi lại, data→bị chặn, social_proof→CRM). Bốn loại nghiep_vu|hoi_lai|su_kien|chan
 *  đúng `dan_toi.kieu` của hợp đồng; ban_sao = luật CRM; crm = lớp CRM tự động. */
export const KIEU_DUONG: KieuDuong[] = [
  { id: 'nghiep_vu', ten: 'Luồng nghiệp vụ', mau: 'nghiep_vu', rong: 1.92, dash: null, mo_ta: 'tin này dẫn tới tin kia trong cùng một việc' },
  { id: 'ban_sao', ten: 'Bản sao theo luật', mau: 'ban_sao', rong: 1.92, dash: null, mo_ta: 'luật chủ đặt gửi thêm bản sao sang đích khác' },
  { id: 'su_kien', ten: 'Sự kiện từ nguồn', mau: 'su_kien', rong: 1.68, dash: '6.75 3.75', mo_ta: 'máy in, Odoo hay lịch phát sự kiện' },
  { id: 'hoi_lai', ten: 'Hỏi lại / quay vòng', mau: 'hoi_lai', rong: 2.16, dash: '1.125 4.5', mo_ta: 'quay về bước trước' },
  { id: 'chan', ten: 'Bị chặn / tạm im', mau: 'chan', rong: 1.44, dash: '2.25 3', mo_ta: 'rào chặn tin hoặc nhóm đang im' },
  { id: 'crm', ten: 'CRM tự động', mau: 'crm', rong: 1.92, dash: null, mo_ta: 'CRM tự gửi, chỉ xem' },
];

export const KIEU_DUONG_THEO_ID = Object.fromEntries(KIEU_DUONG.map((k) => [k.id, k])) as Record<LoaiLienKet, KieuDuong>;

export const TEN_DICH = (h: string): string => HANG[h as MaHang]?.ten ?? h;

/** Nhãn "ai soạn" (hợp đồng bổ sung 02/10, như bản mẫu chủ đã xem) + lớp CSS `.bdt-tag.t-soan.s-*`. */
export const TEN_SOAN: Record<AiSoan, string> = { ma: 'Mã', model: 'Model', mau: 'Mẫu', anh: 'Ảnh' };
export const MO_TA_SOAN: Record<AiSoan, string> = {
  ma: 'chữ do mã viết sẵn', model: 'model AI diễn đạt', mau: 'khuôn mẫu điền số', anh: 'ảnh (Odoo / biểu đồ)',
};
export const LOP_SOAN: Record<AiSoan, string> = { ma: 't-soan s-ma', model: 't-soan s-model', mau: 't-soan s-mau', anh: 't-soan s-anh' };

/** Lớp CSS của nhãn khối (ban-do-tin.css `.bdt-tag.t-*`). */
export const LOP_TAG: Record<TagKhoi, string> = {
  Khoá: 't-khoa', 'Nhạy cảm': 't-nhay', Mới: 't-moi', Bóng: 't-bong', Tắt: 't-tat', Nguồn: 't-nguon', CRM: 't-crm',
};
