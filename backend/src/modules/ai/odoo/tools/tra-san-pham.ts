// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: tra sản phẩm theo tên/mã trong Odoo.
//
// Vì sao tool này tồn tại: giá đang được parse bằng regex `Giá bán: ([\d.]+)đ`
// từ text chunk trong KB. KB là ảnh chụp tại một thời điểm — giá đổi thì KB sai,
// và bot báo sai giá cho khách. Có ca thật: một agent bán hàng báo giảm 50% lấy
// từ tài liệu giá cũ trong knowledge base. Giá phải đọc từ Odoo, luôn luôn.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import {
  mauKhongDau, locKhopBoDau, boDau as boDauChung,
  dieuKienBienTheDau, dieuKienBienTheDauCum,
} from '../tim-khong-dau.js';

/**
 * Field ĐƯỢC PHÉP đọc. Danh sách trắng, không phải danh sách đen.
 *
 * `standard_price` (giá vốn) KHÔNG có ở đây và không bao giờ được thêm vào.
 * Odoo đã chặn ở tầng field cho group_staff, nhưng đây là hàng rào thứ hai:
 * nếu ai đó lỡ cấp group_manager cho user bot, code vẫn không lộ giá vốn.
 */
const ALLOWED_FIELDS = ['id', 'name', 'default_code', 'list_price', 'uom_id'] as const;

/** Field cấm tuyệt đối — lọc lần cuối trước khi trả cho LLM. */
const FORBIDDEN_FIELDS = ['standard_price', 'cost', 'purchase_price', 'margin'];

export interface SanPham {
  id: number;
  ten: string;
  ma: string | null;
  gia: number;
  donVi: string | null;
}

/**
 * Bỏ dấu tiếng Việt + hạ chữ thường, để so khớp tên gần đúng.
 * Odoo core name_search KHÔNG hiểu tiếng Việt không dấu — khách gõ "den led"
 * sẽ không khớp "Đèn LED". Chuẩn hoá phía client là cách rẻ nhất để vá.
 *
 * Dùng lại bản trong tim-khong-dau.ts (12/08) thay vì chép luật lần hai: hai
 * bản bỏ dấu lệch nhau thì tầng tra và tầng lọc sẽ bất đồng về "chữ này có dấu
 * hay không", và bug loại đó không lộ ra cho tới khi ra đơn sai. `.trim()` giữ
 * nguyên vì các chỗ gọi cũ đang dựa vào.
 */
export function boDau(s: string): string {
  return boDauChung(s).trim();
}

/**
 * TỪ BIẾN THỂ — màu/chỗ lắp phân biệt hai SP cùng dòng. Chọn nhầm biến thể là
 * nhầm mặt hàng thật (kho xuất sai màu), nên alias/khớp tự động phải soi.
 *
 * Ca thật 06:05 13/08: alias học sai "3b 6214 trắng ấm" → "3 bóng 6214 trắng
 * (thanh)" rồi TỰ CHỐT IM LẶNG 3000 cái sai màu vào đơn S13848. "trắng ấm" là
 * MỘT màu (warm white) — gộp về "ấm" trước khi so, kẻo "trắng" trong đó lại
 * khớp nhầm với SP trắng.
 */
const GOP_BIEN_THE: Array<[RegExp, string]> = [
  [/(^|\s)trang am(?=\s|$)/g, '$1am'],
  [/(^|\s)vang am(?=\s|$)/g, '$1am'],
];
const TU_BIEN_THE = [
  'am', 'trang', 'vang', 'xanh', 'do', 'hong', 'tim',
  'ngoai troi', 'trong nha',
];

/**
 * Từ khoá của NV có từ biến thể mà TÊN SP không có → xung đột: đừng tự chốt,
 * đưa ra hỏi. Không có từ biến thể nào trong từ khoá thì không bao giờ chặn
 * (alias kiểu "led hắt 6313" → "3 Bóng Saso 6313" vẫn khớp thẳng như cũ).
 */
export function xungDotBienThe(tuKhoa: string, tenSp: string): boolean {
  const chuan = (s: string): string =>
    GOP_BIEN_THE.reduce((t, [re, thay]) => t.replace(re, thay), ` ${boDau(s)} `);
  const q = chuan(tuKhoa);
  const sp = chuan(tenSp);
  const co = (chuoi: string, tu: string): boolean =>
    new RegExp(`(^|[^a-z0-9])${tu}([^a-z0-9]|$)`).test(chuoi);
  return TU_BIEN_THE.some((tu) => co(q, tu) && !co(sp, tu));
}

/**
 * Tách mã model trong tên SP: token có chữ số, dài ≥3, không phải đơn vị đơn lẻ.
 * Vd "P10", "2835", "12V400W" là mã; "12v", "5a" thì không.
 *
 * Dùng để tránh nhầm SP: P10 và P4 tên gần giống nhau, nhưng khác hàng, khác giá.
 * Cùng logic với order-checkout.ts đang dùng.
 */
export function macModel(s: string): string[] {
  return boDau(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3 && /\d/.test(t) && !/^\d+[mvaw]$/.test(t));
}

/** Xoá mọi field cấm khỏi bản ghi Odoo trả về. Hàng rào cuối cùng. */
function locFieldCam(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row };
  for (const f of FORBIDDEN_FIELDS) delete clean[f];
  return clean;
}

