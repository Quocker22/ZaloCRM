// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá hành vi của mẫu tra KHÔNG PHỤ THUỘC DẤU (xem src/modules/ai/odoo/tim-khong-dau.ts).
//
// Vì sao cần: `ilike` của Postgres prod KHÔNG bỏ dấu (extension unaccent không
// bật). Đo thật 11/08 — nhân viên gõ không dấu là trượt sạch ở CẢ BA tập:
//   khách ['name','ilike','Thuc'] -> 0 kq (có dấu 'Thức' -> 3 kq)
//   SP    ['name','ilike','Nguon']-> 0 kq (có dấu 'Nguồn' -> 5 kq)
//   NCC   ['name','ilike','trung quoc'] -> 0 kq (có dấu -> 2 kq)
import { describe, it, expect } from 'vitest';
//
// SỬA 12/08 — ca hỏng 01:12: nới dấu cho MỌI từ khoá là quá tay. NV gõ "Vấn"
// (đủ dấu) mà bot trả 10 người Văn/Vạn/Vân, KHÔNG ai tên Vấn, trong khi Odoo
// có đúng 1 người. Luật mới: CÓ DẤU thì tra đúng dấu, KHÔNG DẤU mới nới.
import {
  mauKhongDau, dieuKienKhongDau, coDauTiengViet, khopBoDau, traiDeuBienTheDau,
} from '../../../src/modules/ai/odoo/tim-khong-dau.js';

