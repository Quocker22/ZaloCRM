// SPDX-License-Identifier: AGPL-3.0-or-later
// PHỤ PHÍ trên đơn bán — "thêm 70k ship", "phí lắp đặt 200k".
//
// Anh Quyết/anh Quốc 23:08 24/08 (sau ca S15179 mất 70k ship): "bạn cứ thêm
// một hàng nữa là tiền ship ở cuối đi, với cũng linh động đi, ví dụ một tiền
// khác thì cũng cứ thêm một hàng vào".
//
// NGUYÊN TẮC: phụ phí là MỘT DÒNG HÀNG ở cuối đơn, SL 1, đơn giá = số tiền
// NV báo, dùng SẢN PHẨM KỸ THUẬT có thật trên Odoo (đo prod 24/08: id 632
// "Phí vận chuyển", id 630 [SP000032], id 56 "Cước xe", id 1568 [Ship]) —
// KHÔNG hard-code id vì đó là dữ liệu Odoo, đổi instance là trỏ sai.
//
// Phí "lạ" ("phí lắp đặt") không có SP riêng → dùng SP phí vận chuyển nhưng
// GHI TÊN THẬT vào tên dòng (sale.order.line.name) — hoá đơn in đúng chữ
// "Phí lắp đặt", còn báo cáo SỐ LƯỢNG vốn đã lọc SP kỹ thuật (sp-ky-thuat.ts).
import type { OdooClient } from '../client.js';
import { boDau } from '../tim-khong-dau.js';

export interface PhuPhi {
  /** Tên phí NV nói, đã chuẩn ("Phí vận chuyển", "Phí lắp đặt"). */
  ten: string;
  /** Số tiền (đồng), > 0. */
  tien: number;
}

/** Làm sạch mảng phụ phí thô (từ LLM): sai kiểu/tiền ≤ 0 thì bỏ dòng đó. */
export function lamSachPhuPhi(raw: unknown): PhuPhi[] {
  if (!Array.isArray(raw)) return [];
  const ra: PhuPhi[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue;
    const o = p as Record<string, unknown>;
    const ten = typeof o.ten === 'string' ? o.ten.trim() : '';
    const tien = Number(o.tien);
    // Trần 1 tỷ: cùng SL_TOI_DA của trích slot — số vượt trần gần như chắc
    // chắn là model nhân nghìn bừa.
    if (ten.length >= 2 && Number.isFinite(tien) && tien > 0 && tien <= 1_000_000_000) {
      ra.push({ ten, tien: Math.round(tien) });
    }
  }
  return ra;
}

const LA_SHIP = ['ship', 'van chuyen', 'cuoc', 'giao hang', 'gui hang'];

/** Tên phí này là phí VẬN CHUYỂN chứ? (để rơi về SP "Phí vận chuyển" chuẩn) */
export function laPhiShip(ten: string): boolean {
  const t = boDau(ten);
  return LA_SHIP.some((k) => t.includes(k));
}

export interface SpPhi {
  id: number;
  ten: string;
}

/**
 * Tìm SẢN PHẨM Odoo cho một khoản phụ phí.
 *
 * 1. ilike theo đúng tên phí ("Cước xe" có SP riêng thì dùng nó).
 * 2. Không có, hoặc phí lạ → SP "phí vận chuyển" làm vỏ, tên thật ghi ở dòng.
 * Không có nốt (Odoo chưa tạo SP phí nào) → null, caller báo rõ chứ không chặn đơn.
 */
export async function timSanPhamPhi(
  odoo: Pick<OdooClient, 'searchRead'>,
  ten: string,
): Promise<SpPhi | null> {
  const tim = async (q: string): Promise<SpPhi | null> => {
    const rows = await odoo.searchRead<{ id: number; name: string }>(
      'product.product', [['name', 'ilike', q]], ['id', 'name'], { limit: 3 },
    );
    if (rows.length === 0) return null;
    return { id: Number(rows[0].id), ten: String(rows[0].name ?? '') };
  };
  return (await tim(ten.trim())) ?? (await tim('phí vận chuyển'));
}

/**
 * Dựng lệnh dòng phụ phí cho `order_line` (dạng [0,0,vals] của Odoo) —
 * SL 1, giá = tiền phí, tên dòng = tên phí thật.
 */
export function lenhDongPhuPhi(sp: SpPhi, phi: PhuPhi): [number, number, Record<string, unknown>] {
  return [0, 0, {
    product_id: sp.id,
    product_uom_qty: 1,
    name: phi.ten,
    price_unit: phi.tien,
  }];
}
