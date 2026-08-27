// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool GHI: tạo khách hàng mới trong Odoo từ thông tin Zalo.
//
// VÌ SAO CÓ TOOL NÀY (anh chốt 2026-08-04): bot phải tự lên đơn cho khách nhắn
// Zalo, kể cả khách CHƯA có trong Odoo. Trước đây `tra_khach_hang` không thấy
// thì báo nhân viên — khách mới là không lên đơn được.
//
// NHƯNG khách trùng là RÁC VĨNH VIỄN: đối chiếu công nợ sau này sẽ sai, và
// không ai đi gộp thủ công 3000 khách. Nên tool này chống trùng ba lớp:
//   1. Tra theo UID Zalo (`ref` = "zalo:<uid>") — khoá chắc chắn nhất, một
//      người Zalo chỉ tạo được đúng một khách.
//   2. Tra theo SĐT nếu có (dùng lại `bienTheSdt` vì DB lưu không chuẩn hoá).
//   3. Tra theo TÊN CHÍNH XÁC (không phải "chứa") — trùng thì trả khách cũ.
//
// Tìm thấy ở bất kỳ lớp nào → TRẢ KHÁCH CŨ, không tạo mới. Gọi lại nhiều lần
// với cùng UID là an toàn.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { bienTheSdt } from './tra-khach-hang.js';

/** Tiền tố `ref` đánh dấu khách do bot tạo — nhân viên lọc ra để bổ sung sau. */
export const TIEN_TO_REF = 'zalo:';

export interface KhachMoi {
  id: number;
  ten: string;
  ma: string | null;
  daCo: boolean;
}

export type KetQuaTaoKhach =
  | { trangThai: 'ok'; khach: KhachMoi }
  | { trangThai: 'loi'; lyDo: string };

export interface TaoKhachDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  /** UID Zalo của người đang chat — khoá chống trùng chắc nhất. */
  zaloUid?: string | null;
}

const FIELDS = ['id', 'name', 'ref'];

