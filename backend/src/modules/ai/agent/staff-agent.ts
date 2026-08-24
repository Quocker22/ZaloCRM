// SPDX-License-Identifier: AGPL-3.0-or-later
// Nối mọi thứ lại: nhân viên tag bot → vòng lặp tool-calling → kết quả.
//
// Đây là điểm hội tụ của Giai đoạn 1-4:
//   nhanDienLenhNhanVien (GĐ4) → ToolRegistry (GĐ1) → runAgent (GĐ1)
//     → tool Odoo (GĐ2-3) → quan trắc (GĐ4)

import { runAgent } from './loop.js';
import { ToolRegistry } from './registry.js';
import { nhanDienLenhNhanVien, buildStaffSystemPrompt } from './staff-command.js';
import {
  laYDinhDung, laToolGhi, khoeDaGhi, khoeDaGuiAnh, khoeDaChuyenSale, khoeDaGuiTaiLieu,
  coBangChungGuiFile,
} from './y-dinh-dung.js';
import { logger } from '../../../shared/utils/logger.js';
import type { ContextManagementConfig, ToolAwareGenerate, TurnUsage } from './types.js';

/**
 * Cấu hình context editing khuyến nghị cho luồng bán hàng.
 *
 * `exclude_tools: ['tao_don_nhap']` là BẮT BUỘC: kết quả tạo đơn chứa mã đơn.
 * Xoá đi thì model quên mất đã tạo đơn nào và có thể tạo lại — đúng thứ mà
 * idempotency đang chống. Hai lớp bảo vệ nên trùng khớp, không mâu thuẫn.
 */
export const CONTEXT_EDITING_MAC_DINH: ContextManagementConfig = {
  edits: [
    {
      type: 'clear_tool_uses_20250919',
      trigger: { type: 'input_tokens', value: 30_000 },
      keep: { type: 'tool_uses', value: 3 },
      // Xoá ít nhất 5.000 token thì mới bõ công phá cache.
      clear_at_least: { type: 'input_tokens', value: 5_000 },
      exclude_tools: ['tao_don_nhap'],
    },
  ],
};

import type { OdooClient } from '../odoo/client.js';
import {
  traSanPham, traSanPhamDefinition, dinhDangSanPham,
} from '../odoo/tools/tra-san-pham.js';
import {
  traTonKho, traTonKhoDefinition, dinhDangTonKho,
} from '../odoo/tools/tra-ton-kho.js';
import {
  traKhachHang, traKhachHangDefinition, dinhDangKhachHang,
} from '../odoo/tools/tra-khach-hang.js';
import {
  taoKhachHang, taoKhachHangDefinition, dinhDangTaoKhach,
} from '../odoo/tools/tao-khach-hang.js';
import {
  taoDonNhap, taoDonNhapDefinition, dinhDangTaoDon,
} from '../odoo/tools/tao-don-nhap.js';
// PHIẾU NHẬP HÀNG (11/08) — CHỈ registry NHÂN VIÊN, xem chú thích chỗ đăng ký.
import {
  taoDonMua, taoDonMuaDefinition, dinhDangTaoDonMua,
  traNhaCungCap, traNhaCungCapDefinition, dinhDangNhaCungCap,
} from '../odoo/tools/tao-don-mua.js';
import {
  chuyenSale, chuyenSaleDefinition, dinhDangChuyenSale,
  type YeuCauChuyenSale,
} from '../odoo/tools/chuyen-sale.js';
import {
  traDanhMuc, traDanhMucDefinition, dinhDangDanhMuc,
} from '../odoo/tools/tra-danh-muc.js';
import {
  traTriThuc, traTriThucDefinition, dinhDangTriThuc,
} from '../odoo/tools/tra-tri-thuc.js';
import {
  guiTaiLieu, guiTaiLieuDefinition, dinhDangGuiTaiLieu, khoiNoiDungKemFile, kemFileTriThuc, type TaiLieu,
} from '../odoo/tools/gui-tai-lieu.js';
import {
  baoCaoTongQuan, baoCaoTongQuanDefinition, dinhDangBaoCaoTongQuan,
} from '../odoo/tools/bao-cao-tong-quan.js';
import {
  baoCaoBanHang, baoCaoBanHangDefinition, dinhDangBaoCaoBanHang,
} from '../odoo/tools/bao-cao-ban-hang.js';
import {
  canhBaoTonKho, canhBaoTonKhoDefinition, dinhDangCanhBaoTonKho,
} from '../odoo/tools/canh-bao-ton-kho.js';
import {
  guiHoaDon, guiHoaDonDefinition, dinhDangGuiHoaDon, type KetQuaGuiHoaDon,
} from '../odoo/tools/gui-hoa-don.js';
import {
  traNganHang, traNganHangDefinition, dinhDangTraNganHang,
} from '../odoo/tools/tra-ngan-hang.js';
import {
  xuatHoaDon, xuatHoaDonDefinition, dinhDangXuatHoaDon,
} from '../odoo/tools/xuat-hoa-don.js';
import type { HoaDonAnhClient } from '../odoo/hoa-don-anh.js';
import {
  suaChietKhau, suaChietKhauDefinition, dinhDangChietKhau,
} from '../odoo/tools/sua-chiet-khau.js';
import {
  suaDon, suaDonDefinition, dinhDangSuaDon,
} from '../odoo/tools/sua-don.js';
import {
  suaVat, suaVatDefinition, dinhDangVat,
} from '../odoo/tools/sua-vat.js';
import {
  xuatCongNo, xuatCongNoDefinition, dinhDangCongNo,
} from '../odoo/tools/xuat-cong-no.js';
import {
  donChoXacNhan, donChoXacNhanDefinition, dinhDangDonCho, bangDonCho,
} from '../odoo/tools/don-cho-xac-nhan.js';
import {
  topSanPham, topSanPhamDefinition, dinhDangTopSanPham, bangTopSanPham,
} from '../odoo/tools/top-san-pham.js';
import {
  baoCaoLinhHoat, baoCaoLinhHoatDefinition, dinhDangLinhHoat, bangLinhHoat,
} from '../odoo/tools/bao-cao-linh-hoat.js';
import {
  baoCaoBanTon, baoCaoBanTonDefinition, dinhDangBanTon, bangBanTon,
} from '../odoo/tools/bao-cao-ban-ton.js';
import {
  xuatExcel, tenFileBaoCao, NGUONG_DINH_KEM, type BangExcel, type TepBaoCao,
} from '../odoo/xuat-excel.js';
import { bangRaAnh } from '../odoo/anh-bang.js';
import { docOdoo, docOdooDefinition, dinhDangDoc } from '../odoo/tong-quat/doc.js';
import { lamOdoo, lamOdooDefinition, dinhDangLam, CHIA_XAC_NHAN } from '../odoo/tong-quat/lam.js';
import { khamPhaOdoo, khamPhaOdooDefinition, dinhDangKhamPha } from '../odoo/tong-quat/kham-pha.js';
import { ghiLuatDefinition, quenLuatDefinition, khoiLuatChoPrompt, type KetQuaGhiLuat, type KetQuaQuenLuat } from './luat-nhan-vien.js';
import { khoiMucLucChoPrompt } from '../knowledge/muc-luc.js';

/**
 * Dấu nhận biết bot ĐÃ xin xác nhận cho một lệnh nguy hiểm ở lượt TRƯỚC.
 *
 * Khớp đúng câu `dinhDangLam` sinh ra khi `lam_odoo` trả `can_xac_nhan`
 * ("… Odoo KHÔNG hoàn tác được." / "(quá 20 bản ghi).", kèm lời mời nhắn
 * "đồng ý" ở tin sau). Bắt theo NỘI DUNG câu bot đã GỬI ĐI, chứ không tin lời
 * model tự khai trong cùng lượt — đó chính là lỗ hổng 11/08.
 *
 * Cố ý bắt HẸP: chỉ câu có cả cụm "xác nhận"/"đồng ý" LẪN dấu hiệu của lệnh
 * nguy hiểm (số bản ghi / không hoàn tác). Bot nói "em xác nhận đơn giúp anh"
 * KHÔNG mở được phanh xoá.
 */
const LOI_XIN_XAC_NHAN =
  /(?:KHÔNG hoàn tác được|quá \d+ bản ghi)[\s\S]*?(?:đồng ý|xác nhận)/i;

