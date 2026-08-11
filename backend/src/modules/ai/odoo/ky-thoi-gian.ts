// SPDX-License-Identifier: AGPL-3.0-or-later
// ĐỒNG HỒ CỦA HỆ — một chỗ duy nhất biết "hôm nay là ngày nào".
//
// ═══ VÌ SAO FILE NÀY TỒN TẠI (đọc trước khi sửa) ══════════════════════════
// MODEL KHÔNG CÓ ĐỒNG HỒ. Nó chỉ biết những gì nằm trong prompt. Trước file
// này, prompt nhân viên không hề nêu ngày, mà inputSchema của 3 tool báo cáo
// lại MỜI model tự tính ngày ("Bỏ trống = HÔM NAY. 'Hôm qua' → điền ngày hôm
// qua"). Model không biết hôm nay là gì nên điền đại một ngày trông hợp lý,
// và code tin luôn.
//
// HAI CA THẬT CÙNG NGÀY 11/08/2026:
//
//   21:17 (nhóm Test-AI) — NV: "@bot Anh muốn nó báo cáo theo ngày các sản
//   phẩm bán ra hôm nay". Bot: "báo cáo bán ra + tồn kho hôm nay (20/06/2026)
//   đây ạ: Hôm nay bán ra 69 mã sản phẩm...". Anh Quốc: "sao lại 20/6/2026 ???"
//   Lệch gần 2 THÁNG. Cả báo cáo sai kỳ nhưng trình bày y như thật, kèm cả
//   danh sách 7 mã "bất thường" — nhân viên tin số đó đi kiểm kho là mất công
//   vô ích, đúng thứ tool kiểm kho sinh ra để tiết kiệm.
//
//   03:29 CÙNG NGÀY — bot tự thú: "em thấy dữ liệu đơn hàng trả về đang ở kỳ
//   2026-06-20 — không rõ hôm nay là ngày nào". CÙNG MỘT NGÀY BỊA. Model
//   không đoán ngẫu nhiên mà rơi về CÙNG một mốc, nên "chạy lại cho may"
//   không phải cách chữa.
//
// ═══ THIẾT KẾ: MODEL CHỌN TỪ KHOÁ, CODE TÍNH NGÀY ═════════════════════════
// Đây không phải ý tưởng mới trong repo này — `bao_cao_tong_quan` và
// `bao_cao_ban_hang` VỐN ĐÃ làm đúng như vậy (tham số `ky` với enum today/
// yesterday/…, Odoo tự đổi ra ngày). Ba tool hỏng là ba tool ĐI CHỆCH khỏi
// nếp đó vì chúng tự dựng domain Odoo nên phải tự tính ngày. File này mang
// nếp cũ về cho chúng.
//
// ═══ ĐỒNG HỒ LUÔN TIÊM ĐƯỢC ═══════════════════════════════════════════════
// Mọi hàm nhận `bayGio?: Date`. Không có nó thì test phải phụ thuộc ngày chạy
// thật — hôm nay xanh, mai đỏ. Trớ trêu là đó đúng loại lỗi file này chữa.

/** Từ khoá kỳ model được chọn. Model KHÔNG bao giờ phải tự tính ngày. */
export const KY_HOP_LE = ['hom_nay', 'hom_qua', 'tuan_nay', 'thang_nay', 'thang_truoc'] as const;
export type KyTuKhoa = (typeof KY_HOP_LE)[number];

/** Một kỳ đã chốt, hai đầu đều 'YYYY-MM-DD' và đã bao gồm cả hai đầu. */
export interface Ky {
  tu: string;
  den: string;
  /**
   * Kỳ đã bị CODE SỬA vì ngày model gửi vô lý. Nơi gọi PHẢI in ra cho nhân
   * viên thấy — sửa im lặng cũng là một kiểu bịa, chỉ khác là khó phát hiện
   * hơn. `undefined` khi không có gì bất thường.
   */
  canhBao?: string;
}

/**
 * Múi giờ VN cố định +7, KHÔNG có DST (Việt Nam bỏ từ 1975).
 *
 * VÌ SAO KHÔNG DÙNG `toISOString().slice(0,10)` như code cũ: nó trả ngày UTC.
 * Từ 00:00 đến 06:59 giờ VN thì UTC vẫn còn là NGÀY HÔM TRƯỚC — báo cáo "hôm
 * nay" của ca sáng sớm lấy nhầm sang hôm qua, lệch đúng 1 ngày, âm thầm, mỗi
 * ngày một lần. Ca 03:29 ngày 11/08 rơi đúng vào khung giờ này.
 *
 * VÌ SAO KHÔNG DÙNG `Intl` + timeZone: cần cộng/trừ ngày (hôm qua, thứ Hai của
 * tuần, đầu tháng) nên phải có số học. Cộng thẳng 7 giờ rồi đọc phần UTC cho
 * ta một lịch VN "phẳng" làm số học an toàn, không lo DST vì VN không có.
 */
