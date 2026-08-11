// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: xuất công nợ khách — số nợ + danh sách hoá đơn chưa thanh toán.
//
// VÌ SAO TOOL RIÊNG (không dùng tra_khach_hang): `tra_khach_hang` chỉ trả con
// số nợ tổng. Nhân viên đi đòi nợ cần biết nợ TỪ ĐƠN NÀO, ngày nào — không thì
// phải mở Odoo tra tay, và bot thành vô dụng đúng lúc cần nhất.
//
// ⚠️ CHỈ REGISTRY NHÂN VIÊN. Công nợ là thông tin nội bộ; registry khách cố ý
// không có cả `tra_khach_hang` lẫn tool này.
//
// ⚠️ SỐ TỔNG CỘNG TỪ CHÍNH DANH SÁCH IN RA — đây là điều kiện sống còn.
//
// BUG THẬT 16:09 11/08/2026 (nhóm Test-AI): hỏi công nợ "Lộc Beco Thanh Hóa"
// (Odoo id=2293), bot báo "Công nợ hiện tại: 3.990.000đ" rồi in ngay bên dưới
// 10 hoá đơn chưa trả cộng lại 144.796.039đ — riêng INV/2026/025127 đã
// 100.100.000đ. Nhân viên tin số tổng đi đòi nợ là mất trắng 140 triệu.
//
// Vì sao: bản cũ đọc field TỰ VIẾT `incokit_receivable_balance` làm số tổng,
// còn danh sách thì query từ account.move — HAI ĐƯỜNG TÍNH TÁCH RỜI nên không
// gì bắt buộc chúng khớp nhau. Đo trên prod 11/08: field này SAI ở 29/40 khách
// nợ nhiều nhất, báo thiếu tổng 3,92 TỶ đồng; có khách field=0 mà đang nợ thật,
// có khách field còn báo THỪA (anh Hưng Huế: field 179tr, thực 12,6tr).
//
// NGUỒN ĐÚNG: tổng `amount_residual_signed` của các account.move chưa tất toán.
// Kiểm chứng khách 2293 — ba nguồn độc lập đều ra 144.796.039đ:
//   partner.credit = 144.796.039
//   Σ amount_residual hoá đơn chưa trả = 144.796.039
//   Σ amount_residual của account.move.line phải thu chưa đối trừ = 144.796.039
// Dùng *_signed để hoá đơn hoàn trả (out_refund) TRỪ ra thay vì cộng vào —
// ca "Anh Khoa Cabin": 261.580.240 HĐ bán − 2.480.000 hoàn = 259.100.240
// đúng bằng partner.credit.
//
// Field `incokit_receivable_balance` KHÔNG bị xoá khỏi query: nó được giữ lại
// làm ĐỐI CHỨNG. Lệch giữa nó và tổng HĐ là dấu hiệu sổ sách có bút toán tay
// (ca "CTY 3S": HĐ 77,1tr nhưng sổ phải thu 44,6tr) — khi đó tool NÓI RA
// thay vì im lặng trả một con số không ai kiểm được.

import type { OdooClient } from '../client.js';
import { tenKhopKhach } from './tao-don-nhap.js';
import { dieuKienBienTheDauCum, locKhopBoDau } from '../tim-khong-dau.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Số hoá đơn liệt kê tối đa. Tin Zalo dài hơn là không ai đọc. */
const HD_TOI_DA = 10;

/** Số khách tối đa liệt kê khi tên trùng. */
const KHACH_TOI_DA = 5;

export interface HoaDonNo {
  ma: string;
  ngay: string;
  conNo: number;
  tong: number;
}

