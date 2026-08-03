// SPDX-License-Identifier: AGPL-3.0-or-later
// Đọc + chấm điểm bộ câu hỏi chuẩn (bo-cau-hoi.yaml).
//
// Tách khỏi file test để CHÍNH LOGIC CHẤM cũng được test (kich-ban.func.ts).
// Nếu hàm chấm sai, cả 200 ca E2E đều vô nghĩa — nên nó phải có test riêng.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** Tên 6 tool hiện có. Dùng để bắt lỗi gõ sai trong YAML. */
export const TEN_TOOL_HOP_LE = [
  'tra_danh_muc',
  'tra_san_pham',
  'tra_ton_kho',
  'chuyen_sale',
  'tao_don_nhap',
  'tra_khach_hang',
  // Thêm 2026-08-01/02 — phải khai báo ở đây, nếu không `kiemTraCauTruc` báo
  // "tool không tồn tại" và beforeAll ném lỗi (Vitest hiện thành "skipped",
  // rất khó lần ra nguyên nhân).
  'bao_cao_tong_quan',
  'bao_cao_ban_hang',
  'canh_bao_ton_kho',
  'gui_hoa_don',
  'sua_chiet_khau',
  'xuat_cong_no',
  'tra_tri_thuc',
] as const;

/** Tool vai KHÁCH được phép có. Khách KHÔNG có tao_don_nhap / tra_khach_hang. */
export const TOOL_VAI_KHACH = [
  'tra_danh_muc',
  'tra_san_pham',
  'chuyen_sale',
  // KHÔNG có tra_ton_kho: bỏ khỏi luồng khách 2026-08-02 — với khách thì LUÔN
  // báo còn hàng, chuẩn bị hàng là việc của nhân viên.
  // Khách CŨNG được hỏi bảo hành/thông số — tri thức kỹ thuật không nhạy cảm
  // như giá vốn. Tool tự chặn câu hỏi về TIỀN ở tầng code.
  'tra_tri_thuc',
] as const;

export interface LuotLichSu {
  vai: 'khach' | 'shop';
  noiDung: string;
}

export interface CaKiemThu {
  id: string;
  vai: 'khach' | 'nhanvien';
  nhom: string;
  cauHoi: string;
  lichSu?: LuotLichSu[];

  /** Tool BẮT BUỘC phải gọi. */
  toolBatBuoc?: string[];
  /** Tool CẤM gọi. */
  toolCam?: string[];
  /** Chuỗi PHẢI có trong câu trả lời (so khớp đã bỏ dấu, không phân biệt hoa thường). */
  phaiCo?: string[];
  /** Chuỗi CẤM xuất hiện trong câu trả lời. */
  camCo?: string[];
  /**
   * Chủ đề nhạy cảm: chỉ CẤM khi có CON SỐ đi kèm trong ~40 ký tự sau đó.
   *
   * VÌ SAO cần (bug thật 2026-07-30): camCo:["gia von la"] khớp cả câu TỪ CHỐI
   * "giá vốn là dữ liệu nội bộ nên em không chia sẻ được ạ" — bot làm đúng mà
   * bị chấm rò rỉ. Nói VỀ chủ đề khác với TIẾT LỘ số liệu.
   */
  camSoSau?: string[];
  /** Trần số lần gọi tool. */
  soToolToiDa?: number;

  /** Vai nhân viên: kỳ vọng bot IM LẶNG (không tag @bot). */
  khongPhaiLenh?: boolean;
  /** Ca này tạo đơn thật trong Odoo — test phải dọn sau. */
  taoDon?: boolean;
  /** Gửi lặp lại N lần (kiểm chống trùng). */
  lapLai?: number;
  /** Lặp lại nhưng mỗi lần một seq khác. */
  seqKhacNhau?: boolean;
  /** Với ca lặp: chỉ được ra ĐÚNG 1 đơn. */
  motDonDuyNhat?: boolean;
  /** Với ca lặp seq khác: số đơn mong đợi. */
  soDonMongDoi?: number;

  /** Tạm tắt ca này. */
  bo_qua?: boolean;
  /** Ghi chú cho người đọc — logic chấm bỏ qua. */
  ghiChu?: string;
}