const LECH_VN_MS = 7 * 60 * 60 * 1000;

/** Date → mốc VN "phẳng" (đọc bằng các hàm getUTC*). */
function theoVN(d: Date): Date {
  return new Date(d.getTime() + LECH_VN_MS);
}

/** Mốc VN "phẳng" → 'YYYY-MM-DD'. */
function inNgay(vn: Date): string {
  return vn.toISOString().slice(0, 10);
}

/** Hôm nay theo GIỜ VIỆT NAM, dạng 'YYYY-MM-DD'. */
export function ngayVietNam(bayGio: Date = new Date()): string {
  return inNgay(theoVN(bayGio));
}

/** Cộng/trừ ngày trên lịch VN phẳng. */
function themNgay(vn: Date, n: number): Date {
  return new Date(vn.getTime() + n * 86_400_000);
}

/** 'YYYY-MM-DD' hợp lệ? Ngày rác truyền thẳng vào domain là Odoo ném khó hiểu. */
export function ngayHopLe(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // Chặn cả ngày không tồn tại (2026-02-30): regex đúng dạng nhưng vô nghĩa.
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * TỪ KHOÁ → kỳ ngày thật. Đây là chỗ DUY NHẤT biết "hôm nay", "hôm qua" nghĩa
 * là ngày nào.
 *
 * Tuần bắt đầu THỨ HAI (chuẩn VN), không phải Chủ nhật kiểu Mỹ — nhân viên nói
 * "tuần này" là tính từ thứ Hai.
 */
export function giaiKy(ky: KyTuKhoa, bayGio: Date = new Date()): { tu: string; den: string } {
  const vn = theoVN(bayGio);
  const homNay = inNgay(vn);

  switch (ky) {
    case 'hom_nay':
      return { tu: homNay, den: homNay };

    case 'hom_qua': {
      // Kỳ đúng MỘT ngày: "hôm qua bán gì" mà trả cả hôm nay là sai tập mã.
      const q = inNgay(themNgay(vn, -1));
      return { tu: q, den: q };
    }

    case 'tuan_nay': {
      // getUTCDay: 0=CN, 1=T2… Chủ nhật phải lùi 6 ngày về thứ Hai TRƯỚC đó,
      // không phải lùi 0 (nếu không thì "tuần này" hỏi vào Chủ nhật chỉ ra
      // đúng một ngày Chủ nhật).
      const thu = vn.getUTCDay();
      const luiVeThuHai = thu === 0 ? 6 : thu - 1;
      return { tu: inNgay(themNgay(vn, -luiVeThuHai)), den: homNay };
    }

    case 'thang_nay':
      return { tu: `${homNay.slice(0, 7)}-01`, den: homNay };

    case 'thang_truoc': {
      // Kỳ ĐÃ ĐÓNG → phải hết ngày cuối tháng, không cắt ở hôm nay.
      // Ngày 0 của tháng này = ngày cuối tháng trước; Date tự lo tháng 2 năm
      // nhuận và bắc qua năm, không cần bảng số ngày viết tay.
      const cuoiThangTruoc = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 0));
      const den = inNgay(cuoiThangTruoc);
      return { tu: `${den.slice(0, 7)}-01`, den };
    }
  }
}

/**
 * Ngày model gửi có xa đến mức chắc chắn là bịa không?
 *
 * NGƯỠNG và VÌ SAO:
 *   · TƯƠNG LAI — dữ liệu bán hàng của ngày chưa tới KHÔNG THỂ tồn tại. Không
 *     phải "đáng ngờ" mà chắc chắn sai.
 *   · QUÁ 1 NĂM về trước — shop mở đơn hằng ngày; câu hỏi kiểm kho thường
 *     ngày mà nhảy về hơn 1 năm trước gần như chắc chắn là model bịa.
 *
 * VÌ SAO 1 NĂM CHỨ KHÔNG CHẶT HƠN: "doanh thu năm ngoái", "cùng kỳ năm trước"
 * là câu hỏi THẬT và hợp lệ. Ngưỡng chặt (vd 3 tháng) sẽ chặn nhầm việc đúng —
 * và một hàng rào hay chặn nhầm thì người ta sẽ gỡ nó đi.
 *
 * LƯU Ý QUAN TRỌNG: ngày bịa của ca thật (20/06/2026) chỉ cách hôm nay ~52
 * ngày nên luật này KHÔNG bắt được nó. Đó là lý do lớp `ky` (từ khoá) mới là
 * hàng rào chính; luật này chỉ là lưới vét những ca lệch thô bạo.
 */