/** `ilike` của Postgres: `_` = 1 ký tự bất kỳ, `%` = chuỗi bất kỳ, bỏ qua hoa/thường. */
function ilike(mau: string, giaTri: string): boolean {
  let re = '';
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i];
    if (c === '\\' && i + 1 < mau.length) { re += mau[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '_') { re += '.'; continue; }
    if (c === '%') { re += '.*'; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i').test(giaTri);
}
const khop = (tuKhoa: string, ten: string) => ilike(`%${mauKhongDau(tuKhoa)}%`, ten);

describe('mauKhongDau — gõ kiểu nào cũng khớp', () => {
  it('hai kiểu gõ ra HAI mẫu KHÁC NHAU — và đó mới là đúng', () => {
    // Bản 11/08 ép hai kiểu gõ về CÙNG một mẫu. Nghe thì gọn, nhưng đó chính là
    // chỗ hỏng ca 01:12 12/08: quy "Vấn" về mẫu của "van" là vứt bỏ dấu người ta
    // vừa gõ, rồi trả về 10 người Văn/Vạn/Vân. Gõ dấu và không gõ dấu là HAI ý
    // định khác nhau, phải ra hai truy vấn khác nhau.
    // "Trung" tự nó KHÔNG mang dấu nên vẫn được nới (bắt cả "Trùng"); chỉ
    // "Quốc" — chữ người ta thật sự bỏ công gõ dấu — mới được giữ nguyên văn.
    expect(mauKhongDau('Trung Quốc')).toBe('tr_ng quốc');
    expect(mauKhongDau('trung quoc')).toBe('tr_ng q__c');
    expect(mauKhongDau('Nguồn')).toBe('nguồn');
    expect(mauKhongDau('nguon')).toBe('ng__n');
    // Cả hai kiểu gõ VẪN phải tìm ra cùng một người/SP — chỉ bằng hai đường khác.
    expect(khop('Trung Quốc', 'Trung Quốc')).toBe(true);
    expect(khop('trung quoc', 'Trung Quốc')).toBe(true);
  });

  it('khớp được tên CÓ DẤU thật trên prod dù gõ không dấu', () => {
    // Đúng ba ca đã đo trượt trên prod 11/08.
    expect(khop('trung quoc', 'Trung Quốc')).toBe(true);
    expect(khop('trung quoc', 'Trung Quốc- Kho Cô Lỳ')).toBe(true);
    expect(khop('thuc', 'Anh Thức CNC')).toBe(true);
    expect(khop('nguon', 'Nguồn ATX Trong Nhà 12V400W Pro (cái)')).toBe(true);
    expect(khop('day dien', 'Dây điện 0.2 (m)')).toBe(true);
    expect(khop('long led', 'Anh Long Led')).toBe(true);
  });

  it('gõ ĐÚNG DẤU vẫn khớp như cũ — không phá đường đang chạy được', () => {
    expect(khop('Trung Quốc', 'Trung Quốc')).toBe(true);
    expect(khop('Nguồn', 'Nguồn 12v29A')).toBe(true);
  });

  it('KHÔNG khớp bừa tên khác hẳn', () => {
    // `_` nới rộng nhưng vẫn phải giữ đúng ĐỘ DÀI và các phụ âm — không được
    // biến thành "khớp mọi thứ". Tầng xepHangKhach phía sau lọc tiếp phần rộng.
    expect(khop('trung quoc', 'Mogen Star')).toBe(false);
    expect(khop('nguon', 'Màn hình LED P10')).toBe(false);
  });

  it('THOÁT ký tự wildcard nhân viên gõ — "50%" không thành "khớp mọi thứ"', () => {
    // Không thoát thì '%' của người dùng thành wildcard SQL và lôi về cả bảng.
    expect(mauKhongDau('50%')).toBe('50\\%');
    expect(khop('50%', 'Chiết khấu 50% cuối năm')).toBe(true);
    expect(khop('50%', 'Chiết khấu 70% cuối năm')).toBe(false);
  });

  it('dieuKienKhongDau trả đúng bộ ba domain Odoo', () => {
    // 'u' trong "quoc" cũng là nguyên âm nên cũng thành '_' → "q__c". Đo prod
    // 11/08 thì "tr_ng q__c" và "tr_ng qu_c" cho CÙNG 2 NCC, nên không cần thêm
    // luật riêng cho cặp 'qu' — giữ luật đơn giản: mọi nguyên âm đều thay.
    expect(dieuKienKhongDau('name', 'trung quoc')).toEqual(['name', 'ilike', 'tr_ng q__c']);
  });

  it('MẪU PHẢI HẸP — chỉ thay nguyên âm, giữ nguyên phụ âm', () => {
    // Ca thật bắt lỗi (replay-long-led-11-08): thay cả phụ âm thì "led" hoá
    // "l__" và khớp luôn "Long", "Hạ Long", "Long Biên" — tra "Anh Long Led"
    // ra 11 người thay vì đúng 1. Phụ âm không mang dấu, không được nới.
    expect(mauKhongDau('led')).toBe('l_d');
    expect(mauKhongDau('long')).toBe('l_ng');
    // "long led" phải chỉ còn khớp đúng người có CẢ hai từ, không ôm "Hạ Long".
    expect(khop('led', 'Anh Long Led')).toBe(true);
    expect(khop('led', 'Anh Hùng - QC Đa Hình Hạ Long')).toBe(false);
    expect(khop('led', 'Anh Long Biên')).toBe(false);
  });

  it('coDauTiengViet phân biệt được hai kiểu gõ', () => {
    // Đây là cái công tắc của toàn bộ luật mới, nên khoá riêng.
    expect(coDauTiengViet('Vấn')).toBe(true);
    expect(coDauTiengViet('Thức')).toBe(true);
    expect(coDauTiengViet('Trung Quốc')).toBe(true);
    expect(coDauTiengViet('Nguồn')).toBe(true);
    expect(coDauTiengViet('đỏ')).toBe(true);        // 'đ' cũng là dấu
    expect(coDauTiengViet('van')).toBe(false);
    expect(coDauTiengViet('trung quoc')).toBe(false);
    expect(coDauTiengViet('Led F5 12V')).toBe(false);
  });

  it('GÕ CÓ DẤU thì TÔN TRỌNG DẤU — ca thật 01:12 ngày 12/08', () => {
    // Ca hỏng: NV gõ "@bot lên đơn cho anh Vấn ...". Odoo có ĐÚNG 1 khách tên
    // chứa "Vấn" (Anh Vấn Đà Nẵng [KH000027]), nhưng bot liệt kê 10 người và
    // KHÔNG ai tên Vấn: Văn, Vạn, Vân... Anh Quốc: "trong DB có 1 anh vấn thôi
    // mà ????? càng làm càng sai à".
    //
    // Gốc rễ: mẫu nới áp cho MỌI từ khoá, kể cả từ đã gõ đủ dấu. "Vấn" → "v_n"
    // khớp luôn Văn/Vạn/Vân/Vin/Von. Người gõ dấu là gõ có chủ đích PHÂN BIỆT —
    // nới dấu của họ là xoá đúng cái thông tin họ vừa cung cấp.
    expect(mauKhongDau('Vấn')).toBe('vấn');
    expect(khop('Vấn', 'Anh Vấn Đà Nẵng')).toBe(true);
    expect(khop('Vấn', 'ANh Văn')).toBe(false);
    expect(khop('Vấn', 'A Hòa - Vạn Phúc - Hà Đông')).toBe(false);
    expect(khop('Vấn', 'Chị Vân Hải Phòng')).toBe(false);
  });

  it('GÕ KHÔNG DẤU vẫn nới như bản vá gốc — không phá 11/08', () => {
    // Nửa còn lại của luật: không dấu thì mới nới, vì người gõ không dấu đang
    // NHỜ hệ thống đoán hộ dấu.
    expect(khop('van', 'Anh Vấn Đà Nẵng')).toBe(true);
    expect(khop('thuc', 'Anh Thức CNC')).toBe(true);
    expect(khop('nguon', 'Nguồn ATX Trong Nhà 12V400W Pro (cái)')).toBe(true);
    expect(khop('trung quoc', 'Trung Quốc')).toBe(true);
  });

  it('CÓ DẤU chỉ ở MỘT TỪ thì chỉ từ đó được tôn trọng', () => {
    // Nhân viên hay gõ nửa vời: "Nguồn NB" (từ đầu có dấu, từ sau không).
    // Luật xét TỪNG TỪ, không xét cả cụm — nếu xét cả cụm thì một chữ có dấu
    // sẽ khoá cứng luôn những từ người ta cố tình gõ không dấu.
    expect(mauKhongDau('Nguồn nb')).toBe('nguồn nb');
    expect(mauKhongDau('nguon NB')).toBe('ng__n nb');
  });

  it('MẪU KHÔNG DẤU chỉ khớp BIẾN THỂ DẤU của chính nguyên âm đó', () => {
    // Đánh đổi cũ: "van" → "v_n" khớp cả "vin", "von", "vun" — những chữ KHÔNG
    // phải biến thể dấu của "van". Ca 01:12 12/08 lộ ra là nới thế quá tay.
    // Nay lọc lại ở TypeScript: mẫu `_` vẫn đi xuống DB (rẻ, không kéo bảng),
    // nhưng kết quả về phải qua khopBoDau() — so bỏ dấu ĐÚNG chữ.
    expect(khopBoDau('van', 'Anh Vấn Đà Nẵng')).toBe(true);
    expect(khopBoDau('van', 'ANh Văn')).toBe(true);       // Văn cũng là biến thể của "van" — đúng
    expect(khopBoDau('van', 'Chú Vinh')).toBe(false);     // "vin" KHÔNG phải biến thể dấu của "van"
    expect(khopBoDau('van', 'Anh Vốn')).toBe(false);
    expect(khopBoDau('thuc', 'Anh Thức CNC')).toBe(true);
    expect(khopBoDau('thuc', 'Anh Thắc')).toBe(false);
    // Từ khoá CÓ DẤU: so đúng dấu, không hạ chuẩn về bỏ dấu.
    expect(khopBoDau('Vấn', 'Anh Vấn Đà Nẵng')).toBe(true);
    expect(khopBoDau('Vấn', 'ANh Văn')).toBe(false);
  });

  it('TRẢI ĐỀU biến thể dấu — không để một chữ chiếm sạch trang đầu', () => {
    // Đo prod 12/08 sau bản sửa vòng 1: "van" ra 10 dòng + cờ còn-nữa nhưng
    // TOÀN Văn/Vạn/Vân, không có "Anh Vấn Đà Nẵng". Xếp hạng không cứu được vì
    // diemKhopTen so BỎ DẤU nên Văn và Vấn bằng điểm nhau — phải cho mỗi biến
    // thể một suất thay vì để chữ đông hơn chiếm hết.
    const ds = ['ANh Văn 1', 'ANh Văn 2', 'ANh Văn 3', 'A Vạn 1', 'Anh Vấn Đà Nẵng'];
    const kq = traiDeuBienTheDau('van', ds, (x) => x);

    // Vòng đầu: mỗi biến thể (văn, vạn, vấn) một suất.
    expect(kq.slice(0, 3)).toEqual(['ANh Văn 1', 'A Vạn 1', 'Anh Vấn Đà Nẵng']);
    // Không mất ai — chỉ đổi thứ tự.
    expect([...kq].sort()).toEqual([...ds].sort());
  });

  it('trải đều GIỮ NGUYÊN thứ tự trong cùng một biến thể', () => {
    // Xếp hạng theo điểm đã chạy trước đó; trải đều không được xáo trộn nó.
    const ds = ['Văn A', 'Văn B', 'Văn C', 'Vấn X'];
    expect(traiDeuBienTheDau('van', ds, (x) => x)).toEqual(['Văn A', 'Vấn X', 'Văn B', 'Văn C']);
  });

  it('từ khoá CÓ DẤU thì KHÔNG trải — chỉ còn một biến thể', () => {
    const ds = ['Anh Vấn Đà Nẵng', 'Chị Vấn Hà Nội'];
    expect(traiDeuBienTheDau('Vấn', ds, (x) => x)).toEqual(ds);
  });

  it('chỉ MỘT biến thể thì trả nguyên, không xáo trộn vô cớ', () => {
    const ds = ['Văn A', 'Văn B', 'Văn C'];
    expect(traiDeuBienTheDau('van', ds, (x) => x)).toEqual(ds);
  });

  it("'d' đầu từ VẪN thay được (vì 'đ'), giữa/cuối từ thì không", () => {
    // "dien" phải khớp "điện" — 'đ' chỉ nằm ở đầu từ tiếng Việt.
    expect(khop('dien', 'Dây điện 0.2 (m)')).toBe(true);
    expect(khop('do', 'Led đỏ 5050')).toBe(true);
    // Nhưng 'd' cuối từ ("led") giữ nguyên là chữ 'd' thật.
    expect(mauKhongDau('led')).toBe('l_d');
  });
});