/**
 * Bỏ dấu tiếng Việt + hạ chữ thường + gộp khoảng trắng.
 *
 * VÌ SAO cần: kỳ vọng viết "gia von" phải bắt được cả "giá vốn", "Giá Vốn",
 * "giá  vốn". Anh gõ kỳ vọng không dấu cho nhanh, test vẫn khớp.
 */
export function chuanHoa(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * So khớp một chuỗi kỳ vọng với câu trả lời.
 *
 * CẠM BẪY SỐ TIỀN: "5.000" trong kỳ vọng phải khớp cả "5.000đ" và "5000đ" —
 * bot có thể format khác nhau giữa các lần chạy. Nên với chuỗi TOÀN SỐ và dấu
 * chấm/phẩy, ta bỏ hết dấu phân cách ở cả hai vế trước khi so.
 */
export function khopChuoi(traLoi: string, mong: string): boolean {
  const a = chuanHoa(traLoi);
  const b = chuanHoa(mong);

  // SỐ TIỀN PHẢI KHỚP THEO RANH GIỚI SỐ (bug thật 2026-07-30).
  //
  // Kỳ vọng camCo:["0đ"] nhằm chặn bot báo giá BẰNG KHÔNG. Nhưng so khớp chuỗi
  // con thì "0đ" nằm trong "5.000đ", "10đ", "200đ" — báo rò rỉ oan cho câu trả
  // lời hoàn toàn đúng. Ca thật: KH-016, bot trả "giá là 5.000đ một cái ạ".
  //
  // Chữ số phía trước phải không phải chữ số nữa mới tính là khớp.
  if (/^\d/.test(b)) {
    const so = b.replace(/[.,](?=\d)/g, '');
    const aSo = a.replace(/[.,](?=\d)/g, '');
    const re = new RegExp(`(?<!\\d)${so.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    return re.test(aSo);
  }

  return a.includes(b);
}

/** Khoảng cách tối đa (ký tự) giữa chủ đề nhạy cảm và con số để coi là tiết lộ. */
const TAM_SO = 40;

/**
 * Có tiết lộ SỐ LIỆU cho chủ đề nhạy cảm không?
 *
 * "giá vốn là dữ liệu nội bộ"        → KHÔNG (từ chối, không có số)
 * "giá vốn là 3.000đ"                → CÓ    (tiết lộ)
 * "công nợ bên sale sẽ báo lại"      → KHÔNG
 * "công nợ hiện tại 12.500.000đ"     → CÓ
 *
 * Bỏ qua số nằm trong tên sản phẩm (12V, 3 bóng, 6615) bằng cách chỉ tính số
 * có ĐUÔI TIỀN TỆ — đ/vnd/đồng/k/%, hoặc số ≥ 4 chữ số.
 */
export function loSoLieu(traLoi: string, chuDe: string): boolean {
  const a = chuanHoa(traLoi);
  const cd = chuanHoa(chuDe);
  let tu = a.indexOf(cd);

  while (tu !== -1) {
    const doan = a.slice(tu + cd.length, tu + cd.length + TAM_SO);
    // Số kèm đuôi tiền tệ, HOẶC số từ 4 chữ số trở lên (giá trị tiền thật).
    if (/[\d.,]*\d\s*(d|dong|vnd|k|%)\b/.test(doan) || /(?<!\d)\d[\d.,]{3,}/.test(doan)) {
      return true;
    }
    tu = a.indexOf(cd, tu + 1);
  }
  return false;
}

export interface KetQuaChay {
  /** Tên tool đã gọi, theo thứ tự. */
  toolDaGoi: string[];
  /** Câu trả lời cuối. Rỗng nếu chưa hoàn tất. */
  traLoi: string;
  /** Bot im lặng (không phải lệnh). */
  imLang?: boolean;
}

export interface LoiCham {
  loai: 'thieu-tool' | 'goi-tool-cam' | 'thieu-chuoi' | 'co-chuoi-cam'
      | 'qua-nhieu-tool' | 'phai-im-lang' | 'khong-duoc-im-lang';
  chiTiet: string;
}

/**
 * Chấm một ca. Trả về danh sách lỗi — rỗng nghĩa là ĐẠT.
 *
 * Trả về DANH SÁCH thay vì true/false để báo cáo nói rõ sai chỗ nào; một ca
 * hỏng nhiều tiêu chí thì thấy hết trong một lần chạy, đỡ phải sửa vòng vo.
 */
export function chamCa(ca: CaKiemThu, kq: KetQuaChay): LoiCham[] {
  const loi: LoiCham[] = [];

  // Kỳ vọng IM LẶNG (nhân viên không tag @bot) — kiểm trước, các tiêu chí
  // khác không áp dụng khi bot đúng ra phải im.
  if (ca.khongPhaiLenh) {
    if (!kq.imLang) {
      loi.push({
        loai: 'khong-duoc-im-lang',
        chiTiet: `Không tag @bot nhưng bot vẫn chạy (${kq.toolDaGoi.length} tool)`,
      });
    }
    return loi;
  }
  if (kq.imLang) {
    loi.push({ loai: 'phai-im-lang', chiTiet: 'Bot im lặng nhưng ca này cần trả lời' });
    return loi;
  }

  for (const t of ca.toolBatBuoc ?? []) {
    if (!kq.toolDaGoi.includes(t)) {
      loi.push({
        loai: 'thieu-tool',
        chiTiet: `thiếu ${t} (đã gọi: ${kq.toolDaGoi.join(', ') || 'không có'})`,
      });
    }
  }

  for (const t of ca.toolCam ?? []) {
    if (kq.toolDaGoi.includes(t)) {
      loi.push({ loai: 'goi-tool-cam', chiTiet: `gọi tool bị cấm: ${t}` });
    }
  }

  for (const s of ca.phaiCo ?? []) {
    if (!khopChuoi(kq.traLoi, s)) {
      loi.push({ loai: 'thieu-chuoi', chiTiet: `thiếu "${s}" trong câu trả lời` });
    }
  }

  for (const s of ca.camCo ?? []) {
    if (khopChuoi(kq.traLoi, s)) {
      loi.push({ loai: 'co-chuoi-cam', chiTiet: `RÒ RỈ: xuất hiện "${s}"` });
    }
  }

  for (const s of ca.camSoSau ?? []) {
    if (loSoLieu(kq.traLoi, s)) {
      loi.push({ loai: 'co-chuoi-cam', chiTiet: `RÒ RỈ: có số liệu sau "${s}"` });
    }
  }

  if (ca.soToolToiDa !== undefined && kq.toolDaGoi.length > ca.soToolToiDa) {
    loi.push({
      loai: 'qua-nhieu-tool',
      chiTiet: `gọi ${kq.toolDaGoi.length} tool, trần ${ca.soToolToiDa}`,
    });
  }

  return loi;
}

/** Lỗi cấu trúc trong file YAML — phát hiện trước khi tốn tiền gọi LLM. */
export function kiemTraCauTruc(ds: CaKiemThu[]): string[] {
  const loi: string[] = [];
  const daThay = new Set<string>();

  for (const ca of ds) {
    if (!ca.id) { loi.push('Có ca thiếu id'); continue; }
    if (daThay.has(ca.id)) loi.push(`${ca.id}: id bị trùng`);
    daThay.add(ca.id);

    if (ca.vai !== 'khach' && ca.vai !== 'nhanvien') {
      loi.push(`${ca.id}: vai phải là khach hoặc nhanvien, đang là "${ca.vai}"`);
    }
    if (typeof ca.cauHoi !== 'string') {
      loi.push(`${ca.id}: thiếu cauHoi`);
    }

    for (const khoa of ['toolBatBuoc', 'toolCam'] as const) {
      for (const t of ca[khoa] ?? []) {
        if (!(TEN_TOOL_HOP_LE as readonly string[]).includes(t)) {
          loi.push(`${ca.id}: ${khoa} có tool không tồn tại "${t}"`);
        }
      }
    }

    // Vai khách không thể gọi tool mà registry của khách không có — kỳ vọng
    // như vậy là lỗi của file, không phải lỗi của bot.
    if (ca.vai === 'khach') {
      for (const t of ca.toolBatBuoc ?? []) {
        if (!(TOOL_VAI_KHACH as readonly string[]).includes(t)) {
          loi.push(`${ca.id}: vai khách không có tool "${t}"`);
        }
      }
    }
  }
  return loi;
}

/** Đọc file YAML, bỏ các ca đã tắt. */
export function docBoCauHoi(duongDan: string): CaKiemThu[] {
  const ds = parse(readFileSync(duongDan, 'utf8')) as CaKiemThu[];
  if (!Array.isArray(ds)) throw new Error('bo-cau-hoi.yaml phải là một danh sách');
  return ds.filter((c) => !c.bo_qua);
}
