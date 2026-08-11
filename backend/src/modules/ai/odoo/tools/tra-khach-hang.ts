// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: tìm khách hàng trong Odoo theo số điện thoại.
//
// Vấn đề đã khảo sát: `phone` trong res.partner KHÔNG chuẩn hoá, KHÔNG unique.
// Không có module phone_validation, không có index unique. Nghĩa là cùng một
// người có thể nằm dưới "0912345678", "+84912345678", "0912 345 678".
// Ta phải tự thử nhiều dạng.
//
// QUY TẮC TUYỆT ĐỐI: tool này KHÔNG BAO GIỜ tạo res.partner mới.
// Không tìm thấy → chuyển sale. Khách trùng lặp là rác dữ liệu vĩnh viễn, và
// đối chiếu công nợ về sau sẽ sai. Thà để người xử lý 30 giây còn hơn tạo rác.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { normalizeVnPhone } from '../../../../shared/phone/normalize-vn-phone.js';
import {
  locKhopBoDau, coDauTiengViet, boDau, traiDeuBienTheDau, dieuKienBienTheDauCum,
} from '../tim-khong-dau.js';

export interface KhachHang {
  id: number;
  ten: string;
  ma: string | null;      // ref — mã KH, vd KH00001 (đây mới là khoá unique thật)
  dienThoai: string | null;
  congNo: number;         // số khách đang nợ mình
}

export type KetQuaTimKhach =
  | { trangThai: 'tim_thay'; khach: KhachHang }
  | { trangThai: 'khong_thay'; sdtDaTra: string[] }
  | {
      trangThai: 'nhieu_ket_qua';
      danhSach: KhachHang[];
      /**
       * Danh sách CHẠM TRẦN — ngoài kia còn khách trùng nữa không hiển thị.
       * Bug thật 16:15 11/08: tra "Long" ra đúng 10 người, "Anh Long Led" nằm
       * ngoài trang đầu, không dấu hiệu gì → nhân viên tưởng 10 người là tất cả.
       * Cắt im lặng là cắt nói dối — phải nói rõ để người/model thu hẹp từ khoá.
       */
      conNua?: boolean;
      /**
       * Ứng viên KHỚP GẦN NGUYÊN VĂN và áp đảo hẳn phần còn lại — caller được
       * phép tự chốt người này thay vì bắt nhân viên chọn. Xem xepHangKhach().
       * Không có ai áp đảo → vắng mặt, caller PHẢI hỏi.
       */
      tuChot?: KhachHang;
    };

export interface TraKhachHangDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/**
 * Sinh các biến thể SĐT để tra Odoo.
 *
 * Vì DB lưu tự do nên phải thử: local (0912…), E164 (+84912…), và dạng 84912…
 * Trả về mảng đã khử trùng lặp.
 */
export function bienTheSdt(raw: string): string[] {
  const kq = normalizeVnPhone(raw);
  if (!kq.valid || !kq.phoneE164) {
    // Không parse được → vẫn thử nguyên văn, biết đâu DB lưu đúng như vậy.
    const s = raw.trim();
    return s ? [s] : [];
  }
  const e164 = kq.phoneE164;              // +84912345678
  const local = kq.phoneLocal ?? '';      // 0912345678
  const khongCong = e164.replace(/^\+/, ''); // 84912345678
  return [...new Set([local, e164, khongCong].filter(Boolean))];
}

/**
 * Tìm khách theo SĐT. Chỉ ĐỌC.
 *
 * Ba kết quả có thể:
 *  - tim_thay      → 1 khách duy nhất, dùng được
 *  - khong_thay    → model phải chuyển sale, KHÔNG được tự tạo
 *  - nhieu_ket_qua → dữ liệu trùng, người phải chọn
 */
/** Chuỗi trông như MÃ KH (ref): chữ cái + số, vd KH001017, KH002359AC. */
export function laMaKh(s: string): boolean {
  return /^[A-Za-z]{1,4}\d{3,}[A-Za-z]*$/.test(s.trim());
}

