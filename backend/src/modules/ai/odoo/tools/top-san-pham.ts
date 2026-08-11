// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: TOP SẢN PHẨM — bán chạy hoặc Ế theo kỳ (spec báo-cáo-Zalo 06/08/2026).
//
// Định nghĩa Ế (chốt trong spec): còn TỒN (>0) nhưng 0 BÁN trong kỳ —
// không phải "bán ít", tránh cãi nhau về ngưỡng.
//
// Số liệu bán lấy qua read_group trên sale.order.line — ODOO cộng, code chỉ
// sắp xếp/trình bày, model chỉ đọc (hàng rào chính xác số 1).
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { NGUONG_DINH_KEM, type BangExcel } from '../xuat-excel.js';
import { laSanPhamKyThuat } from '../sp-ky-thuat.js';
import {
  chonKy, ngayVietNam, KY_HOP_LE, MO_TA_KY, MO_TA_TU_NGAY, MO_TA_DEN_NGAY, type Ky,
} from '../ky-thoi-gian.js';

export interface DongTop {
  sanPhamId: number;
  ten: string;
  soLuong: number;
  tongTien: number;
}

export type KetQuaTop =
  | { trangThai: 'ok'; kieu: 'ban_chay' | 'e'; danhSach: DongTop[]; ky: string }
  | { trangThai: 'loi'; lyDo: string };

export interface TopSanPhamDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

const TRAN_DONG = 200;