export interface CongNoKhach {
  khachId: number;
  ten: string;
  maKh: string;
  sdt: string;
  /** Tổng nợ = Σ conNo của TOÀN BỘ chứng từ chưa tất toán (kể cả phần chưa liệt kê). */
  congNo: number;
  hoaDon: HoaDonNo[];
  /** Tổng số HĐ chưa trả (có thể lớn hơn số đã liệt kê). */
  tongSoHd: number;
  /**
   * Số dư Odoo tự báo (`incokit_receivable_balance`) — CHỈ để đối chứng.
   * Lệch so với `congNo` là dấu hiệu sổ có bút toán tay; xem `lech`.
   */
  soDuOdoo: number;
  /**
   * Có lệch đáng kể giữa tổng hoá đơn và số dư Odoo hay không. Bật thì đầu ra
   * phải cảnh báo — KHÔNG im lặng chọn một số (ca "CTY 3S" 11/08).
   */
  lech: boolean;
}

export type KetQuaCongNo =
  | { loai: 'ok'; duLieu: CongNoKhach }
  /**
   * Khách tra ra KHÔNG khớp tên nhân viên nhắc — chặn để không báo số liệu
   * của người khác. Bug thật 20:06 10/08: hỏi công nợ "anh Vấn", model bốc
   * khach_id của anh Tuấn BG từ danh sách trong lịch sử chat cũ rồi tra theo
   * id đó; bot báo công nợ nhầm người, nói rành mạch như thật.
   */
  | { loai: 'sai_khach'; lyDo: string }
  | { loai: 'khong_thay'; tuKhoa: string }
  | { loai: 'nhieu_khach'; danhSach: Array<{ id: number; ten: string; maKh: string; sdt: string }> };