/**
 * Xưng hô đứng ĐẦU tên — bỏ ở CẢ HAI VẾ trước khi so.
 *
 * Nhân viên gõ "a Long led", DB lưu "Anh Long Led": khác nhau đúng một chữ
 * xưng hô. Không bỏ thì hai chuỗi này không bao giờ bằng nhau và luật "khớp
 * nguyên văn" thành vô dụng ngay ở ca chính anh Quốc nêu.
 */
const XUNG_HO = /^(a|anh|c|chi|em|bac|co|chu|ong|ba|mr|ms)\s+/;

/**
 * Chuẩn hoá để SO TÊN: bỏ dấu, bỏ ký tự phân cách, gộp khoảng trắng, bỏ xưng hô.
 *
 * Bỏ ký tự phân cách là bắt buộc: tên Odoo đầy "-", "." xen giữa
 * ("Anh Thức- Nam ĐỊnh", "A Long. Thị xã kỳ anh") mà nhân viên không gõ.
 */
function chuanHoaTen(s: string): string {
  let t = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Lặp: "a anh Long" (nhân viên gõ thừa) cũng phải sạch.
  while (XUNG_HO.test(t)) t = t.replace(XUNG_HO, '');
  return t.trim();
}

/**
 * Điểm KHỚP GẦN NGUYÊN VĂN giữa câu nhân viên gõ và tên trong DB.
 *
 * Thang đo (đo trên dữ liệu prod 11/08, xem tests/ai/odoo/xep-hang-khach.test.ts):
 *   100 — trùng khớp hoàn toàn   ("a Long led" ~ "Anh Long Led")
 *    80 — tên BẮT ĐẦU bằng cụm   ("anh Thức" → "Anh Thức CNC")
 *    60 — tên CHỨA nguyên cụm    (cụm nằm trọn giữa tên)
 *     0 — chỉ trùng từ rời rạc   ("Led Kim Long" với "long led")
 *
 * Điểm 0 cho từ rời rạc là CÓ CHỦ Ý: đó chính là thứ mà tra-theo-AND-từng-từ
 * lôi về ("long" AND "led" khớp cả "Led Hoàng Long"), và cũng chính là 7 kết
 * quả rác mà anh Quốc phàn nàn.
 */
export function diemKhopTen(hoi: string, ten: string): number {
  const h = chuanHoaTen(hoi);
  const t = chuanHoaTen(ten);
  if (!h || !t) return 0;
  if (h === t) return 100;
  if (t.startsWith(`${h} `)) return 80;
  if (t.includes(` ${h} `) || t.endsWith(` ${h}`)) return 60;
  return 0;
}

/**
 * Tên có giữ ĐÚNG THỨ TỰ mọi từ khoá của câu hỏi không (cho phép chèn chữ giữa)?
 *
 * ĐÂY LÀ HÀNG RÀO CHỐNG CHỐT NHẦM KHÁCH — phần quan trọng nhất của file này.
 *
 * Ca thật đêm 11/08: anh Quốc gõ "Cảnh tam kỳ", có hai người
 *   - "Anh Cảnh Tam Kỳ"              (KH000202)      → điểm 100
 *   - "Anh Cảnh - Led Việt - Tam Kỳ" (KH003067ACDL)  → điểm 0
 * và anh chọn NGƯỜI ĐIỂM 0. Chốt theo điểm thuần là lên đơn sai người — đúng
 * họ lỗi đã làm phải huỷ đơn S13814 ngày 07/08.
 *
 * Vì sao "đủ từ" KHÔNG đủ làm hàng rào (đã đo, bị loại): cả 8 người ca
 * "a Long led" đều chứa đủ cả "long" lẫn "led" → hàng rào đó chặn luôn ca
 * ĐÚNG. Vì sao "đếm chữ lạ" cũng KHÔNG đủ: "Led Kim Long" thừa 1 chữ, còn
 * "Anh Cảnh - Led Việt - Tam Kỳ" thừa 2 — hai ca ngược nhau lại cùng thang đo.
 *
 * THỨ TỰ mới là thứ tách được chúng: "Anh Cảnh - Led Việt - Tam Kỳ" giữ nguyên
 * cảnh→tam→kỳ nên vẫn là "cùng một kiểu tên, thêm phần bổ nghĩa" — đáng ngờ.
 * Còn "Led Kim Long" đảo thành led→long, "Led Hoàng Long" cũng vậy: đó là tên
 * KHÁC HẲN chỉ tình cờ dùng lại mấy chữ đó.
 */