const NGUONG_QUA_KHU_MS = 366 * 86_400_000;

function voLy(ngay: string, bayGio: Date): string | null {
  const moc = new Date(`${ngay}T00:00:00Z`).getTime();
  const homNay = new Date(`${ngayVietNam(bayGio)}T00:00:00Z`).getTime();
  if (moc > homNay) return `ngày ${ngay} nằm ở TƯƠNG LAI`;
  if (homNay - moc > NGUONG_QUA_KHU_MS) return `ngày ${ngay} cách hôm nay hơn 1 năm`;
  return null;
}

export interface DauVaoKy {
  /** Từ khoá kỳ — ĐƯỜNG ĐI ĐÚNG khi nhân viên nói "hôm nay/hôm qua/tuần này". */
  ky?: string;
  /** Chỉ dùng khi nhân viên NÊU NGÀY CỤ THỂ ("từ 1/8 đến 5/8"). */
  tu_ngay?: string;
  den_ngay?: string;
}

/**
 * CHỐT KỲ CUỐI CÙNG — hàng rào thật, đứng giữa model và Odoo.
 *
 * THỨ TỰ ƯU TIÊN (và vì sao):
 *   1. `ky` từ khoá THẮNG TUYỆT ĐỐI, kể cả khi model điền kèm tu_ngay/den_ngay.
 *      Đây chính là vá cho ca 21:17: model nói "hom_nay" nhưng điền kèm
 *      2026-06-20 thì ta tin TỪ KHOÁ, vì từ khoá là thứ model suy từ lời nhân
 *      viên (đáng tin), còn ngày là thứ model tự nhẩm (không có đồng hồ, không
 *      đáng tin).
 *   2. Ngày cụ thể — chỉ khi KHÔNG có từ khoá. Nhân viên nói "từ 1/8 đến 5/8"
 *      thì phải tôn trọng, ép về hôm nay là trả lời câu khác.
 *   3. Không có gì → `macDinh` (mỗi tool tự quyết cái gì hợp lý cho nó).
 *
 * Ngày cụ thể còn phải qua cửa `voLy`. Trả `canhBao` chứ KHÔNG ném lỗi: nhân
 * viên đang cần số, chặn đứng câu hỏi vì model điền sai là phạt nhầm người.
 */
export function chonKy(
  dauVao: DauVaoKy,
  bayGio: Date = new Date(),
  macDinh: KyTuKhoa = 'hom_nay',
): Ky {
  // ── 1. TỪ KHOÁ THẮNG ────────────────────────────────────────────────────
  if ((KY_HOP_LE as readonly string[]).includes(dauVao.ky ?? '')) {
    return giaiKy(dauVao.ky as KyTuKhoa, bayGio);
  }

  // TỪ KHOÁ LẠ ("quy_nay", "last_month"…) → model ĐANG NÓI VỀ MỘT KỲ TƯƠNG
  // ĐỐI mà ta chưa hỗ trợ. Ngày nó điền kèm lúc này là ngày nó TỰ NHẨM ra cho
  // kỳ đó — tức là đúng loại số bịa của ca 21:17. Rơi về mặc định, đừng dùng.
  if ((dauVao.ky ?? '') !== '') return giaiKy(macDinh, bayGio);

  const coTu = ngayHopLe(dauVao.tu_ngay);
  const coDen = ngayHopLe(dauVao.den_ngay);

  // ── 3. Không từ khoá, không ngày (hoặc ngày rác) → mặc định của tool ─────
  // `ky` lạ ("quy_nay") cũng rơi vào đây: thà chạy kỳ mặc định rõ ràng còn hơn
  // tin một chuỗi không ai định nghĩa.
  if (!coTu && !coDen) return giaiKy(macDinh, bayGio);

  // ── 2. NGÀY CỤ THỂ nhân viên nêu ────────────────────────────────────────
  // Thiếu một đầu → kỳ đúng MỘT ngày đầu kia. "hôm 5/8 bán gì" mà kéo tới hôm
  // nay là giao cho kho sai tập mã.
  let tu = coTu ? dauVao.tu_ngay! : dauVao.den_ngay!;
  let den = coDen ? dauVao.den_ngay! : dauVao.tu_ngay!;

  // Model điền ngược (tu > den) → đảo lại. Odoo sẽ trả kỳ RỖNG chứ không báo
  // lỗi, và "0 mã bán ra" trông y hệt một ngày ế thật — im lặng sai.
  if (tu > den) [tu, den] = [den, tu];

  const lyDo = voLy(tu, bayGio) ?? voLy(den, bayGio);
  if (lyDo) {
    const kyAnToan = giaiKy(macDinh, bayGio);
    return {
      ...kyAnToan,
      canhBao:
        `Kỳ máy đề xuất không hợp lệ (${lyDo}) nên đã tự sửa về kỳ ${kyAnToan.tu === kyAnToan.den ? kyAnToan.tu : `${kyAnToan.tu} – ${kyAnToan.den}`}. ` +
        'Nếu anh/chị cần đúng kỳ khác, nói rõ ngày giúp em.',
    };
  }

  return { tu, den };
}

