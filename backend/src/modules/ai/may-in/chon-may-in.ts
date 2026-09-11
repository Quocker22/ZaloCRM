// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * chon-may-in.ts — Task 2 (nhiều máy in theo chi nhánh): chọn máy in đích
 * theo 3 tầng ưu tiên.
 *
 * Spec: docs/plan-may-in-nhieu-chi-nhanh.md (Task 2) + print-agent-rs/docs/spec-may-in-nhieu-chi-nhanh.md
 *
 * Vì sao KHÔNG dùng LLM để đọc override của NV (Global Constraint của plan):
 * NV có thể gõ "in đơn HCM cho anh Hùng" (HCM là chi nhánh, ép in) hoặc "in
 * cho anh Hùng ở HN" (HN là chi nhánh của KHÁCH mà NV nhắc tới, vẫn hợp lệ ép
 * in HN) — cả hai đều đúng là override chi nhánh. Cái phải CHẶN là chuỗi con
 * vô tình: tên riêng như "Hồng Cẩm" bỏ dấu ra "hong cam", không chứa "hcm";
 * "Hà Nam" không được đọc nhầm "Hà Nội"; "hôm nay"/"hàng ngày" chứa "hn" dính
 * liền trong từ khác không được kích override. Parse bằng CODE (regex ranh
 * giới từ \b sau khi chuẩn hoá) là hàng rào tất định — LLM có thể tự suy
 * luận "khách ở HCM chắc là muốn in HCM" trong lượt sau, sai với chủ đích
 * (đối chiếu memory "hàng rào ở code, không vá prompt").
 */
import type { PrintAgent } from '@prisma/client';
import { KHO } from '../agent/noi-zalo/gom-don/kieu.js';

export interface ChonMayInDeps {
  /** Lấy toàn bộ máy in khả dụng (của org). Inject để test không cần DB thật. */
  layDanhSachMayIn: () => Promise<PrintAgent[]>;
}

export interface ChonMayInInput {
  /** Kho xuất hàng của hoá đơn (sale.order.warehouse_id / KHO.id ở kieu.ts). */
  warehouseId?: number | null;
  /** Câu nhân viên gõ trong lượt — có thể chứa lời ép chi nhánh in. */
  cauNv?: string | null;
}

const MA_KHO_HCM = KHO.find((k) => k.ma === 'HCM')!.id; // 3
const MA_KHO_TT = KHO.find((k) => k.ma === 'TT')!.id; // 2 — dùng chung cho HN (Global Constraint: HN = mặc định hiện nay)

