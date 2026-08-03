// SPDX-License-Identifier: AGPL-3.0-or-later
// Nối mọi thứ lại: nhân viên tag bot → vòng lặp tool-calling → kết quả.
//
// Đây là điểm hội tụ của Giai đoạn 1-4:
//   nhanDienLenhNhanVien (GĐ4) → ToolRegistry (GĐ1) → runAgent (GĐ1)
//     → tool Odoo (GĐ2-3) → quan trắc (GĐ4)

import { runAgent } from './loop.js';
import { ToolRegistry } from './registry.js';
import { nhanDienLenhNhanVien, buildStaffSystemPrompt } from './staff-command.js';
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
import type { HoaDonAnhClient } from '../odoo/hoa-don-anh.js';
import {
  suaChietKhau, suaChietKhauDefinition, dinhDangChietKhau,
} from '../odoo/tools/sua-chiet-khau.js';
import {
  xuatCongNo, xuatCongNoDefinition, dinhDangCongNo,
} from '../odoo/tools/xuat-cong-no.js';

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
  history?: Array<{ vai: 'nhanvien' | 'bot'; noiDung: string }>;
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
    .map((h) => `${h.vai === 'nhanvien' ? 'NHÂN VIÊN' : 'BOT'}: ${h.noiDung}`)
    .join('\n');

  return (
    `[Hội thoại trước]\n${dong}\n\n[Tin mới]\n${noiDung}\n\n` +
    'Tin mới có thể là CÂU TRẢ LỜI cho câu bạn vừa hỏi. Nếu trên kia có việc ' +
    'đang làm dở (lên đơn, tra cứu), hãy LÀM TIẾP cho xong — dùng lại thông tin ' +
    'đã có (tên khách, số lượng) thay vì hỏi lại.'
  );
}

export type StaffAgentResult =
  | { trangThai: 'khong_phai_lenh' }
  | {
      trangThai: 'xong'; traLoi: string; soToolDaGoi: number;
      log: ToolCallLog[]; usage: TurnUsage;
      /** Hóa đơn cần đính kèm vào tin Zalo (nếu bot có gọi gui_hoa_don). */
      hoaDon?: KetQuaGuiHoaDon;
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
export function buildStaffRegistry(deps: {
  odoo: OdooClient;
  conversationId: string;
  seq: number;
  ghiNhanChuyenSale: (yc: YeuCauChuyenSale) => Promise<void>;
  /** Render ảnh hóa đơn. Không có thì tool gui_hoa_don KHÔNG được đăng ký. */
  anhClient?: HoaDonAnhClient;
  odooUrl?: string;
  /** Nhận ảnh để caller đính kèm vào tin Zalo. */
  nhanHoaDon?: (kq: KetQuaGuiHoaDon) => void;
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
      definition: taoDonNhapDefinition,
      run: async (input) =>
        dinhDangTaoDon(
          await taoDonNhap(
            { odoo, conversationId: deps.conversationId, seq: deps.seq },
            input as Parameters<typeof taoDonNhap>[1],
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
    .register({
      definition: xuatCongNoDefinition,
      run: async (input) =>
        dinhDangCongNo(
          await xuatCongNo({ odoo }, input as { khach_id?: number; ten?: string; sdt?: string }),
        ),
    })
    .register({
      definition: chuyenSaleDefinition,
      run: async (input) =>
        dinhDangChuyenSale(
          await chuyenSale({ ghiNhan: deps.ghiNhanChuyenSale }, input as { ly_do: string; tom_tat: string }),
        ),
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

  if (deps.anhClient && deps.odooUrl) {
    const anhClient = deps.anhClient;
    const odooUrl = deps.odooUrl;
    r.register({
      definition: guiHoaDonDefinition,
      run: async (input) => {
        const kq = await guiHoaDon(
          { odoo, anhClient, odooUrl },
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

  const registry = buildStaffRegistry({
    odoo: deps.odoo,
    conversationId: input.conversationId,
    seq: input.seq,
    ghiNhanChuyenSale: deps.ghiNhanChuyenSale,
    anhClient: deps.anhClient,
    odooUrl: deps.odooUrl,
    timDoanTriThuc: deps.timDoanTriThuc,
    // Bot gọi gui_hoa_don nhiều lần thì lấy cái CUỐI — đó là đơn nó đang nói tới.
    nhanHoaDon: (kq) => { hoaDon = kq; },
  });

  const log: ToolCallLog[] = [];

  const kq = await runAgent({
    system: buildStaffSystemPrompt(input.bizName),
    userMessage: ghepLichSuNhanVien(input.history, lenh.noiDung),
    tools: registry.definitions(),
    execute: registry.executor(),
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

  return {
    trangThai: 'xong',
    traLoi: kq.text,
    soToolDaGoi: kq.toolCalls.length,
    log,
    usage: kq.usage,
    hoaDon,
  };
}