function giuThuTuTu(hoi: string, ten: string): boolean {
  const tuHoi = chuanHoaTen(hoi).split(' ').filter((t) => t.length >= 2);
  const tuTen = chuanHoaTen(ten).split(' ').filter((t) => t.length >= 2);
  if (tuHoi.length === 0) return false;
  let i = 0;
  for (const w of tuTen) if (i < tuHoi.length && w === tuHoi[i]) i++;
  return i === tuHoi.length;
}

/** Ngưỡng điểm tối thiểu để được xét tự chốt — dưới mức này là khớp quá lỏng. */
const NGUONG_TU_CHOT = 60;

/**
 * Xếp danh sách khách theo độ khớp gần nguyên văn, và nói rõ có được TỰ CHỐT không.
 *
 * LUẬT TỰ CHỐT (hai điều kiện, phải đủ CẢ HAI):
 *   1. Hạng nhất đạt ≥ 60 điểm — tức tên chứa nguyên cụm nhân viên gõ.
 *   2. KHÔNG còn ứng viên nào khác "cùng kiểu tên": không ai cùng điểm hạng
 *      nhất, và không ai giữ đúng thứ tự từ khoá (xem giuThuTuTu).
 *
 * ĐO THẬT trên Odoo prod 11/08 (500 khách, chạy chính hàm này):
 *   271 lượt vốn đã ra 1 kết quả — không đụng tới
 *    16 lượt TỰ CHỐT — đúng cả 16, KHÔNG có lượt nào chốt nhầm người
 *   213 lượt VẪN HỎI — giữ nguyên hành vi cũ
 * Thà bắt chọn thừa còn hơn lên đơn sai người.
 */
export function xepHangKhach(
  tuKhoa: string,
  danhSach: KhachHang[],
): { danhSach: KhachHang[]; tuChot: KhachHang | null } {
  if (danhSach.length === 0) return { danhSach, tuChot: null };

  const cham = danhSach.map((k) => ({ k, diem: diemKhopTen(tuKhoa, k.ten) }));
  // Sắp ổn định giảm dần theo điểm (Array.sort của V8 stable) — giữ thứ tự
  // Odoo trong nhóm cùng điểm, không xáo trộn vô cớ.
  const xep = [...cham].sort((a, b) => b.diem - a.diem);
  const dsXep = xep.map((x) => x.k);

  const nhat = xep[0];
  if (!nhat || nhat.diem < NGUONG_TU_CHOT) return { danhSach: dsXep, tuChot: null };

  // Còn ai "cùng kiểu tên" thì im lặng mà hỏi — xem giuThuTuTu, ca "Cảnh tam kỳ".
  const doiThu = xep
    .slice(1)
    .some((x) => x.diem === nhat.diem || giuThuTuTu(tuKhoa, x.k.ten));

  return { danhSach: dsXep, tuChot: doiThu ? null : nhat.k };
}