/** Bỏ dấu tiếng Việt + hạ chữ thường, giữ khoảng trắng để giữ ranh giới từ. */
function chuanHoa(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/** Khớp một trong các cụm, mỗi cụm dùng ranh giới từ \b (chặn chuỗi con dính trong từ khác). */
function khopCumTuKhoa(cauChuanHoa: string, cum: string): boolean {
  // Cụm có khoảng trắng bên trong (vd "tp hcm") — thay bằng \s+ để chấp nhận
  // khoảng trắng thừa, và bọc \b hai đầu để không dính vào chữ liền kề.
  const pattern = new RegExp(`\\b${cum.replace(/\s+/g, '\\s+')}\\b`, 'i');
  return pattern.test(cauChuanHoa);
}

/**
 * Cụm ĐẶC TRƯNG — tự nó gần như chỉ xuất hiện khi NV thật sự ép chi nhánh in,
 * hiếm khi là chuỗi con vô tình của tên riêng/địa danh khác. Không cần tiền
 * tố hành động đi kèm.
 */
const CUM_HCM_DAC_TRUNG = ['hcm', 'tphcm', 'tp hcm', 'ho chi minh'];

/**
 * Cụm MƠ HỒ — 2 từ phổ biến trong tiếng Việt tự nhiên (tên quán, tên người,
 * câu chuyện phiếm), CHỈ được coi là lệnh ép in khi có TIỀN TỐ HÀNH ĐỘNG ngay
 * trước nó (in/gửi/giao/ở/tại/vào). Không đủ tiền tố → bỏ qua, KHÔNG override.
 *
 * Fix round 1 (bằng chứng review): "trong nam" quá lỏng — khớp cả
 * "Trong Nam Định giao trước nhé" (Nam Định là tỉnh MIỀN BẮC) vì "trong" +
 * "nam" đều là từ cực phổ biến, không có ranh giới từ nào cứu được. BỎ HẲN
 * khỏi danh sách nhận diện (khác "Hà Nam" — đó là 1 tên tỉnh cụ thể, hiếm khi
 * là chuỗi con của câu khác).
 *
 * "sai gon" giữ lại (NV thật hay gõ "in sài gòn") nhưng THẮT bằng tiền tố:
 * ca "quán Sài Gòn Ơi giao đồ ăn" không có in/gửi/giao/ở/tại/vào ngay trước
 * "sài gòn" (từ liền trước là "quán") nên không còn khớp. Trade-off: NV gõ
 * đúng dạng "sài gòn ơi" cho tên khách/quán NGAY SAU tiền tố "giao"/"gửi"
 * (vd "giao Sài Gòn Ơi giúp em") vẫn có thể bị hiểu nhầm — chấp nhận vì hàng
 * rào tiền tố đã cắt phần lớn ca sai; ca hiếm này thuộc giới hạn parse code
 * (không LLM), tương tự "ranh giới từ" không cứu 100% mọi câu.
 */
const CUM_HCM_MO_HO = ['sai gon', 'trong sg', 'trong sai gon'];
const TIEN_TO_HANH_DONG = '(?:in|gui|giao|o|tai|vao)';

const CUM_HN = ['hn', 'ha noi', 'hanoi', 'ngoai bac', 'ngoai nay'];

function khopCumMoHoCoTienTo(cauChuanHoa: string, cum: string): boolean {
  const pattern = new RegExp(`\\b${TIEN_TO_HANH_DONG}\\s+${cum.replace(/\s+/g, '\\s+')}\\b`, 'i');
  return pattern.test(cauChuanHoa);
}

/** Tầng 1: đọc lời NV ép chi nhánh in. Trả về id kho tương ứng hoặc null nếu không khớp gì. */
function tangMotDocLoiNv(cauNv?: string | null): number | null {
  if (!cauNv) return null;
  const chuan = chuanHoa(cauNv);

  // Ưu tiên khớp HCM trước — đặc trưng hơn (Global Constraint của plan), tránh
  // trường hợp câu vừa có "hcm" vừa lẫn "hn" từ chuỗi con khác gây mơ hồ.
  if (CUM_HCM_DAC_TRUNG.some((cum) => khopCumTuKhoa(chuan, cum))) return MA_KHO_HCM;
  if (CUM_HCM_MO_HO.some((cum) => khopCumMoHoCoTienTo(chuan, cum))) return MA_KHO_HCM;
  if (CUM_HN.some((cum) => khopCumTuKhoa(chuan, cum))) return MA_KHO_TT;
  return null;
}

function timMayTheoKho(danhSach: PrintAgent[], warehouseId: number): PrintAgent | undefined {
  return danhSach.find((m) => m.warehouseIds.includes(warehouseId));
}

/**
 * CỤM chi nhánh ĐẶC TRƯNG (Task 3b) — dùng để MIỄN khỏi hàng rào chủ đơn
 * `kiemCauNvKhopDon` (in-hoa-don.ts), vì "hcm"/"hn" trong câu NV là CHỈ ĐỊNH
 * NƠI IN chứ không phải tên khách. Một nguồn sự thật DUY NHẤT — tái dùng
 * NGUYÊN cụm HCM đặc trưng + cụm HN của tầng 1 chonMayIn (KHÔNG khai lại lần
 * hai, DRY).
 *
 * CỐ Ý CHỈ LẤY CỤM ĐẶC TRƯNG (`CUM_HCM_DAC_TRUNG` + `CUM_HN`), KHÔNG lấy
 * `CUM_HCM_MO_HO` ("sai gon", "trong sg"…): ở tầng chonMayIn cụm mơ hồ chỉ
 * được TÍNH khi có tiền tố hành động ("in sài gòn") — chấp nhận rủi ro nhỏ vì
 * override sai nhiều nhất cũng chỉ in nhầm chi nhánh. Nhưng miễn khỏi hàng
 * rào CHỦ ĐƠN thì rủi ro khác hẳn: miễn "sai"/"gon"/"trong"/"sg" tách rời khỏi
 * hàng rào tên khách sẽ mở khe cho NV nêu tên khách THẬT trùng vô tình với
 * mảnh cụm mơ hồ (vd token "sai" của tên "Sài" nào đó) đi lọt qua so khớp —
 * mức thắt của hàng rào chống-in-nhầm-giấy phải NGẶT HƠN mức thắt của
 * override-chọn-máy. Cũng KHÔNG tách cụm nhiều từ thành từng từ đơn ("ha",
 * "noi", "chi", "minh"): "ha"/"chi" là mảnh cực phổ biến của tên người thật
 * (chị Hà, chị Chi) — miễn một TỪ ĐƠN như vậy xoá tác dụng hàng rào ngay với
 * chính loại tên nó phải bắt. Chỉ miễn khi cả CỤM xuất hiện nguyên vẹn trong
 * câu (ranh giới từ \b, giống tầng 1) — token bị miễn phải liền được LOẠI
 * KHỎI câu trước khi tách; xem `boTuChiNhanh`.
 */
const CUM_CHI_NHANH_MIEN: readonly string[] = [...CUM_HCM_DAC_TRUNG, ...CUM_HN];

/**
 * Loại các cụm chi nhánh ĐẶC TRƯNG khỏi một chuỗi đã chuẩn hoá (chữ thường,
 * bỏ dấu — dạng `chuanSo` của in-hoa-don.ts), trả chuỗi còn lại để tách token
 * so khớp tên khách. Khớp CẢ CỤM bằng ranh giới từ `\b`, không tách rời từng
 * từ — xem lý do ở docstring `CUM_CHI_NHANH_MIEN`.
 */
export function boTuChiNhanh(cauChuanHoa: string): string {
  let ra = cauChuanHoa;
  for (const cum of CUM_CHI_NHANH_MIEN) {
    ra = ra.replace(new RegExp(`\\b${cum.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  return ra;
}

/**
 * Chọn máy in đích theo 3 tầng ưu tiên:
 *   1. Override lời NV (parse CODE, không LLM) — thắng nếu có máy phục vụ kho đó.
 *   2. warehouseId của hoá đơn.
 *   3. Máy laMacDinh (đúng 1; nhiều/không có → xử lý, xem dưới).
 *
 * Ném lỗi CHỈ khi không tầng nào khớp và không có máy mặc định nào — đây là
 * lỗi cấu hình (org quên đặt máy mặc định), không phải trạng thái vận hành
 * bình thường (Global Constraint: KHÔNG fallback sai địa chỉ, nhưng cũng
 * không được im lặng trả undefined khiến caller NPE mù mờ).
 */
export async function chonMayIn(deps: ChonMayInDeps, input: ChonMayInInput): Promise<PrintAgent> {
  const danhSach = await deps.layDanhSachMayIn();

  // Tầng 1: override lời NV — chỉ thắng nếu có máy PHỤC VỤ kho đó; nếu khớp
  // chi nhánh nhưng không máy nào phục vụ, rơi xuống tầng 2 (đừng ném lỗi).
  const khoOverride = tangMotDocLoiNv(input.cauNv);
  if (khoOverride !== null) {
    const may = timMayTheoKho(danhSach, khoOverride);
    if (may) return may;
  }

  // Tầng 2: theo warehouseId hoá đơn.
  if (input.warehouseId != null) {
    const may = timMayTheoKho(danhSach, input.warehouseId);
    if (may) return may;
  }

  // Tầng 3: máy mặc định. Đúng 1 máy laMacDinh=true là kỳ vọng; nếu nhiều hơn
  // 1 (lỗi cấu hình nhẹ, ai đó bật nhầm 2 máy mặc định) thì lấy cái đầu tiên
  // thay vì treo cả luồng in — an toàn hơn ném lỗi giữa ca vận hành. Chỉ ném
  // lỗi khi KHÔNG có máy mặc định nào, vì khi đó không còn tầng nào để lui.
  const macDinh = danhSach.find((m) => m.laMacDinh);
  if (!macDinh) {
    throw new Error(
      'chonMayIn: cấu hình máy in mặc định sai — không có máy in nào đặt laMacDinh=true cho org này.',
    );
  }
  return macDinh;
}
