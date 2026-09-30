// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT — MẶC ĐỊNH chức năng nhóm (docs/77 §8, chủ chốt 30/09): "trong nhóm mà toàn nhân viên thì mặc định là
// nhóm nhân viên, trong nhóm mà có người không phải nhân viên thì mặc định nhóm khách". Luật THUẦN — không I/O.
//
//   danh sách thành viên chưa đọc / thiếu / đang chờ đọc lại  ⇒ KHÔNG có mặc định (nhóm "chưa xếp loại" ⇒ bot im, D-DS)
//   mọi thành viên là NV (BotNhanVien hoat_dong|khoa, kể cả vai cong_ty) hoặc nick CỦA CHÍNH nhóm ⇒ `sales`
//       ("Nhóm nhân viên" — sales không cho năng lực gì hơn NV thường, nên là mặc định an toàn)
//   có ≥ 1 người không phải NV (người ngoài, nick CRM khác chưa xếp là NV, người ĐÃ NGHỈ) ⇒ `khach` (bot im phía NV)
//
// Vì sao người `nghi` không tính là NV: bot im mọi nhóm có người nghỉ (N9) — mặc định `khach` nói đúng điều đó.
// Vì sao NV `khoa` vẫn là NV: bot không coi họ là người ngoài (tam_im: có danh tính là người công ty), khoá chỉ dừng
// nhận lệnh — khoá tạm một người không được làm cả nhóm đổi loại.
//
// Chủ xếp tường minh (dòng BotNhom) LUÔN thắng mặc định (`chucNangHieuLuc`).
//
// ĐỘ CŨ TỐI ĐA (review 30/09, chủ duyệt): `sales` là hướng RỦI RO (bot trả lời như với NV) nên chỉ tin bản đọc trong
// TUOI_TOI_DA_SALES_MS; quá hạn ⇒ không có mặc định (bot im) tới lần đọc lại kế tiếp. `khach` cũ vẫn giữ (hướng an toàn).
// Vòng đọc lại định kỳ (bot-quyen-danh-sach.ts) ưu tiên nhóm `sales` để giữ chúng dưới hạn này trong ngân sách.

export type LyDoMacDinh =
  | 'toan_nhan_vien' | 'co_nguoi_ngoai' | 'chua_doc' | 'thieu_danh_sach' | 'dang_doc_lai' | 'qua_cu' | 'da_an';

/** Bản đọc cho mặc định `sales` quá tuổi này ⇒ bot im (xem trên). */
export const TUOI_TOI_DA_SALES_MS = 6 * 60 * 60_000;

/** Bản đọc danh sách thành viên đã lưu (bảng bot_nhom_danh_sach). */
export interface DanhSachDaDoc {
  uids: readonly string[];
  /** Zalo trả ĐỦ danh sách (không hasMoreMember, đủ totalMember). */
  dayDu: boolean;
  /** Thành viên vừa đổi / nick vừa kết nối lại mà chưa đọc lại xong — bản đang có có thể đã cũ. */
  canDocLai: boolean;
  docLuc: Date | null;
}

export interface BoiCanhMacDinh {
  /** uid Zalo của nick CRM sở hữu hội thoại (null nếu CRM chưa biết). */
  nickUid: string | null;
  /** uid → trạng thái của MỌI BotNhanVien trong org. */
  trangThaiNv: ReadonlyMap<string, string>;
  /** uid của mọi nick Zalo của org — chỉ để đếm riêng "nick khác" trong lý do. */
  nickCrm: ReadonlySet<string>;
  /**
   * uid là nick CRM KHÁC của org nhìn từ nick của hội thoại này (bot_nick_crm_uid — docs/77 §8b-an-toàn) ⇒ người công ty,
   * KHÔNG phải người ngoài (bot cũng nhận qua payload `nick_crm` ⇒ nick_bot).
   */
  nickCongTy?: ReadonlySet<string>;
  /** Có ⇒ áp độ cũ tối đa cho `sales` (API công khai + trang). Không ⇒ bỏ qua (so sánh "mặc định cuối"). */
  bayGio?: Date;
  /** Mặc định TUOI_TOI_DA_SALES_MS. */
  tuoiToiDaSalesMs?: number;
  /** Hội thoại đã xoá mềm / nick đã lưu trữ ⇒ không có mặc định (review P2-4 — không đọc, không phát cho bot). */
  daAn?: boolean;
}