export async function traKhachHang(
  deps: TraKhachHangDeps,
  input: { sdt?: string; ten?: string; ma?: string },
): Promise<KetQuaTimKhach> {
  const sdt = (input.sdt ?? '').trim();
  const ten = (input.ten ?? '').trim();
  let ma = (input.ma ?? '').trim();

  // Nhân viên hay gõ mã KH vào ô tên/sdt (vd "KH001017"). Tự nhận và chuyển sang
  // tra theo ref — ref là KHOÁ UNIQUE THẬT nên khớp là ra đúng 1 người, hết lặp.
  if (!ma && sdt && laMaKh(sdt) && !normalizeVnPhone(sdt).valid) ma = sdt;
  if (!ma && ten && laMaKh(ten)) ma = ten;

  // Không có gì để tra.
  if (!sdt && !ten && !ma) return { trangThai: 'khong_thay', sdtDaTra: [] };

  let dieuKien: unknown[];
  let bienThe: string[] = [];

  if (ma) {
    // TRA THEO MÃ KH (ref) — khoá unique, ưu tiên cao nhất. =ilike để không phân biệt hoa/thường.
    dieuKien = [['ref', '=ilike', ma]];
  } else if (sdt) {
    bienThe = bienTheSdt(sdt);
    if (bienThe.length === 0) return { trangThai: 'khong_thay', sdtDaTra: [] };
    // phone in [...] OR mobile in [...]
    dieuKien = ['|', ['phone', 'in', bienThe], ['mobile', 'in', bienThe]];
  } else {
    // TRA THEO TÊN — tách từ khoá, mỗi từ một điều kiện AND.
    // Cùng lý do như tra_san_pham: "qc hoàng sơn" phải khớp được cả khi tên
    // trong DB có thêm chữ ở giữa. Nhân viên gõ tên gần đúng là chuyện bình thường.
    //
    // TRA THEO BIẾN THỂ DẤU THẬT (sửa vòng 3, 12/08) — không dùng mẫu `_` nữa.
    //
    // `ilike` của Postgres prod KHÔNG bỏ dấu, nên gõ không dấu là trượt sạch
    // (đo 11/08: ['name','ilike','Thuc'] -> 0 kq trong khi 'Thức' -> 3 kq).
    // Bản vá 11/08 dùng mẫu `_`; đo prod 12/08 cho thấy nó hỏng ở ca "van":
    //
    //   ilike 'v_n'    -> 60 dòng, 0 người tên "Vấn"   ← anh Vấn NGOÀI trần
    //   ilike 'vấn'    -> 1 dòng,  đúng anh Vấn
    //
    // `v_n` khớp hàng trăm người nên Odoo cắt ở trần ta xin và anh Vấn rớt
    // ngoài — chưa từng được lấy về thì xếp hạng kiểu gì cũng không thấy.
    // dieuKienBienTheDau() tra OR trên từng biến thể dấu THẬT ("vấn" là một
    // nhánh riêng), nên mỗi biến thể chắc chắn được xét. Xem tim-khong-dau.ts.
    dieuKien = dieuKienBienTheDauCum('name', ten);
  }

  // Xin TRẦN + 1: phần tử thứ 11 không hiển thị, chỉ để BIẾT danh sách bị cắt.
  const TRAN = 10;
  // TRA THEO TÊN thì XIN DƯ (gấp 5) vì còn phải LỌC BỎ DẤU ở JS ngay dưới.
  // Ca 01:12 12/08: mẫu "v_n" trả 10 người Văn/Vạn/Vân trước rồi mới tới "Anh
  // Vấn Đà Nẵng" — chỉ xin 11 dòng là người đúng nằm ngoài, lọc xong còn 0 và
  // ta lại phải nhả nguyên 10 dòng rác ra cho nhân viên. Xin dư thì phần rác
  // bị lọc còn chỗ cho người đúng lọt vào. Nhánh mã KH/SĐT không cần: khoá
  // chính xác, không có rác để lọc.
  const traTheoTen = Boolean(ten && !ma && !sdt);
  const FIELDS = ['id', 'name', 'ref', 'phone', 'mobile', 'incokit_receivable_balance'];
  const soDong = traTheoTen ? (TRAN + 1) * 5 : TRAN + 1;
  let rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner',
    ['&', ['customer_rank', '>', 0], ...dieuKien],
    FIELDS,
    { limit: soDong },
  );

  // DỰ PHÒNG cho chiều NGƯỢC LẠI: gõ CÓ DẤU nhưng DB lưu KHÔNG DẤU.
  //
  // Luật mới tôn trọng dấu nên "Nguồn" đi xuống DB nguyên văn — trúng nếu DB
  // cũng lưu có dấu. Nhưng dữ liệu prod lẫn lộn: có bản ghi gõ vội không dấu
  // ("Anh Thuc Nam Dinh"). Ca đó tra nguyên văn ra 0 dòng, và im lặng trả
  // "không tìm thấy" khi DB CÓ người là đúng bug 23:15 11/08 mà bản vá
  // không-dấu sinh ra để chữa — không được để nó quay lại từ cửa sau.
  //
  // Chỉ chạy khi đã RỖNG SẠCH nên không nới bừa: có kết quả đúng dấu thì
  // không bao giờ tới đây.
  // `tenLoc` là từ khoá dùng cho tầng lọc JS: bình thường bằng chính `ten`,
  // nhưng sau khi rơi vào dự phòng thì phải HẠ VỀ BỎ DẤU — lọc bằng "Nguồn"
  // có dấu sẽ cắt sạch đúng những dòng "Nguon" mà dự phòng vừa tìm được.
  let tenLoc = ten;
  if (traTheoTen && rows.length === 0 && coDauTiengViet(ten)) {
    tenLoc = boDau(ten);
    const dieuKienNoi = dieuKienBienTheDauCum('name', tenLoc);
    rows = await deps.odoo.searchRead<Record<string, unknown>>(
      'res.partner',
      ['&', ['customer_rank', '>', 0], ...dieuKienNoi],
      FIELDS,
      { limit: soDong },
    );
  }
  // LỌC LẠI Ở ĐÂY khi tra theo TÊN (sửa 12/08, ca 01:12 "anh Vấn").
  //
  // Mẫu `_` ở tầng DB khớp ký tự BẤT KỲ nên "van" → "v_n" lôi về cả "Vinh",
  // "Vốn" — không chữ nào là biến thể dấu của "van". Ca thật: tra "Vấn" ra 10
  // người (Văn, Vạn, Vân, Nguyễn Văn Đại, Phan Văn Trị...) trong khi Odoo có
  // ĐÚNG 1 "Anh Vấn Đà Nẵng [KH000027]". locKhopBoDau so bỏ dấu ĐÚNG chữ.
  //
  // Lọc TRƯỚC khi cắt trần: cắt trước thì 10 dòng rác chiếm hết chỗ và người
  // đúng — vốn nằm ở dòng thứ 11 — bị vứt đi trước khi kịp được xét.
  const rowsLoc = traTheoTen
    ? locKhopBoDau(tenLoc, rows, (r) => String(r.name ?? ''))
    : rows;
  const conNua = rowsLoc.length > TRAN;

  const tatCa: KhachHang[] = rowsLoc.map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    ma: r.ref ? String(r.ref) : null,
    dienThoai: (r.phone ? String(r.phone) : null) ?? (r.mobile ? String(r.mobile) : null),
    congNo: Number(r.incokit_receivable_balance ?? 0),
  }));

  if (tatCa.length === 0) return { trangThai: 'khong_thay', sdtDaTra: bienThe };
  if (tatCa.length === 1) return { trangThai: 'tim_thay', khach: tatCa[0] };

  // XẾP HẠNG khi tra THEO TÊN (yêu cầu anh Quốc 21:56 11/08).
  //
  // Tra theo tên dùng AND từng từ rời nên "long" AND "led" lôi về cả "Led Kim
  // Long" — 8 kết quả mà chỉ 1 là người cần. Xếp hạng đẩy người khớp gần
  // nguyên văn lên đầu; áp đảo hẳn thì báo `tuChot` để caller khỏi bắt chọn.
  //
  // XẾP TRƯỚC RỒI MỚI CẮT (sửa vòng 2, 12/08) — ĐÂY LÀ THỨ TỰ SỐNG CÒN.
  //
  // Đo prod sau vòng 1: tra "van" ra 10 kq + conNua:true nhưng TOÀN Văn/Vạn/Vân,
  // KHÔNG có "Anh Vấn Đà Nẵng". Cờ conNua báo đúng nên hệ thống không nói dối,
  // nhưng người nhân viên cần lại không thấy — với họ vẫn là hỏng.
  //
  // Gốc rễ: trước đây `slice(0, TRAN)` chạy TRƯỚC xepHangKhach. Odoo trả theo
  // thứ tự chữ cái nên 10 dòng đầu toàn "Văn"/"Vạn", còn anh Vấn nằm dòng ~11+
  // trong 55 dòng đã xin về — bị vứt TRƯỚC khi kịp được chấm điểm. Xếp hạng
  // trên phần rác đã cắt thì có xếp cũng vô ích.
  //
  // Nay chấm điểm trên TOÀN BỘ số dòng xin được rồi mới cắt 10 dòng đầu THEO
  // ĐIỂM. Rẻ hơn hẳn việc nâng trần: vẫn 55 dòng như cũ, chỉ đổi thứ tự việc.
  //
  // CHỈ áp cho nhánh TÊN: nhánh mã KH/SĐT vốn đã là khoá chính xác, còn danh
  // sách chạm trần (conNua) thì người đúng có thể đang nằm NGOÀI cả 55 dòng —
  // tự chốt trên dữ liệu thiếu là chốt liều (bug 16:15 11/08 "Anh Long Led").
  if (traTheoTen) {
    const xep = xepHangKhach(ten, tatCa);
    // TRẢI ĐỀU BIẾN THỂ DẤU trước khi cắt — bước cuối của bản vá CA 2.
    //
    // Xếp-trước-cắt-sau vẫn chưa đủ: diemKhopTen() so BỎ DẤU nên "Văn" và "Vấn"
    // cùng khớp "van" với ĐIỂM BẰNG NHAU (đo: cả hai 80). Sắp ổn định giữ thứ
    // tự Odoo, mà "Văn" đông hơn hẳn nên vẫn chiếm sạch 10 chỗ và anh Vấn vẫn
    // rớt. Không thang điểm nào tách được, vì người gõ "van" thật sự CHƯA NÓI
    // họ muốn chữ nào — nên cho mỗi biến thể một suất thay vì đoán hộ.
    const traiDeu = traiDeuBienTheDau(tenLoc, xep.danhSach, (k) => k.ten);
    const hienThi = traiDeu.slice(0, TRAN);
    return {
      trangThai: 'nhieu_ket_qua',
      danhSach: hienThi,
      ...(conNua ? { conNua } : {}),
      // `tuChot` phải là người CÒN NẰM TRONG danh sách hiện ra: chốt một người
      // mà nhân viên không nhìn thấy thì họ không kiểm được là bot lấy đúng ai.
      ...(xep.tuChot && !conNua && hienThi.some((k) => k.id === xep.tuChot!.id)
        ? { tuChot: xep.tuChot }
        : {}),
    };
  }

  return { trangThai: 'nhieu_ket_qua', danhSach: tatCa.slice(0, TRAN), ...(conNua ? { conNua } : {}) };
}



