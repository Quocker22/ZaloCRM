// SPDX-License-Identifier: AGPL-3.0-or-later
// Nối agent tool-calling vào luồng tin Zalo thật.
//
// VÌ SAO LÀ FILE RIÊNG, KHÔNG SỬA auto-reply-wiring.ts: luồng RAG cũ đang phục
// vụ khách thật. File này đứng cạnh nó, bật/tắt bằng biến môi trường — hỏng thì
// tắt biến là quay về nguyên trạng, không cần deploy lại.
//
// HAI CÔNG TẮC (mặc định TẮT — bật có chủ đích, không phải hiệu ứng phụ của deploy):
//   AI_AGENT_NHANVIEN=1  → nhân viên gõ "@bot ..." thì agent trả lời
//   AI_AGENT_KHACH=1     → khách nhắn thì agent trả lời THAY luồng RAG cũ
//
// LLM lấy từ AiConfig + AppSetting (per-org, đã mã hoá) — CÙNG nguồn luồng RAG
// cũ đang dùng. Không bắt thêm biến LLM_* để hai luồng khỏi lệch model/key.
// Chỉ Odoo cần biến môi trường (ODOO_URL/DB/USERNAME/PASSWORD); thiếu thì cả
// hai luồng im lặng và luồng cũ chạy tiếp.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../../shared/database/prisma-client.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { logger } from '../../../shared/utils/logger.js';
import { odooClientFromEnv, type OdooClient } from '../odoo/client.js';
import { HoaDonAnhClient } from '../odoo/hoa-don-anh.js';
import { generateWithOpenaiCompatTools } from '../providers/openai-compat.js';
import { getProviderApiKey } from '../ai-service.js';
import { getProviderBaseUrl } from '../provider-registry.js';
import { humanPace } from '../knowledge/human-pace.js';
import { findImageForReply } from '../knowledge/product-image.js';
import { searchKnowledge } from '../knowledge/knowledge-service.js';
import { generateEmbedding } from '../knowledge/embedding.js';
import { chayLenhNhanVien } from './staff-agent.js';
import { chayTuVanKhach } from './customer-agent.js';
import { nhanDienLenhNhanVien } from './staff-command.js';
import { taoGhiLog, type PrismaGhiLog } from './ghi-log-tool.js';
import type { ToolAwareGenerate } from './types.js';
import type { ToolCallLog } from './staff-agent.js';

/**
 * Prisma sinh kiểu `create` chặt hơn `PrismaGhiLog` (vốn chỉ cần một hàm nhận
 * `{data}`). Ép ở ĐÚNG MỘT CHỖ này thay vì nới lỏng kiểu trong ghi-log-tool —
 * nới ra thì test dùng bản giả sẽ mất luôn kiểm tra kiểu.
 */
const prismaLog = prisma as unknown as PrismaGhiLog;

/** Số tin lịch sử nạp vào ngữ cảnh — đủ để hiểu "cái đó", không phình prompt. */
const SO_TIN_LICH_SU = 10;

export function batLuongNhanVien(): boolean {
  return process.env.AI_AGENT_NHANVIEN === '1';
}

export function batLuongKhach(): boolean {
  return process.env.AI_AGENT_KHACH === '1';
}

/**
 * Có đủ Odoo để chạy agent không. Thiếu → luồng cũ chạy tiếp.
 *
 * KHÔNG kiểm LLM ở đây: key/model lấy từ DB per-org lúc chạy (xem `dungGenerate`).
 */
export function duCauHinh(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ODOO_URL && env.ODOO_DB && env.ODOO_USERNAME && env.ODOO_PASSWORD);
}

// Client dựng MỘT LẦN rồi dùng lại: OdooClient nhớ uid sau khi đăng nhập, tạo
// mới mỗi tin là mỗi tin một lần authenticate thừa.
let odooCache: OdooClient | null = null;
let anhCache: HoaDonAnhClient | null = null;

function layOdoo(): OdooClient {
  odooCache ??= odooClientFromEnv();
  return odooCache;
}

function layAnhClient(): HoaDonAnhClient | undefined {
  if (!process.env.ODOO_URL) return undefined;
  anhCache ??= new HoaDonAnhClient({
    url: process.env.ODOO_URL, db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!, password: process.env.ODOO_PASSWORD!,
  });
  return anhCache;
}

/**
 * Dựng hàm gọi LLM từ cấu hình per-org.
 *
 * Cùng nguồn luồng RAG cũ dùng, nên đổi model/key trên giao diện là cả hai
 * luồng đổi theo — không có chuyện agent chạy model khác luồng cũ.
 *
 * Trả null khi chưa có key: caller im lặng, nhường luồng cũ (nó tự báo lỗi
 * theo cách của nó) thay vì ném giữa chừng.
 */
