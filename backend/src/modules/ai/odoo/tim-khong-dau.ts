// SPDX-License-Identifier: AGPL-3.0-or-later
// Tra Odoo KHÔNG PHỤ THUỘC DẤU TIẾNG VIỆT — dùng chung cho khách, NCC, sản phẩm.
//
// ══ VÌ SAO CÓ FILE NÀY ══════════════════════════════════════════════════════
//
// Ca thật 23:15–23:16 ngày 11/08/2026 (anh Quốc): nhân viên nhắn "tạo phiếu
// nhập hàng ... nhà cung cấp là Trung Quốc", bot hỏi lại rồi KHÔNG khớp được
// nhà cung cấp nào, cuối cùng quay về đầu luồng. Anh Quốc: "ủa sao không tìm
// được nhà Cung cấp".
//
// Gốc rễ: `ilike` của Odoo/Postgres ở prod KHÔNG bỏ dấu (extension `unaccent`
// KHÔNG bật). Đo thật trên prod 11/08 bằng tài khoản bot_zalo, chỉ đọc:
//
//   NCC    ['name','ilike','Trung Quốc'] -> 2 kq (314 NCC000001, 21 NCC000290)
//   NCC    ['name','ilike','trung quoc'] -> 0 kq        ← gõ không dấu: TRƯỢT SẠCH
//   KHÁCH  ['name','ilike','Thức']       -> 3 kq
//   KHÁCH  ['name','ilike','Thuc']       -> 0 kq        ← TRƯỢT SẠCH
//   KHÁCH  ['name','ilike','Vân']        -> 5 kq
//   KHÁCH  ['name','ilike','Van']        -> 1 kq (trúng "Chú Vanh", TRẬT hết 5 người thật)
//   SP     ['name','ilike','Nguồn']      -> 5 kq
//   SP     ['name','ilike','Nguon']      -> 0 kq        ← TRƯỢT SẠCH
//
// Nên đây KHÔNG phải lỗi riêng của luồng nhập hàng: nhân viên gõ "nguon NB",
// "anh Van", "thuc" ở BẤT KỲ luồng nào (tra khách, tra SP, lên đơn) đều trượt.
// Bàn phím điện thoại gõ không dấu là chuyện thường ngày.
//
// ══ CÁCH SỬA, VÀ VÌ SAO KHÔNG CHỌN CÁCH KHÁC ═══════════════════════════════
//
// Đã cân nhắc và LOẠI:
//
//  (a) Bật extension `unaccent` trên Postgres — sửa đúng gốc nhất, nhưng phải
//      đụng DB prod (CREATE EXTENSION + index), ngoài phạm vi sửa code và
//      không rollback bằng một lệnh được. Để dành cho lần có cửa sổ bảo trì.
//
//  (b) Kéo cả bảng về rồi lọc bằng JS — 3.700 khách + 1.257 SP mỗi lượt tra.
//      Chậm, tốn RAM, và đổ vỡ khi dữ liệu lớn thêm. LOẠI THẲNG.
//
// CHỌN: biến từ khoá thành MẪU LIKE dùng ký tự đại diện `_` (khớp đúng MỘT ký
// tự bất kỳ) ở mọi vị trí chữ cái CÓ THỂ MANG DẤU. "trung quoc" → "tr_ng q__c":
// mẫu này khớp cả "Trung Quốc" lẫn "trung quoc", vì `_` nuốt được cả "u" lẫn "ố".
//
// Lọc vẫn nằm Ở TẦNG DB (Postgres tự lo), nên KHÔNG kéo bảng về. Đo thật trên
// prod 11/08 — chính hàm mauKhongDau() dưới đây:
//
//   NCC   "trung quoc"  → "tr_ng q__c" → 2 kq  (đúng 2 NCC thật)
//   KHÁCH "long led"    → "l_ng l_d"   → 1 kq  ("Anh Long Led")
//   KHÁCH "thuc"        → "th_c"       → 11 kq (trước đây 0)
//   SP    "nguon"       → "ng__n"      → 11 kq (trước đây 0)
//
// MẪU PHẢI HẸP NHẤT CÓ THỂ: chỉ thay NGUYÊN ÂM (và 'd' đứng đầu từ, vì 'đ').
// Thay cả phụ âm là nới vô cớ — đã bị test replay-long-led bắt tại trận: "led"
// hoá "l__" thì tra "Anh Long Led" ra cả 11 người thay vì đúng 1.
//
// ══ SỬA LẦN 2 (12/08) — NỚI QUÁ TAY, PHẢI THU LẠI HAI TẦNG ═════════════════
//
// Ca thật 01:12 ngày 12/08 (anh Quốc): nhân viên nhắn "@bot lên đơn cho anh Vấn
// 10 cái Led F5 12V ...". Bot đáp "Có 10 khách tên Vấn" rồi liệt kê ANh Văn,
// A Hòa - Vạn Phúc, Anh Nguyễn Văn Đại, A tuấn 1385 Phan Văn Trị... KHÔNG một
// ai tên Vấn. Anh Quốc: "ủa trong DB có 1 anh vấn thôi mà ????? càng làm càng
// sai à". Đo prod cùng lúc: ilike 'Vấn' (nguyên văn) ra ĐÚNG 1 người —
// "Anh Vấn Đà Nẵng 0934.786.998 [KH000027]" — còn tool trả 10 người, trật hết.
//
// Bản vá 11/08 nới dấu cho MỌI từ khoá. Đó là ĐÁNH ĐỔI SAI ở hai điểm:
//
//  SAI 1 — nới cả khi người ta ĐÃ GÕ DẤU. "Vấn" → "v_n" khớp Văn, Vạn, Vân,
//    Vin, Von. Nhưng gõ đủ dấu là hành động CÓ CHỦ ĐÍCH phân biệt: nhân viên
//    bấm thêm phím để nói rõ "Vấn chứ không phải Văn". Nới ra là xoá đúng cái
//    thông tin họ vừa bỏ công cung cấp. Bản vá gốc sinh ra để cứu người gõ
//    KHÔNG dấu — nó không có việc gì phải đụng đến người gõ CÓ dấu.
//    → LUẬT MỚI: coDauTiengViet(tuKhoa) ? tra nguyên văn : mới nới mẫu.
//
//  SAI 2 — ngay cả khi không dấu, `_` vẫn quá lỏng. `_` là "ký tự BẤT KỲ" nên
//    "van" → "v_n" ôm luôn "vin", "von", "vun" — những chữ KHÔNG hề là biến thể
//    dấu của "van". Đúng ra 'a' chỉ nên khớp a/à/á/ả/ã/ạ/ă/ằ/ắ/…/â/ầ/ấ/…
//    Postgres `ilike` không có class ký tự nên không diễn đạt được điều đó, và
//    Odoo domain cũng không có toán tử regex (`=~` là của ORM khác, XML-RPC
//    search_read của Odoo 17 KHÔNG nhận) — đã cân nhắc và LOẠI.
//    → CHỌN: giữ mẫu `_` ở tầng DB để thu hẹp cho rẻ (không kéo bảng), rồi LỌC
//      LẠI ở TypeScript bằng khopBoDau() — so bỏ dấu ĐÚNG chữ. DB trả về vài
//      chục dòng, lọc trên đó không tốn gì.
//
// Đo prod sau khi sửa (chính hàm dưới đây):
//   KHÁCH "Vấn"       → tra nguyên văn 'Vấn'  → 1 kq  ("Anh Vấn Đà Nẵng")
//   KHÁCH "van"       → "v_n" + lọc bỏ dấu    → vẫn có "Anh Vấn Đà Nẵng"
//   KHÁCH "thuc"      → "th_c" + lọc          → "Anh Thức ..."
//   SP    "nguon NB"  → "ng__n" + lọc         → Nguồn NB
//   NCC   "trung quoc"→ "tr_ng q__c" + lọc    → Trung Quốc
//
// Tầng xếp hạng (xepHangKhach/diemKhopTen trong tra-khach-hang.ts) VẪN GIỮ:
// nó lo việc chọn ai trong số đã khớp, còn khopBoDau lo việc ai được vào danh
// sách. Hai việc khác nhau, không thay thế nhau.
//
// ══ SỬA LẦN 3 (12/08) — MẪU `_` KHÔNG PHẢI THỦ PHẠM, TRẦN MỚI LÀ ══════════
//
// Sau hai vòng trên, đo prod lại: ca "van" VẪN hỏng — 10 dòng toàn Văn/Vạn/Vân,
// không có "Anh Vấn Đà Nẵng". Đào xuống tầng Odoo mới ra gốc rễ thật:
//
//   ilike 'v_n'      -> 60 dòng, trong đó 0 người tên "Vấn"
//   ilike 'vấn'      -> 1 dòng,  đúng anh Vấn
//   ilike 'V_n Đà'   -> 1 dòng,  ĐÚNG anh Vấn        ← bằng chứng quyết định
//
// Dòng cuối chứng minh `_` KHỚP `ấ` BÌNH THƯỜNG. Mẫu tìm không hỏng, lọc bỏ dấu
// không hỏng, xếp hạng không hỏng. Thứ hỏng là `v_n` khớp HÀNG TRĂM người, Odoo
// cắt ở trần ta xin (55-60 dòng), và anh Vấn nằm NGOÀI trần đó. Xếp hạng chạy
// trên 60 dòng không bao giờ thấy anh ấy — vì anh ấy chưa từng được lấy về.
//
// Hai vòng trước đều sửa đúng thứ mình NHÌN THẤY, nhưng thứ hỏng nằm sâu hơn
// một tầng. Bài học: khi vá xong mà triệu chứng còn nguyên, phải đo lại ở tầng
// DƯỚI chỗ vừa sửa, đừng vá tiếp ở tầng trên.
//
// CHỌN: tra CÓ CHỦ ĐÍCH từng biến thể dấu thay vì một lượt rộng — xem
// bienTheDau()/dieuKienBienTheDau() bên dưới. Mẫu `_` chỉ còn là đường lùi khi
// số biến thể vượt trần.

