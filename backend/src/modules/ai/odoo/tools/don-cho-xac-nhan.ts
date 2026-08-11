// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: ĐƠN NHÁP CHỜ XÁC NHẬN — bot tạo đơn nháp cả ngày, ai đó phải biết
// đang tồn bao nhiêu đơn chưa ai duyệt (spec báo-cáo-Zalo 06/08/2026).
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { NGUONG_DINH_KEM, type BangExcel } from '../xuat-excel.js';

export interface DonCho {
  id: number;
  maDon: string;
  tenKhach: string;
  tongTien: number;
  /** Số giờ từ lúc tạo — đơn "già" là đơn bị quên. */
  tuoiGio: number;
}

export type KetQuaDonCho =
  | {
      trangThai: 'ok'; danhSach: DonCho[]; tongTien: number;
      /** Chạm trần → `tongTien` chỉ là tổng phần lấy được, phải nói ra. */
      biCat?: boolean;
    }
  | { trangThai: 'loi'; lyDo: string };

export interface DonChoDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/**
 * Trần cứng — bảo vệ Odoo lẫn người đọc.
 *
 * ⚠️ `tongTien` CHỈ cộng các đơn lấy về được, nên khi chạm trần thì tổng là
 * tổng của phần đã lấy, KHÔNG phải toàn bộ. Trước 11/08 comment ở đây khẳng
 * định "quá nữa thì con số tổng vẫn đúng" — SAI, và đó đúng là kiểu ngộ nhận
 * đã gây bug 16:09 11/08 ở xuat-cong-no.ts (tổng không khớp danh sách).
 * Nay xin TRẦN + 1 để BIẾT bị cắt và nói ra thay vì im lặng.
 */
const TRAN_DONG = 200;

export async function donChoXacNhan(
  deps: DonChoDeps,
  input: { gioi_han?: number } = {},
): Promise<KetQuaDonCho> {
  try {
    const limit = Math.min(Math.max(1, input.gioi_han ?? TRAN_DONG), TRAN_DONG);
    const raw = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order',
      [['state', '=', 'draft']],
      ['id', 'name', 'partner_id', 'amount_total', 'create_date'],
      // Xin THÊM 1: phần tử dư không hiển thị, chỉ để biết danh sách bị cắt.
      { limit: limit + 1, order: 'create_date asc' }, // đơn GIÀ nhất lên đầu — đó là đơn bị quên
    );
    const biCat = raw.length > limit;
    const rows = raw.slice(0, limit);
    const bayGio = Date.now();
    const danhSach = rows.map((r) => ({
      id: Number(r.id),
      maDon: String(r.name ?? ''),
      tenKhach: Array.isArray(r.partner_id) ? String(r.partner_id[1] ?? '') : '',
      tongTien: Number(r.amount_total ?? 0),
      tuoiGio: Math.round((bayGio - new Date(String(r.create_date) + 'Z').getTime()) / 3_600_000),
    }));
    return {
      trangThai: 'ok',
      danhSach,
      tongTien: danhSach.reduce((t, d) => t + d.tongTien, 0),
      ...(biCat ? { biCat } : {}),
    };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

/** Dựng bảng Excel — caller quyết định có xuất hay không. */
export function bangDonCho(kq: Extract<KetQuaDonCho, { trangThai: 'ok' }>): BangExcel {
  return {
    tieuDe: 'Đơn nháp chờ xác nhận',
    cot: ['Mã đơn', 'Khách', 'Tổng tiền (đ)', 'Tuổi (giờ)'],
    dong: kq.danhSach.map((d) => [d.maDon, d.tenKhach, d.tongTien, d.tuoiGio]),
    tongCong: [
      'TỔNG',
      `${kq.danhSach.length} đơn${kq.biCat ? ' (BỊ CẮT — còn đơn chưa lấy)' : ''}`,
      kq.tongTien, '',
    ],
  };
}

export function dinhDangDonCho(kq: KetQuaDonCho, daDinhKem = false): string {
  if (kq.trangThai === 'loi') return `Không lấy được danh sách đơn chờ: ${kq.lyDo}`;
  if (kq.danhSach.length === 0) {
    // Rỗng ≠ lỗi — nói rõ để model không đoán (hàng rào chính xác số 3).
    return 'Không có đơn nháp nào đang chờ xác nhận. Nguồn: sale.order state=draft.';
  }
  const hien = kq.danhSach.slice(0, daDinhKem ? 5 : NGUONG_DINH_KEM);
  const dong = hien
    .map((d) => `- ${d.maDon} | ${d.tenKhach} | ${d.tongTien.toLocaleString('vi-VN')}đ | chờ ${d.tuoiGio}h`)
    .join('\n');
  // Chạm trần → nói rõ "ít nhất", đừng để nghe như con số đầy đủ.
  const moDau = kq.biCat
    ? `ÍT NHẤT ${kq.danhSach.length} đơn nháp chờ xác nhận (danh sách BỊ CẮT, còn đơn chưa lấy về), ` +
      `tổng riêng ${kq.danhSach.length} đơn này là ${kq.tongTien.toLocaleString('vi-VN')}đ `
    : `${kq.danhSach.length} đơn nháp chờ xác nhận, tổng ${kq.tongTien.toLocaleString('vi-VN')}đ `;
  return (
    moDau +
    '(đơn chờ lâu nhất lên đầu):\n' + dong +
    (daDinhKem ? `\n... Đã gửi kèm FILE EXCEL đầy đủ ${kq.danhSach.length} đơn (tải về mở được) và một ảnh xem nhanh. Nói "xem file Excel đính kèm ạ".` : '')
  );
}

export const donChoXacNhanDefinition: ToolDefinition = {
  name: 'don_cho_xac_nhan',
  description:
    'GỌI KHI nhân viên hỏi về đơn nháp/đơn chờ xác nhận/đơn chưa duyệt: "còn bao nhiêu đơn chờ?", ' +
    '"đơn nào chưa xác nhận?". Trả danh sách đơn draft, đơn chờ lâu nhất lên đầu.',
  inputSchema: {
    type: 'object',
    properties: {
      gioi_han: {
        type: 'number',
        description:
          'Số đơn tối đa lấy về (mặc định 200, trần 200). ĐỪNG điền số nhỏ khi ' +
          'nhân viên hỏi tổng: con số tổng chỉ cộng các đơn lấy về, điền nhỏ là ra tổng thiếu.',
      },
    },
  },
};