export interface XuatCongNoDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/** Bỏ dấu để so khớp tên gần đúng. */
function boDau(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

export async function xuatCongNo(
  deps: XuatCongNoDeps,
  input: { khach_id?: number; ten?: string; sdt?: string; ten_nhac?: string },
): Promise<KetQuaCongNo> {
  const F = ['id', 'name', 'ref', 'phone', 'mobile', 'incokit_receivable_balance'];
  let khach: Record<string, unknown>[] = [];

  if (input.khach_id) {
    khach = await deps.odoo.searchRead('res.partner', [['id', '=', input.khach_id]], F, { limit: 1 });
    // XÁC MINH TÊN khi tra bằng id: id có thể là số model nhặt từ lịch sử chat
    // chứ không phải người nhân viên đang hỏi (bug 20:06 10/08).
    const tenNhac = (input.ten_nhac ?? '').trim();
    const tenThat = String(khach[0]?.name ?? '');
    if (tenNhac && tenThat && !tenKhopKhach(tenNhac, tenThat)) {
      return {
        loai: 'sai_khach',
        lyDo:
          `Khách id=${input.khach_id} trong hệ thống là "${tenThat}", KHÔNG khớp tên ` +
          `"${tenNhac}" nhân viên hỏi. Có thể id lấy nhầm từ danh sách cũ trong lịch sử. ` +
          'Hãy gọi tra_khach_hang với tên/SĐT đúng để lấy id chính xác.',
      };
    }
  } else if (input.sdt?.trim()) {
    const sdt = input.sdt.replace(/\D/g, '');
    khach = await deps.odoo.searchRead(
      'res.partner',
      ['|', ['phone', 'like', sdt], ['mobile', 'like', sdt]],
      F, { limit: KHACH_TOI_DA + 1 },
    );
  } else if (input.ten?.trim()) {
    khach = await deps.odoo.searchRead(
      'res.partner',
      // Mẫu KHÔNG DẤU (11/08): `ilike` prod không bỏ dấu nên "cong no anh Thuc"
      // gõ không dấu ra 0 kết quả, bot báo "không có khách này" — sai sự thật.
      // Bước khớp chính xác (bỏ dấu) ngay dưới vẫn lọc lại, nên tra rộng an toàn.
      ['&', ['customer_rank', '>', 0], ...dieuKienBienTheDauCum('name', input.ten.trim())],
      // Xin dư để còn chỗ mà LỌC BỎ DẤU ngay dưới (sửa 12/08) — mẫu `_` lôi về
      // cả tên chỉ tình cờ cùng khung chữ, cắt trước khi lọc là vứt nhầm người.
      F, { limit: (KHACH_TOI_DA + 1) * 5 },
    );

    // LỌC BỎ DẤU CHÍNH XÁC (sửa 12/08, ca "anh Vấn" 01:12): mẫu `_` ở tầng DB
    // khớp ký tự BẤT KỲ nên "van" → "v_n" ôm cả "Vinh", "Vốn" — hỏi công nợ
    // "anh Vấn" mà trả về danh sách toàn người khác thì cũng vô dụng y hệt.
    khach = locKhopBoDau(input.ten.trim(), khach, (k) => String(k.name ?? ''));

    // Nhiều kết quả → thử khớp CHÍNH XÁC tên (bỏ dấu) để tự chọn.
    //
    // Ca thật 2026-07-31: "Quảng Cáo Hoàng Anh" khớp cả "Quảng cáo Hoàng Nam
    // Thanh Hóa" (vì ilike khớp "Quảng cáo"), bot thấy 2 kết quả nên chuyển
    // sale — dù có MỘT khách trùng khít tên nhân viên gõ.
    if (khach.length > 1) {
      const goc = boDau(input.ten);
      const khop = khach.filter((k) => boDau(String(k.name ?? '')) === goc);
      if (khop.length === 1) khach = khop;
    }
  }

  if (khach.length === 0) {
    return { loai: 'khong_thay', tuKhoa: input.ten ?? input.sdt ?? String(input.khach_id ?? '') };
  }

  if (khach.length > 1) {
    return {
      loai: 'nhieu_khach',
      danhSach: khach.slice(0, KHACH_TOI_DA).map((k) => ({
        id: Number(k.id),
        ten: String(k.name ?? ''),
        maKh: String(k.ref ?? ''),
        sdt: String(k.phone || k.mobile || ''),
      })),
    };
  }

  const k = khach[0];
  const khachId = Number(k.id);

  // Chứng từ bán CHƯA tất toán. `payment_state != paid` bắt cả partial/
  // in_payment — nhân viên cần thấy cả đơn trả một phần.
  //
  // LẤY CẢ out_refund: hoá đơn hoàn trả làm GIẢM nợ. Bỏ sót nó là đòi khách
  // số tiền đã trả lại cho họ. KHÔNG giới hạn kỳ thời gian — nợ cũ vẫn là nợ.
  //
  // KHÔNG limit: tổng phải tính trên TOÀN BỘ chứng từ, chỉ danh sách in ra mới
  // cắt còn HD_TOI_DA. Bản cũ lấy limit=30 nên khách nhiều hoá đơn (prod có
  // khách 318 HĐ) sẽ tính thiếu nếu cộng từ đây.
  const hd = await deps.odoo.searchRead<Record<string, unknown>>(
    'account.move',
    [
      ['partner_id', '=', khachId],
      ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['state', '=', 'posted'],
      ['payment_state', '!=', 'paid'],
    ],
    ['name', 'invoice_date', 'amount_total', 'amount_residual', 'amount_residual_signed', 'move_type'],
    { order: 'invoice_date desc' },
  );

  // MỘT nguồn duy nhất cho cả tổng lẫn danh sách: map trước, cộng trên chính
  // mảng đã map. Không thể có chuyện tổng nói một đằng, danh sách một nẻo.
  const dong: HoaDonNo[] = hd.map((h) => {
    // `amount_residual_signed` đã mang dấu: out_refund ra ÂM. Odoo cũ/bản ghi
    // thiếu field thì suy ra từ move_type để không âm thầm cộng nhầm dấu.
    const raw = h.amount_residual_signed;
    const conNo = raw === undefined || raw === null || raw === false
      ? Number(h.amount_residual ?? 0) * (h.move_type === 'out_refund' ? -1 : 1)
      : Number(raw);
    return {
      ma: String(h.name ?? ''),
      ngay: String(h.invoice_date ?? ''),
      conNo,
      tong: Number(h.amount_total ?? 0) * (h.move_type === 'out_refund' ? -1 : 1),
    };
  });

  const congNo = dong.reduce((a, d) => a + d.conNo, 0);
  const soDuOdoo = Number(k.incokit_receivable_balance ?? 0);

  return {
    loai: 'ok',
    duLieu: {
      khachId,
      ten: String(k.name ?? ''),
      maKh: String(k.ref ?? ''),
      sdt: String(k.phone || k.mobile || ''),
      congNo,
      hoaDon: dong.slice(0, HD_TOI_DA),
      tongSoHd: dong.length,
      soDuOdoo,
      // Lệch quá 1đ (tránh nhiễu làm tròn) → đầu ra phải cảnh báo.
      lech: Math.abs(congNo - soDuOdoo) > 1,
    },
  };
}

export const xuatCongNoDefinition: ToolDefinition = {
  name: 'xuat_cong_no',
  description:
    'Xuất công nợ của một khách: số tiền đang nợ + danh sách hoá đơn chưa thanh toán ' +
    '(mã, ngày, số còn nợ). ' +
    'GỌI KHI nhân viên nói: "xuất công nợ khách X", "khách X nợ bao nhiêu", ' +
    '"công nợ của X", "khách nào còn nợ đơn nào". ' +
    'Dùng tool NÀY thay vì tra_khach_hang khi cần chi tiết từng hoá đơn — ' +
    'tra_khach_hang chỉ có số tổng. ' +
    'Có SĐT thì ưu tiên sdt (chính xác nhất), không thì dùng ten. ' +
    'LUÔN điền ten_nhac = tên khách nhân viên vừa nhắc: tool dùng nó để chặn ' +
    'tra nhầm người khi id/mã bị lấy nhầm từ lịch sử chat.',
  inputSchema: {
    type: 'object',
    properties: {
      khach_id: { type: 'integer', description: 'id khách LẤY TỪ tra_khach_hang trong CHÍNH lượt này — KHÔNG lấy từ danh sách cũ trong lịch sử' },
      ten_nhac: { type: 'string', description: 'Tên khách NHÂN VIÊN vừa nhắc trong câu hỏi. LUÔN điền — dùng để chặn tra nhầm người.' },
      ten: { type: 'string', description: 'Tên khách, khớp gần đúng' },
      sdt: { type: 'string', description: 'Số điện thoại — chính xác hơn tên' },
    },
    required: [],
  },
};

function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/** yyyy-mm-dd → dd/mm. Năm bỏ đi cho gọn, HĐ nợ hiếm khi quá 1 năm. */
function ngay(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

export function dinhDangCongNo(kq: KetQuaCongNo): string {
  if (kq.loai === 'sai_khach') return kq.lyDo;
  if (kq.loai === 'khong_thay') {
    return (
      `Không tìm thấy khách "${kq.tuKhoa}". Thử lại với tên ngắn hơn hoặc SĐT.`
    );
  }

  if (kq.loai === 'nhieu_khach') {
    const ds = kq.danhSach
      .map((k) => `- id=${k.id} | ${k.ten}${k.maKh ? ` [${k.maKh}]` : ''}${k.sdt ? ` | ${k.sdt}` : ''}`)
      .join('\n');
    return (
      `Tìm thấy ${kq.danhSach.length} khách khớp:\n${ds}\n` +
      'HỎI nhân viên chọn khách nào (nêu tên, không nêu id), rồi gọi lại tool với khach_id. ' +
      'ĐỪNG chuyển sale — chỉ cần hỏi một câu là xong.'
    );
  }

  const d = kq.duLieu;
  // "Hết nợ" chỉ khi CẢ HAI nguồn cùng nói hết. Không có hoá đơn nhưng sổ Odoo
  // vẫn còn số dư (nợ từ bút toán tay) mà báo "hết nợ" là giấu nợ thật —
  // đúng loại lỗi đang sửa, chỉ ngược chiều.
  if (d.congNo === 0 && d.hoaDon.length === 0 && d.soDuOdoo === 0) {
    return `${d.ten}${d.maKh ? ` [${d.maKh}]` : ''}: KHÔNG còn công nợ.`;
  }

  // Không có hoá đơn nào nhưng sổ còn nợ → nêu số của sổ, nói rõ nguồn.
  if (d.hoaDon.length === 0 && d.soDuOdoo !== 0) {
    return [
      `${d.ten}${d.maKh ? ` [${d.maKh}]` : ''}${d.sdt ? ` · ${d.sdt}` : ''}`,
      `Công nợ: ${tien(d.soDuOdoo)}`,
      '(công nợ không đến từ hoá đơn bán — có thể là bút toán thủ công)',
      '',
      'Nguồn: Số dư công nợ khách (Odoo)',
    ].join('\n');
  }

  const dong = [
    `${d.ten}${d.maKh ? ` [${d.maKh}]` : ''}${d.sdt ? ` · ${d.sdt}` : ''}`,
    `Công nợ: ${tien(d.congNo)}`,
  ];

  if (d.hoaDon.length > 0) {
    dong.push('', 'Hoá đơn chưa thanh toán:');
    // Tổng của riêng phần IN RA — để đối chiếu ngay trên màn hình khi bị cắt.
    let tongDaIn = 0;
    for (const h of d.hoaDon) {
      tongDaIn += h.conNo;
      const hoan = h.conNo < 0;
      // Nêu cả tổng khi đã trả một phần — nhân viên cần biết để đối chiếu.
      const motPhan = !hoan && h.conNo < h.tong ? ` (đã trả ${tien(h.tong - h.conNo)})` : '';
      dong.push(
        hoan
          // Hoàn trả hiển thị dấu TRỪ rõ ràng, không để đọc nhầm thành nợ thêm.
          ? `- ${h.ma} · ${ngay(h.ngay)} · HOÀN TRẢ −${tien(Math.abs(h.conNo))}`
          : `- ${h.ma} · ${ngay(h.ngay)} · còn ${tien(h.conNo)}${motPhan}`,
      );
    }
    const conLai = d.tongSoHd - d.hoaDon.length;
    if (conLai > 0) {
      // Nói rõ tổng đã gồm phần chưa liệt kê — nếu không, nhân viên tự cộng
      // danh sách rồi tưởng con số tổng bị sai.
      dong.push(
        `(còn ${conLai} hoá đơn nữa — ${tien(d.congNo - tongDaIn)} chưa liệt kê; ` +
        `tổng ${tien(d.congNo)} ĐÃ bao gồm)`,
      );
    }
  } else {
    // Có nợ mà không có HĐ → nợ từ bút toán thủ công. Nói rõ, đừng để model
    // kết luận "không nợ" khi con số nói ngược lại.
    dong.push('(công nợ không đến từ hoá đơn bán — có thể là bút toán thủ công)');
  }

  // ── HÀNG RÀO TỰ KIỂM ──────────────────────────────────────────────────────
  // Tổng hoá đơn lệch số dư Odoo → KHÔNG im lặng. Bug 16:09 11/08 sống được
  // chính vì hai con số lệch nhau 140 triệu mà không ai được báo.
  if (d.lech) {
    dong.push(
      '',
      `⚠️ LỆCH SỔ: tổng hoá đơn ${tien(d.congNo)} khác số dư Odoo tự báo ` +
      `${tien(d.soDuOdoo)} (chênh ${tien(Math.abs(d.congNo - d.soDuOdoo))}). ` +
      'Thường do bút toán tay đối trừ mà không đánh dấu hoá đơn đã trả. ' +
      'BÁO nhân viên đối chiếu Odoo trước khi đi đòi nợ — ĐỪNG khẳng định một số.',
    );
  }

  dong.push('', 'Nguồn: Hoá đơn chưa thanh toán (Odoo)');
  return dong.join('\n');
}