/** Odoo trả many2one dạng [id, "tên"]. Lấy phần tên. */
function tenM2O(v: unknown): string | null {
  return Array.isArray(v) && v.length >= 2 ? String(v[1]) : null;
}

export interface TraSanPhamDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/**
 * Tìm SP theo tên hoặc mã.
 *
 * Chiến lược 2 bước:
 *  1. Hỏi Odoo bằng ilike trên name + default_code (Odoo lo phần này tốt).
 *  2. Nếu query có mã model (P10, 2835…), LỌC LẠI phía client để chỉ giữ SP
 *     chứa đúng mã đó — chống nhầm P10 → P4.
 */
/**
 * Số kết quả mặc định. Hạ từ 5 → 3 vì kết quả tool nằm lại trong lịch sử và bị
 * tính tiền lại ở MỌI vòng sau. Đo thực tế: 20 kết quả ≈ 500 token, lặp 8 vòng
 * là 4.000 token chỉ cho một lần tra.
 */
const MAC_DINH = 3;
const TOI_DA = 10;

/**
 * Giá ≤ ngưỡng này coi là GIÁ ẢO (placeholder khi nhập liệu), không phải giá bán.
 *
 * Đo thực tế trên DB: 63/313 SP "có giá" thực ra để đúng **1đ**. Không có mặt hàng
 * LED nào bán 1 đồng. Coi đó là giá thật thì bot báo sai cho khách.
 *
 * Ngưỡng 10đ: đủ thấp để không loại oan hàng rẻ thật (SP rẻ nhất có giá hợp lệ
 * trong DB là 1.000đ), đủ cao để bắt hết placeholder 1đ/2đ/5đ.
 */
export const NGUONG_GIA_AO = 10;

/**
 * Từ đệm — bỏ khi tách từ khoá vì chúng không phân biệt được sản phẩm.
 *
 * Gồm 2 nhóm:
 *  - Đơn vị / từ nối: "màu", "cái", "cuộn", "và"…
 *  - Từ CHỦNG LOẠI quá chung: "đèn", "led", "bóng".
 *    Lý do (bug thật): nhân viên gõ "đèn led ngoài trời" nhưng SP tên
 *    "Led 3 Bóng Ngoài Trời 6615…" KHÔNG có chữ "đèn" → đòi đủ 4 từ là ra 0 kết
 *    quả, dù catalog có 47 SP ngoài trời. Bỏ từ chủng loại thì "ngoài trời" khớp.
 */
const TU_DEM = new Set([
  // đơn vị / từ nối
  'mau', 'loai', 'cai', 'cay', 'chiec', 'va', 'cua', 'con', 'bo',
  // chủng loại quá chung — gần như SP nào cũng có hoặc không có tuỳ cách gọi
  'den', 'led', 'bong', 'cuon', 'day',
]);

/**
 * Dựng domain tìm kiếm: tách query thành TỪNG TỪ KHOÁ, mỗi từ là một điều kiện AND.
 *
 * VÌ SAO KHÔNG khớp nguyên chuỗi (bug thật 2026-07-29):
 *   Odoo `ilike` so khớp chuỗi con LIỀN MẠCH. Query "COB 24v xanh ngọc" KHÔNG khớp
 *   SP tên "Led dây COB 24v MÀU xanh ngọc" — chỉ vì thiếu chữ "màu" ở giữa.
 *   Nhân viên gõ tên gần đúng là chuyện bình thường, không phải lỗi của họ.
 *
 * Tách từ → mỗi từ ilike riêng → SP phải chứa TẤT CẢ các từ (thứ tự tuỳ ý).
 * Vẫn chặt: "COB xanh" không khớp SP "COB đỏ".
 *
 * Trả về domain dạng prefix-notation của Odoo.
 */
/**
 * Token là CON SỐ ĐẾM trong tên hàng — luôn giữ, dù chỉ 1 ký tự.
 *
 * VÌ SAO (bug thật 2026-07-30): "led hắt cụm 3 bóng" bị bỏ chữ "3" (do lọc
 * `length >= 2`) rồi bỏ luôn "led"/"cum"/"bong" (do TU_DEM) → còn "hat" một mình
 * → khớp bừa. Kết quả trả về có "Led **4** bóng" khi khách hỏi **3** bóng, nên
 * bot không dám báo giá và chuyển sale, dù DB có hàng 3 bóng giá 5.000đ.
 *
 * Trong catalog LED, số đếm là thông tin PHÂN BIỆT mặt hàng (3 bóng ≠ 4 bóng,
 * khác giá), không phải từ đệm.
 */
function laSoDem(t: string): boolean {
  return /^\d+$/.test(t);
}

/**
 * Tập TỪ KHOÁ THẬT SỰ đem đi tra — sau khi bỏ từ đệm và giữ số đếm.
 *
 * Tách riêng (12/08) để tầng LỌC BỎ DẤU ở JS dùng ĐÚNG tập từ mà tầng DB đã
 * dùng. Lệch tập là loại oan: DB bỏ chữ "đèn" rồi tìm đúng "Led dây COB", còn
 * JS lại đòi tên phải chứa cả "đèn" nên vứt luôn SP đó.
 */
