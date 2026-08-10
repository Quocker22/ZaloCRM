// SPDX-License-Identifier: AGPL-3.0-or-later
// Gộp các tin LIỀN TRƯỚC khi nhân viên tag bot mà không kèm nội dung.
//
// Bug thật 21:04-21:05 10/08 trong nhóm:
//   21:04:55  lên đơn cho anh Thức 10 cái nguồn NB   ← QUÊN tag → bot bỏ qua
//   21:05:00  @Tiểu Mã Nelia                          ← tag, nhưng TRỐNG
//
// Anh Quốc: "người ta tag trong một số trường hợp mấy tin trước đó quên tag
// thì sao???". Ý người dùng rõ ràng: tin trước là VIỆC, tin tag là "làm đi".
// Đáp "Dạ em đây, cần gì ạ?" là vô dụng khi câu lệnh nằm ngay dòng trên.

/** Số tin tối đa nuốt ngược — tag trống không được kéo cả buổi chat vào. */
const TRAN_GOP = 5;

export interface TinLichSu {
  senderUid: string | null;
  senderType: string;
  content: string;
}

/**
 * Nội dung thật sự của một tag trống — gộp các tin liền trước của CHÍNH người
 * đã tag, theo thứ tự cũ → mới.
 *
 * DỪNG khi gặp tin của người khác hoặc của bot: đó là ranh giới lượt nói. Nuốt
 * qua ranh giới ấy thì bot bốc nhầm câu người ta nói với nhau, hoặc làm lại
 * việc đã xong ở lượt trước.
 *
 * @param lichSu Cũ → mới, KHÔNG gồm chính tin tag (layLichSu đã bỏ tin đang xử).
 * @returns Nội dung gộp, hoặc `null` nếu không có gì để lấy.
 */
export function gopTinTruocKhiTag(
  senderUid: string,
  lichSu: readonly TinLichSu[],
): string | null {
  const gom: string[] = [];

  // Đi NGƯỢC từ tin mới nhất — tin gần tag nhất là tin liên quan nhất.
  for (let i = lichSu.length - 1; i >= 0 && gom.length < TRAN_GOP; i--) {
    const tin = lichSu[i];

    // Bot đã nói ở đây → lượt trước đã được trả lời, đừng nuốt ngược qua.
    if (tin.senderType === 'self') break;
    // Người khác chen vào → hết phần của người tag.
    if (tin.senderUid !== senderUid) break;

    const noi = (tin.content ?? '').trim();
    if (!noi) continue;
    // Tin trước cũng chỉ là một cái tag trống → bỏ, đừng gộp rác vào lệnh.
    if (laChiCoTag(noi)) continue;

    gom.push(noi);
  }

  if (gom.length === 0) return null;
  return gom.reverse().join('\n');
}

/**
 * Tin này CHỈ có mỗi cái tag, không kèm việc gì?
 *
 * Không tự chế regex cắt tag: mention Zalo là TÊN HIỂN THỊ có dấu cách
 * ("@Tiểu Mã Nelia"), nên `@\S+` sót đuôi, còn cắt tới hết dòng thì nuốt luôn
 * câu lệnh thật ("@Tiểu Mã Nelia lên đơn cho anh Thức" → rỗng).
 *
 * Cách chắc chắn: đếm chữ. Tin chỉ-có-tag là chuỗi ngắn gồm mention + vài từ
 * xưng hô; hễ còn từ nào KHÔNG thuộc mention thì coi là có nội dung. Mention
 * luôn đứng đầu tin nên chỉ cần bỏ phần '@…' ở đầu, giữ nguyên phần sau.
 */
function laChiCoTag(noi: string): boolean {
  // Bỏ mention/tag ở ĐẦU tin: '@' + các từ viết hoa liền sau (tên hiển thị),
  // hoặc các cách gọi cứng. Phần đuôi giữ nguyên để còn đếm.
  const conLai = noi
    .replace(/^\s*@\s*(?:[\p{Lu}][\p{L}]*|bot|ai)(?:\s+[\p{Lu}][\p{L}]*)*/u, '')
    .replace(/^\s*(?:\/bot|bot\s*[ơo]i)\b/i, '')
    .trim();
  return conLai.length === 0;
}
