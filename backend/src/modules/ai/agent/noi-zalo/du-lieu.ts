// SPDX-License-Identifier: AGPL-3.0-or-later
// NGUỒN DỮ LIỆU cho một lượt agent: Odoo client, lịch sử hội thoại, tri thức,
// và khoá chống trùng đơn. Không gửi gì đi đâu — chỉ ĐỌC và dựng.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { odooClientFromEnv, type OdooClient } from '../../odoo/client.js';
import { HoaDonAnhClient } from '../../odoo/hoa-don-anh.js';
import { searchKnowledge } from '../../knowledge/knowledge-service.js';
import { generateEmbedding } from '../../knowledge/embedding.js';
import { soTinLichSu } from './cong-tac.js';

// Client dựng MỘT LẦN rồi dùng lại: OdooClient nhớ uid sau khi đăng nhập, tạo
// mới mỗi tin là mỗi tin một lần authenticate thừa.
let odooCache: OdooClient | null = null;
let anhCache: HoaDonAnhClient | null = null;

export function layOdoo(): OdooClient {
  odooCache ??= odooClientFromEnv();
  return odooCache;
}

export function layAnhClient(): HoaDonAnhClient | undefined {
  if (!process.env.ODOO_URL) return undefined;
  anhCache ??= new HoaDonAnhClient({
    url: process.env.ODOO_URL, db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
  });
  return anhCache;
}

/**
 * Tra tài liệu kỹ thuật. Chưa nạp tài liệu → undefined để tool KHÔNG đăng ký.
 *
 * Không đăng ký còn hơn đăng ký rồi luôn rỗng: model sẽ gọi, không thấy gì, rồi
 * bịa thông số — mà bịa thông số kỹ thuật là khách lắp hỏng hàng.
 */
export async function timTriThuc(
  orgId: string,
): Promise<((cauHoi: string, soDoan: number) => Promise<Array<{ content: string; score?: number }>>) | undefined> {
  const n = await prisma.knowledgeChunk.count({ where: { orgId } });
  if (n === 0) return undefined;

  // KHÔNG mặc định `localhost:11434` nữa (2026-08-05). Mặc định đó viết cho
  // máy dev có Ollama; lên production không ai đặt biến nên nó âm thầm trỏ vào
  // cổng không tồn tại — chức năng tra tài liệu chết mà KHÔNG ai biết: 212 đoạn
  // nằm trong DB, đủ vector, không tra được lần nào.
  //
  // Thiếu cấu hình → tool KHÔNG đăng ký + log CẢNH BÁO. Bot mất khả năng tra
  // tài liệu (nó đang mất sẵn rồi), nhưng lần này có tiếng nói trong log.
  const baseUrl = process.env.EMBED_BASE_URL;
  if (!baseUrl) {
    logger.warn(
      { orgId, soDoan: n },
      '[agent] CHƯA đặt EMBED_BASE_URL — tắt tra tài liệu kỹ thuật dù DB có sẵn đoạn',
    );
    return undefined;
  }

  const cfg = {
    provider: process.env.EMBED_PROVIDER ?? 'openai',
    model: process.env.EMBED_MODEL ?? 'google/gemini-embedding-001',
    baseUrl,
    apiKey: process.env.EMBED_API_KEY,
  };
  return async (cauHoi, soDoan) =>
    (await searchKnowledge({ prisma, embed: generateEmbedding } as never, orgId, cauHoi, soDoan, cfg))
      .map((h) => ({ content: h.content, score: h.score }));
}

/**
 * Lịch sử hội thoại (cũ → mới), BỎ chính tin đang xử lý: nó được truyền riêng,
 * để trong lịch sử nữa thì model thấy hai lần và tưởng khách nhắc lại.
 */
export async function layLichSu(
  conversationId: string,
  messageId: string,
): Promise<Array<{ senderType: string; content: string; senderUid: string | null }>> {
  const rows = await prisma.message.findMany({
    where: { conversationId, isDeleted: false, id: { not: messageId }, contentType: 'text' },
    orderBy: { sentAt: 'desc' },
    take: soTinLichSu(),
    // senderUid: để luồng nhân viên phân biệt AI ĐANG RA LỆNH với khách/bot —
    // thiếu nó thì vai trong lịch sử bị gán ngược (bug thật 06/08).
    select: { senderType: true, content: true, senderUid: true },
  });
  return rows.reverse()
    .filter((m): m is { senderType: string; content: string; senderUid: string | null } => Boolean(m.content))
    .map((m) => ({ ...m, content: bocKhoiTuBom(m.content) }))
    .filter((m) => Boolean(m.content));
}