export function tuKhoaTraSp(ten: string): string[] {
  // TÁCH TOKEN GẠCH NỐI (P1.1, 12/08 — đo 30 ngày prod): ảnh/nhân viên ghi
  // "RY3-800W" nhưng catalog lưu "Nguồn 12V800W đổ keo ngoài trời
  // RY3-12V800WYR" — tra nguyên chuỗi "RY3-800W" bằng ilike là trượt dù cả
  // "RY3" lẫn "800W" đều nằm trong tên. Cách người ghép mã bằng gạch không
  // bao giờ trùng khít cách catalog ghép, nên gạch nối là RANH GIỚI TỪ, không
  // phải ký tự của từ. Tách rồi để cơ chế AND-từng-từ sẵn có làm việc.
  //
  // `default_code` KHÔNG ảnh hưởng: domainTimKiem vẫn tra mã bằng NGUYÊN
  // chuỗi gốc (mã thật có gạch thì nhân viên gõ đủ mã).
  const moiTu = ten
    .trim()
    .split(/\s+/)
    .flatMap((t) => (/[-_]/.test(t) && /\d/.test(t) ? t.split(/[-_]+/) : [t]))
    .filter((t) => t.length >= 2 || laSoDem(t));
  // TU_DEM không được phép loại số đếm.
  const tu = moiTu.filter((t) => laSoDem(t) || !TU_DEM.has(boDau(t)));
  // Query TOÀN từ đệm ("đèn led", "bóng") → không bỏ được từ nào, dùng lại tất cả.
  // Kết quả sẽ rộng, nhưng có kết quả vẫn hơn trả rỗng.
  return tu.length > 0 ? tu : moiTu;
}

export function domainTimKiem(ten: string): unknown[] {
  const dung = tuKhoaTraSp(ten);

  // BIẾN THỂ DẤU THẬT cho `name` (sửa vòng 3, 12/08) — `ilike` prod KHÔNG bỏ
  // dấu, đo thật: ['name','ilike','Nguồn'] -> 5 kq · ['name','ilike','Nguon'] -> 0 kq.
  // Bản 11/08 vá bằng mẫu `_`, nhưng đo prod 12/08 cho thấy `_` khớp quá rộng
  // (v_n -> hàng trăm người) nên hàng đúng có thể rớt NGOÀI trần Odoo trả về.
  // Nay tra OR trên từng biến thể dấu thật. Xem tim-khong-dau.ts.
  //
  // `default_code` GIỮ NGUYÊN `ilike` thường: mã SP là ASCII ("P10FO", "2835"),
  // không có dấu để mà bỏ, và nới thành wildcard chỉ làm mã ngắn khớp bừa.

  // Query quá ngắn (1 ký tự) → khớp nguyên chuỗi cho an toàn.
  if (dung.length === 0) {
    return ['|', ...dieuKienBienTheDauCum('name', ten), ['default_code', 'ilike', ten]];
  }

  // Một từ: (name khớp một trong các biến thể) OR default_code ilike X
  if (dung.length === 1) {
    return ['|', ...dieuKienBienTheDau('name', dung[0]), ['default_code', 'ilike', dung[0]]];
  }

  // Nhiều từ: (name chứa TẤT CẢ các từ) OR (default_code chứa nguyên chuỗi).
  // default_code là mã, không tách từ — nhân viên gõ mã thì gõ đủ.
  const khoi = dung.map((t) => dieuKienBienTheDau('name', t));
  const theoTen = [...Array(khoi.length - 1).fill('&'), ...khoi.flat()];
  return ['|', ...theoTen, ['default_code', 'ilike', ten]];
}

