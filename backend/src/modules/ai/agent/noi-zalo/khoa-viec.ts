// SPDX-License-Identifier: AGPL-3.0-or-later
// KHOÁ VIỆC — chặn hai lượt cùng xử lý MỘT câu lệnh.
//
// Bug thật 21:34:22-24 10/08 (nhóm), do chính bản "tag trống nuốt tin trước"
// gây ra:
//   21:34:23.637  tin "lên đơn cho anh Thức" TỰ chạy (nhóm không bắt tag)
//   21:34:24.674  tag trống chạy, nuốt LẠI đúng câu đó → chạy lần hai
//   21:34:26 + :28  bot trả lời HAI LẦN cùng nội dung
//
// Vì sao mấy lớp bảo vệ cũ không cứu:
//   - "dừng ở tin của bot" (gop-tin) nhìn LỊCH SỬ, mà lúc đó bot còn ĐANG xử
//     lý — chưa có tin nào để thấy.
//   - `aiSuggestion.count` (luồng khách) cũng chỉ có bản ghi SAU khi xong.
// Hai lượt cách nhau 1 giây thì mọi phép "nhìn kết quả đã có" đều thua.
//
// Khoá này đặt NGAY KHI BẮT ĐẦU và theo NỘI DUNG việc (không theo messageId):
// hai lượt trên đến từ hai tin khác nhau nhưng cùng một việc.
//
// DÙNG Ở CẢ HAI LUỒNG từ 11/08. Ban đầu chỉ luồng nhân viên, vì bug 21:34 xảy
// ra ở đó. Dò lại prod thấy luồng KHÁCH có đúng cùng khe hở — hội thoại
// 0d81fe67 (chat 1-1), 04/08:
//   18:23:41.303  khách "chào"  messageId 24f20f8e…
//   18:23:46.550  khách "chào"  messageId a558b28e…   ← id KHÁC, cùng một việc
//   18:23:59 + 18:24:15  bot chào LẠI hai lần
// `aiSuggestion.count` đếm theo messageId nên không thấy gì; `coTinKhachMoiHon`
// chạy sau LLM và lượt tin mới nhất không có tin nào mới hơn để bỏ.
//
// RANH GIỚI với hai lớp kia (đừng gộp — mỗi lớp một bài toán):
//   - lớp này        : hai TIN KHÁC NHAU, cùng NỘI DUNG, trong ~100 giây
//   - aiSuggestion   : CÙNG MỘT TIN được xử lý lại, không giới hạn thời gian
//   - coTinKhachMoiHon: tin nội dung KHÁC NHAU, cần GỘP ngữ cảnh chứ không phải
//                       chặn trùng
import { createHash } from 'node:crypto';
import { getRedis } from '../../../../shared/redis-client.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * Bao lâu thì coi hai lượt là "cùng một việc".
 *
 * Đủ dài để phủ một lượt agent chậm nhất (đo thật: 8-15s, trần 90s), đủ ngắn
 * để nhân viên gõ LẠI y hệt câu đó vài phút sau vẫn chạy được — họ thường làm
 * vậy khi muốn lên đơn thứ hai giống đơn đầu.
 */
const HAN_GIAY = 100;

/** Đường lui khi không có Redis (dev, hoặc Redis chết): khoá trong tiến trình. */
const trongBoNho = new Map<string, number>();

function chuanHoa(cau: string): string {
  return cau.toLowerCase().replace(/\s+/g, ' ').trim();
}

function khoaCua(conversationId: string, cau: string): string {
  const bam = createHash('sha1').update(chuanHoa(cau)).digest('hex').slice(0, 16);
  return `agent:viec:${conversationId}:${bam}`;
}

/**
 * Giành quyền xử lý một việc. `true` = lượt này được chạy; `false` = lượt khác
 * đang/vừa chạy đúng việc đó, caller phải im lặng bỏ qua.
 *
 * Câu RỖNG luôn trả `true`: tag trống chưa gộp được gì thì không có "việc" nào
 * để khoá, và khoá chuỗi rỗng sẽ chặn nhầm mọi tag trống sau đó.
 */
export async function thuGiuViec(
  conversationId: string,
  cau: string,
  // Tiêm được để test đúng NHÁNH REDIS — đó mới là nhánh chạy trên prod, còn
  // test thì không có Redis nên mặc định rơi xuống bộ nhớ và không kiểm được.
  layRedis: typeof getRedis = getRedis,
): Promise<boolean> {
  const sach = chuanHoa(cau);
  if (!sach) return true;

  const khoa = khoaCua(conversationId, sach);

  try {
    const redis = await layRedis();
    if (redis) {
      // SET NX EX — nguyên tử, đúng thứ cần: chỉ một lượt đặt được khoá.
      const dat = await redis.set(khoa, '1', 'EX', HAN_GIAY, 'NX');
      return dat === 'OK';
    }
  } catch (err) {
    // Redis lỗi → rơi xuống bộ nhớ. KHÔNG chặn việc chỉ vì hạ tầng trục trặc:
    // thà trả lời hai lần còn hơn im lặng nuốt lệnh của nhân viên.
    logger.warn({ err }, '[khoa-viec] Redis lỗi — dùng khoá trong bộ nhớ');
  }

  const gio = Date.now();
  const het = trongBoNho.get(khoa);
  if (het && het > gio) return false;
  trongBoNho.set(khoa, gio + HAN_GIAY * 1000);
  // Dọn rác: bản đồ này chỉ sống trong tiến trình, đừng để nó phình mãi.
  if (trongBoNho.size > 500) {
    for (const [k, h] of trongBoNho) if (h <= gio) trongBoNho.delete(k);
  }
  return true;
}

/** Chỉ dùng trong test — xoá khoá bộ nhớ giữa các ca. */
export function _resetKhoaViecChoTest(): void {
  trongBoNho.clear();
}
