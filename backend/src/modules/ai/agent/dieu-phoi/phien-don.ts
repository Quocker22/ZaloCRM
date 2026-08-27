// SPDX-License-Identifier: AGPL-3.0-or-later
// PHIÊN ĐƠN — object CỐ ĐỊNH tiếp nhận yêu cầu của người đang chat (khách hay
// nhân viên), dùng chung cho cả hai luồng (anh Quốc 27/08: "phải có một object
// cố định để tiếp nhận yêu cầu… khách gì, sản phẩm gì, số lượng, giá, thêm
// tiền gì, VAT, chiết khấu… xác định được trong session, thiếu gì thì điều
// phối hỏi lại").
//
// Mỗi Ô có TRẠNG THÁI riêng, không chỉ giá trị: 'da_co' (đã rõ), 'thieu'
// (chưa nói), 'mo_ho' (nói rồi nhưng hai cách hiểu — phải hỏi lại đúng chỗ
// đó), 'tu_choi' (người ta nói "không cần"/"để sau" — KHÔNG hỏi lại nữa).
// Trạng thái là thứ máy hỏi dựa vào; "ô đã có không bao giờ hỏi lại" nằm ở
// cấu trúc, không phụ thuộc model nhớ hay quên.
//
// File này là HÀM THUẦN: không I/O, không LLM — test được từng ô.

export type TrangThaiO = 'da_co' | 'thieu' | 'mo_ho' | 'tu_choi';

export interface O<T> {
  trangThai: TrangThaiO;
  giaTri?: T;
  /** Vì sao mơ hồ / người ta nói gì — để máy hỏi đúng chỗ. */
  ghiChu?: string;
}

export interface DongHang {
  /** Tên người ta nói, giữ nguyên văn (máy tra Odoo sau). */
  ten: string;
  /**
   * id SP trên Odoo. Model CHỌN từ kết quả tool tim_sp (nó hiểu "a"/"loại
   * trong"/"cái 26803"), code chỉ KIỂM id có nằm trong bằng chứng đã tra —
   * id không có trong bằng chứng = bịa → bỏ, coi như chưa khớp.
   */
  spId?: number;
  /** Tên SP thật trên Odoo (điền cùng spId, từ bằng chứng). */
  tenOdoo?: string;
  /** Giá hệ thống của SP (từ bằng chứng) — 0 = chưa có giá. */
  giaOdoo?: number;
  soLuong: O<number>;
  donVi?: string;
  /** Giá người ta báo / chấp nhận (đồng). Không có = lấy giá hệ thống. */
  donGia: O<number>;
  chietKhauPhanTram?: number;
  tang?: boolean;
}

export interface PhienDon {
  /** Ai đang nói: khách tự đặt, hay NV lên đơn hộ. */
  vai: 'khach' | 'nhanvien';
  /** Chế độ việc — điều phối chỉ hoạt động khi đang có việc về đơn. */
  che: 'khong' | 'hoi_gia' | 'dat_hang' | 'sua_don' | 'nhap_hang';
  khach: O<{ ten: string; sdt?: string; maKh?: string; id?: number; moi?: boolean }>;
  dong: DongHang[];
  kho: O<string>;
  phuPhi: O<Array<{ ten: string; tien: number }>>;
  vatPhanTram: O<number>;
  chietKhauDonPhanTram: O<number>;
  giaoHang: O<{ cach: 'ship' | 'lay_tai_kho' | 'chanh'; diaChi?: string; sdtNhan?: string; thoiGian?: string }>;
  thanhToan: O<'chuyen_khoan' | 'cod' | 'cong_no' | 'tien_mat'>;
  ghiChu?: string;
  /** Lượt gần nhất cập nhật — để biết phiên còn sống. */
  capNhatLuc: string;
  /** Số lần hỏi cùng một ô — hỏi quá 2 lần thì thôi, chuyển người. */
  soLanHoi: Partial<Record<TenO, number>>;
  /**
   * BẰNG CHỨNG tra cứu tích luỹ trong phiên (kết quả tim_khach / tim_sp các
   * lượt trước). Mọi id model điền phải nằm trong đây — hàng rào DỮ LIỆU duy
   * nhất của code, thay cho việc đọc chữ.
   */
  bangChung?: {
    khach: Array<{ id: number; ten: string; ma?: string | null; sdt?: string | null }>;
    sp: Array<{ id: number; ten: string; gia: number; donVi?: string | null }>;
    /** Lần tra khách GẦN NHẤT (model hay code gọi) — để liệt kê cho NV chọn / tự chốt theo goiY. */
    traKhachCuoi?: { hoi: string; ds: Array<{ id: number; ten: string; ma?: string | null; sdt?: string | null }>; conNua: boolean; goiY?: number };
  };
  /** Đơn vừa lên trong phiên này (để "sửa đơn" biết sửa cái nào). */
  donVuaLen?: { donId: number; maDon: string; tenKhach: string; khachId: number; luc: string };
  /**
   * Bot ĐANG CHỜ NV chọn gì (danh sách khách / loại hàng đã hỏi lượt trước) —
   * dữ liệu để lượt sau model đối chiếu "3"/"a"/"fa 50w trắng" với đúng danh sách.
   */
  dangHoi?: {
    khach?: { ten: string; ds: Array<{ id: number; ten: string }> };
    sp?: Array<{ ten: string; ds: Array<{ id: number; ten: string }> }>;
  };
}