/**
 * NGUYÊN ÂM tiếng Việt — chỉ những chữ này mới thật sự mang dấu.
 *
 * CỐ Ý KHÔNG gồm phụ âm: thay phụ âm bằng `_` là nới mẫu ra vô cớ. Ca thật bắt
 * được lỗi này (test replay-long-led-11-08): để 'd' trong danh sách thì "led"
 * thành mẫu "l__", khớp luôn "Long", "Hạ Long", "Long Biên" — tra "Anh Long Led"
 * ra cả 11 người thay vì đúng 1. Mẫu phải HẸP NHẤT mà vẫn bỏ được dấu.
 */
const NGUYEN_AM = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * 'd' chỉ được thay khi đứng ĐẦU MỘT TỪ — vì 'đ' chỉ xuất hiện ở đầu từ tiếng
 * Việt ("điện", "đỏ", "Định"). Nhân viên gõ "dien" vẫn khớp "điện", nhưng chữ
 * 'd' giữa/cuối từ ("led", "led ziczac") thì giữ nguyên, không nới bừa.
 */
function laDDauTu(chuoi: string, i: number): boolean {
  return chuoi[i] === 'd' && (i === 0 || chuoi[i - 1] === ' ');
}

/** Ký tự có nghĩa đặc biệt trong LIKE của SQL — phải thoát để khỏi thành wildcard. */
const CAN_THOAT = /[\\%_]/g;

