// SPDX-License-Identifier: AGPL-3.0-or-later
// VÒNG TỰ SOI — quét hội thoại đã NGUỘI, chấm, rút bài học, ghi vào kho luật.
//
// Anh Quốc 18/08: "sau khi khách nhắn xong một cuộc hội thoại thì phải biết
// đọc lại đoạn đó tự nhận biết đúng sai rồi training lại để trả lời cho đúng
// và hài lòng khách và nhân viên". Chốt: TỰ ÁP NGAY + có nhật ký để gỡ; soi
// khi hội thoại lặng ~15 phút.
//
// Ba tầng lọc trước khi tốn một đồng model:
//   1. Hội thoại phải NGUỘI (≥15') và có bot tham gia — đang chat thì để yên.
//   2. Chưa soi đoạn này (khoá theo conversationId + tin cuối).
//   3. `chamDauHieu` (code) phải thấy MÙI — hội thoại trơn tru thì chỉ ghi
//      điểm, không gọi model, không học gì.
//
// Trần mỗi lượt quét: MAX_HOI_THOAI hội thoại — vòng nền không được biến
// thành hố tiền model khi shop có ngày trăm hội thoại.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { dungGenerate } from '../noi-zalo/llm.js';
import { napLuatNhanVien, ghiLuat, type PrismaLuatNv } from '../luat-nhan-vien.js';
import { chamDauHieu, type TinSoi } from './dau-hieu.js';
import { rutBaiHoc } from './rut-bai-hoc.js';

/** Hội thoại phải im bao lâu mới coi là xong (phút). */
const NGUOI_PHUT = 15;
/** Không soi đoạn quá cũ — bài học tới muộn thì vô nghĩa. */
const CU_NHAT_GIO = 24;
/** Trần hội thoại mỗi lượt quét. */
const MAX_HOI_THOAI = 20;
/** Số tin lấy về soi cho một hội thoại. */
const MAX_TIN = 40;

export interface KetQuaLuotSoi {
  daQuet: number;
  daSoiKy: number;
  luatMoi: number;
}

