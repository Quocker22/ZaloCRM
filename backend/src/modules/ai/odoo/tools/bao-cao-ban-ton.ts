// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: BÁO CÁO BÁN RA + TỒN KHO THEO NGÀY — công cụ KIỂM KHO TỪNG PHẦN.
//
// ═══ VÌ SAO TOOL NÀY TỒN TẠI (đọc trước khi sửa) ═══════════════════════════
// Yêu cầu 17:58–17:59 ngày 11/08/2026, anh Quyết (khách hàng), nguyên văn:
//   "Anh muốn nó báo cáo theo ngày các sản phẩm bán ra"
//   "Xem còn tồn kho bao nhiêu"
//   "Ví dụ anh có 1.000 sản phẩm như hôm nay anh chỉ bán được 10 mã sản phẩm
//    thôi thì anh sẽ hỏi nó là hôm nay bán được bao nhiêu mã và còn tồn lại
//    là bao nhiêu"
//   "Sau đó anh sẽ cho kho đi đối chiếu với số lượng thực tế những cái mã bán
//    ra thì nó sẽ nhanh hơn"
//   "Bây giờ bọn anh đang bị tình trạng là lâu lâu kiểm tra lại một lần thì
//    lại thấy thiếu nhiều hàng"
//
// ĐÂY KHÔNG PHẢI BÁO CÁO DOANH SỐ. Kho có ~1.000 mã; kiểm toàn bộ thì lâu nên
// cả tháng mới làm một lần, và mỗi lần lại "thấy thiếu nhiều hàng" mà không
// truy được thất thoát xảy ra lúc nào. Ý tưởng của anh Quyết: mỗi ngày chỉ có
// vài mã CÓ BIẾN ĐỘNG — chỉ cần đếm ngần ấy mã là đủ, làm được HÀNG NGÀY, và
// lệch phát hiện ra trong vòng 24h thay vì một tháng.
//
// Hệ quả cho thiết kế:
//   · Con số quan trọng nhất là SỐ MÃ (không phải doanh thu) — đó là khối
//     lượng việc anh Quyết giao cho kho.
//   · Cột TIỀN cố ý KHÔNG có: đây là phiếu đi đếm hàng, thêm tiền vào chỉ làm
//     nhiễu và lộ giá không cần thiết.
//   · Mã BẤT THƯỜNG phải nổi lên trên cùng — đó là mục đích cuối (phát hiện
//     thất thoát sớm), không phải phần phụ.
//
// ═══ VÌ SAO KHÔNG DÙNG `top_san_pham` ═════════════════════════════════════
// Tool đó mặc định 30 NGÀY và không có cột tồn. Câu "hôm nay bán bao nhiêu mã"
// trả về danh sách cả tháng là giao cho kho đếm sai tập mã.
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { NGUONG_DINH_KEM, type BangExcel } from '../xuat-excel.js';
import { laSanPhamKyThuat } from '../sp-ky-thuat.js';

/**
 * Trần số mã kéo về. Một ngày bận nhất đo được ~40 mã; 500 là dư xa, đủ để
 * "tuần này"/"tháng này" vẫn không bị cắt im lặng.
 */
const TRAN_MA = 500;

/** Lý do một mã bị đánh dấu đáng ngờ. Chuỗi này in thẳng cho người đọc. */
export type LyDoBatThuong = 'ton_am' | 'ban_ma_het_ton';

export interface DongBanTon {
  sanPhamId: number;
  /** Mã nội bộ (default_code). Rỗng nếu SP chưa đặt mã. */
  ma: string;
  ten: string;
  /** Số lượng bán ra trong kỳ (đã loại đơn huỷ + dòng kỹ thuật). */
  banRa: number;
  /** Tồn hiện tại — qty_available tại THỜI ĐIỂM CHẠY, không phải cuối kỳ. */
  tonHienTai: number;
  /**
   * Tồn đầu kỳ SUY RA (chỉ khi kỳ = hôm nay). `null` khi không tính được —
   * xem chú thích ở `suyRaTonDauKy`. Thà để trống còn hơn bịa số.
   */
  tonDauKy: number | null;
  batThuong: LyDoBatThuong | null;
}

export type KetQuaBanTon =
  | {
      trangThai: 'ok';
      danhSach: DongBanTon[];
      /** TỔNG SỐ MÃ bán ra — con số anh Quyết hỏi ĐẦU TIÊN. */
      soMa: number;
      soBatThuong: number;
      ky: string;
      /** Kỳ có phải đúng hôm nay không — quyết định có suy ra tồn đầu kỳ. */
      laHomNay: boolean;
      /** Danh sách bị cắt vì vượt trần? Cắt im lặng là lỗi nguy hiểm nhất. */
      biCat: boolean;
    }
  | { trangThai: 'loi'; lyDo: string };

