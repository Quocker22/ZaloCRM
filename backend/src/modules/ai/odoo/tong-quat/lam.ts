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

export interface LamOdooInput {
  bang: string;
  viec: 'tao' | 'sua' | 'goi_nut';
  du_lieu?: Record<string, unknown>;
  loc?: unknown[];
  nut?: string;
  xac_nhan?: boolean;
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

    const phanh = quyetDinhPhanh({
      viec: input.viec,
      ...(input.nut ? { nut: input.nut } : {}),
      soBanGhi,
      ...(input.xac_nhan ? { xacNhan: true } : {}),
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
      `${kq.moTa} Anh/chị xác nhận giúp em rồi em làm ngay ạ ` +
      '(nhắn "đồng ý" / "xác nhận").'
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
    'Việc XOÁ hoặc đụng nhiều bản ghi sẽ trả về yêu cầu xác nhận — đọc nguyên văn ' +
    'cho nhân viên rồi chờ họ đồng ý, gọi lại với xac_nhan=true. ' +
    'KHÔNG dùng cho lên đơn/sửa đơn hàng — đã có tao_don_nhap/sua_don.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: { type: 'string', description: 'Model Odoo: sale.order, res.partner, stock.picking…' },
      viec: { type: 'string', enum: ['tao', 'sua', 'goi_nut'], description: 'Loại thao tác' },
      du_lieu: { type: 'object', description: 'Dữ liệu khi tao/sua, vd {"list_price": 99000}' },
      loc: { type: 'array', items: {}, description: 'Domain chỉ rõ bản ghi, vd [["name","=","S13823"]]' },
      nut: { type: 'string', description: 'Tên method khi viec=goi_nut' },
      xac_nhan: { type: 'boolean', description: 'true khi nhân viên ĐÃ đồng ý sau cảnh báo' },
    },
    required: ['bang', 'viec'],
  },
  mutates: true,
};