export async function traSanPham(
  deps: TraSanPhamDeps,
  input: { ten: string; gioi_han?: number },
): Promise<SanPham[]> {
  const ten = input.ten?.trim();
  if (!ten) return [];
  const limit = Math.min(Math.max(1, input.gioi_han ?? MAC_DINH), TOI_DA);

  // Domain gốc: SP đang bán + KHÔNG lưu trữ.
  //
  // LỌC HÀNG ĐÃ LƯU TRỮ — phải kiểm CẢ HAI cấp. Odoo lưu trữ ở cấp template
  // (product_template.active=false) nhưng variant (product_product.active) vẫn
  // có thể = true. Chỉ lọc một cấp là SP đã archive vẫn lọt ra.
  const domainGoc: unknown[] = [
    ['sale_ok', '=', true],
    ['active', '=', true],
    ['product_tmpl_id.active', '=', true],
  ];

  const domainTim = domainTimKiem(ten);

  // ƯU TIÊN GIÁ PHẢI Ở TẦNG DB, không phải tầng JS (bug thật 2026-07-30).
  //
  // Trước đây: lấy `limit*4` dòng rồi mới sắp SP-có-giá lên đầu. Sai — Odoo trả
  // 12 dòng ĐẦU theo id, và vì 74% catalog trống giá thì 12 dòng đó thường trống
  // hết. Bot kết luận "cả 12 SP đều chưa có giá" trong khi catalog có 250 SP CÓ
  // giá khớp từ khoá. Ca thật: khách hỏi "led" → 12 SP ziczac trống giá →
  // chuyển sale, dù có hàng trăm SP led có giá.
  //
  // Cách sửa: hỏi Odoo HAI LẦN — lần 1 chỉ SP có giá thật, lần 2 bù thêm SP
  // trống giá nếu còn chỗ. `order: 'list_price desc'` không thay được vòng này:
  // ta cần BIẾT tổng số SP có giá để báo đúng, và cần SP trống giá vẫn xuất hiện
  // khi không còn lựa chọn nào khác.
  const domainCoGia = [...domainGoc, ['list_price', '>', NGUONG_GIA_AO], ...domainTim];
  const coGiaRows = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product',
    domainCoGia,
    [...ALLOWED_FIELDS],
    // Lấy dư để còn lọc mã model phía dưới.
    { limit: limit * 4 },
  );

  // Chỉ hỏi thêm SP trống giá khi SP có giá chưa lấp đủ `limit` — tiết kiệm 1
  // round-trip cho ca phổ biến (tra đúng SP có giá).
  const trongGiaRows = coGiaRows.length >= limit * 4
    ? []
    : await deps.odoo.searchRead<Record<string, unknown>>(
        'product.product',
        [...domainGoc, ['list_price', '<=', NGUONG_GIA_AO], ...domainTim],
        [...ALLOWED_FIELDS],
        { limit: limit * 4 - coGiaRows.length },
      );

  const rows = [...coGiaRows, ...trongGiaRows];

  // DỰ PHÒNG: đòi đủ MỌI từ mà ra rỗng → nới sang "chứa BẤT KỲ từ nào".
  // Ca thật: "đèn led" — không SP nào có CẢ hai chữ (SP tên "Led 3 Bóng…",
  // không ai đặt tên "Đèn LED 3 Bóng"). Đòi đủ là trả rỗng dù có 353 SP chứa "led".
  // Thà trả kết quả rộng kèm dấu CÒN NỮA còn hơn nói "không tìm thấy".
  let rowsFinal = rows;
  let daNoiRong = false;
  if (rows.length === 0) {
    // Giữ số đếm ở đây nữa — nới rộng mà mất chữ "3" thì SP "4 bóng" lọt vào.
    const tu = ten.trim().split(/\s+/).filter((t) => t.length >= 2 || laSoDem(t));
    if (tu.length >= 2) {
      // Ở ĐÂY thì nới dấu CẢ khi nhân viên gõ có dấu (khác luật chung 12/08).
      // Đây là ĐƯỜNG CỨU CUỐI, chỉ chạy sau khi đòi-đủ-từ đã trả rỗng sạch:
      // giữ nguyên dấu tới tận đây là bỏ nốt cơ hội bắt được SP mà DB lỡ lưu
      // không dấu, rồi đáp "không tìm thấy" trong khi hàng có thật. Luật tôn
      // trọng dấu để KHỎI TRẢ NGƯỜI SAI, không phải để trả về tay trắng.
      const bg = [
        ...domainGoc,
        ...Array(tu.length - 1).fill('|'),
        ...tu.map((t) => ['name', 'ilike', mauKhongDau(boDau(t))]),
      ];
      // Cũng ưu tiên-giá-tại-DB như trên: nới rộng mà vẫn trả toàn hàng trống giá
      // thì việc nới rộng thành vô nghĩa.
      const noiCoGia = await deps.odoo.searchRead<Record<string, unknown>>(
        'product.product',
        [['list_price', '>', NGUONG_GIA_AO], ...bg],
        [...ALLOWED_FIELDS],
        { limit: limit * 4 },
      );
      const noiTrongGia = noiCoGia.length >= limit * 4
        ? []
        : await deps.odoo.searchRead<Record<string, unknown>>(
            'product.product',
            [['list_price', '<=', NGUONG_GIA_AO], ...bg],
            [...ALLOWED_FIELDS],
            { limit: limit * 4 - noiCoGia.length },
          );
      rowsFinal = [...noiCoGia, ...noiTrongGia];
      daNoiRong = true;
    }
  }

  // DỰ PHÒNG 2 — VIẾT LIỀN vs VIẾT CÁCH (bug thật 06/08/2026): nhân viên gõ
  // "Nb12v100w", SP tên "NB 12V100w". Tách-theo-khoảng-trắng ra MỘT token nên
  // dự phòng trên bị bỏ qua, bot đáp "không khớp sản phẩm nào" — trong khi
  // chính nó vừa liệt kê SP đó một tin trước.
  //
  // Cách xử: chèn wildcard `%` của ilike vào MỌI ranh giới chữ↔số:
  // "Nb12v100w" → "nb%12%v%100%w". `%` khớp cả chuỗi rỗng nên pattern này
  // khớp "NB 12V100w", "NB12V100W", lẫn "NB-12V-100W" — mọi kiểu gõ.
  if (rowsFinal.length === 0) {
    const lien = ten.replace(/\s+/g, '');
    const doan = lien.match(/\p{L}+|\d+/gu) ?? [];
    if (doan.length >= 2) {
      // lowercase chỉ để log/test nhất quán — ilike vốn không phân biệt hoa thường.
      const mau = doan.join('%').toLowerCase();
      // Nhánh `name` cũng phải KHÔNG DẤU (11/08): đây là đường cứu cuối khi mọi
      // cách trên đã trượt, để nó kẹt vì dấu thì coi như không có đường cứu.
      // mauKhongDau giữ nguyên '%' (không nằm trong diện thay) nên vẫn nối đoạn.
      const mauKd = doan.map((d) => mauKhongDau(d.toLowerCase())).join('%');
      rowsFinal = await deps.odoo.searchRead<Record<string, unknown>>(
        'product.product',
        [...domainGoc, '|', ['name', 'ilike', mauKd], ['default_code', 'ilike', mau]],
        [...ALLOWED_FIELDS],
        { limit: limit * 4 },
      );
    }
  }

  // LỌC BỎ DẤU CHÍNH XÁC (sửa 12/08, ca "anh Vấn" 01:12) — mẫu `_` ở tầng DB
  // khớp ký tự BẤT KỲ nên "van" → "v_n" lôi cả "Vinh", "Vốn". Bên SP cũng vậy:
  // "nguon" → "ng__n" ôm luôn những tên chỉ tình cờ cùng khung chữ. So bỏ dấu
  // ĐÚNG chữ ở JS, trên vài chục dòng DB đã trả về.
  //
  // KHÔNG áp cho nhánh NỚI RỘNG (daNoiRong): nhánh đó CỐ Ý rộng — nó chạy khi
  // đòi-đủ-từ đã trả rỗng, lọc lại là quay về rỗng, mất luôn đường cứu.
  // So trên CẢ `name` LẪN `default_code`: domain cho phép khớp qua mã SP
  // ("Nb12v100w"), chỉ soi `name` là loại oan chính SP tìm bằng mã.
  const rowsLoc = daNoiRong
    ? rowsFinal
    : locKhopBoDau(tuKhoaTraSp(ten), rowsFinal, (r) => `${r.name ?? ''} ${r.default_code ?? ''}`);

  const sach = rowsLoc.map(locFieldCam);

  // Lọc theo mã model nếu query có mã — chống trả nhầm SP khác dòng.
  //
  // So khớp MỘT CHIỀU nới lỏng (06/08/2026): query viết liền "Nb12v100w" cho
  // ra mã "nb12v100w", còn SP cho ra "12v100w" — so bằng tuyệt đối là loại
  // oan chính SP đúng. Mã query CHỨA mã SP thì nhận ("nb" chỉ là tiền tố dòng
  // hàng). KHÔNG so chiều ngược lại: "p10" không được khớp "p104".
  const maQuery = macModel(ten);
  // MÃ SỐ THUẦN LÀ ĐIỀU KIỆN CỨNG (siết 2 vòng, 22:06→22:4x 12/08):
  //
  // Vòng 1: "260727" nuốt "2607" qua m.includes(s) — số chứa số là trùng hợp
  // số học, đổi sang khớp === . Vòng 2 (đo e2e prod ngay sau): "P10 Full Out
  // 260626" VẪN ra "P10 3 màu LLR 260409" vì luật `some` — mã chữ "p10" khớp
  // là cho qua, số lô 260626 vs 260409 không ai xét. Với người ghi số lô, SỐ
  // là thứ họ phân biệt hàng; khớp mỗi tiền tố dòng ("p10") mà sai số là SAI
  // MẶT HÀNG. Luật chốt: query CÓ mã số thuần → SP phải khớp === ít nhất một
  // số đó; trượt hết thì thà RỖNG — để nhánh gợi-ý-bỏ-số-lô của gom đơn tra
  // lại "P10 Full Out" và đưa đúng dòng hàng (đúng loại, khác lô) ra hỏi.
  const soThuanQuery = maQuery.filter((m) => /^\d+$/.test(m));
  const loc = maQuery.length > 0
    ? sach.filter((r) => {
        const maSp = macModel(`${r.name ?? ''} ${r.default_code ?? ''}`);
        if (soThuanQuery.length > 0 && !soThuanQuery.some((m) => maSp.includes(m))) return false;
        return maQuery.some((m) => maSp.some((sp) =>
          sp === m || (!/^\d+$/.test(sp) && m.includes(sp))));
      })
    : sach;

  // Có mã mà lọc ra rỗng → trả rỗng, KHÔNG rơi về danh sách chưa lọc.
  // Thà nói "không tìm thấy" còn hơn báo giá sai sản phẩm.
  let ketQua = maQuery.length > 0 && loc.length === 0 ? [] : loc;

  // NỚI THEO MÃ MODEL (P1.2, 12/08 — đo 30 ngày prod: gần MỌI ca đơn-từ-ảnh
  // chết ở "không tìm thấy sản phẩm" trong khi hàng CÓ dưới tên khác).
  //
  // Ca thật 19:43: ảnh ghi "QC-LH3B6313T Led hắt 3 bóng 6313 ngoài trời - Màu
  // Trắng", catalog lưu "3 Bóng Saso 6313". Đường AND vỡ (không tên nào có
  // "hắt"+"ngoài"+"trời"...), đường nới-OR thì "3"/"ngoài"/"trời" khớp nửa
  // catalog nên 4 SP Saso 6313 rớt NGOÀI trần limit*4 trước khi lọc mã chạy.
  //
  // Trong catalog LED, MÃ MODEL là thông tin phân biệt nhất (chính lý do có
  // `macModel`). Vậy khi mọi đường trên đã rỗng: tra THẲNG theo từng mã, ưu
  // tiên mã SỐ THUẦN ("6313" — bền nhất qua mọi cách ghi) rồi mã dài. Mỗi mã
  // một query nhỏ, dừng ở mã đầu tiên có kết quả. Kết quả coi là GẦN ĐÚNG
  // (daNoiRong) — đi đường xếp-theo-khớp, và máy gom đơn sẽ HỎI thay vì tự chốt.
  let noiTheoMa = false;
  if (ketQua.length === 0 && maQuery.length > 0) {
    // Query CÓ mã số thuần → CHỈ thử các số đó (cùng luật với lọc mã ở trên):
    // số là thứ người ghi dùng để phân biệt hàng. Số không ra mà mò tiếp theo
    // mã chữ ("p10") là vớ hàng cùng dòng KHÁC LÔ/KHÁC LOẠI — chính ca "P10
    // Full Out 260626" ra "P10 3 màu LLR 260409". Thà rỗng để nhánh bỏ-số-lô
    // của gom đơn gợi đúng dòng hàng.
    const nguon = soThuanQuery.length > 0 ? soThuanQuery : maQuery;
    const thuTuMa = [...nguon].sort((a, b) => {
      const soA = /^\d+$/.test(a) ? 0 : 1;
      const soB = /^\d+$/.test(b) ? 0 : 1;
      return soA - soB || b.length - a.length;
    });
    for (const ma of thuTuMa) {
      const rowsMa = await deps.odoo.searchRead<Record<string, unknown>>(
        'product.product',
        [...domainGoc, '|', ['name', 'ilike', ma], ['default_code', 'ilike', ma]],
        [...ALLOWED_FIELDS],
        { limit: limit * 2 },
      );
      if (rowsMa.length > 0) {
        ketQua = rowsMa.map(locFieldCam);
        daNoiRong = true;
        noiTheoMa = true;
        break;
      }
    }
  }

  // XẾP THEO ĐỘ KHỚP — chỉ khi đã nới sang OR (bug thật 2026-07-30).
  //
  // Nới rộng trả "chứa BẤT KỲ từ nào" và Odoo giữ thứ tự theo id, nên SP khớp
  // đúng 1 từ có thể đứng trên SP khớp 4/5 từ. Ca thật: "led hắt cụm 3 bóng" —
  // chữ "cụm" không có trong tên SP nào nên AND vỡ, nới rộng trả "P10 3 màu"
  // (khớp mỗi "3") lên trước "Led hắt 3 bóng 7 màu" (khớp 4 từ).
  //
  // Chỉ áp cho nhánh nới rộng: nhánh AND thì mọi dòng đã khớp đủ từ, xếp lại
  // chỉ làm mất thứ tự Odoo mà không thêm thông tin gì.
  const tuKhoaKhop = ten.trim().split(/\s+/)
    .filter((t) => t.length >= 2 || laSoDem(t))
    .map(boDau);
  const demKhop = (r: Record<string, unknown>): number => {
    const ten2 = boDau(`${r.name ?? ''} ${r.default_code ?? ''}`);
    return tuKhoaKhop.filter((t) => ten2.includes(t)).length;
  };
  const xepKhop = (() => {
    if (!daNoiRong) return ketQua;
    // RÀO NỚI-OR (16/08, ca "Quạt gió" → 12 SP không chung MỘT chữ nào, bot
    // liệt kê nguồn ATX/mạch 16 kênh/led thanh làm "ứng viên"): kết quả nới
    // phải khớp ÍT NHẤT MỘT từ thật của từ khoá. 0 từ khớp = rác của phép nở
    // biến thể — thà "không thấy + mời tạo mới" còn hơn bắt NV chọn giữa rác.
    const locKhop = ketQua.filter((r) => demKhop(r) >= 1);
    // Sắp ổn định giảm dần theo số từ khớp (Array.sort của V8 là stable).
    return [...locKhop].sort((a, b) => demKhop(b) - demKhop(a));
  })();

  // ƯU TIÊN SP CÓ GIÁ khi chọn ra `limit` kết quả để hiện.
  //
  // Vì sao: 74% catalog trống giá. Nếu cắt theo thứ tự Odoo trả về, rất dễ 3 SP
  // đầu đều trống giá trong khi SP thứ 5 có giá — nhân viên hỏi giá mà bot đưa
  // toàn hàng chưa có giá là vô dụng. Giữ nguyên thứ tự tương đối trong mỗi nhóm.
  //
  // NHÁNH NỚI RỘNG là ngoại lệ: ở đó ĐỘ KHỚP quan trọng hơn giá. SP đúng loại mà
  // trống giá vẫn hữu ích (bot nói "có hàng, để em hỏi giá"), còn SP sai loại có
  // giá thì báo ra là báo sai mặt hàng. Xếp-theo-khớp đã chạy ở trên, giữ nguyên.
  const uuTien = daNoiRong
    ? xepKhop
    : [
        ...xepKhop.filter((r) => Number(r.list_price ?? 0) > NGUONG_GIA_AO),
        ...xepKhop.filter((r) => Number(r.list_price ?? 0) <= NGUONG_GIA_AO),
      ];

  const hienThi = uuTien.slice(0, limit).map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    ma: r.default_code ? String(r.default_code) : null,
    gia: Number(r.list_price ?? 0),
    donVi: tenM2O(r.uom_id),
  }));

  // ═══ KHỚP NGUYÊN VĂN THẮNG TUYỆT ĐỐI (16/08, ca thật 22:02) ═══════════════
  // NV gõ "nguồn DF-12V400W" — ĐÚNG NGUYÊN TÊN một SP — mà máy vẫn bắt chọn
  // giữa DF và XDF, vì "Nguồn 12V400w XDF" cũng chứa "df"+"12v400w" theo kiểu
  // khớp-từ. Anh Quốc: "ủa cái này đúng là DF-12V400W mà nhỉ, còn XDF có
  // giống đâu mà hỏi?". Cùng bài với gui_tai_lieu (17:14 13/08): người đã nêu
  // ĐÍCH DANH thì so nguyên văn sau chuẩn hoá — đúng MỘT SP trùng hệt tên
  // (bỏ đơn vị "(cái)") hoặc chứa nguyên MÃ dài ≥6 → chốt SP đó, khỏi hỏi.
  // Hai SP cùng khớp (catalog có tên trùng thật) → vẫn hỏi như cũ.
  // KHÔNG áp cho đường nới (daNoiRong): kết quả nới là hàng đoán, phải hỏi.
  if (!daNoiRong && hienThi.length > 1) {
    const nguyenVan = (s: string): string =>
      boDau(s).replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
    const q = nguyenVan(ten);
    if (q.length >= 6) {
      const khopHet = hienThi.filter((sp) => {
        const t = nguyenVan(sp.ten);
        const ma = sp.ma ? nguyenVan(sp.ma) : '';
        return t === q || q.endsWith(t) || (ma.length >= 6 && q.includes(ma));
      });
      if (khopHet.length === 1) {
        const mot = [khopHet[0]] as SanPhamList;
        mot.tongKhop = 1;
        mot.ganDung = false;
        mot.daNoiRong = false;
        return mot;
      }
    }
  }

  // Gắn tổng số khớp lên mảng để dinhDangSanPham báo được "còn nữa".
  // KHÔNG cắt im lặng — model không biết bị cắt sẽ tự tin tóm tắt cái không có.
  (hienThi as SanPhamList).tongKhop = xepKhop.length;
  // GẦN ĐÚNG = đã đi đường NỚI-THEO-MÃ — caller (máy gom đơn) sẽ HỎI CHỌN
  // thay vì tự chốt, kể cả 1 kết quả: mã 6313 ra "Saso 6313" là hàng ĐOÁN
  // theo mã, chưa ai xác nhận tên gọi. CHỈ đường theo-mã: nhánh nới-OR cũ
  // (1 kq = chốt) đã sống ổn nhiều tuần, siết nó là regression (test replay
  // 10/08 "led thanh tỏa Lixin" bắt được ngay khi em thử siết cả hai).
  (hienThi as SanPhamList).ganDung = noiTheoMa;
  // Đã đi BẤT KỲ đường nới nào — gom đơn dùng để quyết "lựa chọn của NV có
  // đáng học thành alias không" (học cả từ nới-OR, không chỉ theo-mã).
  (hienThi as SanPhamList).daNoiRong = daNoiRong;
  return hienThi;
}