export const traKhachHangDefinition: ToolDefinition = {
  name: 'tra_khach_hang',
  description:
    'Tìm khách hàng trong hệ thống theo MÃ KH, SỐ ĐIỆN THOẠI hoặc TÊN. Trả về id, tên, mã KH. ' +
    'KHÔNG trả số công nợ — hỏi "khách X nợ bao nhiêu" thì PHẢI gọi xuat_cong_no. ' +
    'GỌI KHI: cần lên đơn cho khách, hoặc cần biết khách đã có trong hệ thống chưa. ' +
    'ƯU TIÊN: có MÃ KH (dạng KH001017, hiện trong [ngoặc] ở danh sách) thì dùng `ma` — ra đúng 1 người. ' +
    'Có SĐT thì dùng sdt; chỉ biết tên thì dùng ten. ' +
    'LƯU Ý: tool này CHỈ TRA, không tạo khách mới. Nếu không tìm thấy, phải chuyển sale ' +
    'để người tạo khách — tuyệt đối không tự bịa id khách.',
  inputSchema: {
    type: 'object',
    properties: {
      ma: { type: 'string', description: 'Mã KH (ref), vd "KH001017". Khoá chính xác nhất — có thì ưu tiên dùng.' },
      sdt: { type: 'string', description: 'Số điện thoại khách, dạng nào cũng được (0912…, +84912…)' },
      ten: { type: 'string', description: 'Tên khách, gõ gần đúng cũng được. Vd "hoàng sơn", "chị Lan"' },
    },
    // Không required: phải có ÍT NHẤT MỘT trong ba, kiểm ở code.
  },
};

