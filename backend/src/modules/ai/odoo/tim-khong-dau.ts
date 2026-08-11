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
 * Điều kiện Odoo `ilike` cho một field, theo luật dấu ở trên.
 *
 * Dùng thay cho `['name','ilike', tuKhoa]` ở mọi chỗ tra theo tên người/SP.
 * Nhớ lọc lại kết quả bằng locKhopBoDau() — mẫu `_` ở đây vẫn rộng hơn ý người gõ.
 */
export function dieuKienKhongDau(field: string, tuKhoa: string): [string, string, string] {
  return [field, 'ilike', mauKhongDau(tuKhoa)];
}