/** Mảng kết quả có kèm tổng số khớp (để biết còn bị cắt hay không). */
export type SanPhamList = SanPham[] & { tongKhop?: number; ganDung?: boolean; daNoiRong?: boolean };

// VÌ SAO SP *KHÔNG* CÓ LUẬT TỰ CHỐT NHƯ KHÁCH HÀNG (hỏi 21:56 11/08, đã đo).
//
// Anh Quốc: "Áp dụng cho SẢN PHẨM luôn nếu cùng bệnh … nếu 'nguồn NB 12V300W'
// ra 5 kết quả mà có 1 cái khớp nguyên văn thì cũng nên chốt luôn. Tự đánh giá."
//
// Đo trên catalog THẬT (prod 11/08, chạy chính traSanPham):
//   "nguồn NB 12V300W"      -> 1 kết quả  (đã tự chốt sẵn qua nhánh length===1)
//   "nguồn 5v60a không quạt"-> 1 kết quả  (đã tự chốt sẵn)
//   "nguồn NB 12V100W"      -> 1 kết quả  (đã tự chốt sẵn)
//   "led dây cob 24v"       -> 3 kết quả: xanh dương | xanh ngọc | vàng nắng
//   "P10 3 màu"             -> 3 kết quả: P10 3 màu | p10 full out | P10 Ốp Lưng
//
// Kết luận: chính ca anh nêu VỐN ĐÃ chốt luôn — lọc mã model (macModel) đã thu
// về đúng 1 SP. Còn khi SP ra nhiều kết quả thì các "đối thủ" là BIẾN THỂ THẬT
// khác màu/khác đời, không phải rác trùng chữ như bên khách hàng. Tự chốt ở đó
// là giao nhầm màu hàng — hỏng nặng hơn hẳn việc hỏi thêm một câu.
//
// Nói cách khác: SP KHÔNG cùng bệnh với khách hàng. Bệnh bên khách là "AND từng
// từ lôi về người khác hẳn tên"; bên SP, tên là thông số kỹ thuật nên trùng từ
// khoá thường nghĩa là THẬT SỰ cùng dòng hàng, cần người chọn.