export type TenO = 'khach' | 'dong' | 'soLuong' | 'donGia' | 'kho' | 'phuPhi' | 'vatPhanTram' | 'chietKhauDonPhanTram' | 'giaoHang' | 'thanhToan';
/** Ô là O<...> nằm trực tiếp trên phiên (không phải dòng hàng). */
export type OTrenPhien = Exclude<TenO, 'dong' | 'soLuong' | 'donGia'>;

export const O_THIEU = <T>(): O<T> => ({ trangThai: 'thieu' });

export function phienTrong(vai: PhienDon['vai']): PhienDon {
  return {
    vai, che: 'khong',
    khach: O_THIEU(), dong: [], kho: O_THIEU(), phuPhi: O_THIEU(), vatPhanTram: O_THIEU(),
    chietKhauDonPhanTram: O_THIEU(), giaoHang: O_THIEU(), thanhToan: O_THIEU(),
    capNhatLuc: new Date(0).toISOString(), soLanHoi: {},
  };
}

/**
 * Ô nào BẮT BUỘC theo chế độ và vai — thứ tự = thứ tự hỏi.
 *
 * Chỉ hỏi cái cần để LÊN ĐƯỢC ĐƠN: khách → hàng → số lượng → (giá nếu SP chưa
 * có giá) → giao hàng (chỉ khách) → thanh toán (chỉ khách). Phụ phí / VAT /
 * chiết khấu / kho là ô TUỲ CHỌN: có thì ghi, không thì mặc định, KHÔNG hỏi
 * (hỏi "anh có VAT không?" với mọi khách là chọc phiền — NV báo thì thêm).
 */
export function oBatBuoc(p: PhienDon): TenO[] {
  if (p.che === 'khong' || p.che === 'hoi_gia') return [];
  const co: TenO[] = ['khach', 'dong', 'soLuong', 'donGia'];
  if (p.vai === 'khach' && p.che === 'dat_hang') co.push('giaoHang', 'thanhToan');
  return co;
}

/** Trạng thái gộp của một ô (dòng hàng gộp theo dòng xấu nhất). */
export function trangThaiO(p: PhienDon, o: TenO): { trangThai: TrangThaiO; ghiChu?: string; dong?: string } {
  switch (o) {
    case 'dong':
      return p.dong.length > 0 ? { trangThai: 'da_co' } : { trangThai: 'thieu' };
    case 'soLuong': {
      const xau = p.dong.find((d) => d.soLuong.trangThai === 'mo_ho') ?? p.dong.find((d) => d.soLuong.trangThai === 'thieu');
      return xau ? { trangThai: xau.soLuong.trangThai, ghiChu: xau.soLuong.ghiChu, dong: xau.ten } : { trangThai: p.dong.length ? 'da_co' : 'thieu' };
    }
    case 'donGia': {
      // Giá chỉ BẮT BUỘC khi mơ hồ (NV báo hai giá, khách đòi giá khác hệ
      // thống). Thiếu = lấy giá Odoo, không hỏi.
      const moHo = p.dong.find((d) => d.donGia.trangThai === 'mo_ho');
      return moHo ? { trangThai: 'mo_ho', ghiChu: moHo.donGia.ghiChu, dong: moHo.ten } : { trangThai: 'da_co' };
    }
    default: {
      const x = p[o as OTrenPhien] as O<unknown>;
      return { trangThai: x.trangThai, ...(x.ghiChu ? { ghiChu: x.ghiChu } : {}) };
    }
  }
}

export interface OCanHoi {
  o: TenO;
  trangThai: 'thieu' | 'mo_ho';
  ghiChu?: string;
  dong?: string;
}