async function dungGenerate(orgId: string): Promise<ToolAwareGenerate | null> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId } });
  if (!cfg) return null;
  const apiKey = await getProviderApiKey(orgId, cfg.provider);
  if (!apiKey) return null;
  const baseUrl = await getProviderBaseUrl(orgId, cfg.provider);
  if (!baseUrl) return null;

  return (a) =>
    generateWithOpenaiCompatTools({
      url: `${baseUrl}/chat/completions`,
      apiKey,
      model: cfg.model,
      ...(process.env.LLM_TIMEOUT_MS ? { timeoutMs: Number(process.env.LLM_TIMEOUT_MS) } : {}),
      ...a,
    });
}

/**
 * Tra tài liệu kỹ thuật. Chưa nạp tài liệu → trả undefined để tool KHÔNG đăng ký.
 *
 * Không đăng ký còn hơn đăng ký rồi luôn rỗng: model sẽ gọi, không thấy gì, rồi
 * bịa thông số — mà bịa thông số kỹ thuật là khách lắp hỏng hàng.
 */
async function timTriThuc(orgId: string) {
  const n = await prisma.knowledgeChunk.count({ where: { orgId } });
  if (n === 0) return undefined;
  const cfg = {
    provider: process.env.EMBED_PROVIDER ?? 'local',
    model: process.env.EMBED_MODEL ?? 'bge-m3',
    baseUrl: process.env.EMBED_BASE_URL ?? 'http://localhost:11434/v1',
  };
  return async (cauHoi: string, soDoan: number) =>
    (await searchKnowledge({ prisma, embed: generateEmbedding } as never, orgId, cauHoi, soDoan, cfg))
      .map((h) => ({ content: h.content, score: h.score }));
}

interface DichGui {
  accountId: string;
  threadId: string;
  threadType: 0 | 1;
}

/** Tra đích gửi từ conversationId. Không đủ dữ liệu → null, caller bỏ qua. */
async function timDich(conversationId: string): Promise<DichGui | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      zaloAccountId: true, threadType: true, externalThreadId: true,
      contact: { select: { zaloUid: true } },
    },
  });
  if (!c?.zaloAccountId) return null;
  // Group có externalThreadId riêng; hội thoại 1-1 dùng zaloUid của contact.
  const threadId = c.externalThreadId ?? c.contact?.zaloUid;
  if (!threadId) return null;
  return {
    accountId: c.zaloAccountId,
    threadId,
    threadType: c.threadType === 'group' ? 1 : 0,
  };
}

/**
 * Ghi ảnh ra file tạm — `zaloOps.sendImage` nhận đường dẫn, không nhận Buffer.
 *
 * Cùng cách luồng cũ làm với ảnh QR (qr-image.ts). Không dọn file: thư mục tạm
 * do OS dọn, và giữ lại thì còn tra được khi nhân viên báo "ảnh sai".
 */
async function ghiAnhTam(duLieu: Buffer, tenFile: string): Promise<string> {
  const dir = join(tmpdir(), 'zcrm-hoadon');
  await mkdir(dir, { recursive: true });
  const duongDan = join(dir, `${Date.now()}-${tenFile}`);
  await writeFile(duongDan, duLieu);
  return duongDan;
}

/**
 * @param giaNguoi giãn theo nhịp gõ người trước khi gửi.
 *
 * BẬT cho khách: trả lời tức thì thì lộ là bot, và Zalo gắn cờ spam.
 * TẮT cho nhân viên: họ BIẾT đang nói với bot, bắt chờ thêm tới 9s mỗi lệnh
 * chỉ làm chậm việc — nhịp người ở đây không lừa được ai.
 */
async function guiTin(dich: DichGui, text: string, giaNguoi: boolean): Promise<void> {
  if (giaNguoi) await humanPace(text.length);
  await zaloOps.sendMessage(dich.accountId, dich.threadId, dich.threadType, { msg: text });
}

