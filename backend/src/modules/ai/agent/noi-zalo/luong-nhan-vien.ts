// SPDX-License-Identifier: AGPL-3.0-or-later
// LUỒNG NHÂN VIÊN — nhân viên sai bot: tra cứu, lên đơn, báo cáo.
//
// Đường đi một tin:
//   cổng (công tắc → nhận lệnh → đích gửi → LLM) → chạy agent → gửi kết quả
//
// Mọi lối thoát sớm đi qua `dung(lyDo)` — có log, grep `[agent/nv] dừng` là ra.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { chayLenhNhanVien } from '../staff-agent.js';
import { nhanDienLenhNhanVien, coTagBot } from '../staff-command.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { batLuongNhanVien, duCauHinh, chanDonLienKeGiay, odooUrlCongKhai } from './cong-tac.js';
import { dungGenerate } from './llm.js';
import { layOdoo, layAnhClient, timTriThuc, layLichSu, seqTuMessageId } from './du-lieu.js';
import { timDich, guiTin, guiAnh, guiFile, ghiAnhTam } from './gui-zalo.js';
import { taoDung, taoMoc, chayCoHanGio } from './dung.js';
import type { NgữCanhTin } from './types.js';

// Prisma sinh kiểu `create` chặt hơn `PrismaGhiLog` (vốn chỉ cần hàm nhận
// `{data}`). Ép ở đúng một chỗ thay vì nới lỏng kiểu trong ghi-log-tool.
const prismaLog = prisma as unknown as PrismaGhiLog;

const dung = taoDung('nv');
const moc = taoMoc('nv');

/**
 * Tin này có phải LỆNH NHÂN VIÊN không — luồng khách gọi để TRÁNH xử lý trùng.
 *
 * Cả hai luồng chạy nền (`void`) nên không chờ nhau được. Thiếu hàm này thì
 * nhân viên gõ lệnh từ nick cá nhân sẽ kích hoạt CẢ HAI: agent trả lời một câu,
 * RAG trả lời câu khác — khách thấy cả hai.
 */
export function laLenhNhanVien(input: {
  content: string;
  isSelf: boolean;
  senderUid?: string | null;
  laNhom?: boolean;
  daTagBot?: boolean;
}): boolean {
  if (!batLuongNhanVien() || !duCauHinh()) return false;
  return nhanDienLenhNhanVien({
    // Mention Zalo thật (@TênBot) không chứa chữ "@bot" — quy đổi thành tag.
    content: input.daTagBot ? `@bot ${input.content}` : input.content,
    isSelf: input.isSelf,
    senderUid: input.senderUid,
    batBuocTag: input.laNhom === true,
  }) !== null;
}

/**
 * Xử lý một tin nhân viên. Trả `true` nếu ĐÃ nhận việc (kể cả khi lỗi giữa
 * chừng) — caller không được để luồng khác trả lời chồng lên.
 */
