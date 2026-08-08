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
import { timAnhSanPhamTheoReply, taiAnhVeTam } from '../../knowledge/anh-san-pham.js';
import { chayTuVanKhach } from '../customer-agent.js';
import { coTagBot } from '../staff-command.js';
import { chiCoEmoji } from './luong-media.js';
import { laBucTuc } from './cam-xuc.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { batLuongKhach, batKhachTuChotDon, duCauHinh, tranTienKhach, chanDonLienKeGiay } from './cong-tac.js';
import { dungGenerate } from './llm.js';
import { layOdoo, timTriThuc, layLichSu, seqTuMessageId, coTinKhachMoiHon } from './du-lieu.js';
import { timDich, guiTin, guiAnh, guiHoaDonVaQr } from './gui-zalo.js';
import { baoNhanVien, CAU_GIU_CHAN } from './bao-nhan-vien.js';
import { demVaKiemTra, CAU_XIN_PHEP } from './gioi-han.js';
import { taoDung, taoMoc, chayCoHanGio } from './dung.js';
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

  // TRONG NHÓM: chỉ nói khi được tag (06/08/2026). Nhóm là chỗ nhiều người
  // nói chuyện với nhau — bot chen vào từng câu vừa phiền vừa đốt tiền LLM
  // theo cuộc tán gẫu của người khác. Trả TRUE để luồng RAG cũ cũng không
  // được nhảy vào nói thay (nó không có gate nhóm).
  //
  // Đứng TRƯỚC rate limit: tin nhóm không tag là phần lớn lưu lượng nhóm,
  // không được ăn vào quota 15 tin/giờ của hội thoại.
  if (ctx.laNhom && !ctx.daTagBot && !coTagBot(ctx.content)) {
    logger.info({ conversationId: ctx.conversationId }, '[agent/khach] tin nhóm không tag bot — bỏ qua');
    return true;
  }

  // "👍" / "😀😀" — không có gì để trả lời, và một lượt agent cho cái like là
  // đốt ~3k token. Người thật cũng chỉ… nhìn nó. Trả TRUE để RAG cũ khỏi đáp.
  if (chiCoEmoji(ctx.content)) {
    logger.info({ conversationId: ctx.conversationId }, '[agent/khach] tin chỉ emoji — bỏ qua');
    return true;
  }

  // KHÁCH BỰC / CHỬI (07/08, học Chatwoot): người xoa dịu được, bot càng máy
  // móc càng chọc giận — và trước đây bot lấy chữ viết hoa trong câu chửi tra
  // thành tên SP (bug "Cả đi → tra Trần Hưng"). Báo nhân viên, bot ngừng.
  if (laBucTuc(ctx.content)) {
    logger.info({ conversationId: ctx.conversationId }, '[agent/khach] khách bực/chửi — báo nhân viên, bot ngừng');
    const dichBuc = await timDich(ctx.conversationId);
    if (dichBuc) {
      await baoNhanVien(dichBuc, {
        conversationId: ctx.conversationId,
        lyDo: 'khách có vẻ bực/chửi — cần người vào xoa dịu, bot ngừng để khỏi chọc thêm',
        tinKhach: ctx.content,
      });
    }
    return true;
  }

  // Chặn spam TRƯỚC mọi thứ tốn tiền — một người dội 1.000 tin không được đốt
  // 1.000 lượt LLM (cost-DoS) và không được để bot máy móc trả lời 1.000 lần
  // (Zalo gắn cờ nick). Trả TRUE: tin bị chặn thì luồng RAG cũ cũng KHÔNG được
  // trả lời — nó cũng gọi LLM, nhường là thủng trần ở cửa sau.
  const gioiHan = demVaKiemTra(ctx.conversationId);
  if (!gioiHan.cho) {
    if (gioiHan.lanDau) {
      const dichChan = await timDich(ctx.conversationId);
      if (dichChan) {
        // Vượt trần GIỜ: xin phép một câu (khách thật nhắn hăng vẫn được giữ
        // chân). Vượt trần NGÀY: im — đến mức này gần như chắc chắn là spam.
        if (gioiHan.lyDo === 'qua_tran_gio') {
          try {
            await guiTin(dichChan, CAU_XIN_PHEP, true);
          } catch (err) {
            logger.warn({ err, conversationId: ctx.conversationId }, '[agent/khach] gửi câu xin phép lỗi');
          }
        }
        await baoNhanVien(dichChan, {
          conversationId: ctx.conversationId,
          lyDo: `khách vượt giới hạn tin (${gioiHan.lyDo}) — bot ngừng trả lời, cần người xem có phải khách thật không`,
          tinKhach: ctx.content,
        });
      }
    }
    return true;
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
    // Log từng chặng: treo ở đâu thì dòng cuối cùng chỉ thẳng ra chỗ đó.
    logger.info({ soTin: lichSu.length }, '[agent/khach] đã lấy lịch sử');
    const triThuc = await timTriThuc(ctx.orgId);
    logger.info({ coTriThuc: Boolean(triThuc) }, '[agent/khach] đã dựng tri thức — vào LLM');

    const r = await chayCoHanGio('khach', chayTuVanKhach(
      {
        odoo: layOdoo(),
        generate,
        // Bot chủ động xin chuyển sale → báo nhân viên THẬT, không chỉ log.
        // Khách đã có câu trả lời của agent ("em chuyển anh/chị cho nhân viên…")
        // nên KHÔNG gửi thêm câu giữ chân ở đây.
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent/khach] cần sale');
          await baoNhanVien(dich, {
            conversationId: ctx.conversationId,
            lyDo: `bot xin chuyển sale (${yc.lyDo}): ${yc.tomTat}`,
            tinKhach: ctx.content,
          });
        },
        ghiLog: (l) => { soToolDaChay++; ghiDb(l); },
        timDoanTriThuc: triThuc,
        choKhachChotDon: batKhachTuChotDon()
          ? {
              conversationId: ctx.conversationId,
              seq: seqTuMessageId(ctx.messageId),
              zaloUid: dich.zaloUid,
              tranTien: tranTienKhach(),
              chanDonLienKeGiay: chanDonLienKeGiay(),
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
    ));

    // TIN MỚI ĐẾN GIỮA CHỪNG (07/08, học Chatwoot): khách gõ tiếp trong lúc
    // bot gọi LLM. Nếu chưa ghi gì vào Odoo → BỎ câu trả lời này, im lặng, để
    // lượt do tin mới kích trả lời gộp cả chuỗi. Trả TRUE: tin này coi như đã
    // xử lý (bị gộp), luồng cũ không nhảy vào.
    //
    // ĐÃ ghi tool (tạo đơn/khách) thì KHÔNG bỏ — đơn đã vào Odoo, phải trả lời
    // cho khách biết. seq idempotency đã chống trùng đơn ở tầng dưới.
    if (soToolDaChay === 0 && await coTinKhachMoiHon(ctx.conversationId, ctx.messageId)) {
      logger.info({ conversationId: ctx.conversationId }, '[agent/khach] có tin mới hơn — bỏ lượt này, gộp vào lượt sau');
      return true;
    }

    if (r.trangThai !== 'xong') {
      // Bot bí → giữ chân khách + báo nhân viên kèm ngữ cảnh. Trước đây là im
      // lặng hoàn toàn — khách chờ vô vọng nếu nhân viên không mở CRM (05/08).
      // Vẫn trả true — không để luồng cũ nói thay.
      logger.warn({ lyDo: r.lyDo, conversationId: ctx.conversationId }, '[agent/khach] chưa hoàn tất — giữ chân + báo nhân viên');
      const lanDau = await baoNhanVien(dich, {
        conversationId: ctx.conversationId,
        lyDo: r.lyDo,
        tinKhach: ctx.content,
        soToolDaChay,
      });
      if (lanDau) {
        try {
          await guiTin(dich, CAU_GIU_CHAN, true);
        } catch (err) {
          logger.warn({ err, conversationId: ctx.conversationId }, '[agent/khach] gửi câu giữ chân lỗi');
        }
      }
      return true;
    }

    // Khách CẦN giả nhịp người: trả lời tức thì thì lộ là bot, Zalo gắn cờ spam.
    await guiTin(dich, r.traLoi, true);

    // Ảnh sản phẩm — thứ tự ưu tiên:
    //   1. agent trả sẵn đường dẫn
    //   2. bảng anh_san_pham (cột Link ảnh của Sheet, đồng bộ dong-bo-sheet) —
    //      gửi được NHIỀU ảnh/SP, công ty tự nuôi qua sheet không cần deploy
    //   3. kho crawl cũ (product-images/) đỡ nốt
    // Lỗi từng tấm không phá câu trả lời — ảnh là phụ.
    if (r.anhSanPham) {
      try {
        await guiAnh(dich, r.anhSanPham, true);
      } catch (err) {
        logger.warn({ err }, '[agent/khach] gửi ảnh sản phẩm lỗi (bỏ qua)');
      }
    } else {
      const urls = await timAnhSanPhamTheoReply(prisma, ctx.orgId, r.traLoi).catch(() => []);
      if (urls.length > 0) {
        for (const url of urls) {
          try {
            await guiAnh(dich, await taiAnhVeTam(url), true);
          } catch (err) {
            logger.warn({ err, url }, '[agent/khach] gửi ảnh từ sheet lỗi (bỏ qua tấm này)');
          }
        }
      } else {
        const anh = findImageForReply(r.traLoi);
        if (anh) {
          try {
            await guiAnh(dich, anh, true);
          } catch (err) {
            logger.warn({ err }, '[agent/khach] gửi ảnh sản phẩm lỗi (bỏ qua)');
          }
        }
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

    // tokenCache/tokenVao: theo dõi implicit cache của Gemini qua OpenRouter —
    // tokenCache = 0 kéo dài nghĩa là prefix bị vỡ (ai đó chèn thứ thay đổi
    // theo lượt vào ĐẦU prompt), tiền LLM đội 4 lần mà không ai hay.
    moc.xong(t0, {
      soTool: r.log.length,
      conversationId: ctx.conversationId,
      tokenVao: r.usage.inputTokens,
      tokenCache: r.usage.cacheReadTokens,
    });
    return true;
  } catch (err) {
    // Lỗi SAU khi đã gọi tool → giữ chân + báo nhân viên, KHÔNG nhường luồng RAG cũ.
    //
    // Bug thật 2026-08-05: agent tra Odoo xong, model trả câu rỗng, sendMessage
    // ném → nhường luồng cũ → khách nhận câu của RAG (không biết gì về thứ
    // agent vừa tra): bot lặp y hệt câu trước và nói "để em kiểm tra tồn kho".
    //
    // Nhường chỉ đúng khi CHƯA chạm dữ liệu — lúc đó luồng cũ còn xử lý được
    // từ đầu. Sau đó thì người phải vào — đừng để hai hệ nói hai chuyện khác nhau.
    const daChayTool = soToolDaChay > 0;
    logger.error(
      { err, conversationId: ctx.conversationId, daChayTool },
      daChayTool
        ? '[agent/khach] lỗi SAU khi gọi tool — giữ chân + báo nhân viên, KHÔNG nhường luồng cũ'
        : '[agent/khach] lỗi trước khi gọi tool — nhường luồng cũ',
    );
    if (daChayTool) {
      const lanDau = await baoNhanVien(dich, {
        conversationId: ctx.conversationId,
        lyDo: `lỗi hệ thống: ${err instanceof Error ? err.message : String(err)}`,
        tinKhach: ctx.content,
        soToolDaChay,
      });
      if (lanDau) {
        try {
          await guiTin(dich, CAU_GIU_CHAN, true);
        } catch (e2) {
          logger.warn({ err: e2, conversationId: ctx.conversationId }, '[agent/khach] gửi câu giữ chân lỗi');
        }
      }
    }
    return daChayTool;
  }
}
