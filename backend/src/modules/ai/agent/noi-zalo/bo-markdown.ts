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