/** Bỏ dấu tiếng Việt: "Vấn" → "van", "Quốc" → "quoc", "đỏ" → "do". */
export function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/**
 * Chuỗi có mang DẤU TIẾNG VIỆT không (thanh điệu, mũ/móc, hoặc chữ 'đ')?
 *
 * ĐÂY LÀ CÔNG TẮC của toàn bộ bản sửa 12/08. Có dấu = người gõ đã nói rõ họ
 * tìm ai ("Vấn" chứ không phải "Văn") → tra NGUYÊN VĂN, không nới.
 * Không dấu = người gõ đang nhờ hệ thống đoán hộ dấu → mới nới mẫu.
 *
 * Cách nhận biết: chuẩn hoá NFD tách chữ khỏi dấu; còn sót ký tự tổ hợp
 * (U+0300–U+036F) hoặc 'đ' nghĩa là chuỗi có dấu.
 */
export function coDauTiengViet(s: string): boolean {
  return /[̀-ͯ]/.test(s.normalize('NFD')) || /đ/i.test(s);
}

/**
 * Biến MỘT TỪ thành mẫu LIKE nới dấu — chỉ dùng cho từ KHÔNG dấu.
 *
 *   "trung" → "tr_ng"   ·   "quoc" → "q__c"   ·   "nguon" → "ng__n"
 *
 * Ký tự `%` và `_` do nhân viên gõ được THOÁT bằng `\` để không thành wildcard
 * ngoài ý muốn (gõ "50%" không được biến thành "khớp mọi thứ").
 */