/** Tên thứ tiếng Việt. getUTCDay trên lịch VN phẳng: 0=CN. */
const THU = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/**
 * Dòng ngày nhét vào system prompt.
 *
 * CHỈ CÓ NGÀY, KHÔNG CÓ GIỜ/PHÚT — đây là quyết định về CHI PHÍ, không phải
 * thẩm mỹ. Prompt được cache theo NỘI DUNG: prefix giống hệt lần trước thì đọc
 * lại rẻ (~0,25× giá token thường). Nhét giờ/phút vào là mỗi lượt một prefix
 * khác nhau → cache miss 100% → toàn bộ prompt tĩnh (~3,4k ký tự) bị tính giá
 * đầy đủ ở MỌI lượt, đắt gấp ~4 lần.
 *
 * Chỉ để ngày thì prefix đổi đúng 1 lần/24h: lượt đầu tiên sau nửa đêm chịu
 * một lần miss (như mọi lần deploy đổi prompt), phần còn lại của ngày hit như
 * cũ. Chi phí tăng thêm coi như bằng 0.
 *
 * Giờ/phút cũng KHÔNG có giá trị nghiệp vụ ở đây: mọi báo cáo đều tính theo
 * NGÀY, không tool nào cần biết bây giờ là 21:17 hay 09:00.
 */
export function dongNgayHomNay(bayGio: Date = new Date()): string {
  const vn = theoVN(bayGio);
  const [y, m, d] = inNgay(vn).split('-');
  return `Hôm nay là ${THU[vn.getUTCDay()]}, ${d}/${m}/${y} (giờ Việt Nam).`;
}

/**
 * Mô tả dùng chung cho tham số `ky` trong inputSchema của các tool báo cáo.
 *
 * Một chỗ sửa, mọi tool theo — trước đây mỗi tool tự viết một kiểu và ĐÃ lệch
 * nhau (`bao_cao_ban_ton` nói "Bỏ trống = HÔM NAY", `top_san_pham` nói "Bỏ
 * trống = 30 ngày trước"), làm model đoán sai giữa các tool.
 */
export const MO_TA_KY =
  'Kỳ báo cáo. DÙNG THAM SỐ NÀY khi nhân viên nói "hôm nay", "hôm qua", ' +
  '"tuần này", "tháng này", "tháng trước" — bạn KHÔNG biết hôm nay là ngày nào, ' +
  'hệ thống sẽ tự tính. TUYỆT ĐỐI đừng tự nhẩm ngày rồi điền tu_ngay.';

/** Mô tả dùng chung cho `tu_ngay`. */
export const MO_TA_TU_NGAY =
  'YYYY-MM-DD. CHỈ dùng khi nhân viên NÊU NGÀY CỤ THỂ ("từ 1/8 đến 5/8", "ngày 20/7"). ' +
  'Nhân viên nói "hôm nay/hôm qua/tuần này" thì dùng `ky`, KHÔNG điền ô này.';

/** Mô tả dùng chung cho `den_ngay`. */
export const MO_TA_DEN_NGAY =
  'YYYY-MM-DD. Chỉ điền khi nhân viên nêu khoảng "từ ngày… đến ngày…". ' +
  'Bỏ trống mà có tu_ngay thì kỳ đúng MỘT ngày tu_ngay.';