/**
 * Nhân viên có GẬT cho lệnh nguy hiểm không?
 *
 * KHÔNG dùng thẳng `laXacNhanNgan`, dù nó là hàm chuẩn cho mọi chỗ khác. Hai
 * lý do, cả hai đều đo được:
 *
 *   1. NÓ GẬT NHẦM. `laXacNhanNgan('khoan đã, để tôi xem lại')` trả TRUE —
 *      chuỗi 'da' (từ "đã") nằm trong danh sách cụm xác nhận. Với việc lên đơn
 *      thì gật nhầm chỉ tốn một câu sửa; với lệnh XOÁ 300 đơn thì "khoan đã"
 *      bị hiểu thành "đồng ý" là mất dữ liệu vĩnh viễn. Ở đây phải NGẶT hơn.
 *
 *   2. NÓ BỎ SÓT chính chữ ta dặn. `laXacNhanNgan('xác nhận')` trả FALSE, mà
 *      `dinhDangLam` lại mời nhân viên nhắn đúng chữ "xác nhận".
 *
 * Nguyên tắc: nghi ngờ thì KHÔNG gật. Nhân viên phải nhắn lại một chữ rõ hơn —
 * tốn hai giây, đổi lấy việc không bao giờ xoá nhầm.
 */
const GAT_RO_RANG = /^(?:đồng ý|dong y|xác nhận|xac nhan|ok|oke|okay|đúng rồi|dung roi|chốt|chot|làm đi|lam di|xoá đi|xoa di|yes|y)$/i;