export interface BaoCaoBanTonDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

/** 'YYYY-MM-DD' hợp lệ? Ngày rác truyền thẳng vào domain là Odoo ném khó hiểu. */
function ngayHopLe(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function homNay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'DD/MM' cho người Việt đọc nhanh. */
function ngayVN(s: string): string {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Tồn đầu kỳ SUY RA = tồn hiện tại + bán ra.
 *
 * VÌ SAO CHỈ ÁP DỤNG CHO HÔM NAY, và vì sao đây vẫn chỉ là ƯỚC LƯỢNG:
 * `qty_available` là tồn TẠI THỜI ĐIỂM CHẠY, không phải tồn cuối ngày. Với kỳ
 * quá khứ (vd hỏi ngày 10/08 vào ngày 11/08), giữa cuối kỳ và bây giờ đã có
 * thêm nhập/xuất/điều chỉnh — cộng ngược ra một con số VÔ NGHĨA. Nên trả
 * `null`: ô Excel để trống, và người đọc biết là không tính được.
 *
 * Ngay cả với HÔM NAY, phép cộng này chỉ đúng nếu trong ngày KHÔNG có nhập
 * hàng hay điều chỉnh kho. Vì vậy nó được gọi là "ước tính" ở mọi chỗ hiển
 * thị, và KHÔNG được dùng để kết luận "lệch bao nhiêu" — kết luận sai về thất
 * thoát còn tệ hơn không kết luận.
 */
function suyRaTonDauKy(tonHienTai: number, banRa: number, laHomNay: boolean): number | null {
  if (!laHomNay) return null;
  return tonHienTai + banRa;
}

/**
 * Mã này có đáng ngờ không?
 *
 * Cố ý BẮT HẸP — chỉ hai ca mà số liệu tự nó mâu thuẫn, không cần suy đoán:
 *
 *   1. `ton_am` — tồn âm là dấu hiệu CHẮC CHẮN sổ sách lệch thực tế. Kho không
 *      thể có -7 cái.
 *   2. `ban_ma_het_ton` — bán ra > 0 mà tồn = 0. Bán hết sạch đúng bằng số
 *      tồn là chuyện có thật, nhưng khi anh Quyết đang truy thất thoát thì đây
 *      chính là loại mã cần cầm đi đếm đầu tiên. Ca thật đo 11/08:
 *      [SP000910] Nguồn 12V400W Jinbo — bán 10, tồn 0.
 *
 * VÌ SAO KHÔNG THÊM LUẬT "tồn đầu - bán ≠ tồn cuối": với công thức suy ra ở
 * trên, đẳng thức đó LUÔN đúng theo định nghĩa (tồn đầu vừa được tính bằng
 * tồn cuối + bán). Đưa vào sẽ là một phép kiểm tra giả, không bao giờ kêu.
 * Muốn kiểm thật phải đọc stock.move theo mốc thời gian — việc lớn hơn, và
 * chưa có bằng chứng là cần. Thà nêu ít mà đúng.
 */
function danhDauBatThuong(tonHienTai: number, banRa: number): LyDoBatThuong | null {
  if (tonHienTai < 0) return 'ton_am';
  if (banRa > 0 && tonHienTai === 0) return 'ban_ma_het_ton';
  return null;
}

export async function baoCaoBanTon(
  deps: BaoCaoBanTonDeps,
  input: { tu_ngay?: string; den_ngay?: string } = {},
): Promise<KetQuaBanTon> {
  // MẶC ĐỊNH = HÔM NAY. Anh Quyết nói "báo cáo THEO NGÀY" — rơi về "30 ngày
  // gần nhất" như top_san_pham là giao cho kho đếm sai tập mã.
  const tu = ngayHopLe(input.tu_ngay) ? input.tu_ngay : homNay();
  // Chỉ có tu_ngay ("hôm qua bán gì") → kỳ đúng MỘT ngày đó, không kéo tới hôm
  // nay: "hôm qua" mà trả cả hôm nay là danh sách mã sai.
  const den = ngayHopLe(input.den_ngay)
    ? input.den_ngay
    : ngayHopLe(input.tu_ngay)
      ? input.tu_ngay
      : homNay();

  const ky = tu === den ? ngayVN(tu) : `${ngayVN(tu)} – ${ngayVN(den)}`;
  const laHomNay = tu === homNay() && den === homNay();

  try {
    // ── 1. SỐ BÁN trong kỳ, do ODOO cộng (read_group) ────────────────────
    // Code chỉ sắp xếp/trình bày, không tự cộng — hàng rào chính xác số 1 của
    // hệ này.
    const nhom = await deps.odoo.execute<Array<Record<string, unknown>>>(
      'sale.order.line',
      'read_group',
      [
        [
          // NGÀY ĐẶT ĐƠN, không phải create_date của dòng: sửa một đơn cũ hôm
          // nay sẽ đẻ dòng mới mang create_date hôm nay, kéo mã không hề bán
          // hôm nay vào danh sách kho phải đếm.
          ['order_id.date_order', '>=', `${tu} 00:00:00`],
          ['order_id.date_order', '<=', `${den} 23:59:59`],
          // Loại đơn HUỶ. Giữ đơn nháp: shop này bot tạo nháp cả ngày, bỏ nháp
          // là thiếu gần hết số (bài học từ top_san_pham).
          ['order_id.state', '!=', 'cancel'],
          // Bỏ dòng ghi chú/section — không phải hàng.
          ['display_type', '=', false],
        ],
        ['product_uom_qty:sum'],
        ['product_id'],
      ],
      { orderby: 'product_uom_qty desc', limit: TRAN_MA, lazy: true },
    );

    const banTheoSP = (Array.isArray(nhom) ? nhom : [])
      .filter((g) => Array.isArray(g.product_id))
      .map((g) => ({
        sanPhamId: Number((g.product_id as unknown[])[0]),
        tenDayDu: String((g.product_id as unknown[])[1] ?? ''),
        banRa: Number(g.product_uom_qty ?? 0),
      }))
      // LỌC SP KỸ THUẬT (VAT, phí ship, chiết khấu). Kế toán ghi VAT bằng SP
      // giả đơn giá 1đ với SỐ LƯỢNG = SỐ TIỀN (đo thật: qty 43.968.000), nên
      // lọt vào đây thì nó chiếm hạng 1 và kho được giao đi đếm "43 triệu cái
      // VAT". Xem sp-ky-thuat.ts + commit 720bca7a.
      .filter((d) => !laSanPhamKyThuat(d.tenDayDu));

    if (banTheoSP.length === 0) {
      return { trangThai: 'ok', danhSach: [], soMa: 0, soBatThuong: 0, ky, laHomNay, biCat: false };
    }

    // ── 2. TỒN HIỆN TẠI của đúng những mã đã bán ─────────────────────────
    // Chỉ đọc mã có biến động, không kéo cả 1.257 SP: đó chính là ý tưởng
    // "kiểm kho từng phần". KHÔNG đọc standard_price — cấm lộ giá vốn.
    const ids = banTheoSP.map((d) => d.sanPhamId);
    const rows = await deps.odoo.searchRead<Record<string, unknown>>(
      'product.product',
      [['id', 'in', ids]],
      ['id', 'name', 'default_code', 'qty_available'],
      { limit: TRAN_MA },
    );

    const tonTheoId = new Map<number, { ten: string; ma: string; ton: number }>();
    for (const r of Array.isArray(rows) ? rows : []) {
      tonTheoId.set(Number(r.id ?? 0), {
        ten: String(r.name ?? ''),
        ma: r.default_code ? String(r.default_code) : '',
        ton: Number(r.qty_available ?? 0),
      });
    }

    const danhSach: DongBanTon[] = banTheoSP.map((d) => {
      const t = tonTheoId.get(d.sanPhamId);
      // SP không đọc được tồn (bị xoá/ẩn) → tồn 0 nhưng KHÔNG đánh dấu bất
      // thường: đó là thiếu dữ liệu, không phải bằng chứng thất thoát. Báo
      // động giả làm kho mất lòng tin vào cả danh sách.
      const ton = t ? t.ton : 0;
      return {
        sanPhamId: d.sanPhamId,
        ma: t?.ma ?? '',
        // Tên từ product.product sạch hơn display_name (không kèm "[mã] ").
        ten: t?.ten || d.tenDayDu,
        banRa: d.banRa,
        tonHienTai: ton,
        tonDauKy: suyRaTonDauKy(ton, d.banRa, laHomNay),
        batThuong: t ? danhDauBatThuong(ton, d.banRa) : null,
      };
    });

    // Bán nhiều nhất lên đầu — mã bán nhiều là mã cần kiểm trước (rủi ro lệch
    // cao nhất, và nếu kho chỉ kịp đếm một phần thì phải đếm phần này).
    danhSach.sort((a, b) => b.banRa - a.banRa);

    return {
      trangThai: 'ok',
      danhSach,
      soMa: danhSach.length,
      soBatThuong: danhSach.filter((d) => d.batThuong).length,
      ky,
      laHomNay,
      biCat: banTheoSP.length >= TRAN_MA,
    };
  } catch (err) {
    // Lỗi hạ tầng KHÔNG được biến thành "hôm nay bán 0 mã": kho sẽ không đi
    // kiểm những mã thật sự có biến động, đúng thứ tool này sinh ra để chặn.
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

/** In số kiểu VN, giữ phần lẻ khi có (đơn vị bán lẻ như mét, kg). */
function so(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function nhanBatThuong(ly: LyDoBatThuong): string {
  return ly === 'ton_am' ? 'TỒN ÂM — sổ sách chắc chắn lệch' : 'bán ra nhưng TỒN = 0';
}

/**
 * Bảng Excel để kho CẦM ĐI ĐẾM.
 *
 * Hai cột cuối cố ý ĐỂ TRỐNG: kho điền tay số đếm được, cột "Chênh lệch" tự
 * người kiểm ghi. Điền sẵn số vào là kho sẽ chép lại thay vì đi đếm — mất sạch
 * tác dụng đối chiếu.
 *
 * KHÔNG có cột tiền: đây là phiếu kiểm kho, không phải báo cáo doanh số.
 */
export function bangBanTon(kq: Extract<KetQuaBanTon, { trangThai: 'ok' }>): BangExcel {
  // Cột "Tồn đầu kỳ (ước tính)" chỉ xuất hiện khi thật sự tính được — cột
  // trống trơn cho kỳ quá khứ chỉ làm người đọc tưởng dữ liệu bị lỗi.
  const coDauKy = kq.laHomNay;
  const cot = [
    'Mã SP',
    'Tên sản phẩm',
    ...(coDauKy ? ['Tồn đầu kỳ (ước tính)'] : []),
    'Bán ra trong kỳ',
    'Tồn hiện tại',
    'Thực tế đếm',
    'Chênh lệch',
    'Ghi chú',
  ];
  return {
    tieuDe: `Kiểm kho theo ngày — mã bán ra ${kq.ky}`,
    ky: kq.ky,
    cot,
    dong: kq.danhSach.map((d) => [
      d.ma,
      d.ten,
      ...(coDauKy ? [d.tonDauKy ?? ''] : []),
      d.banRa,
      d.tonHienTai,
      '', // Thực tế đếm — kho điền tay
      '', // Chênh lệch — kho điền tay
      d.batThuong ? `BẤT THƯỜNG: ${nhanBatThuong(d.batThuong)}` : '',
    ]),
  };
}

/**
 * Định dạng cho LLM đọc rồi nhắn lại qua Zalo.
 *
 * Thứ tự trình bày bám đúng thứ tự anh Quyết hỏi: SỐ MÃ trước, rồi bảng, rồi
 * mã bất thường. Mã bất thường được nêu LẠI thành mục riêng dù đã có trong
 * bảng — bắt người đọc tự dò bảng trên điện thoại là mất tác dụng cảnh báo.
 */
export function dinhDangBanTon(kq: KetQuaBanTon, daDinhKem = false): string {
  if (kq.trangThai === 'loi') {
    return `Không lấy được báo cáo bán ra/tồn kho: ${kq.lyDo}`;
  }

  const NGUON = 'Nguồn: Odoo · đơn bán trong kỳ (loại đơn huỷ, loại dòng VAT/phí) + tồn hiện tại';

  if (kq.soMa === 0) {
    // Rỗng KHÔNG được trả bảng trống: nói thẳng là không có mã nào, kèm kỳ —
    // model nhận chuỗi mơ hồ sẽ tự bịa nội dung.
    return (
      `Kỳ ${kq.ky}: KHÔNG có mã nào bán ra (0 mã) — không có gì cần kho đối chiếu.\n${NGUON}`
    );
  }

  const hien = kq.danhSach.slice(0, daDinhKem ? 5 : NGUONG_DINH_KEM);
  const dong = hien
    .map((d, i) => {
      const ma = d.ma ? `[${d.ma}] ` : '';
      const canh = d.batThuong ? '  ← BẤT THƯỜNG' : '';
      return `${i + 1}. ${ma}${d.ten} — bán ${so(d.banRa)} | tồn ${so(d.tonHienTai)}${canh}`;
    })
    .join('\n');

  const phanBatThuong =
    kq.soBatThuong === 0
      ? '\n\nKhông có mã nào bất thường — số bán và tồn khớp nhau ở mức kiểm tra được.'
      : `\n\n⚠️ ${kq.soBatThuong} MÃ BẤT THƯỜNG cần kiểm TRƯỚC:\n` +
        kq.danhSach
          .filter((d) => d.batThuong)
          .map((d) => `- ${d.ma ? `[${d.ma}] ` : ''}${d.ten}: bán ${so(d.banRa)}, tồn ${so(d.tonHienTai)} (${nhanBatThuong(d.batThuong!)})`)
          .join('\n');

  const conNua =
    !daDinhKem && kq.danhSach.length > hien.length
      ? `\n... còn ${kq.danhSach.length - hien.length} mã nữa.`
      : '';

  const canhCat = kq.biCat
    ? `\nLƯU Ý: kỳ này vượt ${TRAN_MA} mã nên danh sách có thể bị cắt — thu hẹp khoảng ngày để kiểm cho đủ.`
    : '';

  const kem = daDinhKem
    ? `\n\nĐã gửi kèm FILE EXCEL đầy đủ ${kq.danhSach.length} mã, có sẵn cột trống "Thực tế đếm" và "Chênh lệch" để kho điền tay khi đi đếm. Nói "xem file Excel đính kèm ạ".`
    : '';

  return (
    `Kỳ ${kq.ky}: bán ra ${kq.soMa} mã sản phẩm.\n` +
    `Danh sách mã cần đối chiếu (bán nhiều nhất trước):\n${dong}${conNua}` +
    phanBatThuong +
    canhCat +
    kem +
    `\n${NGUON}`
  );
}

// ═══ MÔ TẢ TOOL ═══════════════════════════════════════════════════════════
// VÌ SAO DÀI VÀ CHÉP NGUYÊN VĂN CÂU HỎI THẬT: model chọn tool bằng MÔ TẢ, không
// bằng code. Bài học đắt ngày 11/08 — `canh_bao_ton_kho` đã làm được việc,
// nhưng mô tả không nhắc đến "tồn nhỏ hơn N" nên bot vẫn đáp "em không có công
// cụ" trước mặt khách. Câu hỏi thật của người dùng là tín hiệu rẻ nhất và mạnh
// nhất để model khớp đúng tool, nên chép thẳng vào đây.
export const baoCaoBanTonDefinition: ToolDefinition = {
  name: 'bao_cao_ban_ton',
  description:
    'BÁO CÁO BÁN RA + TỒN KHO THEO NGÀY, phục vụ KIỂM KHO từng phần. Trả về: tổng SỐ MÃ ' +
    'sản phẩm bán ra trong kỳ, số bán và tồn hiện tại của từng mã, và cảnh báo những mã ' +
    'BẤT THƯỜNG (bán ra mà tồn 0, hoặc tồn âm). Kèm file Excel có cột trống để kho điền số đếm thực tế. ' +
    'GỌI KHI nhân viên/sếp hỏi (câu thật của khách hàng): ' +
    '"hôm nay bán được bao nhiêu mã và còn tồn lại là bao nhiêu", ' +
    '"báo cáo theo ngày các sản phẩm bán ra", "xem còn tồn kho bao nhiêu", ' +
    '"hôm nay bán ra những mã nào", "hôm qua bán được mấy mã", ' +
    '"cho kho đi đối chiếu số lượng thực tế những mã bán ra", ' +
    '"kiểm kho hôm nay", "tuần này bán những mã gì để kiểm kho". ' +
    'Mặc định kỳ = HÔM NAY. ' +
    'ĐÂY LÀ TOOL DUY NHẤT ghép được SỐ BÁN với SỐ TỒN theo từng mã trong một kỳ. ' +
    'KHÔNG dùng top_san_pham (tool đó mặc định 30 ngày và KHÔNG có cột tồn kho), ' +
    'KHÔNG dùng canh_bao_ton_kho (chỉ biết tồn, không biết bán ra), ' +
    'KHÔNG dùng doc_odoo để mò.',
  inputSchema: {
    type: 'object',
    properties: {
      tu_ngay: {
        type: 'string',
        description:
          'YYYY-MM-DD. Bỏ trống = HÔM NAY. "Hôm qua" → điền ngày hôm qua. ' +
          '"Tuần này" → điền ngày thứ Hai của tuần.',
      },
      den_ngay: {
        type: 'string',
        description:
          'YYYY-MM-DD. Bỏ trống mà có tu_ngay thì kỳ đúng MỘT ngày tu_ngay. ' +
          'Chỉ điền khi nhân viên nêu khoảng "từ ngày… đến ngày…".',
      },
    },
    required: [],
  },
};