/**
 * `seq` cho khoá chống trùng đơn — dẫn xuất từ messageId, KHÔNG phải số đếm.
 *
 * Khoá đơn là `zalo:{conversationId}:{seq}`, và nguyên tắc của nó (idempotency.ts)
 * là "retry phải sinh RA CÙNG một khoá". Số đếm vi phạm điều đó: nhân viên gõ lại
 * cùng một lệnh vì tưởng chưa nhận, hoặc Zalo gửi trùng tin, thì số đếm đã tăng
 * (mỗi tool đều ghi log) → khoá khác → HAI ĐƠN cho một ý định.
 *
 * Dẫn xuất từ messageId thì cùng tin luôn cho cùng số, kể cả sau khi container
 * khởi động lại. Tin khác nhau vẫn cho số khác nhau nên lệnh thứ hai thật sự
 * vẫn tạo được đơn thứ hai.
 *
 * FNV-1a 32-bit: đủ tản cho phạm vi một hội thoại (đụng độ cần ~65k tin trong
 * CÙNG một hội thoại), và cho số nguyên dương ổn định giữa các lần chạy.
 */
export function seqTuMessageId(messageId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < messageId.length; i++) {
    h ^= messageId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

async function layLichSu(
  conversationId: string,
  messageId: string,
): Promise<Array<{ senderType: string; content: string }>> {
  const rows = await prisma.message.findMany({
    // Bỏ chính tin đang xử lý: nó được truyền riêng qua `message`, để trong
    // lịch sử nữa thì model thấy hai lần và tưởng khách nhắc lại.
    where: { conversationId, isDeleted: false, id: { not: messageId }, contentType: 'text' },
    orderBy: { sentAt: 'desc' },
    take: SO_TIN_LICH_SU,
    select: { senderType: true, content: true },
  });
  return rows.reverse()
    .filter((m): m is { senderType: string; content: string } => Boolean(m.content));
}

export interface NgữCanhTin {
  orgId: string;
  bizName: string;
  conversationId: string;
  messageId: string;
  content: string;
}

/**
 * Nhân viên gõ "@bot ..." → chạy agent nhân viên.
 *
 * Trả về true nếu ĐÃ xử lý (kể cả khi lỗi) để caller biết không cần làm gì thêm.
 */
export async function xuLyTinNhanVien(ctx: NgữCanhTin): Promise<boolean> {
  if (!batLuongNhanVien() || !duCauHinh()) return false;
  // CỔNG RẺ: không tag @bot thì không dựng registry, không gọi LLM.
  if (!nhanDienLenhNhanVien({ content: ctx.content, isSelf: true })) return false;

  const dich = await timDich(ctx.conversationId);
  if (!dich) {
    logger.warn({ conversationId: ctx.conversationId }, '[agent] không tra được thread để trả lời');
    return false;
  }

  const generate = await dungGenerate(ctx.orgId);
  if (!generate) {
    logger.warn({ orgId: ctx.orgId }, '[agent] chưa cấu hình LLM cho tổ chức — bỏ qua');
    return false;
  }

  const t0 = Date.now();
  const ghiDb = taoGhiLog({
    prisma: prismaLog, orgId: ctx.orgId, vai: 'nhanvien', conversationId: ctx.conversationId,
    onError: (err) => logger.warn({ err }, '[agent] ghi log tool lỗi'),
  });

  try {
    const lichSu = await layLichSu(ctx.conversationId, ctx.messageId);
    const r = await chayLenhNhanVien(
      {
        odoo: layOdoo(),
        generate,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent] chuyển sale');
        },
        ghiLog: ghiDb,
        anhClient: layAnhClient(),
        odooUrl: process.env.ODOO_URL,
        timDoanTriThuc: await timTriThuc(ctx.orgId),
      },
      {
        bizName: ctx.bizName,
        conversationId: ctx.conversationId,
        seq: seqTuMessageId(ctx.messageId),
        message: { content: ctx.content, isSelf: true },
        history: lichSu.map((m) => ({
          vai: m.senderType === 'self' ? ('nhanvien' as const) : ('bot' as const),
          noiDung: m.content,
        })),
      },
    );

    if (r.trangThai === 'khong_phai_lenh') return false;

    if (r.trangThai === 'xong') {
      await guiTin(dich, r.traLoi, false);
      // Hoá đơn: gửi ảnh nếu dựng được, kèm link để nhân viên bấm vào xử lý.
      if (r.hoaDon) {
        if (r.hoaDon.anh) {
          try {
            const duongDan = await ghiAnhTam(r.hoaDon.anh.duLieu, r.hoaDon.anh.tenFile);
            await zaloOps.sendImage(dich.accountId, dich.threadId, dich.threadType, [duongDan]);
          } catch (err) {
            logger.warn({ err }, '[agent] gửi ảnh hoá đơn lỗi (vẫn gửi link)');
          }
        }
        // Link gửi DÙ có ảnh: ảnh để xem, link để nhân viên bấm vào xử lý đơn.
        await guiTin(dich, `Hoá đơn ${r.hoaDon.maDon}: ${r.hoaDon.link}`, false);
      }
    } else {
      // Dở dang: báo nhân viên tự xử, KHÔNG im lặng để họ còn biết mà làm.
      await guiTin(dich, `Bot chưa xử lý xong (${r.lyDo}). Anh/chị xử lý giúp nhé.`, false);
    }

    logger.info(
      { ms: Date.now() - t0, trangThai: r.trangThai, conversationId: ctx.conversationId },
      '[agent] xong lệnh nhân viên',
    );
    return true;
  } catch (err) {
    logger.error({ err, conversationId: ctx.conversationId }, '[agent] lỗi luồng nhân viên');
    return true; // đã nhận lệnh rồi, đừng để luồng cũ trả lời chồng lên
  }
}