function noiMotTu(tu: string): string {
  const t = boDau(tu);
  return [...t]
    .map((c, i) => {
      if (CAN_THOAT.test(c)) {
        CAN_THOAT.lastIndex = 0;   // regex có cờ /g — phải reset sau mỗi lần test
        return `\\${c}`;
      }
      return NGUYEN_AM.has(c) || laDDauTu(t, i) ? '_' : c;
    })
    .join('');
}

/**
 * Biến từ khoá thành MẪU LIKE cho Odoo `ilike`.
 *
 * LUẬT (sửa 12/08 sau ca "Vấn" 01:12 — xem đầu file):
 *   từ CÓ dấu   → giữ NGUYÊN VĂN (chỉ hạ chữ thường)   "Vấn" → "vấn"
 *   từ KHÔNG dấu→ nới bằng `_`                          "van" → "v_n"
 *
 * Xét theo TỪNG TỪ, không theo cả cụm: nhân viên hay gõ nửa vời ("Nguồn nb" —
 * từ đầu có dấu, từ sau không). Xét cả cụm thì một chữ có dấu sẽ khoá cứng luôn
 * những từ người ta cố tình gõ không dấu, và ngược lại một chữ không dấu sẽ nới
 * bừa những từ đã gõ đủ dấu — đúng cái bug đang sửa.
 *
 *   "trung quoc" → "tr_ng q__c"
 *   "Trung Quốc" → "trung quốc"      (KHÔNG còn cùng mẫu — đó mới là đúng)
 *   "Nguồn nb"   → "nguồn nb"
 */
export function mauKhongDau(tuKhoa: string): string {
  // Giữ nguyên khoảng trắng gốc (tách rồi ghép lại y như cũ) — mẫu LIKE đếm
  // từng ký tự, gộp/mất khoảng trắng là lệch chuỗi và trượt sạch.
  return tuKhoa
    .split(/(\s+)/)
    .map((phan) => (/^\s*$/.test(phan) ? phan : coDauTiengViet(phan) ? phan.toLowerCase() : noiMotTu(phan)))
    .join('');
}

/**
 * Tên trong DB có THẬT SỰ khớp từ khoá không — lọc lại sau khi DB trả về.
 *
 * VÌ SAO CẦN, dù DB đã lọc bằng mẫu `_`: `_` khớp ký tự BẤT KỲ, nên "van" →
 * "v_n" ôm luôn "Vinh", "Vốn", "Vun" — không chữ nào là biến thể dấu của "van".
 * Hàm này so BỎ DẤU hai vế: "van" khớp "Vấn"/"Văn"/"Vạn" (đúng, cùng gốc chữ)
 * nhưng KHÔNG khớp "Vinh"/"Vốn". Đây là tầng thu hẹp thứ hai của bản sửa 12/08.
 *
 * Từ khoá CÓ DẤU thì so ĐÚNG DẤU, không hạ chuẩn về bỏ dấu — "Vấn" không được
 * khớp "Văn" (ca thật 01:12 12/08).
 *
 * Chạy trên vài chục dòng DB đã trả về, không phải cả bảng — rẻ.
 */
export function khopBoDau(tuKhoa: string, ten: string): boolean {
  const tu = tuKhoa.trim();
  if (!tu) return true;
  if (coDauTiengViet(tu)) return ten.toLowerCase().includes(tu.toLowerCase());
  return boDau(ten).includes(boDau(tu));
}