export const traSanPhamDefinition: ToolDefinition = {
  name: 'tra_san_pham',
  description:
    'Tra cứu sản phẩm trong hệ thống theo tên hoặc mã. Trả về id, tên đầy đủ, mã, ' +
    'giá bán và đơn vị tính. GỌI KHI: khách hỏi giá, hỏi có bán sản phẩm nào đó không, ' +
    'hoặc trước khi lên đơn (cần id sản phẩm). Đây là nguồn giá DUY NHẤT đúng — ' +
    'không được lấy giá từ tài liệu hay trí nhớ. ' +
    // Model hay tra lần lượt từng SP → tốn thêm vòng lặp, chậm và tốn token.
    'Cần tra NHIỀU sản phẩm thì gọi NHIỀU LẦN TRONG CÙNG MỘT LƯỢT (song song). ' +
    'Không tìm thấy thì thử lại với TỪ KHOÁ NGẮN HƠN (bỏ bớt chữ), đừng lặp y hệt.',
  inputSchema: {
    type: 'object',
    properties: {
      ten: { type: 'string', description: 'Tên hoặc mã sản phẩm khách nói. Vd: "đèn P10", "2835"' },
      gioi_han: { type: 'integer', description: 'Số kết quả tối đa (mặc định 3, tối đa 10)' },
    },
    required: ['ten'],
  },
};