export async function xuLyTinNhanVien(ctx: NgữCanhTin): Promise<boolean> {
  if (!batLuongNhanVien() || !duCauHinh()) {
    return dung('công tắc tắt hoặc thiếu cấu hình Odoo', {
      bat: batLuongNhanVien(), duCauHinh: duCauHinh(),
    });
  }

  // CỔNG RẺ: nick shop không tag @bot thì không gọi LLM (nó gửi hàng chục tin
  // trả lời khách mỗi ngày). UID trong AI_AGENT_UID_NHANVIEN thì KHÔNG cần tag
  // — TRỪ trong NHÓM: ở đó nhân viên tán gẫu/nói với khách, coi mọi câu là
  // lệnh thì bot chen vào liên tục (06/08/2026). Mention Zalo thật (@TênBot)
  // được quy đổi thành tag "@bot" vì text mention không chứa chữ đó.
  const lenh = nhanDienLenhNhanVien({
    content: ctx.daTagBot ? `@bot ${ctx.content}` : ctx.content,
    isSelf: ctx.isSelf ?? true,
    senderUid: ctx.senderUid,
    batBuocTag: ctx.laNhom === true,
  });
  if (!lenh) {
    return dung('không qua cổng nhận lệnh', {
      senderUid: ctx.senderUid, isSelf: ctx.isSelf, noiDung: ctx.content?.slice(0, 40),
    });
  }

  const dich = await timDich(ctx.conversationId);
  if (!dich) return dung('không tra được thread', { conversationId: ctx.conversationId });

  const generate = await dungGenerate(ctx.orgId);
  if (!generate) return dung('chưa cấu hình LLM cho tổ chức', { orgId: ctx.orgId });

  const t0 = moc.batDau({ noiDung: lenh.noiDung.slice(0, 50) });
  const ghiDb = taoGhiLog({
    prisma: prismaLog, orgId: ctx.orgId, vai: 'nhanvien', conversationId: ctx.conversationId,
    onError: (err) => logger.warn({ err }, '[agent/nv] ghi log tool lỗi'),
  });

  try {
    const lichSu = await layLichSu(ctx.conversationId, ctx.messageId);
    // Log từng chặng: treo ở đâu thì dòng cuối cùng chỉ thẳng ra chỗ đó.
    logger.info({ soTin: lichSu.length }, '[agent/nv] đã lấy lịch sử');
    const triThuc = await timTriThuc(ctx.orgId);
    logger.info({ coTriThuc: Boolean(triThuc) }, '[agent/nv] đã dựng tri thức — vào LLM');

    const r = await chayCoHanGio('nv', chayLenhNhanVien(
      {
        odoo: layOdoo(),
        generate,
        chanDonLienKeGiay: chanDonLienKeGiay(),
        zaloUid: dich.zaloUid,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent/nv] chuyển sale');
        },
        ghiLog: ghiDb,
        anhClient: layAnhClient(),
        // Link cho NGƯỜI bấm — phải là domain công khai, không phải hostname
        // Docker nội bộ (bug thật 06/08: "http://incokit_nginx_prod/web#...").
        odooUrl: odooUrlCongKhai(),
        timDoanTriThuc: triThuc,
      },
      {
        bizName: ctx.bizName,
        conversationId: ctx.conversationId,
        seq: seqTuMessageId(ctx.messageId),
        // GỬI NỘI DUNG ĐÃ QUA CỔNG, không phải `ctx.content` thô.
        //
        // Bug thật 2026-08-05: `chayLenhNhanVien` kiểm cổng LẦN HAI, nhưng ở
        // đó KHÔNG có `senderUid` — nên tin từ UID nhân viên mà không gõ `@bot`
        // bị chính nó từ chối (`khong_phai_lenh`), rồi nhánh đó `return false`
        // KHÔNG log gì. Nhìn log tưởng agent treo ở lượt LLM; thực ra nó thoát
        // ngay sau 0,00s. Mất một buổi mới tìm ra.
        //
        // `lenh.noiDung` đã bỏ tag và ĐÃ qua cổng bảo mật ở trên — nối `@bot`
        // lại để cổng thứ hai luôn nhận, dù người gửi không tự gõ tag.
        message: { content: `@bot ${lenh.noiDung}`, isSelf: true },
        // GÁN VAI THEO NGƯỜI GỬI THẬT, không suy mù từ senderType (bug thật
        // 06/08/2026 13:02): mapping cũ `self→nhanvien, còn lại→bot` bị NGƯỢC
        // khi nhân viên gõ từ nick cá nhân (contact): model đọc lịch sử thấy
        // "BOT ra lệnh lên đơn, NHÂN VIÊN liệt kê 10 khách" — lú hoàn toàn,
        // nhai lại câu tồn kho cũ thay vì xử lý tin mới, 0 tool nào chạy.
        //
        //   self + có tag bot   → nhanvien (lệnh cũ gõ từ nick shop)
        //   self không tag      → bot (bot hoặc sale trả khách — đều "phía shop")
        //   cùng UID người đang ra lệnh → nhanvien (lệnh cũ từ nick cá nhân)
        //   còn lại             → khach
        history: lichSu.map((m) => ({
          vai:
            m.senderType === 'self'
              ? coTagBot(m.content) ? ('nhanvien' as const) : ('bot' as const)
              : ctx.senderUid && m.senderUid === ctx.senderUid
                ? ('nhanvien' as const)
                : ('khach' as const),
          noiDung: m.content,
        })),
      },
    ));

    // KHÔNG được im lặng ở đây: cổng trên đã CHO QUA, nên đến được đây mà bị
    // từ chối nghĩa là hai cổng bất đồng — lỗi lập trình, không phải luồng
    // bình thường. Im lặng ở nhánh này chính là thứ giấu bug 05/08 cả buổi.
    if (r.trangThai === 'khong_phai_lenh') {
      return dung('chayLenhNhanVien từ chối dù cổng trên đã cho qua — HAI CỔNG BẤT ĐỒNG', {
        conversationId: ctx.conversationId, noiDung: lenh.noiDung.slice(0, 60),
      });
    }

    if (r.trangThai === 'xong') {
      // Nhân viên KHÔNG cần giả nhịp người — họ biết đang nói với bot.
      await guiTin(dich, r.traLoi, false);
      // Hoá đơn: ảnh để xem, link để bấm vào xử lý — gửi link DÙ ảnh lỗi.
      if (r.hoaDon) {
        if (r.hoaDon.anh) {
          try {
            await guiAnh(dich, await ghiAnhTam(r.hoaDon.anh.duLieu, r.hoaDon.anh.tenFile), false);
          } catch (err) {
            logger.warn({ err }, '[agent/nv] gửi ảnh hoá đơn lỗi (vẫn gửi link)');
          }
        }
        await guiTin(dich, `Hoá đơn ${r.hoaDon.maDon}: ${r.hoaDon.link}`, false);
      }
      // Báo cáo dài (spec 06/08) — gửi SAU text. Mặc định là ẢNH (zca-js gửi
      // ảnh ổn định; .xlsx hay rớt âm thầm — bug thật 06/08). Lỗi từng cái
      // không phá cái còn lại.
      for (const tep of r.tepBaoCao ?? []) {
        try {
          const duongDan = await ghiAnhTam(tep.duLieu, tep.tenFile);
          if (tep.loai === 'file') await guiFile(dich, duongDan, tep.moTa);
          else await guiAnh(dich, duongDan, false);
        } catch (err) {
          logger.warn({ err, tenFile: tep.tenFile }, '[agent/nv] gửi ảnh/file báo cáo lỗi (đã có text tóm tắt)');
        }
      }
    } else {
      // Dở dang: báo nhân viên tự xử, KHÔNG im lặng để họ còn biết mà làm.
      await guiTin(dich, `Bot chưa xử lý xong (${r.lyDo}). Anh/chị xử lý giúp nhé.`, false);
    }

    moc.xong(t0, {
      trangThai: r.trangThai,
      conversationId: ctx.conversationId,
      tokenVao: r.usage.inputTokens,
      tokenCache: r.usage.cacheReadTokens,
    });
    return true;
  } catch (err) {
    logger.error({ err, conversationId: ctx.conversationId }, '[agent/nv] lỗi giữa chừng');
    // Nhân viên gõ lệnh thì PHẢI biết kết quả — im lặng là họ ngồi chờ một
    // câu trả lời không bao giờ tới (bug thật 05/08: lượt treo, log dừng ở
    // "BẮT ĐẦU xử lý", nhân viên không hay biết gì).
    try {
      const loi = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      await guiTin(dich, `Bot gặp lỗi (${loi}). Anh/chị xử lý giúp nhé.`, false);
    } catch (e2) {
      logger.warn({ err: e2 }, '[agent/nv] báo lỗi cho nhân viên cũng thất bại');
    }
    return true; // đã nhận lệnh rồi — đừng để luồng cũ trả lời chồng lên
  }
}
