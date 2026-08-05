// SPDX-License-Identifier: AGPL-3.0-or-later
// NGUỒN DỮ LIỆU cho một lượt agent: Odoo client, lịch sử hội thoại, tri thức,
// và khoá chống trùng đơn. Không gửi gì đi đâu — chỉ ĐỌC và dựng.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { odooClientFromEnv, type OdooClient } from '../../odoo/client.js';
import { HoaDonAnhClient } from '../../odoo/hoa-don-anh.js';
import { searchKnowledge } from '../../knowledge/knowledge-service.js';
import { generateEmbedding } from '../../knowledge/embedding.js';
import { SO_TIN_LICH_SU } from './cong-tac.js';

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
  const cfg = {
    provider: process.env.EMBED_PROVIDER ?? 'local',
    model: process.env.EMBED_MODEL ?? 'bge-m3',
    baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
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
): Promise<Array<{ senderType: string; content: string }>> {
  const rows = await prisma.message.findMany({
    where: { conversationId, isDeleted: false, id: { not: messageId }, contentType: 'text' },
    orderBy: { sentAt: 'desc' },
    take: SO_TIN_LICH_SU,
    select: { senderType: true, content: true },
  });
  return rows.reverse()
    .filter((m): m is { senderType: string; content: string } => Boolean(m.content));
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