/**
 * Định dạng kết quả cho LLM đọc. Ngắn gọn, không JSON lồng nhau.
 *
 * QUAN TRỌNG — chống "agent nói dối": khi kết quả bị cắt, PHẢI nói rõ còn bao nhiêu.
 * Cắt im lặng là lỗi nguy hiểm nhất của tool: model không có tín hiệu nào nên coi
 * phần nhận được là đầy đủ, rồi trả lời chắc nịch trên dữ liệu thiếu.
 */
export function dinhDangSanPham(list: SanPhamList, tuKhoa?: string): string {
  if (list.length === 0) {
    // Từ khoá TOÀN SỐ ngắn thường là model nhét id sản phẩm vào ô `ten` (bug
    // thật 2026-07-30: bot đã có id=1056 từ lượt trước, vẫn gọi tra_san_pham
    // {ten:"1056"} rồi bối rối khi không thấy gì). Nói thẳng để nó dừng vòng lặp
    // vô nghĩa — id KHÔNG tra ngược được, và cũng không cần tra.
    if (tuKhoa && /^\d{1,6}$/.test(tuKhoa.trim())) {
      return (
        `Không tìm thấy sản phẩm nào tên "${tuKhoa}". ` +
        'LƯU Ý: nếu đây là **id sản phẩm** thì KHÔNG cần tra lại — id đã có rồi, ' +
        'dùng thẳng cho tra_ton_kho / tao_don_nhap. Ô `ten` chỉ nhận TÊN hoặc MÃ, ' +
        'không nhận id.'
      );
    }
    return 'Không tìm thấy sản phẩm nào khớp. Hãy hỏi lại khách tên hoặc mã chính xác hơn.';
  }

  const dong = list
    .map((s) => {
      const ma = s.ma ? ` [${s.ma}]` : '';
      const dv = s.donVi ? `/${s.donVi}` : '';
      // Giá 0 KHÔNG phải giá thật — là dữ liệu chưa nhập. Báo "0đ" cho khách là
      // hứa bán miễn phí. Nói rõ CHƯA CÓ GIÁ để model biết phải chuyển sale.
      //
      // Giá ≤ NGUONG_GIA_AO cũng vậy: DB có 63 SP giá đúng 1đ — placeholder khi
      // nhập liệu, không phải giá bán. Không đánh dấu thì model tưởng bán 1đ thật.
      let gia: string;
      if (s.gia <= 0) gia = 'CHƯA CÓ GIÁ trong hệ thống';
      else if (s.gia <= NGUONG_GIA_AO) gia = `${s.gia}đ — GIÁ TẠM, KHÔNG DÙNG ĐƯỢC`;
      else gia = `${s.gia.toLocaleString('vi-VN')}đ${dv}`;
      return `id=${s.id} | ${s.ten}${ma} | ${gia}`;
    })
    .join('\n');

  // "Có giá" = giá THẬT, không tính placeholder 1đ.
  const coGia = list.filter((s) => s.gia > NGUONG_GIA_AO);
  const thieuGia = list.length - coGia.length;

  // Khi CÓ ít nhất một SP có giá: hướng model dùng SP đó thay vì chuyển sale ngay.
  // 74% catalog hiện chưa nhập giá — chuyển sale mỗi lần là bot vô dụng.
  const canhBao = thieuGia === 0
    ? ''
    : coGia.length > 0
      ? `\nLƯU Ý: ${thieuGia}/${list.length} sản phẩm chưa nhập giá (hiện "CHƯA CÓ GIÁ"). ` +
        'Các SP CÓ giá vẫn dùng bình thường. Chỉ chuyển sale cho SP thiếu giá.'
      // Tất cả thiếu giá: ĐỪNG bỏ cuộc ngay. 74% catalog trống giá, nên rất có thể
      // có SP TƯƠNG TỰ đã nhập giá (vd "COB 24v xanh ngọc" trống nhưng
      // "COB 24V trắng" có giá). Nhân viên cần lựa chọn, không cần lời từ chối.
      // Giục nới rộng nhưng phải CHẶN SỐ LẦN (bug thật 2026-07-30): thiếu câu
      // "chỉ MỘT lần", model tra lại 4 lần cùng ra 1 kết quả trống giá rồi mới
      // chuyển sale — mất 10s và chạm trần vòng lặp, khách nhận im lặng.
      : `\nLƯU Ý: cả ${list.length} sản phẩm tìm được đều chưa nhập giá — KHÔNG báo 0đ. ` +
        'Hãy thử LẠI ĐÚNG MỘT LẦN với từ khoá rộng hơn (bỏ bớt chữ) để tìm sản phẩm ' +
        'tương tự CÓ giá. Nếu lần đó vẫn không ra SP có giá phù hợp thì CHUYỂN SALE NGAY, ' +
        'ĐỪNG tra thêm nữa — tra lặp chỉ làm khách chờ.';

  const tong = list.tongKhop ?? list.length;
  if (tong > list.length) {
    return (
      `Tìm thấy ${tong} sản phẩm, hiển thị ${list.length} đầu tiên:\n${dong}${canhBao}\n` +
      'CÒN NỮA — nếu không thấy đúng SP khách cần, gọi lại với tên/mã cụ thể hơn để thu hẹp.'
    );
  }
  return dong + canhBao;
}
