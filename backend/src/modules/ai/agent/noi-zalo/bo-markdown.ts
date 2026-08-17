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
const MO_DAU_TRA_LOI = /^(Anh\/chị|Anh|Chị|Dạ|Em |Chào|Bên em|Hiện|Đơn|Phiếu|Sản phẩm|Khách|Tổng|Tồn|Giá|Doanh|Công nợ|Còn|Có |Không có|Vâng|Ok|OK|Báo cáo|Danh sách|Tài khoản)/;

export function bocDocThoai(text: string): string {
  const doan = text.split(/\n\s*\n/);
  if (doan.length < 2) return text;
  // Tìm đoạn TRẢ LỜI THẬT cuối cùng: mở đầu như câu nói với người và KHÔNG có dấu hiệu nghĩ.
  let iTraLoi = -1;
  for (let i = doan.length - 1; i >= 1; i--) {
    const d = doan[i].trim();
    if (MO_DAU_TRA_LOI.test(d) && !DAU_HIEU_NGHI.test(d)) { iTraLoi = i; break; }
  }
  if (iTraLoi < 1) return text;
  const truoc = doan.slice(0, iTraLoi).join('\n\n');
  if (!DAU_HIEU_NGHI.test(truoc)) return text; // khối trước không giống suy nghĩ → giữ nguyên
  return doan.slice(iTraLoi).join('\n\n').trim();
}