/**
 * Khách nhắn → chạy agent khách THAY luồng RAG cũ.
 *
 * Trả true nếu đã xử lý; caller phải BỎ QUA luồng RAG khi thấy true, nếu không
 * khách nhận hai câu trả lời khác nhau cho cùng một tin.
 */
export async function xuLyTinKhach(ctx: NgữCanhTin): Promise<boolean> {
  if (!batLuongKhach() || !duCauHinh()) return false;

  const cfg = await prisma.aiConfig.findUnique({ where: { orgId: ctx.orgId } });
  // Tôn trọng công tắc chung: tắt auto-reply thì agent cũng im, giống luồng cũ.
  if (!cfg?.autoReplyEnabled) return false;

  const dich = await timDich(ctx.conversationId);
  if (!dich) return false;

  // Chống trả lời hai lần cùng một tin (retry, tin trùng từ Zalo).
  const daXuLy = await prisma.aiSuggestion.count({
    where: { orgId: ctx.orgId, messageId: ctx.messageId, type: 'auto_reply_agent' },
  });
  if (daXuLy > 0) return true;

  const generate = await dungGenerate(ctx.orgId);
  if (!generate) return false; // nhường luồng cũ, nó tự báo lỗi theo cách của nó

  const t0 = Date.now();
  const ghiDb = taoGhiLog({
    prisma: prismaLog, orgId: ctx.orgId, vai: 'khach', conversationId: ctx.conversationId,
    onError: (err) => logger.warn({ err }, '[agent] ghi log tool lỗi'),
  });

  try {
    const lichSu = await layLichSu(ctx.conversationId, ctx.messageId);
    const r = await chayTuVanKhach(
      {
        odoo: layOdoo(),
        generate,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent] khách cần sale');
        },
        ghiLog: ghiDb,
        timDoanTriThuc: await timTriThuc(ctx.orgId),
      },
      {
        bizName: ctx.bizName,
        message: ctx.content,
        history: lichSu.map((m) => ({
          vai: m.senderType === 'self' ? ('shop' as const) : ('khach' as const),
          noiDung: m.content,
        })),
      },
    );

    if (r.trangThai !== 'xong') {
      // KHÔNG gửi gì cho khách khi bot bí — im lặng để nhân viên vào trả lời,
      // tốt hơn là "em chưa xử lý được" rồi khách bỏ đi.
      logger.warn({ lyDo: r.lyDo, conversationId: ctx.conversationId }, '[agent] khách: chưa hoàn tất');
      return true;
    }

    await guiTin(dich, r.traLoi, true);

    // Ảnh sản phẩm: agent trả sẵn đường dẫn; fallback dò lại từ nội dung trả lời
    // để luồng agent không thua luồng cũ về khoản gửi ảnh.
    const anh = r.anhSanPham ?? findImageForReply(r.traLoi);
    if (anh) {
      try {
        await humanPace(60);
        await zaloOps.sendImage(dich.accountId, dich.threadId, dich.threadType, [anh]);
      } catch (err) {
        logger.warn({ err }, '[agent] gửi ảnh sản phẩm lỗi (bỏ qua)');
      }
    }

    await prisma.aiSuggestion.create({
      data: {
        orgId: ctx.orgId,
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        type: 'auto_reply_agent',
        content: r.traLoi.slice(0, 2000),
        confidence: 1,
      },
    });

    logger.info(
      { ms: Date.now() - t0, soTool: r.log.length, conversationId: ctx.conversationId },
      '[agent] xong tư vấn khách',
    );
    return true;
  } catch (err) {
    // Lỗi → trả false để luồng RAG cũ đỡ lấy. Khách vẫn được trả lời.
    logger.error({ err, conversationId: ctx.conversationId }, '[agent] lỗi luồng khách, nhường luồng cũ');
    return false;
  }
}