function chuanHoaTen(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Tạo khách mới, hoặc trả khách đã có nếu tìm được.
 *
 * KHÔNG ném khi trùng — trả `daCo: true` để model biết mà dùng tiếp, thay vì
 * coi là lỗi rồi chuyển sale.
 */
/**
 * Chìa khoá cho `bo_phanh_trung_ten`. Symbol KHÔNG serialize được qua JSON,
 * nên input do LLM sinh (luôn là JSON thuần) không thể mang nó — kể cả khi
 * model tự bịa ra trường `bo_phanh_trung_ten: true` dù schema không khai.
 *
 * Vì sao cần: hai registry (customer-agent, staff-agent) ép thẳng
 * `input as Parameters<typeof taoKhachHang>[1]`, tức mọi trường model bịa ra
 * đều lọt vào tham số. Ở luồng KHÁCH thì khách điều khiển được câu chữ, nên
 * một cờ bỏ phanh mà LLM bật được là lỗ hổng thật, không phải giả định.
 */
export const CHIA_BO_PHANH: unique symbol = Symbol('bo_phanh_trung_ten');

export async function taoKhachHang(
  deps: TaoKhachDeps,
  input: {
    ten: string; dien_thoai?: string; dia_chi?: string;
    /**
     * Nhân viên đã nói RÕ "khách mới" — bỏ phanh chặn trùng tên.
     *
     * Phanh dưới hợp lý khi LLM tự suy "chắc là người mới"; nhưng khi nhân
     * viên chủ động khai thì họ đang nói "tôi biết có mấy người trùng tên,
     * người này KHÁC" (bug 17:08 10/08: 10 anh Chiến, nhân viên bảo khách mới,
     * bot vẫn từ chối tạo và bắt chọn trong 10 người cũ).
     *
     * CHỈ máy gom đơn được đặt cờ này — nó biết chắc câu "khách mới" đến từ
     * nhân viên. Schema tool KHÔNG khai cờ, nên LLM không tự bật được.
     */
    bo_phanh_trung_ten?: boolean;
    /** Chìa khoá xác thực cờ trên — xem CHIA_BO_PHANH. */
    [CHIA_BO_PHANH]?: true;
  },
): Promise<KetQuaTaoKhach> {
  const ten = chuanHoaTen(input.ten ?? '');
  if (!ten) return { trangThai: 'loi', lyDo: 'Thiếu tên khách. Hỏi khách tên để lưu đơn.' };
  // Tên một ký tự gần như luôn là gõ nhầm, và tạo ra rác không tra lại được.
  if (ten.length < 2) return { trangThai: 'loi', lyDo: 'Tên khách quá ngắn, hỏi lại cho rõ.' };

  const ref = deps.zaloUid ? `${TIEN_TO_REF}${deps.zaloUid}` : null;

  // ── Lớp 1: UID Zalo ───────────────────────────────────────────────────────
  if (ref) {
    const cu = await deps.odoo.searchRead<{ id: number; name: string; ref: string | null }>(
      'res.partner', [['ref', '=', ref]], FIELDS, { limit: 1 },
    );
    if (cu[0]) {
      return { trangThai: 'ok', khach: { id: cu[0].id, ten: cu[0].name, ma: cu[0].ref, daCo: true } };
    }
  }

  // ── Lớp 2: số điện thoại ──────────────────────────────────────────────────
  const sdt = (input.dien_thoai ?? '').trim();
  if (sdt) {
    const dang = bienTheSdt(sdt);
    if (dang.length > 0) {
      // Ca thật 16:23 26/08: Odoo có "Anh Tuấn - QC Hoàng NGuyên" phone
      // "+84 98 927 12 75" (có khoảng trắng — 258 khách lưu kiểu này) → 'in'
      // theo 3 biến thể trượt → tạo khách trùng KH003233. Odoo 17 có sẵn
      // `phone_sanitized` (E.164, bỏ mọi khoảng trắng) — so thêm cột đó.
      const e164 = dang.find((d) => d.startsWith('+'));
      const dkSdt: unknown[] = e164
        ? ['|', '|', ['phone', 'in', dang], ['mobile', 'in', dang], ['phone_sanitized', '=', e164]]
        : ['|', ['phone', 'in', dang], ['mobile', 'in', dang]];
      const cu = await deps.odoo.searchRead<{ id: number; name: string; ref: string | null }>(
        'res.partner',
        dkSdt,
        FIELDS,
        { limit: 1 },
      );
      if (cu[0]) {
        return { trangThai: 'ok', khach: { id: cu[0].id, ten: cu[0].name, ma: cu[0].ref, daCo: true } };
      }
    }
  }

  // Cờ bỏ phanh CHỈ có hiệu lực khi kèm chìa khoá Symbol — tức caller là CODE
  // (máy gom đơn), không phải input LLM bịa ra.
  const boPhanh = input.bo_phanh_trung_ten === true && input[CHIA_BO_PHANH] === true;

  // ── Lớp 3: tên CHÍNH XÁC ──────────────────────────────────────────────────
  // Dùng '=' chứ KHÔNG phải 'ilike': đo thật 2026-08-02 khi thử gộp khách trùng,
  // so khớp "chứa" bắt nhầm "Chị Lan" với "Chị Lan (cũ)" — hai người khác nhau.
  const trungTen = await deps.odoo.searchRead<{ id: number; name: string; ref: string | null }>(
    'res.partner', [['name', '=', ten], ['customer_rank', '>', 0]], FIELDS, { limit: 2 },
  );
  if (trungTen.length === 1 && !boPhanh) {
    return { trangThai: 'ok', khach: { id: trungTen[0].id, ten: trungTen[0].name, ma: trungTen[0].ref, daCo: true } };
  }
  if (trungTen.length > 1 && !boPhanh) {
    // Nhiều người cùng tên y hệt — tạo thêm chỉ tổ rối. Để nhân viên chọn.
    // Trừ khi nhân viên đã nói rõ "khách mới" (bo_phanh_trung_ten).
    return {
      trangThai: 'loi',
      lyDo: `Có ${trungTen.length} khách tên "${ten}" trong hệ thống. Dùng tra_khach_hang để chọn đúng người, đừng tạo mới.`,
    };
  }

  // ── Lớp 3b: tên GẦN GIỐNG (27/08) ─────────────────────────────────────────
  // Ca thật 07:03: NV "lên đơn cho red sun" → không có ai tên đúng "red sun"
  // → tạo KH003235 "red sun" trong khi đã có "Anh Thuận - Red Sun" và "Cty Red
  // Sun - Đông Anh". Tên mới NẰM TRỌN trong tên khách cũ (≥ 2 từ) → gần như
  // chắc là cùng người/công ty: bắt chọn, không tạo. NV nói rõ "khách mới" thì
  // bỏ phanh như lớp 3.
  if (!boPhanh && ten.split(/\s+/).length >= 2) {
    const ganGiong = await deps.odoo.searchRead<{ id: number; name: string; ref: string | null }>(
      'res.partner', [['name', 'ilike', ten], ['customer_rank', '>', 0]], FIELDS, { limit: 5 },
    );
    if (ganGiong.length > 0) {
      const ds = ganGiong.map((k) => `${k.name}${k.ref ? ` [${k.ref}]` : ''}`).join('; ');
      return {
        trangThai: 'loi',
        lyDo: `Đã có khách tên gần giống "${ten}": ${ds}. Dùng tra_khach_hang chọn đúng người; chỉ khi nhân viên nói rõ "khách mới" mới tạo thêm.`,
      };
    }
  }

  // ── Tạo mới ───────────────────────────────────────────────────────────────
  const data: Record<string, unknown> = {
    name: ten,
    customer_rank: 1,
    // Không đặt company_type: mặc định 'person' — khách Zalo là cá nhân/shop nhỏ.
  };
  if (ref) data.ref = ref;
  if (sdt) data.phone = sdt;
  const diaChi = (input.dia_chi ?? '').trim();
  if (diaChi) data.street = diaChi;

  try {
    const id = await deps.odoo.execute<number>('res.partner', 'create', [data], {});
    if (!Number.isInteger(id) || id <= 0) {
      return { trangThai: 'loi', lyDo: 'Odoo không trả id khách sau khi tạo.' };
    }
    return { trangThai: 'ok', khach: { id, ten, ma: ref, daCo: false } };
  } catch (err) {
    return {
      trangThai: 'loi',
      lyDo: `Không tạo được khách: ${err instanceof Error ? err.message.slice(0, 120) : 'lỗi Odoo'}`,
    };
  }
}

export function dinhDangTaoKhach(kq: KetQuaTaoKhach): string {
  if (kq.trangThai === 'loi') return `KHÔNG TẠO ĐƯỢC: ${kq.lyDo}`;
  const k = kq.khach;
  return k.daCo
    ? `Khách ĐÃ CÓ trong hệ thống: ${k.ten} (id ${k.id}${k.ma ? `, mã ${k.ma}` : ''}). Dùng id này để lên đơn, KHÔNG tạo thêm.`
    : `Đã tạo khách mới: ${k.ten} (id ${k.id}${k.ma ? `, mã ${k.ma}` : ''}). Dùng id này để lên đơn.`;
}

export const taoKhachHangDefinition: ToolDefinition = {
  name: 'tao_khach_hang',
  description:
    'GỌI KHI cần lên đơn cho khách CHƯA có trong hệ thống (tra_khach_hang không thấy). ' +
    'Tự chống trùng: khách đã tồn tại thì trả về khách cũ, không tạo thêm. ' +
    'Chỉ cần TÊN; số điện thoại và địa chỉ có thì tốt, không có vẫn tạo được.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      ten: { type: 'string', description: 'Tên khách. Lấy tên Zalo nếu khách không tự xưng.' },
      dien_thoai: { type: 'string', description: 'SĐT nếu khách có cho. Bỏ trống nếu chưa biết.' },
      dia_chi: { type: 'string', description: 'Địa chỉ giao hàng nếu khách có nói.' },
    },
    required: ['ten'],
  },
};