/**
 * ĐIỀU PHỐI — hàm thuần quyết Ô NÀO hỏi tiếp: ô bắt buộc đầu tiên còn
 * 'thieu'/'mo_ho' (mơ hồ ưu tiên trước thiếu vì đang nói dở đúng ô đó),
 * bỏ qua ô 'tu_choi' và ô đã hỏi ≥ 2 lần (hỏi nữa là vòng lặp — để người).
 * Trả tối đa 2 ô mỗi lượt: hỏi 5 thứ một lúc thì người ta trả lời 1.
 */
export function oConThieu(p: PhienDon): OCanHoi[] {
  const ra: OCanHoi[] = [];
  const moHo: OCanHoi[] = [];
  for (const o of oBatBuoc(p)) {
    const t = trangThaiO(p, o);
    if (t.trangThai === 'da_co' || t.trangThai === 'tu_choi') continue;
    if ((p.soLanHoi[o] ?? 0) >= 2) continue;
    const muc: OCanHoi = { o, trangThai: t.trangThai, ...(t.ghiChu ? { ghiChu: t.ghiChu } : {}), ...(t.dong ? { dong: t.dong } : {}) };
    if (t.trangThai === 'mo_ho') moHo.push(muc); else ra.push(muc);
  }
  return [...moHo, ...ra].slice(0, 2);
}

/** Đủ để lên đơn chưa: mọi ô bắt buộc đều da_co hoặc tu_choi. */
export function duDeLenDon(p: PhienDon): boolean {
  if (p.che !== 'dat_hang' && p.che !== 'sua_don' && p.che !== 'nhap_hang') return false;
  return oBatBuoc(p).every((o) => ['da_co', 'tu_choi'].includes(trangThaiO(p, o).trangThai));
}

/** Đã hỏi ô này thêm một lần (code gọi khi câu hỏi được gửi đi). */
export function ghiDaHoi(p: PhienDon, o: TenO): void {
  p.soLanHoi[o] = (p.soLanHoi[o] ?? 0) + 1;
}

const TEN_O_NGUOI: Record<TenO, string> = {
  khach: 'khách hàng', dong: 'mặt hàng', soLuong: 'số lượng', donGia: 'đơn giá', kho: 'kho xuất',
  phuPhi: 'phụ phí', vatPhanTram: 'VAT', chietKhauDonPhanTram: 'chiết khấu', giaoHang: 'giao hàng', thanhToan: 'thanh toán',
};

/** Tóm tắt phiên cho prompt/log — ngắn, tất định, chỉ ô có gì đó. */
export function tomTatPhien(p: PhienDon): string {
  const dong = p.dong.map((d) => {
    const sl = d.soLuong.trangThai === 'da_co' ? `${d.soLuong.giaTri}${d.donVi ? ' ' + d.donVi : ''}` : `SL ${d.soLuong.trangThai}`;
    const gia = d.donGia.trangThai === 'da_co' ? ` · giá ${d.donGia.giaTri}` : d.donGia.trangThai === 'mo_ho' ? ` · giá MƠ HỒ (${d.donGia.ghiChu ?? ''})` : '';
    return `  - ${d.ten}: ${sl}${gia}${d.tang ? ' · tặng' : ''}${d.chietKhauPhanTram ? ` · CK ${d.chietKhauPhanTram}%` : ''}`;
  }).join('\n');
  const o = (ten: OTrenPhien): string => {
    const x = p[ten] as O<unknown>;
    if (x.trangThai === 'thieu') return '';
    const gt = x.giaTri === undefined ? '' : typeof x.giaTri === 'object' ? JSON.stringify(x.giaTri) : String(x.giaTri);
    return `${TEN_O_NGUOI[ten]}: ${x.trangThai}${gt ? ' ' + gt : ''}${x.ghiChu ? ` (${x.ghiChu})` : ''}`;
  };
  const khac = (['khach', 'kho', 'phuPhi', 'vatPhanTram', 'chietKhauDonPhanTram', 'giaoHang', 'thanhToan'] as OTrenPhien[]).map(o).filter(Boolean);
  return [`vai=${p.vai} · chế độ=${p.che}`, ...khac, dong ? `hàng:\n${dong}` : 'hàng: (chưa có)', p.ghiChu ? `ghi chú: ${p.ghiChu}` : ''].filter(Boolean).join('\n');
}

export function tenO(o: TenO): string {
  return TEN_O_NGUOI[o];
}
