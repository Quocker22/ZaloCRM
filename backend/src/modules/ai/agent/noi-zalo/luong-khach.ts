// SPDX-License-Identifier: AGPL-3.0-or-later
// LUỒNG KHÁCH — agent tư vấn khách THAY luồng RAG cũ (khi AI_AGENT_KHACH=1).
//
// Đường đi một tin:
//   cổng (công tắc → auto-reply → đích gửi → chống trùng → LLM)
//   → chạy agent → gửi trả lời (+ ảnh SP, + hoá đơn & QR nếu vừa chốt đơn)
//
// Hợp đồng với caller: trả `true` = ĐÃ xử lý, luồng RAG cũ PHẢI bỏ qua;
// trả `false` = nhường — chỉ an toàn khi agent CHƯA chạm dữ liệu (xem catch).
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { findImageForReply } from '../../knowledge/product-image.js';
import { chayTuVanKhach } from '../customer-agent.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { batLuongKhach, batKhachTuChotDon, duCauHinh, tranTienKhach } from './cong-tac.js';
import { dungGenerate } from './llm.js';
import { layOdoo, timTriThuc, layLichSu, seqTuMessageId } from './du-lieu.js';
import { timDich, guiTin, guiAnh, guiHoaDonVaQr } from './gui-zalo.js';
import { taoDung, taoMoc } from './dung.js';
import type { NgữCanhTin } from './types.js';

const prismaLog = prisma as unknown as PrismaGhiLog;

const dung = taoDung('khach');
const moc = taoMoc('khach');

export async function xuLyTinKhach(ctx: NgữCanhTin): Promise<boolean> {
  if (!batLuongKhach() || !duCauHinh()) {
    return dung('công tắc tắt hoặc thiếu cấu hình Odoo', {
      bat: batLuongKhach(), duCauHinh: duCauHinh(),
    });
  }

  // Tôn trọng công tắc chung: tắt auto-reply thì agent cũng im, giống luồng cũ.
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId: ctx.orgId } });
  if (!cfg?.autoReplyEnabled) return dung('autoReplyEnabled tắt', { orgId: ctx.orgId });

  const dich = await timDich(ctx.conversationId);
  if (!dich) return dung('không tra được thread', { conversationId: ctx.conversationId });

  // Chống trả lời hai lần cùng một tin (retry, tin trùng từ Zalo). Trả TRUE —
  // tin này ĐÃ có câu trả lời, luồng cũ không được nhảy vào.
  const daXuLy = await prisma.aiSuggestion.count({
    where: { orgId: ctx.orgId, messageId: ctx.messageId, type: 'auto_reply_agent' },
  });
  if (daXuLy > 0) return true;

  const generate = await dungGenerate(ctx.orgId);
  if (!generate) return dung('chưa cấu hình LLM — nhường luồng cũ', { orgId: ctx.orgId });

  const t0 = moc.batDau({ noiDung: ctx.content.slice(0, 50) });
  // Đếm tool đã chạy — quyết định nhường hay im lặng khi lỗi (xem catch).
  let soToolDaChay = 0;
  const ghiDb = taoGhiLog({
    prisma: prismaLog, orgId: ctx.orgId, vai: 'khach', conversationId: ctx.conversationId,
    onError: (err) => logger.warn({ err }, '[agent/khach] ghi log tool lỗi'),
  });

  try {
    const lichSu = await layLichSu(ctx.conversationId, ctx.messageId);
    const r = await chayTuVanKhach(
      {
        odoo: layOdoo(),
        generate,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent/khach] cần sale');
        },
        ghiLog: (l) => { soToolDaChay++; ghiDb(l); },
        timDoanTriThuc: await timTriThuc(ctx.orgId),
        choKhachChotDon: batKhachTuChotDon()
          ? {
              conversationId: ctx.conversationId,
              seq: seqTuMessageId(ctx.messageId),
              zaloUid: dich.zaloUid,
              tranTien: tranTienKhach(),
            }
          : undefined,
      },
      {
        bizName: ctx.bizName,
        // Đính tên/SĐT đã biết vào tin — bot hỏi lại thứ Zalo đã cho là phiền
        // khách và làm chậm chốt đơn (bug thật 2026-08-05).
        message: dich.tenKhach || dich.sdtKhach
          ? `[Khách: ${[dich.tenKhach, dich.sdtKhach].filter(Boolean).join(' · ')}] ${ctx.content}`
          : ctx.content,
        history: lichSu.map((m) => ({
          vai: m.senderType === 'self' ? ('shop' as const) : ('khach' as const),
          noiDung: m.content,
        })),
      },
    );

    if (r.trangThai !== 'xong') {
      // Bot bí → IM LẶNG để nhân viên vào trả lời, tốt hơn "em chưa xử lý được"
      // rồi khách bỏ đi. Vẫn trả true — không để luồng cũ nói thay.
      logger.warn({ lyDo: r.lyDo, conversationId: ctx.conversationId }, '[agent/khach] chưa hoàn tất — im lặng');
      return true;
    }

    // Khách CẦN giả nhịp người: trả lời tức thì thì lộ là bot, Zalo gắn cờ spam.
    await guiTin(dich, r.traLoi, true);

    // Ảnh sản phẩm: agent trả sẵn đường dẫn; fallback dò từ nội dung trả lời.
    const anh = r.anhSanPham ?? findImageForReply(r.traLoi);
    if (anh) {
      try {
        await guiAnh(dich, anh, true);
      } catch (err) {
        logger.warn({ err }, '[agent/khach] gửi ảnh sản phẩm lỗi (bỏ qua)');
      }
    }

    // Khách vừa chốt đơn → hoá đơn trước (xem lại), QR sau (chuyển tiền).
    if (r.don) await guiHoaDonVaQr(dich, r.don);

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

    moc.xong(t0, { soTool: r.log.length, conversationId: ctx.conversationId });
    return true;
  } catch (err) {
    // Lỗi SAU khi đã gọi tool → IM LẶNG, KHÔNG nhường luồng RAG cũ.
    //
    // Bug thật 2026-08-05: agent tra Odoo xong, model trả câu rỗng, sendMessage
    // ném → nhường luồng cũ → khách nhận câu của RAG (không biết gì về thứ
    // agent vừa tra): bot lặp y hệt câu trước và nói "để em kiểm tra tồn kho".
    //
    // Nhường chỉ đúng khi CHƯA chạm dữ liệu — lúc đó luồng cũ còn xử lý được
    // từ đầu. Sau đó thì im lặng, đừng để hai hệ thống nói hai chuyện khác nhau.
    const daChayTool = soToolDaChay > 0;
    logger.error(
      { err, conversationId: ctx.conversationId, daChayTool },
      daChayTool
        ? '[agent/khach] lỗi SAU khi gọi tool — im lặng, KHÔNG nhường luồng cũ'
        : '[agent/khach] lỗi trước khi gọi tool — nhường luồng cũ',
    );
    return daChayTool;
  }
}
