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
import { nhanDienLenhNhanVien } from '../staff-command.js';
import { taoGhiLog, type PrismaGhiLog } from '../ghi-log-tool.js';
import { batLuongNhanVien, duCauHinh } from './cong-tac.js';
import { dungGenerate } from './llm.js';
import { layOdoo, layAnhClient, timTriThuc, layLichSu, seqTuMessageId } from './du-lieu.js';
import { timDich, guiTin, guiAnh, ghiAnhTam } from './gui-zalo.js';
import { taoDung, taoMoc } from './dung.js';
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
}): boolean {
  if (!batLuongNhanVien() || !duCauHinh()) return false;
  return nhanDienLenhNhanVien(input) !== null;
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
  // trả lời khách mỗi ngày). UID trong AI_AGENT_UID_NHANVIEN thì KHÔNG cần tag.
  const lenh = nhanDienLenhNhanVien({
    content: ctx.content,
    isSelf: ctx.isSelf ?? true,
    senderUid: ctx.senderUid,
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
    const r = await chayLenhNhanVien(
      {
        odoo: layOdoo(),
        generate,
        zaloUid: dich.zaloUid,
        ghiNhanChuyenSale: async (yc) => {
          logger.info({ lyDo: yc.lyDo, conversationId: ctx.conversationId }, '[agent/nv] chuyển sale');
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
        message: { content: ctx.content, isSelf: true }, // đã qua cổng nhận lệnh ở trên
        history: lichSu.map((m) => ({
          vai: m.senderType === 'self' ? ('nhanvien' as const) : ('bot' as const),
          noiDung: m.content,
        })),
      },
    );

    if (r.trangThai === 'khong_phai_lenh') return false;

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
    } else {
      // Dở dang: báo nhân viên tự xử, KHÔNG im lặng để họ còn biết mà làm.
      await guiTin(dich, `Bot chưa xử lý xong (${r.lyDo}). Anh/chị xử lý giúp nhé.`, false);
    }

    moc.xong(t0, { trangThai: r.trangThai, conversationId: ctx.conversationId });
    return true;
  } catch (err) {
    logger.error({ err, conversationId: ctx.conversationId }, '[agent/nv] lỗi giữa chừng');
    return true; // đã nhận lệnh rồi — đừng để luồng cũ trả lời chồng lên
  }
}