/**
 * Lọc danh sách DB trả về, giữ những dòng khớp MỌI từ khoá (bỏ dấu chính xác).
 *
 * Dùng chung cho khách/NCC/SP: cả bốn luồng đều tra theo AND từng từ ở tầng DB
 * nên tầng lọc cũng phải đòi ĐỦ TỪ, không phải chỉ một từ.
 *
 * AN TOÀN: lọc sạch trơn (0 dòng) thì TRẢ LẠI danh sách gốc. Thà để nhân viên
 * chọn giữa vài dòng hơi rộng còn hơn báo "không tìm thấy" khi DB có hàng —
 * đó chính là bug 23:15 ngày 11/08 mà bản vá không-dấu sinh ra để chữa.
 */
export function locKhopBoDau<T>(
  tuKhoa: string | string[],
  ds: T[],
  layTen: (x: T) => string,
): T[] {
  // Nhận sẵn MẢNG TỪ cho caller nào đã tự tách (tra-san-pham bỏ từ đệm
  // "đèn"/"led"/"bóng" ngay ở tầng DB — lọc lại bằng đủ-mọi-từ thì loại oan
  // chính SP mà DB vừa tìm đúng). Tầng lọc phải dùng CÙNG tập từ với tầng DB.
  const tu = (Array.isArray(tuKhoa) ? tuKhoa : tuKhoa.trim().split(/\s+/))
    .filter((t) => t.length >= 2);
  if (tu.length === 0) return ds;
  const loc = ds.filter((x) => tu.every((t) => khopBoDau(t, layTen(x))));
  return loc.length > 0 ? loc : ds;
}

/**
 * Bảng dấu tiếng Việt: mỗi nguyên âm không dấu → mọi dạng có dấu của nó.
 *
 * Đây là bảng HỮU HẠN và đóng — tiếng Việt không sinh thêm nguyên âm mới.
 */
const BANG_DAU: Record<string, string> = {
  a: 'aàáảãạăằắẳẵặâầấẩẫậ',
  e: 'eèéẻẽẹêềếểễệ',
  i: 'iìíỉĩị',
  o: 'oòóỏõọôồốổỗộơờớởỡợ',
  u: 'uùúủũụưừứửữự',
  y: 'yỳýỷỹỵ',
};

/**
 * Trần số biến thể sinh ra cho MỘT từ. Quá ngưỡng thì rơi về mẫu `_`.
 *
 * Đo thật khi làm — số biến thể theo luật một-dấu-một-nguyên-âm:
 *   van 18 · thuc 12 · led 12 · trung 12 · son 18 · nguon 29 · quoc 29 · hoang 35
 * Mọi từ khoá thực tế đều dưới 40, nên ngưỡng này gần như không bao giờ chạm.
 * Nó chỉ để chặn ca bệnh lý (nhân viên dán cả cụm dài không khoảng trắng).
 */
const TRAN_BIEN_THE = 40;

/**
 * Sinh MỌI BIẾN THỂ DẤU THẬT của một từ gõ không dấu.
 *
 *   "van"  → van, vàn, ván, vản, vãn, vạn, văn, vằn, vắn, ..., vân, vấn, vận
 *   "nb"   → nb              (không có nguyên âm, chỉ chính nó)
 *   "Vấn"  → vấn            (đã có dấu: người ta nói rõ rồi, không sinh thêm)
 *
 * LUẬT SINH — MỘT DẤU TRÊN MỘT NGUYÊN ÂM, không phải tích Descartes.
 * Tiếng Việt: một từ mang đúng MỘT dấu thanh, rơi trên MỘT nguyên âm. Sinh theo
 * tích Descartes là sai luật chính tả VÀ nổ số lượng vô ích — "hoang" ra 324 tổ
 * hợp (phần lớn không tồn tại: "hòàng"), trong khi luật thật chỉ cho 35.
 *
 * Có kèm 'đ' khi từ bắt đầu bằng 'd' ("dien" → "điện" bắt được), vì 'đ' chỉ
 * đứng đầu từ tiếng Việt.
 */
