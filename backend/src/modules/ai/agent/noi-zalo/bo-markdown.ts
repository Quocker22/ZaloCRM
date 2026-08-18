// SPDX-License-Identifier: AGPL-3.0-or-later
// Cổng ra chống markdown — Zalo hiển thị text thô, "**đậm**" đến tay khách
// nguyên dấu sao (chat thật 16:42 08/08). Prompt đã dặn "KHÔNG markdown" ngay
// dòng đầu mà model vẫn vi phạm → chặn tất định ở guiTin, hết cãi.
//
// Chỉ gỡ cú pháp KHÔNG THỂ là nội dung thật; thứ dễ lẫn (dấu - gạch ngang,
// dấu * trong "2*3m", dấu # trong URL) tuyệt đối không đụng.

const LINK_MD = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function boMarkdown(text: string): string {
  return text
    .replace(LINK_MD, '$1: $2')            // [nhãn](url) → nhãn: url
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')   // **đậm**
    .replace(/__([^_\n]+)__/g, '$1')       // __đậm__
    .replace(/`([^`\n]+)`/g, '$1')         // `code`
    .replace(/^#{1,6}\s+/gm, '');          // ### heading đầu dòng
}

/**
 * BÓC ĐỘC THOẠI NỘI TÂM của model khỏi tin gửi ra (17/08, lần thứ HAI sau
 * ca catalog 13/08). Ca thật 22:27 17/08, bot nhả nguyên:
 *   "Câu hỏi của nhân viên: … Đây không phải là dừng/sửa/lên đơn. … Em đã trả
 *    lời trước đó … Tôi chỉ cần nhắc lại ngắn gọn. Không có tool ghi. Không có
 *    tool tra ngân hàng. Đáp lại.
 *    Anh/chị ơi, bên em không có thông tin số tài khoản…"
 * Model rẻ hay "nghĩ thành lời" trước câu trả lời thật. Prompt cấm rồi vẫn
 * lọt → chặn tất định ở cổng ra: KHỐI ĐẦU (các đoạn/dòng trước) mang dấu
 * hiệu suy nghĩ (xưng "Tôi", nói về "tool", "nhân viên hỏi", "Đáp lại"…) và
 * PHÍA SAU còn một đoạn trả lời thật (mở đầu kiểu Anh/chị/Dạ/Em/Chào…) → cắt
 * khối đầu. Không thoả cả hai điều kiện thì GIỮ NGUYÊN — thà lọt một câu
 * lẩm bẩm còn hơn cắt mất câu trả lời thật.
 */
const DAU_HIEU_NGHI =
  /\b(Tôi|tôi)\s+(chỉ|cần|sẽ|đã|nên|phải|thấy|hiểu|nhận thấy)|Câu hỏi của (nhân viên|khách)|(Không|Có) (có )?tool\b|Đáp lại\.?$|^Lặp lại câu hỏi|không phải là (dừng|sửa|lên đơn)/m;

/**
 * KIỂU ĐỘC THOẠI THỨ HAI — TƯỜNG THUẬT (18/08, lần thứ BA sau 13/08 và 17/08).
 *
 * Ca thật 11:56:24, anh Quốc gửi kèm "cái gì thế này?". Bot nhả nguyên:
 *   "Nhân viên nói "led zz thấu kính" giá 80k/cuộn. Các kết quả trên không
 *    khớp giá 80k/cuộn — … "zz thấu kính" 80k/cuộn chưa tìm thấy rõ ràng.
 *    Tin mới "sai mã hàng rồi" — nói rõ tôi đang để sai mã.
 *    Đang làm dở việc lên đơn cho Anh Tuấn QC Thăng Long 13 cuộn…
 *    Dạ anh/chị nói "sai mã hàng rồi" — …"          ← câu trả lời thật ở đây
 *
 * Khác hẳn ca 17/08: không xưng "tôi ... cần", không nhắc "tool", không "Đáp
 * lại." — nên `DAU_HIEU_NGHI` trượt sạch và cả khối lọt ra nguyên. Kiểu này
 * model KỂ LẠI tình hình cho chính nó: mở đầu bằng "Nhân viên nói…", "Khách
 * nói…", "Tin mới…", "Các kết quả trên…", "Đang làm dở việc…".
 *
 * Tách thành hằng số RIÊNG (không nhét thêm vào regex trên) vì hai kiểu có
 * đời sống khác nhau: kiểu 17/08 nhận ra bằng ĐẠI TỪ và TỪ KỸ THUẬT, kiểu này
 * bằng LỐI KỂ NGÔI THỨ BA về hội thoại. Trộn một cục thì lần sửa sau không ai
 * biết vế nào đang bắt ca nào.
 */
const DAU_HIEU_TUONG_THUAT =
  /^(Nhân viên|Khách|NV|Tin mới|Các kết quả|Kết quả trên|Đang làm dở|Người dùng)\b|^"[^"]+" (chưa|không) (tìm thấy|khớp)/m;
const MO_DAU_TRA_LOI = /^(Anh\/chị|Anh|Chị|Dạ|Em |Chào|Bên em|Hiện|Đơn|Phiếu|Sản phẩm|Khách|Tổng|Tồn|Giá|Doanh|Công nợ|Còn|Có |Không có|Vâng|Ok|OK|Báo cáo|Danh sách|Tài khoản)/;

export function bocDocThoai(text: string): string {
  const doan = text.split(/\n\s*\n/);
  if (doan.length < 2) return text;
  // Tìm đoạn TRẢ LỜI THẬT ĐẦU TIÊN (quét XUÔI, sửa 18/08): phần nói với người
  // thường dài nhiều đoạn — "Dạ anh/chị nói … phải không ạ?" rồi "Em cần
  // anh/chị cho em mã …". Quét ngược lấy đoạn CUỐI là cắt mất câu hỏi chính
  // giữa, nhân viên nhận được nửa ý. Bắt đầu từ 1 vì đoạn 0 mà đã là câu trả
  // lời thì không có gì để bóc.
  let iTraLoi = -1;
  for (let i = 1; i < doan.length; i++) {
    const d = doan[i].trim();
    if (MO_DAU_TRA_LOI.test(d) && !DAU_HIEU_NGHI.test(d) && !DAU_HIEU_TUONG_THUAT.test(d)) {
      iTraLoi = i; break;
    }
  }
  if (iTraLoi < 1) return text;
  const truoc = doan.slice(0, iTraLoi).join('\n\n');
  // Khối trước không giống suy nghĩ (CẢ HAI kiểu) → giữ nguyên. Thà lọt một
  // câu lẩm bẩm còn hơn cắt mất câu trả lời thật.
  if (!DAU_HIEU_NGHI.test(truoc) && !DAU_HIEU_TUONG_THUAT.test(truoc)) return text;
  return doan.slice(iTraLoi).join('\n\n').trim();
}