/** Một lượt quét. An toàn khi gọi lại — khoá theo (conversationId, tin cuối). */
export async function chayLuotTuSoi(): Promise<KetQuaLuotSoi> {
  const kq: KetQuaLuotSoi = { daQuet: 0, daSoiKy: 0, luatMoi: 0 };
  const bayGio = Date.now();
  const nguoiTruoc = new Date(bayGio - NGUOI_PHUT * 60_000);
  const cuNhat = new Date(bayGio - CU_NHAT_GIO * 3_600_000);

  let ungVien: Array<{ conversationId: string; orgId: string; lastAt: Date }> = [];
  try {
    // Hội thoại có tin trong 24h, tin cuối đã cũ hơn 15' → coi như xong.
    ungVien = await prisma.$queryRawUnsafe<Array<{ conversationId: string; orgId: string; lastAt: Date }>>(
      `SELECT m.conversation_id AS "conversationId", c.org_id AS "orgId", MAX(m.sent_at) AS "lastAt"
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.sent_at > $1 AND m.is_deleted = false
       GROUP BY m.conversation_id, c.org_id
       HAVING MAX(m.sent_at) < $2
       ORDER BY MAX(m.sent_at) DESC
       LIMIT ${MAX_HOI_THOAI}`,
      cuNhat, nguoiTruoc,
    );
  } catch (err) {
    logger.warn({ err }, '[tu-soi] không lấy được danh sách hội thoại — bỏ lượt');
    return kq;
  }

  for (const hs of ungVien) {
    try {
      // CHỈ SOI PHẦN CHƯA SOI (vá 18/08 — anh Quốc: "làm sao biết có đoạn mới").
      // Lần soi trước đã lưu tin cuối; hội thoại chạy tiếp thì lần này chỉ đọc
      // từ mốc đó về sau, cộng vài tin cũ làm NGỮ CẢNH (một câu "sai rồi" đứng
      // một mình thì soi không ra bot sai chỗ nào).
      const lanTruoc = await prisma.tuSoiHoiThoai.findFirst({
        where: { conversationId: hs.conversationId },
        orderBy: { createdAt: 'desc' },
        select: { denMessageId: true },
      });
      let tuLuc: Date | null = null;
      if (lanTruoc) {
        const moc = await prisma.message.findUnique({
          where: { id: lanTruoc.denMessageId },
          select: { sentAt: true },
        });
        tuLuc = moc?.sentAt ?? null;
      }
      const rows = await prisma.message.findMany({
        where: {
          conversationId: hs.conversationId, isDeleted: false, contentType: 'text',
          // Lùi 10 phút trước mốc cũ để có ngữ cảnh, không phải cả hội thoại.
          ...(tuLuc ? { sentAt: { gte: new Date(tuLuc.getTime() - 10 * 60_000) } } : {}),
        },
        orderBy: { sentAt: 'desc' },
        take: MAX_TIN,
        select: { id: true, senderType: true, content: true, sentAt: true, sentVia: true },
      });
      if (rows.length < 2) continue;
      const tin: TinSoi[] = rows.reverse()
        .filter((r) => Boolean(r.content))
        .map((r) => ({
          id: r.id,
          // 'self' = tin gửi đi từ hệ thống. Bot và người-của-shop dùng chung
          // nick, nhưng tin do BOT gửi có sentVia='ai'/'bot' — không phân biệt
          // được thì coi là bot (soi nhầm chỉ tốn một lượt đọc, không hại).
          vai: r.senderType === 'self' ? 'bot' : 'nguoi',
          noiDung: String(r.content),
          luc: r.sentAt,
        }));
      const cuoi = tin[tin.length - 1];
      if (!cuoi) continue;
      if (!tin.some((t) => t.vai === 'bot')) continue; // bot không tham gia → không có gì để học

      // Đã soi đoạn này rồi?
      const daSoi = await prisma.tuSoiHoiThoai.findUnique({
        where: { conversationId_denMessageId: { conversationId: hs.conversationId, denMessageId: cuoi.id } },
        select: { id: true },
      });
      if (daSoi) continue;
      // Đoạn mới quá ngắn (chỉ vài tin sau mốc cũ, kiểu "ok"/"cảm ơn") → ghi
      // mốc để lần sau khỏi đọc lại, nhưng KHÔNG soi: chưa đủ chuyện để học.
      const tinMoi = tuLuc ? tin.filter((t) => t.luc > tuLuc!).length : tin.length;
      if (tuLuc && tinMoi < 3) {
        await prisma.tuSoiHoiThoai.create({
          data: {
            orgId: hs.orgId, conversationId: hs.conversationId, denMessageId: cuoi.id,
            vai: 'khach', diem: 10, dauHieu: [],
            nhanXet: `Đoạn tiếp theo chỉ có ${tinMoi} tin — chưa đủ để soi.`,
            luatDaGhi: [],
          },
        }).catch(() => {});
        continue;
      }
      kq.daQuet += 1;

      const cham = chamDauHieu(tin);
      // Xác định vai người dùng: có tin nào là lệnh NV (tag bot/lên đơn) thì coi
      // là hội thoại nhân viên — luật học ra sẽ vào kho luật NV.
      const laNv = tin.some((t) => t.vai === 'nguoi' && /lên đơn|phiếu nhập|tồn kho|công nợ|báo cáo|sửa đơn/i.test(t.noiDung));
      const vai: 'nhanvien' | 'khach' = laNv ? 'nhanvien' : 'khach';

      let nhanXet = `Bot xử ổn (điểm ${cham.diem}/10).`;
      const luatDaGhi: string[] = [];

      if (cham.dangSoiKy) {
        kq.daSoiKy += 1;
        const generate = await dungGenerate(hs.orgId, Date.now() + 60_000);
        if (generate) {
          const luatDangCo = await napLuatNhanVien(prisma as unknown as PrismaLuatNv, hs.orgId);
          const rut = await rutBaiHoc(generate, { tin, cham, vai, luatDangCo });
          if (rut.nhanXet) nhanXet = rut.nhanXet;
          // CHỈ học vào kho luật NHÂN VIÊN (kho khách do guideline engine quản,
          // đụng vào là đổi kịch bản bán hàng — việc của người).
          if (vai === 'nhanvien') {
            for (const bh of rut.baiHoc) {
              const g = await ghiLuat(prisma as unknown as PrismaLuatNv, {
                orgId: hs.orgId,
                noiDung: bh.noiDung,
                ...(bh.phamVi ? { phamVi: bh.phamVi } : {}),
                conversationId: hs.conversationId,
                nguon: 'tu_hoc',
              });
              if (g.ok && !g.daCoSan && g.ten) { luatDaGhi.push(g.ten); kq.luatMoi += 1; }
            }
          }
        }
      }

      await prisma.tuSoiHoiThoai.create({
        data: {
          orgId: hs.orgId,
          conversationId: hs.conversationId,
          denMessageId: cuoi.id,
          vai,
          diem: cham.diem,
          dauHieu: cham.dauHieu,
          nhanXet,
          luatDaGhi,
        },
      });
      if (luatDaGhi.length) {
        logger.info(
          { conversationId: hs.conversationId, diem: cham.diem, luatDaGhi },
          '[tu-soi] đã tự học bài học mới từ hội thoại',
        );
      }
    } catch (err) {
      logger.warn({ err, conversationId: hs.conversationId }, '[tu-soi] soi hội thoại lỗi — bỏ qua ca này');
    }
  }
  if (kq.daQuet) logger.info(kq, '[tu-soi] xong một lượt');
  return kq;
}