export interface MacDinhNhom {
  chucNang: 'sales' | 'khach' | null;
  lyDo: LyDoMacDinh;
  soThanhVien: number;
  /** Số thành viên KHÔNG phải NV (gồm nick khác + người đã nghỉ). */
  soNguoiNgoai: number;
  soNickKhac: number;
  soNguoiNghi: number;
  /** Tối đa GIOI_HAN_UID_NGOAI uid không phải NV — để trang gợi ý "đặt làm nhân viên". */
  nguoiNgoai: string[];
  docLuc: Date | null;
}

export const GIOI_HAN_UID_NGOAI = 20;

function khong(lyDo: LyDoMacDinh, ds: DanhSachDaDoc | null): MacDinhNhom {
  return {
    chucNang: null, lyDo, soThanhVien: ds?.uids.length ?? 0, soNguoiNgoai: 0, soNickKhac: 0, soNguoiNghi: 0,
    nguoiNgoai: [], docLuc: ds?.docLuc ?? null,
  };
}

export function tinhMacDinhNhom(ds: DanhSachDaDoc | null, bc: BoiCanhMacDinh): MacDinhNhom {
  if (bc.daAn) return khong('da_an', ds);
  if (!ds) return khong('chua_doc', null);
  if (ds.canDocLai) return khong('dang_doc_lai', ds);
  const uids = [...new Set(ds.uids.filter(Boolean))];
  if (!ds.dayDu || uids.length === 0) return khong('thieu_danh_sach', ds);

  const ngoai: string[] = [];
  let soNickKhac = 0;
  let soNguoiNghi = 0;
  for (const uid of uids) {
    if (bc.nickUid && uid === bc.nickUid) continue;
    if (bc.nickCongTy?.has(uid)) continue;
    const tt = bc.trangThaiNv.get(uid);
    if (tt !== undefined && tt !== 'nghi') continue;
    ngoai.push(uid);
    if (tt === 'nghi') soNguoiNghi++;
    else if (bc.nickCrm.has(uid)) soNickKhac++;
  }
  if (ngoai.length === 0 && bc.bayGio) {
    const tuoi = bc.tuoiToiDaSalesMs ?? TUOI_TOI_DA_SALES_MS;
    if (!ds.docLuc || bc.bayGio.getTime() - ds.docLuc.getTime() > tuoi) {
      return { ...khong('qua_cu', ds), soThanhVien: uids.length };
    }
  }
  return {
    chucNang: ngoai.length > 0 ? 'khach' : 'sales',
    lyDo: ngoai.length > 0 ? 'co_nguoi_ngoai' : 'toan_nhan_vien',
    soThanhVien: uids.length,
    soNguoiNgoai: ngoai.length,
    soNickKhac,
    soNguoiNghi,
    nguoiNgoai: ngoai.slice(0, GIOI_HAN_UID_NGOAI),
    docLuc: ds.docLuc,
  };
}

/**
 * Chức năng HIỆU LỰC: chủ xếp tường minh ⇒ nó (`macDinh:false`); không ⇒ mặc định (`macDinh:true`, có thể null =
 * chưa xếp loại ⇒ bot im).
 */
export function chucNangHieuLuc(
  tuongMinh: string | null,
  macDinh: Pick<MacDinhNhom, 'chucNang'>,
): { chucNang: string | null; macDinh: boolean } {
  if (tuongMinh) return { chucNang: tuongMinh, macDinh: false };
  return { chucNang: macDinh.chucNang, macDinh: true };
}

/**
 * Lý do cho dòng nhật ký "tự động" khi mặc định đổi (góp ý chủ (4)). `tenNgoai` = tên (đã lọc riêng tư) của tối đa 3
 * người không phải NV; `soNgoai` = tổng số. Thuần.
 */
export function cauDoiMacDinhTuDong(moi: 'sales' | 'khach', tenNgoai: readonly string[], soNgoai: number): string {
  if (moi === 'sales') return 'mọi thành viên đều là nhân viên';
  const ten = tenNgoai.slice(0, 3);
  if (ten.length === 0) return `có ${soNgoai} người không phải nhân viên trong nhóm`;
  const du = soNgoai > ten.length ? ` (+${soNgoai - ten.length} người)` : '';
  return `có người ngoài vào nhóm: ${ten.join(', ')}${du}`;
}
