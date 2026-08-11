// SPDX-License-Identifier: AGPL-3.0-or-later
// lam_odoo — GHI vào Odoo: tạo bản ghi, sửa, bấm nút (xác nhận đơn, vào sổ
// hoá đơn, xác nhận phiếu kho…). Thay cho việc viết tool riêng từng nghiệp vụ.
//
// ĐÂY LÀ TOOL NGUY HIỂM NHẤT HỆ THỐNG. User bot_zalo có 20 nhóm quyền Odoo
// (bán hàng, kho, mua hàng, kế toán) nên Odoo KHÔNG chặn giúp mình cái gì.
// Hai phanh trong an-toan.ts là tất cả những gì đứng giữa một câu hiểu nhầm và
// việc mất dữ liệu thật:
//   1. XOÁ  → luôn xin xác nhận (Odoo không có thùng rác)
//   2. >20 bản ghi → xin xác nhận, nêu rõ con số
// Ghi thường (1 đơn, 1 khách, 1 phiếu) chạy luôn — anh Quốc chốt 10/08.
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { quyetDinhPhanh, NGUONG_HANG_LOAT } from './an-toan.js';

export interface LamOdooDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

/**
 * Chìa khoá cho cờ `xac_nhan`. Symbol KHÔNG serialize được qua JSON, nên input
 * do LLM sinh (luôn là JSON thuần) KHÔNG THỂ mang nó — kể cả khi model tự bịa
 * ra trường `xac_nhan: true`.
 *
 * ── VÌ SAO PHẢI CÓ (lỗ hổng thật, xác minh 11/08/2026) ────────────────────
 * Trước đây `xac_nhan` được khai THẲNG trong `inputSchema` cho model tự điền.
 * Vòng lặp tool-calling đẩy kết quả `can_xac_nhan` NGƯỢC lại cho model rồi
 * chạy tiếp TRONG CÙNG MỘT LƯỢT NHẮN — model đọc chính câu cảnh báo nó vừa
 * nhận, rồi gọi lại `lam_odoo` với `xac_nhan: true`. Nhân viên không kịp đọc,
 * thậm chí không kịp THẤY: cả hai lần gọi nằm gọn trong một lượt, trước khi
 * một chữ nào được gửi ra Zalo. Đo thật: 300 đơn bị xoá, không ai gật.
 *
 * Một cái phanh mà chính kẻ bị phanh tự nhả được thì không phải phanh — nó chỉ
 * là lời đề nghị, và model đã chứng minh nhiều lần nó lờ được lời đề nghị
 * (bug 05/08 gọi tao_don_nhap sau khi NV nói dừng; bug 10:09:33 11/08 giá 8đ).
 *
 * ĐÚNG MẪU `CHIA_BO_PHANH` trong tools/tao-khach-hang.ts, và cùng lý do: hai
 * registry ép `input as never` / `as Parameters<...>` nên MỌI trường model bịa
 * ra đều lọt thẳng vào tham số. Ranh giới phải là CODE, không phải schema.
 *
 * Chìa khoá này CHỈ do code đặt, sau khi đọc tin THẬT của nhân viên ở lượt SAU
 * (xem `xacNhanTuNguoi` trong staff-agent.ts) — cùng cơ chế `giaLechDaXacNhan`
 * bên máy gom đơn.
 */
export const CHIA_XAC_NHAN: unique symbol = Symbol('xac_nhan_tu_nguoi');

export interface LamOdooInput {
  bang: string;
  viec: 'tao' | 'sua' | 'goi_nut';
  du_lieu?: Record<string, unknown>;
  loc?: unknown[];
  nut?: string;
  /**
   * Nhân viên ĐÃ đọc cảnh báo và gật ở lượt SAU.
   *
   * CHỈ có hiệu lực khi kèm chìa khoá `CHIA_XAC_NHAN`. Schema tool KHÔNG khai
   * cờ này, nên model không được mời điền — và nếu nó tự bịa ra thì cũng vô
   * hiệu vì thiếu chìa.
   */
  xac_nhan?: boolean;
  /** Chìa khoá xác thực cờ trên — xem CHIA_XAC_NHAN. */
  [CHIA_XAC_NHAN]?: true;
}

