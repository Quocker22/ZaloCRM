// SPDX-License-Identifier: AGPL-3.0-or-later
// Nối mọi thứ lại: nhân viên tag bot → vòng lặp tool-calling → kết quả.
//
// Đây là điểm hội tụ của Giai đoạn 1-4:
//   nhanDienLenhNhanVien (GĐ4) → ToolRegistry (GĐ1) → runAgent (GĐ1)
//     → tool Odoo (GĐ2-3) → quan trắc (GĐ4)

import { runAgent } from './loop.js';
import { ToolRegistry } from './registry.js';
import { nhanDienLenhNhanVien, buildStaffSystemPrompt } from './staff-command.js';
import { laYDinhDung, laToolGhi, khoeDaGhi, khoeDaGuiAnh } from './y-dinh-dung.js';
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
  xuatExcel, tenFileBaoCao, NGUONG_DINH_KEM, type BangExcel, type TepBaoCao,
} from '../odoo/xuat-excel.js';
import { bangRaAnh } from '../odoo/anh-bang.js';

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
  if (!nhan || soDong <= NGUONG_DINH_KEM) return false;
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
        dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo }, input as { so_ngay?: number })),
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
          input as Parameters<typeof taoDonNhap>[1],
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
    // Tool GHI sửa đơn — chỉ đơn nháp, ranh giới nằm trong code không phải prompt.
    .register({
      definition: suaChietKhauDefinition,
      run: async (input) =>
        dinhDangChietKhau(
          await suaChietKhau({ odoo }, input as { don_id?: number; ma_don?: string; phan_tram: number }),
        ),
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
    });

  // Tool ảnh hóa đơn chỉ đăng ký khi caller cấp đủ hạ tầng render. Không có
  // thì bỏ qua — model không thấy tool nên không gọi, thay vì gọi rồi lỗi.
  if (deps.timDoanTriThuc) {
    // Tri thức kỹ thuật (bảo hành, IP, công suất) — thứ Odoo KHÔNG có.
    r.register({
      definition: traTriThucDefinition,
      run: async (input) =>
        dinhDangTriThuc(
          await traTriThuc({ timDoan: deps.timDoanTriThuc! }, input as { cau_hoi: string }),
        ),
    });
  }

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

  // Hóa đơn model gọi ra — gom ở đây để trả về cho caller đính kèm.
  let hoaDon: KetQuaGuiHoaDon | undefined;
  const tepBaoCao: TepBaoCao[] = [];

  const registry = buildStaffRegistry({
    zaloUid: deps.zaloUid,
    odoo: deps.odoo,
    conversationId: input.conversationId,
    seq: input.seq,
    chanDonLienKeGiay: deps.chanDonLienKeGiay,
    ghiNhanChuyenSale: deps.ghiNhanChuyenSale,
    anhClient: deps.anhClient,
    odooUrl: deps.odooUrl,
    timDoanTriThuc: deps.timDoanTriThuc,
    // Bot gọi gui_hoa_don nhiều lần thì lấy cái CUỐI — đó là đơn nó đang nói tới.
    nhanHoaDon: (kq) => { hoaDon = kq; },
    nhanTepBaoCao: (tep) => { tepBaoCao.push(tep); },
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
    userMessage: ghepLichSuNhanVien(input.history, lenh.noiDung),
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

  // HÀNG RÀO CHỐNG BỊA GỬI ẢNH — bot không được KHOE đã/đang gửi ảnh hoá đơn khi
  // KHÔNG có ảnh thật.
  //
  // Bug thật 07/08/2026 (DNH36805, trong nhóm): nhân viên "có gửi luôn đi", bot
  // đáp "Dạ, em gửi lại ảnh đơn hàng DNH36805..." nhưng chạy 0 tool → ảnh không
  // hề được gửi. Chỉ chặn khi khoe gửi ảnh mà KHÔNG có ảnh nào được tạo (hoaDon.anh)
  // — có ảnh thật thì luong-nhan-vien.ts sẽ gửi, câu khoe là đúng.
  const coAnhThat = Boolean(hoaDon?.anh);
  if (!coAnhThat && khoeDaGuiAnh(traLoi)) {
    return {
      trangThai: 'chua_hoan_tat',
      lyDo:
        `Model nói đã gửi ảnh ("${traLoi.slice(0, 80)}") nhưng KHÔNG có ảnh hoá đơn nào được tạo. ` +
        'Muốn gửi ảnh phải gọi tool gui_hoa_don để render ảnh thật; chặn câu bịa để nhân viên khỏi tin nhầm.',
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
  };
}