/**
 * Định dạng cho LLM.
 * Với 2 nhánh không-dùng-được, câu chữ phải NÓI RÕ phải làm gì tiếp — model đọc
 * hướng dẫn trong tool result tốt hơn nhiều so với đọc quy tắc trong system prompt.
 */
export function dinhDangKhachHang(kq: KetQuaTimKhach): string {
  if (kq.trangThai === 'khong_thay') {
    const daThu = kq.sdtDaTra.length > 0
      ? `SĐT đã thử: ${kq.sdtDaTra.join(', ')}`
      : 'đã tra theo tên';
    return (
      `Không tìm thấy khách (${daThu}). ` +
      'Nếu mới chỉ tra theo SĐT, hãy thử lại với tham số `ten`. ' +
      'Vẫn không thấy → KHÔNG được tự tạo khách, hãy dùng chuyen_sale để người tạo khách mới.'
    );
  }
  if (kq.trangThai === 'nhieu_ket_qua') {
    // CÓ NGƯỜI KHỚP GẦN NGUYÊN VĂN VÀ ÁP ĐẢO → nói thẳng dùng người này, đừng
    // bắt nhân viên chọn giữa 8 cái tên mà 7 cái khác hẳn (yêu cầu 21:56 11/08).
    if (kq.tuChot) {
      const k = kq.tuChot;
      return (
        `Khớp gần nguyên văn: id=${k.id} | ${k.ten}${k.ma ? ` [${k.ma}]` : ''} | ${k.dienThoai ?? ''}\n` +
        `DÙNG NGƯỜI NÀY — tên khớp gần như nguyên văn từ khoá, ${kq.danhSach.length - 1} khách còn lại khác hẳn tên. ` +
        'Khi tóm tắt đơn PHẢI nói rõ đã lấy ai (vd "Em lấy Anh Long Led (KH000117) nhé") để nhân viên sửa được nếu sai.'
      );
    }
    const ds = kq.danhSach
      .map((k) => `- id=${k.id} | ${k.ten}${k.ma ? ` [${k.ma}]` : ''} | ${k.dienThoai ?? 'không có SĐT'}`)
      .join('\n');
    // Danh sách chạm trần: nói RÕ là chưa đủ. Cắt im lặng thì model (và nhân
    // viên đọc lại) coi 10 người này là tất cả và kết luận sai "không có khách
    // đó trong hệ thống" — bug thật 16:15 11/08 với khách "Anh Long Led".
    const canhBaoCat = kq.conNua
      ? '\nCHÚ Ý: danh sách BỊ CẮT — còn khách trùng khác chưa hiển thị. ' +
        'Nếu không thấy đúng người, TRA LẠI với tên đầy đủ hơn (thêm chữ) hoặc SĐT để thu hẹp.'
      : '';
    return (
      `Tìm thấy ${kq.danhSach.length} khách khớp:\n${ds}${canhBaoCat}\n` +
      'KHÔNG tự chọn, KHÔNG tự nhặt id từ danh sách này. Khi nhân viên chọn, họ thường gõ MÃ KH ' +
      '(vd KH001017) hoặc SĐT — hãy TRA LẠI bằng `ma` (mã KH) hoặc `sdt` để ra đúng một người rồi mới dùng id đó. ' +
      'Không có mã/SĐT → liệt kê danh sách này cho nhân viên chọn, hoặc dùng chuyen_sale.'
    );
  }
  const k = kq.khach;
  // KHÔNG nêu số nợ ở đây nữa — `incokit_receivable_balance` đo trên prod
  // 11/08 thấy SAI ở 29/40 khách nợ nhiều nhất (bug 16:09 11/08, xem
  // xuat-cong-no.ts). Nêu ra là model sẽ trả lời câu hỏi công nợ bằng số sai
  // mà không bao giờ gọi xuat_cong_no. Chỉ báo CÓ nợ hay không, kèm lệnh
  // bắt buộc gọi tool đúng để lấy con số.
  const no = k.congNo !== 0
    ? ' | ĐANG CÓ CÔNG NỢ — số tiền phải lấy từ tool xuat_cong_no, ĐỪNG đoán'
    : '';
  return `id=${k.id} | ${k.ten}${k.ma ? ` [${k.ma}]` : ''} | ${k.dienThoai ?? ''}${no}`;
}