/**
 * Phụ âm cuối HỢP LỆ của âm tiết tiếng Việt (đã bỏ dấu).
 *
 * Dùng để KHÔNG sinh biến thể cho chữ không thể là tiếng Việt: "cob" kết thúc
 * bằng 'b' — không âm tiết tiếng Việt nào làm vậy, nên "còb"/"cób"/"cộb" là 17
 * điều kiện rác gửi xuống Postgres mỗi lượt. Mã sản phẩm ("COB", "NB", "P10FO")
 * rơi hết vào diện này, mà mã thì vốn không mang dấu.
 */
const PHU_AM_CUOI = new Set(['c', 'ch', 'm', 'n', 'ng', 'nh', 'p', 't']);

/** Chữ cái KHÔNG có trong bảng chữ tiếng Việt — thấy là biết mã, không phải tên. */
const CHU_NGOAI = /[fjwz]/;

/** Âm tiết này CÓ THỂ mang dấu tiếng Việt không? */
function coTheMangDau(t: string): boolean {
  // Lẫn CHỮ SỐ ("p10fo", "12v", "2835") → mã sản phẩm, mã vốn không mang dấu.
  if (/\d/.test(t)) return false;
  // Chứa f/j/w/z → không thuộc bảng chữ tiếng Việt.
  if (CHU_NGOAI.test(t)) return false;
  const cuoi = t.match(/[a-z]+$/)?.[0] ?? '';
  // Kết thúc bằng nguyên âm ("ba", "hoa") thì luôn hợp lệ.
  if (/[aeiouy]$/.test(cuoi)) return true;
  // Kết thúc bằng phụ âm → phải là phụ âm cuối hợp lệ ("van", "thuc", "long").
  return PHU_AM_CUOI.has(cuoi.slice(-2)) || PHU_AM_CUOI.has(cuoi.slice(-1));
}

export function bienTheDau(tu: string): string[] {
  const t = boDau(tu);
  // Đã có dấu → người gõ đã chỉ đích danh, không việc gì sinh thêm.
  if (coDauTiengViet(tu)) return [tu.toLowerCase()];
  // Không thể là tiếng Việt (mã SP "COB", "P10FO"…) → chỉ chính nó, khỏi sinh
  // 17 điều kiện rác kiểu "còb"/"cób" gửi xuống Postgres mỗi lượt tra.
  if (!coTheMangDau(t)) return [t];

  const kq = new Set<string>([t]);
  for (let i = 0; i < t.length; i++) {
    const bang = BANG_DAU[t[i]];
    if (!bang) continue;
    for (const c of bang) kq.add(t.slice(0, i) + c + t.slice(i + 1));
  }
  // 'd' đầu từ có thể là 'đ' — nhân đôi tập hiện có với chữ đầu thay bằng 'đ'.
  if (t.startsWith('d')) for (const v of [...kq]) kq.add(`đ${v.slice(1)}`);
  return [...kq];
}

