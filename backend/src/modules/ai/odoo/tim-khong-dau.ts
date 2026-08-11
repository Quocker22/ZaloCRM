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
// ĐÁNH ĐỔI ĐÃ BIẾT: `_` khớp ký tự BẤT KỲ nên mẫu rộng hơn từ khoá gốc — "v_n"
// trúng cả "Vinh", "Văn", "Vạn". Đây là lý do PHẢI có tầng chấm điểm ở TypeScript
// phía sau (xepHangKhach/diemKhopTen trong tra-khach-hang.ts): DB lọc thô cho rẻ,
// JS chấm điểm tinh trên vài chục dòng. Rộng rồi xếp hạng thì tệ nhất là bắt
// nhân viên chọn; hẹp quá thì mất hẳn người cần tìm — mà đó mới là bug đang sửa.
//
// MẪU PHẢI HẸP NHẤT CÓ THỂ: chỉ thay NGUYÊN ÂM (và 'd' đứng đầu từ, vì 'đ').
// Thay cả phụ âm là nới vô cớ — đã bị test replay-long-led bắt tại trận: "led"
// hoá "l__" thì tra "Anh Long Led" ra cả 11 người thay vì đúng 1.

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

/**
 * Biến từ khoá thành MẪU LIKE khớp được cả có dấu lẫn không dấu.
 *
 * Cách làm: bỏ dấu trước (để "Quốc" và "quoc" cùng ra một mẫu), rồi thay mọi
 * chữ cái có-thể-mang-dấu bằng `_`.
 *
 *   "trung quoc" → "tr_ng q__c"
 *   "Trung Quốc" → "tr_ng q__c"     (cùng mẫu — đó là mục đích)
 *   "Nguồn"      → "ng__n"
 *
 * Ký tự `%` và `_` do nhân viên gõ được THOÁT bằng `\` để không thành wildcard
 * ngoài ý muốn (gõ "50%" không được biến thành "khớp mọi thứ").
 */
export function mauKhongDau(tuKhoa: string): string {
  const boDau = tuKhoa
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

  return [...boDau]
    .map((c, i) => {
      if (CAN_THOAT.test(c)) {
        CAN_THOAT.lastIndex = 0;   // regex có cờ /g — phải reset sau mỗi lần test
        return `\\${c}`;
      }
      return NGUYEN_AM.has(c) || laDDauTu(boDau, i) ? '_' : c;
    })
    .join('');
}

/**
 * Điều kiện Odoo `ilike` KHÔNG phụ thuộc dấu cho một field.
 *
 * Dùng thay cho `['name','ilike', tuKhoa]` ở mọi chỗ tra theo tên người/SP.
 */
export function dieuKienKhongDau(field: string, tuKhoa: string): [string, string, string] {
  return [field, 'ilike', mauKhongDau(tuKhoa)];
}