export function laGatChoLenhNguyHiem(noiDung: string): boolean {
  const t = String(noiDung ?? '').trim()
    // Bỏ dấu câu ở hai đầu: "đồng ý!" / "ok." vẫn là lời gật.
    .replace(/^[\s.,!?;:"'()]+|[\s.,!?;:"'()]+$/g, '');
  if (!t) return false;
  // Có ý DỪNG thì dứt khoát không phải gật, dù câu có chứa chữ "ok".
  if (laYDinhDung(t)) return false;
  return GAT_RO_RANG.test(t);
}

/** Bản ghi 1 lần gọi tool — cho quan trắc. */
export interface ToolCallLog {
  toolName: string;
  input: unknown;
  output: string;
  thanhCong: boolean;
  durationMs: number;
  iteration: number;
}

export interface StaffAgentDeps {
  odoo: OdooClient;
  generate: ToolAwareGenerate;
  /**
   * Chặn tạo đơn thứ hai trong cùng hội thoại nếu cách đơn trước dưới N giây.
   * Không truyền → tắt (giữ hành vi cũ cho test).
   */
  chanDonLienKeGiay?: number;
  /** UID Zalo khách đang chat — khoá chống trùng khi tạo khách mới. */
  zaloUid?: string | null;
  /** Ghi nhận chuyển sale (gắn tag, mở nhóm). */
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  /** Quan trắc: ghi log mỗi lần gọi tool. Lỗi ở đây bị nuốt. */
  ghiLog?: (log: ToolCallLog) => Promise<void> | void;
  /**
   * Render ảnh hóa đơn. KHÔNG truyền thì tool `gui_hoa_don` không được đăng ký
   * — bot sẽ không hứa gửi hóa đơn rồi không gửi được.
   */
  anhClient?: HoaDonAnhClient;
  /** Gốc URL Odoo, để dựng link nhân viên bấm vào xử lý đơn. */
  odooUrl?: string;
  /** Tra tài liệu kỹ thuật (bảo hành, IP, công suất) — thứ Odoo không có. */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
  /**
   * Kho tài liệu (catalog/datasheet PDF) gửi được. Không truyền thì tool
   * `gui_tai_lieu` không đăng ký — khỏi hứa gửi rồi không gửi được (bug 03:17
   * 11/08).
   */
  lietTaiLieu?: () => Promise<TaiLieu[]>;
  /** Trích nội dung thô của tài liệu (RAG) để nhắn kèm tóm tắt sau khi gửi file. */
  trichTaiLieu?: (tieuDe: string) => Promise<string | null>;
  /** Mục lục sản phẩm sinh từ sheet (nhóm B 15/08) — chèn đầu userMessage. */
  mucLucSp?: string;
  /** Luat nhan vien dan — da nap san tu DB (napLuatNhanVien), chen vao nga canh moi luot. */
  luatNhanVien?: string[];
  /** Kho ghi/quen luat — truyen xuong registry de mo tool ghi_luat/quen_luat. */
  luatStore?: {
    ghi: (input: { noiDung: string; phamVi?: string }) => Promise<KetQuaGhiLuat>;
    quen: (input: { tuKhoa: string }) => Promise<KetQuaQuenLuat>;
  };
}

export interface StaffAgentInput {
  bizName: string;
  conversationId: string;
  /** Số thứ tự lần chốt đơn — thành phần khoá chống trùng. */
  seq: number;
  message: { content: string; isSelf: boolean };
  /**
   * Lịch sử hội thoại (cũ → mới) để bot hiểu ngữ cảnh.
   *
   * BẮT BUỘC cho luồng lên đơn nhiều lượt (bug thật 2026-07-30):
   *   NV : "@bot lên đơn chị Yến 1000 cái led 12v"
   *   Bot: "có nhiều loại, chọn loại nào?"
   *   NV : "@bot Led 2 bóng 2607 màu Trắng"
   *   Bot: (không có lịch sử) → tưởng chỉ hỏi giá → BÁO GIÁ rồi dừng.
   * Nhân viên đã nói "1000 cái" và tên khách ở lượt trước, bắt họ gõ lại đủ
   * mọi thứ trong một tin là bắt họ phục vụ máy.
   */
  history?: Array<{ vai: 'nhanvien' | 'bot' | 'khach'; noiDung: string }>;
  maxIterations?: number;
}

/**
 * Ghép lịch sử vào câu mở đầu (runAgent chỉ nhận 1 userMessage).
 *
 * Câu nhắc cuối là phần QUAN TRỌNG NHẤT: không có nó, model đọc lịch sử xong
 * vẫn coi tin mới là một yêu cầu độc lập. Ca thật: nhân viên nói "lên đơn 1000
 * cái", bot hỏi loại nào, nhân viên trả lời tên SP → bot báo giá rồi dừng,
 * quên mất việc đang làm dở là LÊN ĐƠN.
 */
export function ghepLichSuNhanVien(
  history: StaffAgentInput['history'],
  noiDung: string,
): string {
  if (!history || history.length === 0) return noiDung;

  const dong = history
    .map((h) => {
      const nhan = h.vai === 'nhanvien' ? 'NHÂN VIÊN' : h.vai === 'khach' ? 'KHÁCH' : 'BOT';
      return `${nhan}: ${h.noiDung}`;
    })
    .join('\n');

  // THỨ TỰ CÓ Ý: luật DỪNG đứng TRƯỚC luật làm-tiếp. Model đọc tuần tự và
  // luật đọc sau dễ bị luật đọc trước lấn át khi hai bên mâu thuẫn.
  //
  // Bug thật 05/08/2026 21:23: nhân viên nhắn "tôi không muốn mua nữa đâu",
  // BA GIÂY sau bot gọi tao_don_nhap tạo đơn S13799 (780.000đ). Lúc đó câu
  // nhắc chỉ có vế "hãy LÀM TIẾP cho xong" — bot làm tiếp thật, bất chấp
  // người vừa bảo dừng. Làm NGƯỢC ý người dùng tệ hơn nhiều so với làm thiếu.
  return (
    `[Hội thoại trước]\n${dong}\n\n[Tin mới]\n${noiDung}\n\n` +
    'TRƯỚC HẾT, đọc tin mới xem nó có phải một trong ba loại này không:\n' +
    '1. DỪNG / HUỶ — "thôi", "không mua nữa", "bỏ đi", "huỷ", "khoan đã", ' +
    '"để sau". Thì DỪNG NGAY: KHÔNG gọi tool GHI nào nữa (tao_don_nhap, ' +
    'tao_khach_hang, gui_hoa_don). Xác nhận đã dừng, và nếu lượt trước đã lỡ ' +
    'tạo đơn thì nói rõ mã đơn đó để nhân viên huỷ trên Odoo.\n' +
    '2. SỬA đơn vừa tạo — "10 cái mà", "sai rồi", "là 5 cái", "nhầm khách". ' +
    'Thì TUYỆT ĐỐI KHÔNG gọi tao_don_nhap lần nữa: tạo đơn mới là làm bẩn dữ ' +
    'liệu, phải dò và xoá bằng tay. Nói rõ mã đơn vừa tạo cần sửa gì.\n' +
    '3. Còn lại — có thể là CÂU TRẢ LỜI cho câu bạn vừa hỏi. Nếu trên kia có ' +
    'việc đang làm dở (lên đơn, tra cứu), hãy LÀM TIẾP cho xong: dùng lại ' +
    'thông tin đã có (tên khách, số lượng) thay vì hỏi lại.\n' +
    'Nghi ngờ giữa 1/2 và 3 thì HỎI LẠI, đừng đoán — ghi nhầm vào Odoo tốn ' +
    'công dò và xoá, hỏi một câu chỉ tốn vài giây.'
  );
}

export type StaffAgentResult =
  | { trangThai: 'khong_phai_lenh' }
  | {
      trangThai: 'xong'; traLoi: string; soToolDaGoi: number;
      log: ToolCallLog[]; usage: TurnUsage;
      /** Hóa đơn cần đính kèm vào tin Zalo (nếu bot có gọi gui_hoa_don). */
      hoaDon?: KetQuaGuiHoaDon;
      /** File Excel báo cáo dài — caller gửi qua Zalo sau phần text. */
      tepBaoCao?: TepBaoCao[];
      /**
       * File tài liệu bot đã lấy được (tool `gui_tai_lieu`) — caller gửi qua
       * Zalo sau phần text. Đường dẫn CỤC BỘ, vì `zaloOps.sendFile` cần path
       * chứ không nhận Buffer (xem gui-zalo.ts).
       */
      taiLieu?: Array<{ tieuDe: string; duongDanCucBo: string }>;
    }
  | { trangThai: 'chua_hoan_tat'; lyDo: string; log: ToolCallLog[]; usage: TurnUsage };

/**
 * Dựng registry đủ 11 tool cho luồng nhân viên (12 khi có anhClient).
 *
 * 3 tool BÁO CÁO (bao_cao_tong_quan, bao_cao_ban_hang, canh_bao_ton_kho) CHỈ có
 * ở đây — TUYỆT ĐỐI không đăng ký vào `buildCustomerRegistry()`. Doanh thu, lợi
 * nhuận, top khách là thông tin nội bộ; cùng nguyên tắc khiến registry khách cố
 * ý không có `tra_khach_hang` (nó lộ công nợ).
 *
 * Tách hàm riêng để test dựng được registry mà không cần cả agent.
 */
/**
 * Kết quả dài quá ngưỡng → đính kèm cho caller gửi. Trả về việc ĐÃ đính kèm
 * chưa để dinhDang* biết đường nói "xem file/ảnh".
 *
 * CHỈ gửi FILE EXCEL (anh chốt 08/08). Nhân viên hỏi "xuất danh sách" là muốn
 * bản tải về mở/sửa được; ảnh bảng 19 dòng trên điện thoại chữ li ti, không
 * đọc nổi — gửi kèm chỉ tổ rác chat.
 *
 * Vì sao TRƯỚC ĐÂY kèm cả ảnh: 06/08 file .xlsx qua zca-js hay rớt âm thầm nên
 * ảnh là lưới đỡ. Đo lại 08/08: 5 file gửi từ 06/08 tới nay, 0 lần `sendFile
 * NÉM` trong log 72h — nỗi lo đó không còn đúng.
 *
 * Đặt AI_BAO_CAO_CHI_ANH=1 để quay lại chỉ gửi ảnh (khi Zalo chặn file hẳn).
 */
async function dinhKemNeuDai(
  soDong: number,
  taoBang: () => BangExcel,
  nhan?: (tep: TepBaoCao) => void,
): Promise<boolean> {
  if (soDong <= NGUONG_DINH_KEM) return false;
  return dinhKemLuon(taoBang, soDong, nhan);
}

/**
 * Đính kèm BẤT KỂ bảng dài hay ngắn.
 *
 * Dùng cho báo cáo mà FILE CHÍNH LÀ SẢN PHẨM, không phải bản tóm tắt của tin
 * nhắn: `bao_cao_ban_ton` sinh phiếu kiểm kho có cột trống để kho điền số đếm
 * thực tế — ngày chỉ bán 3 mã vẫn cần file, vì đọc trên Zalo thì không có chỗ
 * ghi. Ngưỡng NGUONG_DINH_KEM ("dài quá thì mới kèm") không áp dụng ở đây.
 */
async function dinhKemLuon(
  taoBang: () => BangExcel,
  soDong: number,
  nhan?: (tep: TepBaoCao) => void,
): Promise<boolean> {
  if (!nhan) return false;
  const bang = taoBang();
  const chiAnh = process.env.AI_BAO_CAO_CHI_ANH === '1';
  let daKem = false;

  if (!chiAnh) {
    try {
      const xlsx = await xuatExcel(bang);
      nhan({ tenFile: tenFileBaoCao(bang.tieuDe), duLieu: xlsx, loai: 'file', moTa: `Đầy đủ ${soDong} dòng` });
      daKem = true;
    } catch { /* file lỗi → còn ảnh đỡ */ }
  }
  // Ảnh CHỈ khi không có file: hoặc cờ AI_BAO_CAO_CHI_ANH, hoặc xuất Excel lỗi.
  // Còn file thì thôi — ảnh bảng dài đọc không nổi trên điện thoại.
  if (!daKem) {
    try {
      const png = await bangRaAnh(bang);
      nhan({ tenFile: tenFileBaoCao(bang.tieuDe).replace(/\.xlsx$/, '.png'), duLieu: png, loai: 'anh', moTa: `Đầy đủ ${soDong} dòng` });
      daKem = true;
    } catch { /* cả hai lỗi → dinhDang* nói không có đính kèm */ }
  }

  return daKem;
}

export function buildStaffRegistry(deps: {
  odoo: OdooClient;
  conversationId: string;
  seq: number;
  /** Chặn đơn thứ hai quá gần đơn trước trong cùng hội thoại (giây). */
  chanDonLienKeGiay?: number;
  /** UID Zalo khách đang chat — khoá chống trùng khi tạo khách mới. */
  zaloUid?: string | null;
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  /** Render ảnh hóa đơn. Không có thì tool gui_hoa_don KHÔNG được đăng ký. */
  anhClient?: HoaDonAnhClient;
  odooUrl?: string;
  /** Nhận ảnh để caller đính kèm vào tin Zalo. */
  nhanHoaDon?: (kq: KetQuaGuiHoaDon) => void;
  /** Nhận file Excel báo cáo dài — caller gửi qua Zalo. Thiếu → chỉ text. */
  nhanTepBaoCao?: (tep: TepBaoCao) => void;
  /**
   * Tra tài liệu kỹ thuật. KHÔNG truyền thì tool `tra_tri_thuc` không đăng ký —
   * bot sẽ không hứa tra tài liệu rồi không tra được.
   */
  timDoanTriThuc?: (cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>;
  /**
   * Liệt kê tài liệu (catalog/datasheet PDF) gửi được. KHÔNG truyền thì tool
   * `gui_tai_lieu` không đăng ký — bot khỏi hứa gửi tài liệu rồi không gửi được,
   * đúng bug 03:17-03:18 ngày 11/08.
   */
  lietTaiLieu?: () => Promise<TaiLieu[]>;
  /** Trích nội dung thô của tài liệu (RAG) để nhắn kèm tóm tắt sau khi gửi file. */
  trichTaiLieu?: (tieuDe: string) => Promise<string | null>;
  /** Mục lục sản phẩm sinh từ sheet (nhóm B 15/08) — chèn đầu userMessage. */
  mucLucSp?: string;
  /** Tải tài liệu về đường dẫn cục bộ. Mặc định dùng `taiTaiLieuVe` của kho. */
  taiTaiLieu?: (t: TaiLieu) => Promise<string>;
  /** Nhận file tài liệu đã tải — caller gửi qua Zalo sau phần text. */
  nhanTaiLieu?: (t: { tieuDe: string; duongDanCucBo: string }) => void;
  /**
   * Kho luat nhan vien dan (12/08) — CHI luong nhan vien cap. Luong khach
   * khong bao gio co: khach ma dan duoc luat cho bot la prompt injection
   * co ghi vao DB.
   */
  luatStore?: {
    ghi: (input: { noiDung: string; phamVi?: string }) => Promise<KetQuaGhiLuat>;
    quen: (input: { tuKhoa: string }) => Promise<KetQuaQuenLuat>;
  };
  /**
   * NGƯỜI THẬT vừa gật cho lệnh nguy hiểm mà bot hỏi ở LƯỢT TRƯỚC.
   *
   * Do CODE tính từ tin nhắn thật của nhân viên (`laXacNhanNgan`), KHÔNG phải
   * do model tự khai — xem `CHIA_XAC_NHAN` trong odoo/tong-quat/lam.js. Đây là
   * thứ duy nhất bỏ được phanh xoá / phanh hàng loạt của `lam_odoo`.
   */
  xacNhanTuNguoi?: boolean;
}): ToolRegistry {
  const { odoo } = deps;
  const r = new ToolRegistry()
    // Nhân viên cũng cần: "@bot shop mình còn nhóm nào chưa nhập giá", hoặc khi
    // khách hỏi mảng hàng mà nhân viên chưa nhớ hết catalog.
    .register({
      definition: traDanhMucDefinition,
      run: async (input) =>
        dinhDangDanhMuc(await traDanhMuc({ odoo }, input as { tu_khoa?: string })),
    })
    // ── 3 tool BÁO CÁO — chỉ nhân viên, xem docstring trên ──────────────
    .register({
      definition: baoCaoTongQuanDefinition,
      run: async (input) =>
        dinhDangBaoCaoTongQuan(await baoCaoTongQuan({ odoo }, input as { ky?: string })),
    })
    .register({
      definition: baoCaoBanHangDefinition,
      run: async (input) =>
        dinhDangBaoCaoBanHang(
          await baoCaoBanHang({ odoo }, input as { ky?: string; tab?: string }),
        ),
    })
    .register({
      definition: canhBaoTonKhoDefinition,
      run: async (input) =>
        dinhDangCanhBaoTonKho(
          await canhBaoTonKho({ odoo }, input as { so_ngay?: number; ton_duoi?: number }),
        ),
    })
    .register({
      definition: traSanPhamDefinition,
      run: async (input) => {
        const i = input as { ten: string; gioi_han?: number };
        // Truyền lại từ khoá để thông báo rỗng phân biệt được "id nhét nhầm
        // vào ô ten" với "không tìm thấy thật".
        return dinhDangSanPham(await traSanPham({ odoo }, i), i.ten);
      },
    })
    .register({
      definition: traTonKhoDefinition,
      run: async (input) =>
        dinhDangTonKho(await traTonKho({ odoo }, input as { san_pham_id: number })),
    })
    .register({
      definition: traKhachHangDefinition,
      run: async (input) =>
        dinhDangKhachHang(await traKhachHang({ odoo }, input as { sdt: string })),
    })
    .register({
      definition: taoKhachHangDefinition,
      run: async (input) =>
        dinhDangTaoKhach(
          await taoKhachHang(
            { odoo, zaloUid: deps.zaloUid },
            input as Parameters<typeof taoKhachHang>[1],
          ),
        ),
    })
    .register({
      definition: taoDonNhapDefinition,
      run: async (input) => {
        const kq = await taoDonNhap(
          {
            odoo,
            conversationId: deps.conversationId,
            seq: deps.seq,
            // Nhân viên sửa đơn vừa lên ("10 cái mà") KHÔNG được thành đơn
            // mới — bug thật 05/08, xem cong-tac.ts:chanDonLienKeGiay.
            chanDonLienKeGiay: deps.chanDonLienKeGiay,
          },
          // Input THÔ của LLM — `taoDonNhap` tự kiểm lại từng field (id khách,
          // id SP, số lượng). Qua `unknown` vì `Record<string, unknown>` không
          // phủ được kiểu đích, không phải vì bỏ kiểm.
          input as unknown as Parameters<typeof taoDonNhap>[1],
        );

        // HOÁ ĐƠN TỰ ĐỘNG (06/08/2026): gửi ảnh đơn là bước CHẮC CHẮN sau khi
        // tạo — không giao cho model quyết. Đo thật: prompt dặn "gửi ngay
        // không cần hỏi" mà S13801 tạo xong model vẫn quên gọi gui_hoa_don,
        // nhân viên phải hỏi "sao không gửi hình?". Cùng nguyên tắc với ảnh
        // sản phẩm luồng khách: việc luôn-phải-làm thì code làm.
        // Ảnh lỗi không phá việc tạo đơn — guiHoaDon tự nuốt lỗi render.
        //
        // GỬI ẢNH CẢ KHI 'da_ton_tai' (bug S14172 07/08): model hay gọi
        // tao_don_nhap 2 lần cùng seq (lượt hỏi xác nhận + lượt "đúng rồi"),
        // lần hai idempotency trả 'da_ton_tai' → TRƯỚC ĐÂY skip ảnh nên đơn
        // tạo xong mà không có hoá đơn, bot đi bịa "đã gửi ảnh". Đơn đã tồn
        // tại là đơn THẬT, vẫn phải gửi ảnh.
        if ((kq.trangThai === 'da_tao' || kq.trangThai === 'da_ton_tai') && deps.anhClient && deps.odooUrl) {
          try {
            const hd = await guiHoaDon(
              { odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
              { don_id: kq.donId },
            );
            if (hd) deps.nhanHoaDon?.(hd);
            // guiHoaDon NUỐT lỗi render bên trong (trả anh=null + loiAnh) thay vì
            // throw — nên phải kiểm loiAnh ở ĐÂY, không phải catch. Bug S14172
            // (07/08): render fail thầm lặng, đơn tạo xong mà không có ảnh, bot
            // bịa "đã gửi". Log rõ để biết ảnh rớt vì sao (font/timeout/URL).
            if (hd && !hd.anh) {
              logger.warn(
                { donId: kq.donId, loiAnh: hd.loiAnh },
                '[staff-agent] auto-invoice: render ảnh hoá đơn THẤT BẠI — đơn vẫn tạo, ảnh chưa gửi',
              );
            }
          } catch (err) {
            logger.warn(
              { err: (err as Error)?.message, donId: kq.donId },
              '[staff-agent] auto-invoice lỗi — đơn vẫn tạo, ảnh chưa gửi',
            );
          }
        }
        return dinhDangTaoDon(kq, true);
      },
    })
    // ── PHIẾU NHẬP HÀNG / ĐƠN MUA (11/08/2026) ───────────────────────────
    //
    // Ca thật 22:09-22:11 nhóm Test-AI — bot từ chối việc nó LÀM ĐƯỢC:
    //   NV : "@bot rồi tạo phiếu nhập hàng giúp tôi luôn"
    //   Bot: "em hiện chỉ có tool lên đơn BÁN và quản lý tồn, chưa có tool tạo
    //         phiếu nhập hàng (mua hàng) — em không thể tạo phiếu nhập kho được ạ."
    //   NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10 full
    //         out: 10.000 tấm..."   (13 dòng hàng)
    //   Bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
    //
    // Bot nói SAI. Đo quyền trên prod cùng ngày bằng chính tài khoản bot_zalo:
    //   purchase.order write=true create=true · purchase.order.line write=true
    //   create=true · stock.picking write=true
    // và 5 đơn mua thật P04517-P04521 đang chạy, 4 đơn của NCC "Trung Quốc"
    // (id=314) — đúng nhà cung cấp nhân viên nhắc. `lam_odoo` cũng chưa bao giờ
    // cấm bảng này. Thiếu là thiếu TOOL CÓ TÊN, không thiếu quyền — cùng một
    // lỗi với `canh_bao_ton_kho` và `gui_tai_lieu` (có sẵn mà bot bảo "em không
    // có công cụ").
    //
    // CHỈ registry NHÂN VIÊN, TUYỆT ĐỐI không cho luồng khách: khách tạo được
    // đơn mua là tự đặt hàng bằng tiền công ty. Luồng khách nằm ở
    // customer-agent.ts và không import file này.
    .register({
      definition: traNhaCungCapDefinition,
      run: async (input) =>
        dinhDangNhaCungCap(
          await traNhaCungCap({ odoo }, input as { ten?: string; ma?: string }),
        ),
    })
    .register({
      definition: taoDonMuaDefinition,
      run: async (input) =>
        dinhDangTaoDonMua(
          await taoDonMua(
            { odoo, conversationId: deps.conversationId, seq: deps.seq },
            input as Parameters<typeof taoDonMua>[1],
          ),
        ),
    })
    // Tool GHI sửa đơn — chỉ đơn nháp, ranh giới nằm trong code không phải prompt.
    .register({
      definition: suaChietKhauDefinition,
      run: async (input) =>
        dinhDangChietKhau(
          await suaChietKhau({ odoo }, input as { don_id?: number; ma_don?: string; phan_tram: number }),
        ),
    })
    // VAT cho đơn ĐÃ LÊN (11/08). Ca hỏng 20:38→20:41 nhóm Test-AI: NV nói
    // "sửa lại thêm VAT 8%" cho đơn S13829 đã tạo, bot hỏi vòng quanh 4 lần
    // trong 3 phút rồi đề nghị NHÂN GIÁ LÊN 1.08. Nguyên nhân: máy gom đơn hết
    // cầm lái khi đơn đã lên, mà agent tự do lại không có tool VAT nào —
    // chiết khấu thì có `sua_chiet_khau` nên làm được ngay. Tool này lấp đúng
    // khoảng trống đó. Gửi lại ảnh hoá đơn sau khi sửa vì TỔNG ĐÃ ĐỔI.
    .register({
      definition: suaVatDefinition,
      run: async (input) => {
        const kq = await suaVat({ odoo }, input as { don_id?: number; ma_don?: string; phan_tram: number });
        if (kq.ok && deps.anhClient && deps.odooUrl) {
          try {
            const hd = await guiHoaDon(
              { odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
              { don_id: kq.donId },
            );
            if (hd) deps.nhanHoaDon?.(hd);
            if (hd && !hd.anh) {
              logger.warn({ donId: kq.donId, loiAnh: hd.loiAnh },
                '[staff-agent] sửa VAT: render ảnh THẤT BẠI — thuế đã gắn, ảnh chưa gửi');
            }
          } catch (err) {
            logger.warn({ err: (err as Error)?.message, donId: kq.donId },
              '[staff-agent] sửa VAT: gửi ảnh lỗi — thuế đã gắn, ảnh chưa gửi');
          }
        }
        return dinhDangVat(kq);
      },
    })
    // SỬA ĐƠN (07/08): đổi SL / thêm dòng vào đơn nháp cũ. Sau khi sửa xong, tự
    // gửi lại ảnh hoá đơn (giống auto-invoice sau tạo) để nhân viên thấy đơn mới.
    .register({
      definition: suaDonDefinition,
      run: async (input) => {
        const kq = await suaDon({ odoo }, input as Parameters<typeof suaDon>[1]);
        if (kq.ok && deps.anhClient && deps.odooUrl) {
          try {
            const hd = await guiHoaDon(
              { odoo, anhClient: deps.anhClient, odooUrl: deps.odooUrl },
              { don_id: kq.donId },
            );
            if (hd) deps.nhanHoaDon?.(hd);
            if (hd && !hd.anh) {
              logger.warn({ donId: kq.donId, loiAnh: hd.loiAnh },
                '[staff-agent] sửa đơn: render ảnh THẤT BẠI — đơn đã sửa, ảnh chưa gửi');
            }
          } catch (err) {
            logger.warn({ err: (err as Error)?.message, donId: kq.donId },
              '[staff-agent] sửa đơn: gửi ảnh lỗi — đơn đã sửa, ảnh chưa gửi');
          }
        }
        return dinhDangSuaDon(kq);
      },
    })
    .register({
      definition: xuatCongNoDefinition,
      run: async (input) =>
        dinhDangCongNo(
          await xuatCongNo({ odoo }, input as { khach_id?: number; ten?: string; sdt?: string }),
        ),
    })
    // BỎ chuyen_sale khỏi registry NHÂN VIÊN (07/08): mô tả tool viết cho luồng
    // KHÁCH ("chuyển việc cho sale"), nhưng người đang chat CHÍNH LÀ sale —
    // không có ai để chuyển. Bug thật 06/08: nhân viên hỏi báo cáo, model đọc
    // "không chắc → chuyển sale" rồi gọi cả bao_cao_ban_hang LẪN chuyen_sale
    // cùng lượt → gửi tin thừa "đã chuyển bộ phận bán hàng". Đo log: luồng nhân
    // viên gọi chuyen_sale 0 lần hợp lệ — bỏ hẳn là an toàn.
    // ── BÁO CÁO (spec 06/08/2026) — CHỈ registry nhân viên, khách không thấy ──
    .register({
      definition: donChoXacNhanDefinition,
      run: async (input) => {
        const kq = await donChoXacNhan({ odoo }, input as { gioi_han?: number });
        const kem = kq.trangThai === 'ok' &&
          (await dinhKemNeuDai(kq.danhSach.length, () => bangDonCho(kq), deps.nhanTepBaoCao));
        return dinhDangDonCho(kq, kem);
      },
    })
    .register({
      definition: topSanPhamDefinition,
      run: async (input) => {
        const kq = await topSanPham({ odoo }, input as Parameters<typeof topSanPham>[1]);
        const kem = kq.trangThai === 'ok' &&
          (await dinhKemNeuDai(kq.danhSach.length, () => bangTopSanPham(kq), deps.nhanTepBaoCao));
        return dinhDangTopSanPham(kq, kem);
      },
    })
    .register({
      definition: baoCaoLinhHoatDefinition,
      run: async (input) => {
        const kq = await baoCaoLinhHoat({ odoo }, input as Parameters<typeof baoCaoLinhHoat>[1]);
        const kem = kq.trangThai === 'ok' &&
          (await dinhKemNeuDai(kq.danhSach.length, () => bangLinhHoat(kq), deps.nhanTepBaoCao));
        return dinhDangLinhHoat(kq, kem);
      },
    })
    // KIỂM KHO TỪNG PHẦN (yêu cầu anh Quyết 17:58 ngày 11/08/2026).
    //
    // CHỈ registry NHÂN VIÊN, KHÔNG cho luồng khách: báo cáo này phơi toàn bộ
    // tồn kho và sản lượng bán của shop. Khách biết "hôm nay shop bán 7 mã,
    // mã X còn 2.636 cái" là lộ quy mô kinh doanh và tạo đòn bẩy mặc cả —
    // cùng lý do các tool báo cáo khác đều nằm trong khối này.
    //
    // ĐÍNH KÈM EXCEL BẤT KỂ DÀI NGẮN (khác mọi tool báo cáo trên, vốn chỉ kèm
    // khi quá NGUONG_DINH_KEM dòng): mục đích của báo cáo này là kho CẦM FILE
    // ĐI ĐẾM. Ngày chỉ bán 3 mã vẫn phải có file — đọc trên Zalo thì không có
    // chỗ điền số đếm được, mất sạch tác dụng đối chiếu.
    .register({
      definition: baoCaoBanTonDefinition,
      run: async (input) => {
        const kq = await baoCaoBanTon({ odoo }, input as Parameters<typeof baoCaoBanTon>[1]);
        const kem = kq.trangThai === 'ok' && kq.soMa > 0 &&
          (await dinhKemLuon(() => bangBanTon(kq), kq.soMa, deps.nhanTepBaoCao));
        return dinhDangBanTon(kq, kem);
      },
    });

  // Tool ảnh hóa đơn chỉ đăng ký khi caller cấp đủ hạ tầng render. Không có
  // thì bỏ qua — model không thấy tool nên không gọi, thay vì gọi rồi lỗi.
  if (deps.timDoanTriThuc) {
    // Tri thức kỹ thuật (bảo hành, IP, công suất) — thứ Odoo KHÔNG có.
    r.register({
      definition: traTriThucDefinition,
      run: async (input) => {
        const vao = input as { cau_hoi: string };
        const kqT = await traTriThuc({ timDoan: deps.timDoanTriThuc! }, vao);
        let ra = dinhDangTriThuc(kqT);
        // TỰ ĐÍNH FILE datasheet khi trả lời thông số (ca thật 17:13 24/08:
        // bot đọc vanh vách thông số OVP-K10P từ RAG mà không gửi file K10P.pdf
        // nằm sẵn trong kho — anh Quốc: "tại sao không gửi file cho khách
        // luôn???"). Khớp mơ hồ thì thôi — gửi nhầm tệ hơn gửi thiếu.
        if (kqT.loai === 'ok' && deps.lietTaiLieu) {
          const liet = deps.lietTaiLieu;
          const taiVe = deps.taiTaiLieu ?? (async (t: TaiLieu) => {
            const { taiTaiLieuVe } = await import('../knowledge/kho-tai-lieu.js');
            return taiTaiLieuVe(t);
          });
          const kem = await kemFileTriThuc({ liet, taiVe }, vao.cau_hoi ?? '', kqT.doan[0]?.tieuDe)
            .catch(() => null);
          if (kem) {
            deps.nhanTaiLieu?.(kem);
            ra +=
              `\n\nĐÃ GỬI KÈM file "${kem.tieuDe}" qua Zalo (tự động). ` +
              'Nhắc trong câu trả lời là em có đính kèm file tài liệu — ' +
              'ĐỪNG gọi gui_tai_lieu nữa, ĐỪNG hứa gửi thêm gì.';
          }
        }
        return ra;
      },
    });
  }

  // LUẬT NHÂN VIÊN DẶN (12/08) — trí nhớ dài hạn: "nhớ là khách X luôn giảm
  // 5%" nói MỘT lần, áp cho mọi lượt sau. Chỉ đăng ký khi caller cấp store
  // (luồng nhân viên); luồng khách không bao giờ có — khách mà dặn được luật
  // cho bot là prompt injection có ghi vào DB.
  if (deps.luatStore) {
    const store = deps.luatStore;
    r.register({
      definition: ghiLuatDefinition,
      run: async (input) => {
        const vao = input as { luat: string; pham_vi?: string };
        const kq = await store.ghi({ noiDung: vao.luat, phamVi: vao.pham_vi });
        return kq.ok
          ? `Em nhớ rồi: "${vao.luat}"${vao.pham_vi ? ` (khi: ${vao.pham_vi})` : ''}. Từ giờ em áp dụng cho mọi hội thoại. Muốn bỏ thì nói "quên luật ..." kèm vài chữ trong luật.`
          : `Không ghi được: ${kq.loi}`;
      },
    });
    r.register({
      definition: quenLuatDefinition,
      run: async (input) => {
        const vao = input as { tu_khoa: string };
        const kq = await store.quen({ tuKhoa: vao.tu_khoa });
        return kq.ok
          ? `Em đã quên ${kq.daTat.length} luật: ${kq.daTat.map((l) => `"${l}"`).join('; ')}`
          : `Không quên được: ${kq.loi}`;
      },
    });
  }

  // GỬI FILE TÀI LIỆU (11/08/2026) — sửa bug 03:17-03:18 cùng ngày: nhân viên
  // nói "a muốn e gửi cho a dạng tài liệu cattalog", bot đáp "hiện chưa có sẵn
  // file" TRONG KHI 8 datasheet PDF nằm sẵn trên đĩa server. Bot có tri thức
  // (đọc được chữ trong file) nên tưởng mình chỉ có chữ.
  if (deps.lietTaiLieu) {
    const liet = deps.lietTaiLieu;
    const taiVe = deps.taiTaiLieu ?? (async (t: TaiLieu) => {
      const { taiTaiLieuVe } = await import('../knowledge/kho-tai-lieu.js');
      return taiTaiLieuVe(t);
    });
    r.register({
      definition: guiTaiLieuDefinition,
      run: async (input) => {
        const kq = await guiTaiLieu({ liet, taiVe }, input as { yeu_cau: string });
        // Đẩy file ra ngoài để caller gửi qua Zalo. File KHÔNG đi qua LLM: nó
        // không đọc được PDF nhị phân, và vài MB base64 nuốt sạch ngữ cảnh —
        // cùng lý do ảnh hoá đơn đi đường riêng qua `nhanHoaDon`.
        if (kq.loai === 'da_gui') {
          deps.nhanTaiLieu?.({ tieuDe: kq.taiLieu.tieuDe, duongDanCucBo: kq.duongDanCucBo });
        }
        let ra = dinhDangGuiTaiLieu(kq);
        // Kèm TRÍCH nội dung để model tóm thông số trong cùng tin báo — chỉ
        // "Em đã gửi file..." thì cụt ngủn (anh Quốc 17:41 13/08). Best-effort.
        if (kq.loai === 'da_gui' && deps.trichTaiLieu) {
          const trich = await deps.trichTaiLieu(kq.taiLieu.tieuDe).catch(() => null);
          if (trich) ra += khoiNoiDungKemFile(trich);
        }
        return ra;
      },
    });
  }

  // ── BA TOOL ODOO TỔNG QUÁT (spec 2026-08-10) ─────────────────────────────
  // Thay cho việc viết tool riêng từng nghiệp vụ. CHỈ registry nhân viên —
  // khách điều khiển được câu chữ nên sẽ điều khiển được lệnh Odoo.
  // 18 tool cũ vẫn giữ: chúng nhanh hơn và có hàng rào riêng (verify tên khách,
  // idempotency, chặn giá ảo). Ba tool này để làm việc CHƯA có tool.
  r
    .register({
      definition: docOdooDefinition,
      run: async (input) => dinhDangDoc(await docOdoo({ odoo }, input as never)),
    })
    .register({
      definition: khamPhaOdooDefinition,
      run: async (input) => dinhDangKhamPha(await khamPhaOdoo({ odoo }, input as never)),
    })
    .register({
      definition: lamOdooDefinition,
      // CHÌA KHOÁ XÁC NHẬN gắn ở ĐÂY, không để model tự khai (lỗ hổng 11/08:
      // model đọc câu "cần xác nhận" rồi tự gọi lại với xac_nhan=true ngay
      // trong CÙNG lượt — 300 đơn bị xoá, không một con người nào gật).
      //
      // `deps.xacNhanTuNguoi` do code tính từ tin THẬT của nhân viên ở lượt
      // SAU. Symbol không serialize qua JSON nên input LLM không bao giờ mang
      // được chìa này — đúng mẫu `CHIA_BO_PHANH` của tools/tao-khach-hang.ts.
      run: async (input) => {
        const tham = { ...(input as Record<string, unknown>) } as unknown as Parameters<typeof lamOdoo>[1];
        // Cờ trần do model bịa ra: xoá đi cho sạch, rồi chỉ đặt lại khi NGƯỜI gật.
        delete tham.xac_nhan;
        if (deps.xacNhanTuNguoi) {
          tham.xac_nhan = true;
          tham[CHIA_XAC_NHAN] = true;
        }
        // `conversationId` xuống theo để dấu vết cột giá vốn truy được về đúng
        // hội thoại (xem NHAN_DAU_VET trong tong-quat/lam.ts). Chỉ để ghi log —
        // KHÔNG đổi hành vi, KHÔNG thêm phanh: anh Quốc chốt "đừng siết chặt
        // quá khó dùng".
        return dinhDangLam(await lamOdoo({ odoo, conversationId: deps.conversationId }, tham));
      },
    });

  // XUẤT HOÁ ĐƠN KẾ TOÁN (account.move, vào sổ). CHỈ nhân viên: đây là tool
  // ghi ERP nặng nhất của bot. Có anhClient thì render ảnh hoá đơn gửi kèm
  // ("giống đơn hàng" — 23:43 07/08) qua đúng kênh nhanHoaDon của gui_hoa_don.
  if (deps.odooUrl) {
    const odooUrl = deps.odooUrl;
    r.register({
      definition: xuatHoaDonDefinition,
      run: async (input) => {
        const kq = await xuatHoaDon(
          { odoo, odooUrl, conversationId: deps.conversationId, anhClient: deps.anhClient ?? null },
          input as { don_id?: number; ma_don?: string },
        );
        if (kq.trangThai !== 'loi' && kq.anh) {
          deps.nhanHoaDon?.({
            donId: kq.hoaDonId, maDon: kq.soHoaDon, tongTien: kq.tongTien,
            tenKhach: kq.tenKhach, anh: kq.anh, link: kq.link,
          });
        }
        return dinhDangXuatHoaDon(kq);
      },
    });
  }

  // TRA NGÂN HÀNG / QR cho NV (17/08, ca 22:27 "cho tôi QR của ngân hàng đi"
  // → bot bảo không có). Đọc Odoo, ảnh QR đi kênh nhanTepBaoCao (không qua LLM).
  r.register({
    definition: traNganHangDefinition,
    run: async (input) => {
      const kq = await traNganHang({ odoo }, input as { so_tien?: number; noi_dung?: string });
      if (kq.qr) {
        deps.nhanTepBaoCao?.({
          tenFile: kq.qr.tenFile, duLieu: kq.qr.duLieu, loai: 'anh',
          moTa: `QR chuyển khoản${kq.qr.soTien ? ` ${kq.qr.soTien.toLocaleString('vi-VN')}đ` : ''}`,
        });
      }
      return dinhDangTraNganHang(kq);
    },
  });

  if (deps.anhClient && deps.odooUrl) {
    const anhClient = deps.anhClient;
    const odooUrl = deps.odooUrl;
    r.register({
      definition: guiHoaDonDefinition,
      run: async (input) => {
        const kq = await guiHoaDon(
          // conversationId cho ca "xuất hoá đơn" nói trống — lấy đơn mới nhất
          // của chính hội thoại này (07/08).
          { odoo, anhClient, odooUrl, conversationId: deps.conversationId },
          input as { don_id?: number; ma_don?: string },
        );
        // Đẩy ảnh ra ngoài để caller đính kèm vào tin Zalo. Ảnh KHÔNG đi qua
        // LLM: nó không nhìn thấy được, và 180KB base64 sẽ ngốn hết ngữ cảnh.
        if (kq?.anh) deps.nhanHoaDon?.(kq);
        return dinhDangGuiHoaDon(kq);
      },
    });
  }

  return r;
}

/**
 * Xử lý một tin nhắn từ nhân viên.
 *
 * Trả `khong_phai_lenh` nếu tin không phải lệnh tag bot — caller đi tiếp
 * luồng bình thường, KHÔNG tốn token nào.
 *
 * QUAN TRỌNG: `chua_hoan_tat` nghĩa là vòng lặp chạm trần hoặc bị cắt — câu trả
 * lời CHƯA HOÀN CHỈNH. Caller phải báo nhân viên, không được gửi như kết quả thật.
 */
export async function chayLenhNhanVien(
  deps: StaffAgentDeps,
  input: StaffAgentInput,
): Promise<StaffAgentResult> {
  const lenh = nhanDienLenhNhanVien(input.message);

  if (!lenh) return { trangThai: 'khong_phai_lenh' };

  // Tag TRỐNG ("@bot" không kèm gì): từ 10/08 cổng trả object thay vì null để
  // luồng noi-zalo đáp "Dạ em đây" — nhưng ĐƯỜNG NÀY không có chỗ gửi câu đó,
  // và chạy tiếp nghĩa là nạp cả prompt + 8 tool vào LLM cho một dấu tag.
  // Dừng như cũ: caller đi luồng thường.
  if (lenh.tagTrong) return { trangThai: 'khong_phai_lenh' };

  // Hóa đơn model gọi ra — gom ở đây để trả về cho caller đính kèm.
  let hoaDon: KetQuaGuiHoaDon | undefined;
  const tepBaoCao: TepBaoCao[] = [];
  const taiLieuDaLay: Array<{ tieuDe: string; duongDanCucBo: string }> = [];

  // NGƯỜI THẬT GẬT CHO LỆNH NGUY HIỂM — tính ở CODE, từ tin nhắn thật.
  //
  // Điều kiện phải hội đủ HAI vế, và đó chính là chỗ lỗ hổng 11/08 bị bịt:
  //   1. Tin MỚI của nhân viên là lời gật ("đồng ý", "ok", "xác nhận"…)
  //   2. Bot đã HỎI ở lượt TRƯỚC (lịch sử có câu xin xác nhận của bot)
  //
  // Vế 2 buộc phải có một lượt nhắn THẬT chen giữa: model không thể vừa hỏi
  // vừa tự gật trong cùng một lượt, vì lúc nó chạy thì câu hỏi của nó chưa
  // nằm trong `history` (history là các lượt ĐÃ gửi xong).
  //
  // Cùng cơ chế `giaLechDaXacNhan` bên máy gom đơn: cái gật phải là tiếng nói
  // của người, đối chiếu bằng code — prompt dặn được nhưng model lờ được.
  const botDaXinXacNhan = (input.history ?? []).some(
    (h) => h.vai === 'bot' && LOI_XIN_XAC_NHAN.test(h.noiDung),
  );
  const xacNhanTuNguoi = botDaXinXacNhan && laGatChoLenhNguyHiem(lenh.noiDung);

  const registry = buildStaffRegistry({
    zaloUid: deps.zaloUid,
    odoo: deps.odoo,
    conversationId: input.conversationId,
    seq: input.seq,
    xacNhanTuNguoi,
    chanDonLienKeGiay: deps.chanDonLienKeGiay,
    ghiNhanChuyenSale: deps.ghiNhanChuyenSale,
    anhClient: deps.anhClient,
    odooUrl: deps.odooUrl,
    timDoanTriThuc: deps.timDoanTriThuc,
    lietTaiLieu: deps.lietTaiLieu,
    trichTaiLieu: deps.trichTaiLieu,
    luatStore: deps.luatStore,
    // Bot gọi gui_hoa_don nhiều lần thì lấy cái CUỐI — đó là đơn nó đang nói tới.
    nhanHoaDon: (kq) => { hoaDon = kq; },
    nhanTepBaoCao: (tep) => { tepBaoCao.push(tep); },
    // Tài liệu thì GOM HẾT, khác hoá đơn: nhân viên xin hai datasheet trong một
    // lượt là chuyện thường, giữ cái cuối thì mất cái đầu.
    //
    // CHỐNG TRÙNG theo đường dẫn (24/08): tra_tri_thuc giờ TỰ đính file, model
    // có thể gọi thêm gui_tai_lieu cho CÙNG file — không lọc thì Zalo nhận
    // hai bản y hệt.
    nhanTaiLieu: (t) => {
      if (!taiLieuDaLay.some((x) => x.duongDanCucBo === t.duongDanCucBo)) taiLieuDaLay.push(t);
    },
  });

  const log: ToolCallLog[] = [];

  // Người vừa bảo dừng → KHOÁ mọi tool GHI ở tầng registry, không tin prompt.
  //
  // Bug thật 05/08/2026 21:23: nhân viên nhắn "tôi không muốn mua nữa đâu",
  // BA GIÂY sau bot gọi tao_don_nhap tạo đơn 780.000đ. Prompt đã dặn nhưng
  // model lờ đi — làm NGƯỢC ý người dùng. Ranh giới phải ở CODE (quy tắc 2).
  const dungLai = laYDinhDung(lenh.noiDung);

  const kq = await runAgent({
    system: buildStaffSystemPrompt(input.bizName),
    // Khối luật đứng TRƯỚC lịch sử + tin mới: lời dặn lâu dài là nền, tin
    // mới ghi đè khi mâu thuẫn (chính khối luật tự nói điều đó).
    userMessage: [khoiMucLucChoPrompt(deps.mucLucSp ?? null), khoiLuatChoPrompt(deps.luatNhanVien ?? []), ghepLichSuNhanVien(input.history, lenh.noiDung)]
      .filter(Boolean).join('\n\n'),
    tools: registry.definitions(),
    execute: registry.executor(dungLai),
    generate: deps.generate,
    maxIterations: input.maxIterations,
    onToolCall: async (info) => {
      const ban: ToolCallLog = {
        toolName: info.call.name,
        input: info.call.input,
        output: info.result.content,
        thanhCong: !info.result.isError,
        durationMs: info.durationMs,
        iteration: info.iteration,
      };
      log.push(ban);
      await deps.ghiLog?.(ban);
    },
  });

  // Vòng lặp chưa xong → KHÔNG coi text là kết quả dùng được.
  if (kq.stopReason !== 'end_turn') {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        kq.stopReason === 'max_iterations'
          ? `Bot chạy ${kq.iterations} vòng vẫn chưa xong — cần người kiểm tra.`
          : `Lượt bị dừng bất thường (${kq.stopReason}).`,
      log,
      usage: kq.usage,
    };
  }

  // CÂU TRẢ LỜI RỖNG → coi như CHƯA XONG. Luồng khách đã có hàng rào này từ
  // 05/08 sáng; luồng nhân viên thì CHƯA — và tối cùng ngày nó nổ:
  //
  //   nhân viên: "10 cái mà"
  //   bot: gọi tra_san_pham → tao_don_nhap → gui_hoa_don (đều OK), rồi trả
  //        text RỖNG → guiTin(dich, '') → ZaloApiError "Missing message content"
  //
  // Tệ hơn cả việc báo lỗi: nó CHE MẤT việc bot vừa tạo đơn S13798 thừa —
  // nhân viên chỉ thấy dòng lỗi, không biết trong Odoo đã có thêm một đơn.
  // Vì vậy `lyDo` phải NÊU RÕ tool nào đã chạy, nhất là tool GHI.
  const traLoi = kq.text.trim();
  if (!traLoi) {
    const toolDaChay = log.map((l) => l.toolName);
    const toolGhi = toolDaChay.filter((t) => t === 'tao_don_nhap' || t === 'tao_khach_hang');
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        'Model trả câu rỗng sau khi gọi tool' +
        (toolDaChay.length > 0 ? ` (đã chạy: ${toolDaChay.join(', ')})` : '') +
        (toolGhi.length > 0 ? ' — CHÚ Ý: đã GHI vào Odoo, kiểm tra lại đơn!' : '') +
        '.',
      log,
      usage: kq.usage,
    };
  }

  // HÀNG RÀO CHỐNG BỊA — bot không được KHOE đã ghi khi tool ghi không chạy.
  //
  // Đo thật 05/08/2026 khi kiểm hàng rào đơn-liền-kề: `tao_don_nhap` bị chặn
  // đúng như thiết kế, nhưng bot vẫn đáp "Tôi đã cập nhật đơn S13797 thành 10
  // cái" — nhân viên đọc câu đó sẽ tin là xong và không sửa gì nữa.
  //
  // Cùng bản chất với `khoeDaLenDon()` ở luồng khách (bot bịa "đã lên đơn" 4
  // lần liên tiếp). Khác chỗ: nhân viên CÓ quyền ghi, nên phải đối chiếu với
  // log tool thật thay vì cấm tuyệt đối.
  const coGhiThat = log.some((l) => laToolGhi(l.toolName) && l.thanhCong);
  if (!coGhiThat && khoeDaGhi(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        `Model nói đã ghi ("${traLoi.slice(0, 80)}") nhưng KHÔNG tool ghi nào chạy thành công. ` +
        'Chặn để nhân viên khỏi tin nhầm là việc đã xong.',
      log,
      usage: kq.usage,
    };
  }

  // BẰNG CHỨNG GỬI FILE/ẢNH — gom MỌI ĐƯỜNG, dùng chung cho cả hai hàng rào dưới.
  //
  // Ca thật 21:47:52 + 21:50:21 ngày 11/08/2026: nhân viên xin "báo cáo các sản
  // phẩm bán ra hôm nay", bot tra ĐÚNG (11/08/2026, 7 mã — khớp kiểm chứng prod)
  // và sinh Excel thật, nhưng hàng rào tài liệu chỉ soi `taiLieuDaLay` nên tưởng
  // bot bịa, vứt nguyên câu trả lời, nhân viên nhận "em chưa xử lý được".
  //
  // Excel báo cáo đi đường KHÁC HẲN `gui_tai_lieu`: tool báo cáo tự sinh qua
  // `xuatExcel` → `tepBaoCao` → `guiFile`. Hàng rào phải đối chiếu với MỌI đường
  // gửi thật, nếu không mỗi lần thêm một đường gửi là thêm một kiểu chặn nhầm.
  // Chi tiết bốn đường + số đo log 24h: xem `coBangChungGuiFile` trong y-dinh-dung.ts.
  const coFileHoacAnhThat = coBangChungGuiFile({
    tepBaoCao,
    taiLieu: taiLieuDaLay,
    coAnhHoaDon: Boolean(hoaDon?.anh),
  });

  // HÀNG RÀO CHỐNG BỊA GỬI ẢNH — bot không được KHOE đã/đang gửi ảnh khi KHÔNG
  // có ảnh thật nào.
  //
  // Bug thật 07/08/2026 (DNH36805, trong nhóm): nhân viên "có gửi luôn đi", bot
  // đáp "Dạ, em gửi lại ảnh đơn hàng DNH36805..." nhưng chạy 0 tool → ảnh không
  // hề được gửi. Ca đó VẪN BỊ CHẶN sau bản vá này (không có bằng chứng nào).
  //
  // Nới từ "chỉ ảnh hoá đơn" sang "ảnh bất kỳ" vì ảnh bảng báo cáo (`bangRaAnh`,
  // dùng khi xuất Excel lỗi hoặc cờ AI_BAO_CAO_CHI_ANH=1) cũng là ảnh THẬT đi
  // qua `guiAnh` — bot nói "em gửi ảnh báo cáo" lúc đó là đúng sự thật.
  if (!coFileHoacAnhThat && khoeDaGuiAnh(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        `Model nói đã gửi ảnh ("${traLoi.slice(0, 80)}") nhưng KHÔNG có ảnh/file nào được tạo ra. ` +
        'Muốn gửi ảnh phải gọi tool gui_hoa_don (hoặc tool báo cáo sinh ảnh bảng); chặn câu bịa để nhân viên khỏi tin nhầm.',
      log,
      usage: kq.usage,
    };
  }

  // HÀNG RÀO CHỐNG HỨA LÈO "ĐÃ CHUYỂN SALE" (11/08/2026) — cùng họ với hai
  // hàng rào ngay trên.
  //
  // Ca thật 15:06→15:35 11/08 (nhóm Test-AI): bot nói "Dạ em đã chuyển việc
  // lên đơn ... sang bộ phận sale xử lý ạ. Sale sẽ xác nhận khách và lên đơn
  // giúp anh/chị ngay" — NĂM lần (15:07, 15:09, 15:14, 15:16, 15:32).
  //
  // Không một lời nào là thật:
  //   - `chuyen_sale` KHÔNG có trong registry nhân viên (bỏ từ 07/08, xem chú
  //     thích chỗ .register bên trên) → không tool nào chạy được.
  //   - Kể cả luồng khách nơi tool CÓ đăng ký, `ghiNhan` của nó chỉ ghi một
  //     dòng logger.info — không tag, không mở nhóm, không ai nhận thông báo.
  //   - Và người đang hỏi CHÍNH LÀ nhân viên sale ngồi trong nhóm.
  //
  // Nhân viên tin lời hứa đó nên chờ; kết quả là 28 phút và 8 lượt nhắc lại
  // cho một đơn đáng ra xong trong 1 lượt. Câu chung chung "em chưa xử lý
  // được" tuy cụt nhưng thành thật — họ biết ngay là phải tự làm tiếp.
  //
  // KHÔNG có ngoại lệ "trừ khi tool chạy": ở luồng nhân viên tool không tồn
  // tại, nên mọi câu khoe chuyển sale đều là bịa.
  if (khoeDaChuyenSale(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        `Model hứa đã chuyển sale ("${traLoi.slice(0, 80)}") nhưng tool chuyen_sale KHÔNG có ` +
        'trong registry nhân viên và cũng không gửi thông báo cho ai. Người đang chat CHÍNH LÀ ' +
        'sale — chặn lời hứa suông để nhân viên khỏi ngồi chờ (ca 11/08: chờ 28 phút).',
      log,
      usage: kq.usage,
    };
  }

  // HÀNG RÀO CHỐNG BỊA GỬI TÀI LIỆU (11/08/2026) — song sinh với hàng rào ảnh
  // ngay trên. Bot không được nói "em gửi catalog cho anh rồi" khi lượt đó
  // KHÔNG sinh ra file/ảnh nào.
  //
  // BẢN VÁ 11/08 tối: điều kiện cũ là `taiLieuDaLay.length === 0` — chỉ soi tool
  // `gui_tai_lieu`. Nó chặn nhầm 3/3 lượt trong log 24h, tất cả đều là ca báo
  // cáo bán hàng có Excel THẬT (21:47:52, 21:50:21 và một lượt nữa). Nay đối
  // chiếu với `coFileHoacAnhThat` — gom cả Excel/ảnh báo cáo và ảnh hoá đơn.
  //
  // Chức năng chính GIỮ NGUYÊN: khoe gửi mà không sinh ra gì thì vẫn chặn. Chính
  // việc SỬA bug 03:17 (bot từ chối dù có file) mở ra chiều bịa ngược lại; ba
  // lần trước đã dạy: khoeDaGhi (05/08), khoeDaGuiAnh (07/08), và chính nó (11/08).
  if (!coFileHoacAnhThat && khoeDaGuiTaiLieu(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        `Model nói đã gửi tài liệu ("${traLoi.slice(0, 80)}") nhưng KHÔNG file/ảnh nào được sinh ra. ` +
        'Muốn gửi tài liệu phải gọi tool gui_tai_lieu (hoặc tool báo cáo sinh Excel); chặn câu bịa để nhân viên khỏi ngồi chờ file không tới.',
      log,
      usage: kq.usage,
    };
  }

  return {
    trangThai: 'xong',
    traLoi,
    soToolDaGoi: kq.toolCalls.length,
    log,
    usage: kq.usage,
    hoaDon,
    ...(tepBaoCao.length > 0 ? { tepBaoCao } : {}),
    ...(taiLieuDaLay.length > 0 ? { taiLieu: taiLieuDaLay } : {}),
  };
}