/**
 * Điều kiện Odoo cho MỘT từ khoá: OR trên các biến thể dấu THẬT.
 *
 * ══ VÌ SAO CÓ HÀM NÀY (sửa vòng 3, 12/08) ══════════════════════════════════
 *
 * Hai vòng vá trước đều sửa đúng thứ mình thấy, nhưng thứ hỏng nằm sâu hơn.
 * Đo prod vòng 3 mới lộ ra gốc rễ thật:
 *
 *   ilike 'v_n'     -> 60 dòng, trong đó 0 người tên "Vấn"
 *   ilike 'vấn'     -> 1 dòng,  đúng anh Vấn
 *   ilike 'V_n Đà'  -> 1 dòng,  ĐÚNG anh Vấn        ← chốt lại
 *
 * Dòng cuối là bằng chứng quyết định: `_` KHỚP `ấ` BÌNH THƯỜNG. Mẫu tìm không
 * hỏng, xếp hạng không hỏng, trải đều không hỏng. Thứ hỏng là `v_n` khớp HÀNG
 * TRĂM người, Odoo cắt ở trần ta xin (55-60 dòng), và anh Vấn nằm NGOÀI trần
 * đó. Xếp hạng chạy trên 60 dòng không bao giờ thấy anh ấy — vì anh ấy chưa
 * từng được lấy về. Vá ở tầng sắp xếp là vá sai tầng.
 *
 * CÁCH CHỮA: tra CÓ CHỦ ĐÍCH thay vì một lượt rộng. Thay `['name','ilike','v_n']`
 * bằng OR trên các biến thể thật — "vấn" là một nhánh riêng nên nó CHẮC CHẮN
 * được Odoo xét, không thể bị hàng trăm "Văn" chiếm trần trước.
 *
 * Ba cái lợi cùng lúc:
 *   - Mỗi biến thể có suất, không bị biến thể đông hơn chiếm sạch
 *   - Không kéo bảng, không nâng trần (vẫn một lượt truy vấn)
 *   - Khớp CHÍNH XÁC hơn `_`: loại thẳng "vin"/"vốn"/"vụn" ngay từ tầng DB,
 *     thay vì lôi về rồi mới lọc ở JS
 *
 * ĐƯỜNG LÙI: quá TRAN_BIEN_THE biến thể thì domain OR nặng hơn cả cách cũ →
 * rơi về mẫu `_` (vẫn có tầng lọc JS phía sau đỡ). Thực tế gần như không chạm:
 * từ khoá thật đo được nhiều nhất là "hoang" 35.
 */
export function dieuKienBienTheDau(field: string, tuKhoa: string): unknown[] {
  const bt = bienTheDau(tuKhoa);
  if (bt.length > TRAN_BIEN_THE) return [dieuKienKhongDau(field, tuKhoa)];
  if (bt.length === 1) return [[field, 'ilike', bt[0]]];
  // Prefix-notation của Odoo: n điều kiện cần n-1 toán tử '|' đứng trước.
  return [...Array(bt.length - 1).fill('|'), ...bt.map((v) => [field, 'ilike', v])];
}

/**
 * Điều kiện cho CẢ CỤM nhiều từ: mỗi từ một khối OR-biến-thể, các khối AND nhau.
 *
 * PHẢI TÁCH TỪ, không được sinh biến thể cho cả cụm: số biến thể nhân lên theo
 * số nguyên âm, nên "hoang son" ra 52 và "a long led" ra 46 — vượt trần rồi rơi
 * hết về mẫu `_`, tức là mất sạch tác dụng của bản sửa. Tách từ thì mỗi từ chỉ
 * 12-35 biến thể, nằm gọn dưới trần (đo thật: van 18 · thuc 12 · hoang 35).
 *
 * Tách từ cũng đúng về ngữ nghĩa — giống hệt lý do tra-khách/tra-SP vẫn tách:
 * "qc hoàng sơn" phải khớp được cả khi tên trong DB có thêm chữ chen giữa.
 *
 * Từ dưới 2 ký tự bị bỏ (trừ khi cả cụm chỉ có một từ) — chúng khớp quá rộng.
 */
export function dieuKienBienTheDauCum(field: string, cum: string): unknown[] {
  const tu = cum.trim().split(/\s+/).filter((t) => t.length >= 2);
  const khoi = (tu.length === 0 ? [cum.trim()] : tu)
    .map((t) => dieuKienBienTheDau(field, t));
  // Prefix-notation đếm theo SỐ KHỐI, không phải số điều kiện lẻ bên trong.
  return [...Array(khoi.length - 1).fill('&'), ...khoi.flat()];
}

/**
 * Lấy BIẾN THỂ DẤU mà một cái tên dùng cho từ khoá đã gõ không dấu.
 *
 * "van" trong "Anh Vấn Đà Nẵng" → "vấn";  trong "ANh Văn" → "văn".
 * Không tìm thấy (tên khớp qua chỗ khác) → chuỗi rỗng, coi như một nhóm riêng.
 *
 * Dò trên bản NFC để một chữ có dấu đếm là MỘT ký tự, khớp đúng độ dài từ khoá.
 */
function bienTheDauCua(tuKhoa: string, ten: string): string {
  const t = ten.normalize('NFC');
  const k = boDau(tuKhoa);
  if (!k) return '';
  for (let i = 0; i + k.length <= t.length; i++) {
    const doan = t.slice(i, i + k.length);
    if (boDau(doan) === k) return doan.toLowerCase();
  }
  return '';
}