/**
 * BẢO HIỂM chống memory tự nhiễm (A1, 14/08 — học TencentDB openclaw-plugin
 * capture.ts): các khối do CHÍNH HỆ THỐNG ghép vào câu đưa cho model
 * (`[Khách gửi ảnh…]`, `[Trả lời tin: "…"]`) không bao giờ được phép quay lại
 * lịch sử — nếu lọt, mỗi lượt sau model lại thấy khối cũ, trích lại, và kho
 * nhớ tự nhân bản echo của chính nó.
 *
 * Hôm nay đường lưu ĐÃ đúng (message-handler lưu content thô từ webhook,
 * enrich chỉ nằm trên biến đưa agent) — hàm này là LỚP HAI, phòng ngày nào đó
 * một đường lưu mới quên luật. Nội dung sạch đi qua NGUYÊN VẸN.
 */
export function bocKhoiTuBom(s: string): string {
  let t = s;
  // Khối quote-reply hệ thống chèn đầu câu: `[Trả lời tin: "…"] câu thật`.
  if (t.startsWith('[Trả lời tin:')) {
    const dong = t.indexOf(']');
    if (dong >= 0) t = t.slice(dong + 1);
  }
  // Khối ảnh hệ thống ghép (đa dòng, kết ở ] cuối cùng). Tham lam có chủ ý:
  // đây là nội dung KHÔNG ĐƯỢC TỒN TẠI trong DB — cắt lố còn hơn giữ mầm nhiễm.
  const iAnh = t.indexOf('[Khách gửi ảnh');
  if (iAnh >= 0) {
    const dongCuoi = t.lastIndexOf(']');
    t = dongCuoi > iAnh ? t.slice(0, iAnh) + t.slice(dongCuoi + 1) : t.slice(0, iAnh);
  }
  return t.trim();
}

/**
 * Có TIN KHÁCH nào MỚI HƠN `messageId` trong hội thoại không?
 *
 * Khách Zalo hay gõ 3-4 tin liên tiếp (từng câu ngắn). Bot bắt đầu xử lý tin
 * #1, gọi LLM mất vài giây, trong lúc đó #2 #3 đến. Nếu cứ trả lời #1 thì lệch
 * — khách hỏi "cả tháng này và tháng trước" mà bot chỉ thấy "cả" của tin đầu.
 *
 * Cách xử (học Chatwoot newer_customer_message_arrived, 07/08): TRƯỚC khi gửi
 * câu trả lời, kiểm có tin khách mới hơn chưa. Có → BỎ lượt này, để lượt do
 * tin mới kích trả lời gộp cả chuỗi. Chỉ tính tin KHÁCH (senderType='contact')
 * — tin của bot/nhân viên không tính.
 */
export async function coTinKhachMoiHon(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const dangXuLy = await prisma.message.findUnique({
    where: { id: messageId }, select: { sentAt: true },
  });
  if (!dangXuLy) return false;
  const moiHon = await prisma.message.count({
    where: {
      conversationId,
      senderType: 'contact',
      isDeleted: false,
      sentAt: { gt: dangXuLy.sentAt },
    },
  });
  return moiHon > 0;
}

/**
 * `seq` cho khoá chống trùng đơn — dẫn xuất từ messageId, KHÔNG phải số đếm.
 *
 * Khoá đơn là `zalo:{conversationId}:{seq}`, nguyên tắc (idempotency.ts): "retry
 * phải sinh RA CÙNG một khoá". Số đếm vi phạm: nhân viên gõ lại cùng lệnh vì
 * tưởng chưa nhận → số đếm đã tăng → khoá khác → HAI ĐƠN cho một ý định.
 *
 * FNV-1a 32-bit: cùng tin luôn cho cùng số (kể cả sau restart), tin khác cho số
 * khác — lệnh thứ hai thật sự vẫn tạo được đơn thứ hai.
 */
export function seqTuMessageId(messageId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < messageId.length; i++) {
    h ^= messageId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