export async function topSanPham(
  deps: TopSanPhamDeps,
  input: { kieu?: string; ky?: string; tu_ngay?: string; den_ngay?: string; gioi_han?: number; bayGio?: Date },
): Promise<KetQuaTop> {
  const kieu = input.kieu === 'e' ? 'e' : 'ban_chay';
  const limit = Math.min(Math.max(1, input.gioi_han ?? 20), TRAN_DONG);
  const bayGio = input.bayGio ?? new Date();

  // ═══ KỲ DO CODE CHỐT ─ xem ky-thoi-gian.ts (ca 21:17 + 03:29 ngày 11/08) ══
  // Model KHÔNG có đồng hồ, nên `ky` (từ khoá) thắng mọi ngày nó tự nhẩm.
  //
  // MẶC ĐỊNH KHÁC hai tool kia: 30 NGÀY gần nhất, không phải hôm nay — "dạo
  // này bán gì chạy" là câu hỏi phổ biến nhất của tool này, ép về hôm nay là
  // trả lời câu khác. Vì vậy chỉ gọi `chonKy` khi model THẬT SỰ có nêu kỳ.
  const coNeuKy = Boolean(input.ky) || Boolean(input.tu_ngay) || Boolean(input.den_ngay);
  const mac30Ngay = (): Ky => {
    const den = ngayVietNam(bayGio);
    const tu = ngayVietNam(new Date(bayGio.getTime() - 30 * 86_400_000));
    return { tu, den };
  };
  const kyChot = coNeuKy ? chonKy(input, bayGio, 'thang_nay') : mac30Ngay();
  // Ngày vô lý (tương lai/quá 1 năm) → `chonKy` đã kéo về kỳ an toàn; ở tool
  // này rơi về 30 ngày cho đúng nếp cũ thay vì tháng này.
  const { tu, den } = kyChot.canhBao ? mac30Ngay() : kyChot;
  const ky = `${tu} – ${den}`;

  try {
    // Doanh số theo SP trong kỳ. Bộ lọc nền: loại đơn huỷ (gồm cả đơn nháp —
    // shop này bot tạo nháp cả ngày, bỏ nháp là thiếu gần hết số).
    const nhom = await deps.odoo.execute<Array<Record<string, unknown>>>(
      'sale.order.line',
      'read_group',
      [
        [
          ['order_id.state', '!=', 'cancel'],
          ['create_date', '>=', `${tu} 00:00:00`],
          ['create_date', '<=', `${den} 23:59:59`],
          // LOẠI dòng KHÔNG phải hàng bán thật: dòng thuế/phí/ghi chú
          // (display_type có giá trị), và dòng không gắn sản phẩm kho.
          //
          // Bug thật 06/08: top bán chạy đưa ra "[SP000070] VAT 8% —
          // 503.306.453" đứng đầu — đó là dòng THUẾ gộp cả kỳ, không phải
          // sản phẩm. product_type != 'service' để bỏ dịch vụ/phí; và bỏ
          // dòng section/note.
          ['display_type', '=', false],
          ['product_id.type', '!=', 'service'],
        ],
        ['product_uom_qty:sum', 'price_total:sum'],
        ['product_id'],
      ],
      { orderby: 'product_uom_qty desc', limit: kieu === 'ban_chay' ? limit : TRAN_DONG, lazy: true },
    );
    // Lớp lọc TÊN dự phòng: shop này để "VAT 8%", "chiết khấu", "phí ship"
    // thành product thật (đo 10/08: id 562 `VAT 8%` khai type='product', không
    // phải 'service') nên domain trên không chặn hết. Số vẫn do Odoo cộng, đây
    // chỉ bỏ dòng rác khỏi danh sách hiển thị.
    //
    // Dùng CHUNG `laSanPhamKyThuat` với báo cáo linh hoạt (gộp 10/08): trước
    // đó mỗi nơi một regex và ĐÃ LỆCH — regex cũ `\bphí\b` không khớp "Phí
    // vận chuyển" (chữ "phí" dính "vận"), nên phí ship vẫn lọt vào top bán
    // chạy. Một luật, một chỗ sửa.
    const daBan = nhom
      .filter((g) => Array.isArray(g.product_id))
      .map((g) => ({
        sanPhamId: Number((g.product_id as unknown[])[0]),
        ten: String((g.product_id as unknown[])[1] ?? ''),
        soLuong: Number(g.product_uom_qty ?? 0),
        tongTien: Number(g.price_total ?? 0),
      }))
      .filter((d) => !laSanPhamKyThuat(d.ten));

    if (kieu === 'ban_chay') {
      return { trangThai: 'ok', kieu, danhSach: daBan, ky };
    }

    // Ế = còn tồn nhưng KHÔNG xuất hiện trong danh sách bán của kỳ.
    const idDaBan = new Set(daBan.map((d) => d.sanPhamId));
    const tonNhom = await deps.odoo.execute<Array<Record<string, unknown>>>(
      'stock.quant',
      'read_group',
      [[['location_id.usage', '=', 'internal'], ['quantity', '>', 0]], ['quantity:sum'], ['product_id']],
      { lazy: true },
    );
    const danhSach = tonNhom
      .filter((g) => Array.isArray(g.product_id) && !idDaBan.has(Number((g.product_id as unknown[])[0])))
      .map((g) => ({
        sanPhamId: Number((g.product_id as unknown[])[0]),
        ten: String((g.product_id as unknown[])[1] ?? ''),
        soLuong: Number(g.quantity ?? 0), // với Ế: đây là số TỒN
        tongTien: 0,
      }))
      .sort((a, b) => b.soLuong - a.soLuong)
      .slice(0, limit);
    return { trangThai: 'ok', kieu, danhSach, ky };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

export function bangTopSanPham(kq: Extract<KetQuaTop, { trangThai: 'ok' }>): BangExcel {
  const banChay = kq.kieu === 'ban_chay';
  return {
    tieuDe: banChay ? 'Top sản phẩm bán chạy' : 'Sản phẩm ế (còn tồn, 0 bán trong kỳ)',
    ky: kq.ky,
    cot: banChay ? ['Sản phẩm', 'SL bán', 'Doanh thu (đ)'] : ['Sản phẩm', 'SL tồn'],
    dong: kq.danhSach.map((d) => (banChay ? [d.ten, d.soLuong, d.tongTien] : [d.ten, d.soLuong])),
  };
}

export function dinhDangTopSanPham(kq: KetQuaTop, daDinhKem = false): string {
  if (kq.trangThai === 'loi') return `Không lấy được top sản phẩm: ${kq.lyDo}`;
  const banChay = kq.kieu === 'ban_chay';
  if (kq.danhSach.length === 0) {
    return banChay
      ? `Kỳ ${kq.ky} không có dòng bán nào (nguồn: sale.order.line, đã loại đơn huỷ).`
      : `Kỳ ${kq.ky} không có sản phẩm nào còn tồn mà 0 bán — mọi hàng tồn đều có bán.`;
  }
  const hien = kq.danhSach.slice(0, daDinhKem ? 5 : NGUONG_DINH_KEM);
  const dong = hien
    .map((d, i) =>
      banChay
        ? `${i + 1}. ${d.ten} — ${d.soLuong} | ${d.tongTien.toLocaleString('vi-VN')}đ`
        : `${i + 1}. ${d.ten} — tồn ${d.soLuong}`,
    )
    .join('\n');
  return (
    (banChay ? `Top bán chạy kỳ ${kq.ky} (gồm cả đơn nháp, loại đơn huỷ):\n` : `Hàng ế kỳ ${kq.ky} (còn tồn, 0 bán):\n`) +
    dong +
    (daDinhKem ? `\n... Đã gửi kèm FILE EXCEL đầy đủ ${kq.danhSach.length} dòng (tải về mở được) và một ảnh xem nhanh. Nói "xem file Excel đính kèm ạ".` : '')
  );
}

export const topSanPhamDefinition: ToolDefinition = {
  name: 'top_san_pham',
  description:
    'GỌI KHI nhân viên hỏi sản phẩm bán chạy nhất / bán được bao nhiêu loại nào nhiều nhất ' +
    '(kieu=ban_chay), hoặc hàng Ế / tồn lâu không bán được (kieu=e). Mặc định 30 ngày gần nhất.',
  inputSchema: {
    type: 'object',
    properties: {
      kieu: { type: 'string', enum: ['ban_chay', 'e'], description: 'ban_chay = bán nhiều nhất; e = còn tồn nhưng 0 bán trong kỳ.' },
      // Ca 21:17 + 03:29 ngày 11/08/2026: model không có đồng hồ nên tự nhẩm
      // ngày ra 2026-06-20. `ky` để nó chọn TỪ KHOÁ, code tính ngày.
      ky: { type: 'string', enum: [...KY_HOP_LE], description: `${MO_TA_KY} Bỏ trống = 30 ngày gần nhất.` },
      tu_ngay: { type: 'string', description: MO_TA_TU_NGAY },
      den_ngay: { type: 'string', description: MO_TA_DEN_NGAY },
      gioi_han: { type: 'number', description: 'Số dòng (mặc định 20, trần 200).' },
    },
  },
};