/**
 * TRẢI ĐỀU các BIẾN THỂ DẤU khi danh sách sắp bị cắt.
 *
 * VÌ SAO CẦN — đo prod 12/08 sau bản sửa vòng 1: gõ "van" không dấu ra 10 dòng
 * + cờ "còn nữa", nhưng TOÀN "Văn"/"Vạn"/"Vân", KHÔNG có "Anh Vấn Đà Nẵng".
 * Cờ báo đúng nên hệ thống không nói dối, nhưng người cần tìm vẫn không hiện ra.
 *
 * Vì sao xếp-hạng-theo-điểm KHÔNG cứu được ca này: diemKhopTen() so BỎ DẤU, nên
 * "Văn" và "Vấn" khớp "van" y hệt nhau — cùng 80 điểm. Sắp ổn định giữ nguyên
 * thứ tự Odoo (chữ cái), mà "Văn" đông hơn hẳn nên chiếm sạch 10 chỗ. Không có
 * thang điểm nào tách được hai chữ này, vì người gõ không dấu thật sự CHƯA NÓI
 * họ muốn chữ nào.
 *
 * Nên cách đúng không phải đoán hộ, mà là CHO MỖI BIẾN THỂ MỘT SUẤT: vòng đầu
 * lấy 1 người của mỗi biến thể dấu (vấn, văn, vạn, vân…), hết vòng mới lấy tiếp
 * người thứ 2 của từng biến thể. Nhân viên nhìn 10 dòng là thấy đủ MẶT các chữ
 * có thể, rồi tự chọn — thay vì thấy 10 người cùng một chữ và tưởng không có ai.
 *
 * Giữ nguyên thứ tự tương đối trong mỗi nhóm, nên không phá xếp hạng theo điểm
 * đã chạy trước đó: trong cùng một biến thể, ai điểm cao vẫn đứng trên.
 *
 * KHÔNG áp khi từ khoá đã CÓ DẤU: lúc đó chỉ còn đúng một biến thể, trải đều là
 * việc thừa (và ca "Vấn" có dấu vốn đã ra đúng 1 người).
 */
export function traiDeuBienTheDau<T>(
  tuKhoa: string,
  ds: T[],
  layTen: (x: T) => string,
): T[] {
  const tu = tuKhoa.trim().split(/\s+/).filter((t) => t.length >= 2);
  // Chỉ trải theo từ ĐẦU TIÊN đủ dài — đó là từ định danh chính ("van" trong
  // "van da nang"). Trải theo mọi từ thì số nhóm nổ ra và mất hết ý nghĩa.
  const tuChinh = tu[0];
  if (!tuChinh || coDauTiengViet(tuChinh)) return ds;

  const nhom = new Map<string, T[]>();
  for (const x of ds) {
    const bt = bienTheDauCua(tuChinh, layTen(x));
    const cu = nhom.get(bt);
    if (cu) cu.push(x); else nhom.set(bt, [x]);
  }
  // Một nhóm duy nhất → không có gì để trải, trả nguyên (giữ nguyên thứ tự).
  if (nhom.size <= 1) return ds;

  // Vòng tròn: mỗi vòng lấy 1 phần tử của từng nhóm, theo thứ tự nhóm xuất hiện.
  const kq: T[] = [];
  const dsNhom = [...nhom.values()];
  for (let i = 0; kq.length < ds.length; i++) {
    for (const g of dsNhom) if (i < g.length) kq.push(g[i]);
  }
  return kq;
}

/**
 * Điều kiện Odoo `ilike` cho một field, theo luật dấu ở trên.
 *
 * Dùng thay cho `['name','ilike', tuKhoa]` ở mọi chỗ tra theo tên người/SP.
 * Nhớ lọc lại kết quả bằng locKhopBoDau() — mẫu `_` ở đây vẫn rộng hơn ý người gõ.
 */
export function dieuKienKhongDau(field: string, tuKhoa: string): [string, string, string] {
  return [field, 'ilike', mauKhongDau(tuKhoa)];
}