export type KetQuaLam =
  | { trangThai: 'da_lam'; soBanGhi: number; viec: string; bang: string }
  | { trangThai: 'can_xac_nhan'; lyDo: 'xoa' | 'hang_loat'; soBanGhi: number; moTa: string }
  | { trangThai: 'loi'; lyDo: string };

/**
 * Odoo trả None cho nhiều action → XML-RPC ném "cannot marshal None" DÙ việc
 * đã chạy xong (đo thật 23:33 07/08 với action_post). Nuốt riêng lỗi này.
 */
function laLoiMarshalNone(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return m.includes('cannot marshal None');
}

export async function lamOdoo(deps: LamOdooDeps, input: LamOdooInput): Promise<KetQuaLam> {
  const bang = (input.bang ?? '').trim();
  if (!bang) return { trangThai: 'loi', lyDo: 'Thiếu tên bảng Odoo.' };

  try {
    // ── TẠO: không đụng bản ghi cũ nên không cần phanh ──────────────────
    if (input.viec === 'tao') {
      if (!input.du_lieu || Object.keys(input.du_lieu).length === 0) {
        return { trangThai: 'loi', lyDo: 'Tạo bản ghi thì phải có dữ liệu (du_lieu).' };
      }
      await deps.odoo.execute(bang, 'create', [input.du_lieu]);
      return { trangThai: 'da_lam', soBanGhi: 1, viec: 'tạo', bang };
    }

    // ── SỬA / GỌI NÚT: bắt buộc có bộ lọc ───────────────────────────────
    //
    // Thiếu `loc` mà vẫn chạy thì Odoo hiểu là "toàn bộ bảng" — một câu hiểu
    // nhầm có thể sửa cả 1.257 sản phẩm. Bắt nêu rõ đụng vào đâu.
    if (!input.loc || input.loc.length === 0) {
      return {
        trangThai: 'loi',
        lyDo: 'Phải nêu rõ làm trên bản ghi NÀO (loc). Vd: [["name","=","S13823"]].',
      };
    }
    if (input.viec === 'goi_nut' && !input.nut) {
      return { trangThai: 'loi', lyDo: 'Gọi nút thì phải nêu tên nút (nut), vd action_confirm.' };
    }
    if (input.viec === 'sua' && (!input.du_lieu || Object.keys(input.du_lieu).length === 0)) {
      return { trangThai: 'loi', lyDo: 'Sửa thì phải có dữ liệu mới (du_lieu).' };
    }

    // ĐẾM TRƯỚC — đây là dữ liệu để quyết định phanh, và cũng là con số nói
    // cho nhân viên biết họ sắp đụng vào bao nhiêu.
    const soBanGhi = await deps.odoo.execute<number>(bang, 'search_count', [input.loc]);
    if (!soBanGhi || soBanGhi <= 0) {
      return { trangThai: 'loi', lyDo: `Không có bản ghi nào khớp điều kiện trên ${bang}.` };
    }

    // Cờ vượt phanh CHỈ có hiệu lực khi kèm chìa khoá Symbol — tức lời gật đến
    // từ NGƯỜI (code đọc tin thật của nhân viên ở lượt sau), không phải từ
    // model tự điền trong cùng lượt. Xem CHIA_XAC_NHAN ở đầu file.
    const nguoiDaGat = input.xac_nhan === true && input[CHIA_XAC_NHAN] === true;

    const phanh = quyetDinhPhanh({
      viec: input.viec,
      ...(input.nut ? { nut: input.nut } : {}),
      soBanGhi,
      ...(nguoiDaGat ? { xacNhan: true } : {}),
    });
    if (!phanh.chay) {
      const viecMoTa = phanh.lyDo === 'xoa' ? 'XOÁ' : `${input.viec === 'sua' ? 'sửa' : input.nut}`;
      return {
        trangThai: 'can_xac_nhan',
        lyDo: phanh.lyDo,
        soBanGhi,
        moTa:
          `Lệnh này sẽ ${viecMoTa} ${soBanGhi} bản ghi trên ${bang}` +
          (phanh.lyDo === 'xoa' ? ' — Odoo KHÔNG hoàn tác được.' : ` (quá ${NGUONG_HANG_LOAT} bản ghi).`),
      };
    }

    // ── Chạy thật ───────────────────────────────────────────────────────
    const ids = (await deps.odoo.searchRead<{ id: number }>(bang, input.loc, ['id'], { limit: 1000 }))
      .map((r) => Number(r.id));
    try {
      if (input.viec === 'sua') {
        await deps.odoo.execute(bang, 'write', [ids, input.du_lieu]);
      } else {
        await deps.odoo.execute(bang, input.nut!, [ids]);
      }
    } catch (err) {
      if (!laLoiMarshalNone(err)) throw err;
      // Việc đã chạy xong phía Odoo — chỉ khâu trả về hỏng.
    }
    return {
      trangThai: 'da_lam',
      soBanGhi: ids.length,
      viec: input.viec === 'sua' ? 'sửa' : (input.nut ?? 'gọi nút'),
      bang,
    };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

export function dinhDangLam(kq: KetQuaLam): string {
  if (kq.trangThai === 'loi') return `Không làm được: ${kq.lyDo}`;
  if (kq.trangThai === 'can_xac_nhan') {
    return (
      `${kq.moTa} Anh/chị nhắn "đồng ý" (hoặc "xác nhận") ở tin SAU thì em làm ngay ạ.`
    );
  }
  return `Đã ${kq.viec} ${kq.soBanGhi} bản ghi trên ${kq.bang}.`;
}

export const lamOdooDefinition: ToolDefinition = {
  name: 'lam_odoo',
  description:
    'GHI vào Odoo khi không có tool riêng: tạo bản ghi, sửa, hoặc bấm nút. ' +
    'GỌI KHI nhân viên nói: "xác nhận đơn S13823", "xác nhận phiếu kho", ' +
    '"sửa giá SP này thành 99k", "đổi SĐT khách", "ghi nhận thanh toán". ' +
    'viec=goi_nut cần nut (action_confirm, action_cancel, action_post, button_validate). ' +
    'LUÔN nêu loc để chỉ rõ làm trên bản ghi nào. ' +
    'Việc XOÁ hoặc đụng nhiều bản ghi sẽ trả về yêu cầu xác nhận: ĐỌC NGUYÊN VĂN ' +
    'câu đó cho nhân viên rồi DỪNG LƯỢT — chờ họ trả lời ở tin SAU. ' +
    'Gọi lại tool trong cùng lượt KHÔNG có tác dụng: lời gật phải đến từ nhân ' +
    'viên thật, hệ thống tự nhận biết và bỏ phanh giúp bạn ở lượt sau. ' +
    'KHÔNG dùng cho lên đơn/sửa đơn hàng — đã có tao_don_nhap/sua_don.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: { type: 'string', description: 'Model Odoo: sale.order, res.partner, stock.picking…' },
      viec: { type: 'string', enum: ['tao', 'sua', 'goi_nut'], description: 'Loại thao tác' },
      du_lieu: { type: 'object', description: 'Dữ liệu khi tao/sua, vd {"list_price": 99000}' },
      loc: { type: 'array', items: {}, description: 'Domain chỉ rõ bản ghi, vd [["name","=","S13823"]]' },
      nut: { type: 'string', description: 'Tên method khi viec=goi_nut' },
      // CỐ Ý KHÔNG KHAI `xac_nhan`: khai ra là mời model tự gật thay nhân viên
      // rồi vượt phanh ngay trong cùng lượt (lỗ hổng 11/08 — 300 đơn bị xoá,
      // không ai gật). Cờ đó giờ chỉ code đặt được, kèm chìa CHIA_XAC_NHAN.
    },
    required: ['bang', 'viec'],
  },
  mutates: true,
};
