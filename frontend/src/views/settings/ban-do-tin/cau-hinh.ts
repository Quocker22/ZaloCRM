// SPDX-License-Identifier: AGPL-3.0-or-later
// cau-hinh.ts — khung cố định của bản đồ: pha (cột), hàng/nhóm hàng (đích), sáu loại đường nối.
// Không chứa dữ liệu composer — cái đó đến từ client (bot đẩy danh mục, docs/78 B4).
import type { Hang, LoaiLienKet, MaDich, MaHang, NhomHang, Pha } from './kieu';

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
  crm_sale: { id: 'crm_sale', ten: 'Sale phụ trách', icon: 'badge-dollar-sign', nhom: 'crm' },
  crm_hen: { id: 'crm_hen', ten: 'Người có hẹn', icon: 'calendar-clock', nhom: 'crm' },
  crm_nhom: { id: 'crm_nhom', ten: 'Nhóm mới', icon: 'users', nhom: 'crm' },
  crm_he_thong: { id: 'crm_he_thong', ten: 'Thông báo hệ thống', icon: 'bot', nhom: 'crm' },
};

export const NHOM_HANG: NhomHang[] = [
  { id: 'nguon', ten: 'Nguồn', hang: ['n_may_in', 'n_odoo', 'n_lich'], le: false, chi_xem: true },
  { id: 'theo_luot', ten: 'Theo lượt', hang: ['nhom_goc', 'dm_nguoi_go', 'nguoi_giu_ma', 'chu_don'], le: false },
  { id: 'chuc_nang', ten: 'Nhóm theo chức năng', hang: ['g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat'], le: false },
  { id: 'nguoi', ten: 'Người cụ thể', hang: ['nv'], le: true },
  { id: 'khach', ten: 'Khách', hang: ['g_khach'], le: true },
  { id: 'crm', ten: 'CRM tự động', hang: ['crm_sale', 'crm_hen', 'crm_nhom', 'crm_he_thong'], le: false, chi_xem: true },
];

/** Đích mà luật được phép thêm (hàng nguồn/CRM không bao giờ là đích). */
export const DICH_CO_THE_THEM: MaDich[] = [
  'nhom_goc', 'dm_nguoi_go', 'chu_don', 'g_kho', 'g_admin', 'g_ketoan', 'g_sales', 'g_kythuat', 'nv', 'g_khach',
];

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
 *  content→nguồn, loop→vòng, data→bị chặn, social_proof→CRM). */
export const KIEU_DUONG: KieuDuong[] = [
  { id: 'nghiep_vu', ten: 'Luồng nghiệp vụ', mau: 'nghiep_vu', rong: 1.92, dash: null, mo_ta: 'tin này dẫn tới tin kia trong cùng một việc' },
  { id: 'ban_sao', ten: 'Bản sao theo luật', mau: 'ban_sao', rong: 1.92, dash: null, mo_ta: 'luật chủ đặt gửi thêm bản sao sang đích khác' },
  { id: 'nguon', ten: 'Sự kiện từ nguồn', mau: 'nguon', rong: 1.68, dash: '6.75 3.75', mo_ta: 'máy in, Odoo hay lịch phát sự kiện' },
  { id: 'vong', ten: 'Hỏi lại / quay vòng', mau: 'vong', rong: 2.16, dash: '1.125 4.5', mo_ta: 'quay về bước trước' },
  { id: 'chan', ten: 'Bị chặn / tạm im', mau: 'chan', rong: 1.44, dash: '2.25 3', mo_ta: 'rào chặn tin hoặc nhóm đang im' },
  { id: 'crm', ten: 'CRM tự động', mau: 'crm', rong: 1.92, dash: null, mo_ta: 'CRM tự gửi, chỉ xem' },
];

export const KIEU_DUONG_THEO_ID = Object.fromEntries(KIEU_DUONG.map((k) => [k.id, k])) as Record<LoaiLienKet, KieuDuong>;

export const TEN_DICH = (h: string): string => HANG[h as MaHang]?.ten ?? h;
