// SPDX-License-Identifier: AGPL-3.0-or-later
// Tra dòng thuế VAT trong danh mục account.tax của Odoo.
//
// VÌ SAO TỒN TẠI (11/08/2026): anh Quốc chốt "trong odoo có tính năng vat mà,
// khách nói thêm vat vào hóa đơn thì cứ thêm vào là được" → dùng ĐÚNG cơ chế
// thuế của Odoo (account.tax gắn vào sale.order.line.tax_id), KHÔNG dựng sản
// phẩm giả tên "VAT 8%" rồi cộng tay. Thuế của Odoo tự kế thừa xuống hoá đơn
// khi xuất — kiểm chứng prod: INV/2026/026158 ← đơn S12869, amount_untaxed
// 4.950.000đ, amount_tax 396.000đ (đúng 8%), không ai phải nhập lại.
//
// VÌ SAO TRA ĐỘNG chứ không hằng số `const VAT_8 = 4`: id là CẤU HÌNH của Odoo,
// không phải hằng số nghiệp vụ. Nhân bản DB, đổi công ty, sửa danh mục thuế là
// id đổi — lúc đó hằng số trỏ vào một dòng thuế khác và bot ghi sai vào sổ mà
// không có cảnh báo nào. Tra theo (type_tax_use='sale' + amount) thì cấu hình
// đổi sẽ lộ ra bằng "không tìm thấy", và caller BÁO nhân viên chứ không im lặng.
//
// Đo prod LEDNELIA VN 11/08/2026 — danh mục thuế bán đang có:
//   id=3 "VAT 4%", id=4 "VAT 8%", id=5 "VAT 10%", id=6 "0%". KHÔNG có 5%.
//
// ─────────────────────────────────────────────────────────────────────────
// ĐỪNG XOÁ VÌ "KHÔNG THẤY ĐĂNG KÝ Ở REGISTRY NÀO".
//
// File này nằm trong `odoo/tools/` nhưng KHÔNG phải tool cho model, và cố ý
// như vậy: nó không có `ToolDefinition`, không vào `taoStaffRegistry`. Người
// gọi là MÁY GOM ĐƠN (`agent/noi-zalo/gom-don/index.ts`), gọi thẳng hàm sau khi
// `trich-slot` trích được `vat` — cùng kiểu với `traSanPham`/`traTonKho` mà máy
// gom đơn cũng gọi trực tiếp.
//
// Model KHÔNG được phép tự chọn mức thuế: thuế là tiền thật trên sổ sách, phải
// đi theo con số nhân viên nói, không phải theo suy đoán của model.
//
// LỊCH SỬ (đọc trước khi kết luận file này chết): đo prod 486 lượt gọi tool
// 04→11/08 thấy 0 lần chạy, và docs từng ghi "code chết, nên xoá". Kiểm lại thì
// đúng là chưa từng chạy — nhưng nguyên nhân là ĐỨT DÂY ở `gom-don`, chỗ đó
// chưa bao giờ đọc `trich.vat` nên không ai gọi `traThueBan()`. Đã nối lại
// 11/08; test khoá đường đi thật: `tests/ai/agent/gom-don/vat-noi-day.test.ts`.
import type { OdooClient } from '../client.js';
import { logger } from '../../../../shared/utils/logger.js';

export interface ThueBan {
  id: number;
  ten: string;
  phanTram: number;
}

export interface TraThueDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/**
 * Cache theo phần trăm. Danh mục thuế gần như không đổi (4 dòng, ổn định từ
 * 2026), mà luồng lên đơn thì chạy mỗi tin nhắn — tra lại mỗi lượt là tốn một
 * round-trip XML-RPC cho dữ liệu tĩnh.
 *
 * Cache cả kết quả RỖNG: "Odoo không có VAT 5%" cũng là sự thật ổn định, hỏi
 * lại 10 lần vẫn thế.
 */
const cache = new Map<number, ThueBan | null>();

/** Xoá cache — dùng trong test, và là đường thoát nếu ai đó sửa danh mục thuế. */
export function xoaCacheThue(): void {
  cache.clear();
}

/**
 * Tìm dòng thuế BÁN có `amount` khớp phần trăm nhân viên nói.
 *
 * Trả null khi không có mức thuế đó (hoặc Odoo lỗi) — caller PHẢI báo nhân
 * viên, tuyệt đối không im lặng lên đơn không thuế: nhân viên tưởng đơn có VAT
 * mà hoá đơn ra không có là sai sổ sách, phát hiện thì đã xuất mất rồi.
 */
export async function traThueBan(deps: TraThueDeps, phanTram: number): Promise<ThueBan | null> {
  const pt = Number(phanTram);
  if (!Number.isFinite(pt) || pt <= 0 || pt > 100) return null;
  if (cache.has(pt)) return cache.get(pt) ?? null;

  let kq: ThueBan | null = null;
  try {
    const rows = await deps.odoo.searchRead<Record<string, unknown>>(
      'account.tax',
      [
        // type_tax_use='sale': thuế MUA cũng có mức 8%, ghi nhầm vào đơn bán là
        // sai tài khoản kế toán.
        ['type_tax_use', '=', 'sale'],
        ['amount', '=', pt],
        ['active', '=', true],
      ],
      ['id', 'name', 'amount'],
      { limit: 1 },
    );
    const r = rows[0];
    if (r) kq = { id: Number(r.id), ten: String(r.name ?? ''), phanTram: Number(r.amount ?? pt) };
  } catch (err) {
    // Odoo sập KHÔNG được làm sập luồng lên đơn. Trả null → caller báo nhân
    // viên "chưa gắn được VAT", họ tự quyết (lên đơn không thuế rồi sửa tay,
    // hoặc thử lại). Nhưng KHÔNG cache lỗi: lần sau phải hỏi lại Odoo.
    logger.warn({ err, phanTram: pt }, '[tra-thue] không tra được account.tax');
    return null;
  }

  cache.set(pt, kq);
  return kq;
}
