// SPDX-License-Identifier: AGPL-3.0-or-later
// CHÀO NHÓM — khi nick bot vừa ĐƯỢC ADD vào một nhóm Zalo: đọc ~30 tin gần nhất
// để nắm chủ đề, rồi chào 1 lần theo KHUÔN cố định + (tối đa) 1 câu ngữ cảnh nhẹ.
//
// Thiết kế (docs/superpowers/specs/2026-08-07-chao-nhom-design.md), 6 chốt:
//   1. đọc tin cũ → chào có ngữ cảnh   2. mọi nhóm trừ blocklist
//   3. 30 tin gần nhất                 4. khuôn cố định + guard CODE chống nói hớ
//   5. 1 lần/nhóm vĩnh viễn (cờ DB)    6. ngoại lệ không cần tag
//
// GUARD nằm ở CODE (locCauNguCanh), KHÔNG tin lời dặn prompt — bài học cả hệ
// thống: model quên rule, chỉ khuôn cứng mới chắc. Câu ngữ cảnh là thứ bot NÓI
// TRƯỚC CẢ NHÓM nên phải sạch tuyệt đối: cấm tiền/đơn/giá/khiếu nại/hứa hẹn/sđt.
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { dungGenerate } from './llm.js';
import { guiTin, type DichGui } from './gui-zalo.js';

const SO_TIN_DOC = 30;
const MAX_NGU_CANH = 120; // ký tự tối đa cho câu ngữ cảnh

/**
 * Từ/khuôn CẤM trong câu ngữ cảnh. Bot chào trước cả nhóm — một câu nhắc tới
 * tiền/đơn/khiếu nại/hứa hẹn mà hiểu sai bối cảnh là mất mặt shop. Thà bỏ câu
 * ngữ cảnh (chào khuôn thuần) còn hơn nói hớ.
 */
const TU_CAM = [
  'đơn', 'giá', 'khiếu nại', 'khieu nai', 'bồi thường', 'boi thuong', 'hứa', 'hua',
  'cam kết', 'cam ket', 'hoàn tiền', 'hoan tien', 'ship', 'cọc', 'coc', 'chuyển khoản',
  'chuyen khoan', 'thanh toán', 'thanh toan', 'nợ', 'công nợ', 'cong no', 'giảm', 'sale',
  'khuyến mãi', 'khuyen mai', 'bảo hành', 'bao hanh', 'lỗi', 'hỏng', 'trả hàng', 'tra hang',
];
const RE_TIEN = /\d[\d.,]*\s*(k|đ|d|vnd|vnđ|nghìn|nghin|triệu|trieu|tr)\b/i;
const RE_SDT = /(0|84)\d{8,10}/;
const RE_MA_DON = /\b[A-Z]{1,4}\d{3,}\b/; // S13798, DNH36805…

/**
 * Lọc câu ngữ cảnh LLM sinh ra. Trả '' nếu KHÔNG an toàn (caller sẽ chào khuôn
 * thuần). Đây là guard chính của tính năng — test kỹ ở chao-nhom.func.ts.
 */
export function locCauNguCanh(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  // Model đôi khi trả "không rõ"/"n/a" → coi như rỗng.
  if (/^(không rõ|khong ro|n\/a|none|không|khong)\.?$/i.test(s)) return '';
  if (s.length > MAX_NGU_CANH) return '';
  // Một câu duy nhất: không được có nhiều câu / xuống dòng.
  if (/\n/.test(s)) return '';
  const soCau = (s.match(/[.!?]/g) ?? []).length;
  if (soCau > 1) return '';
  if (RE_TIEN.test(s) || RE_SDT.test(s) || RE_MA_DON.test(s)) return '';
  const thuong = s.toLowerCase();
  if (TU_CAM.some((t) => thuong.includes(t))) return '';
  return s;
}

/** Khuôn chào cố định — luôn dùng, bất kể có câu ngữ cảnh hay không. */
export function khuonChao(tenShop: string): string {
  return `Em chào cả nhà ạ 👋 Em là trợ lý của ${tenShop}, hỗ trợ tư vấn sản phẩm và báo giá. Cả nhà cần gì cứ nhắn em nhé!`;
}

/** Gom text 30 tin gần nhất từ history zca-js, bỏ tin của bot + tin không phải text. */
function gomBoiCanh(history: any, botUid: string | null): string {
  const msgs: any[] = history?.groupMsgs || history?.data?.groupMsgs || [];
  const dong: string[] = [];
  for (const m of msgs) {
    const d = m?.data ?? {};
    if (botUid && String(d.uidFrom || '') === botUid) continue; // bỏ tin của chính bot
    if (m?.isSelf) continue;
    const raw = d.content;
    if (typeof raw !== 'string') continue; // bỏ ảnh/sticker/file
    const text = raw.trim();
    if (!text) continue;
    const ten = (d.dName || 'ai đó').toString().slice(0, 30);
    dong.push(`${ten}: ${text.slice(0, 200)}`);
  }
  return dong.join('\n');
}

export interface ChaoNhomDeps {
  orgId: string;
  accountId: string;
  groupId: string;
  groupName: string | null;
  botUid: string | null;
  /** zca-js api instance (có getGroupChatHistory). */
  api: { getGroupChatHistory: (groupId: string, count: number) => Promise<any> };
  tenShop: string;
}

/**
 * Chào nhóm 1 lần. Trả true nếu ĐÃ chào (hoặc đã đánh dấu bỏ qua), false nếu
 * không đủ điều kiện xử lý (caller không cần làm gì thêm dù trả gì).
 *
 * Chống lặp: ghi cờ groupGreetedAt TRƯỚC khi gửi. 2 event join trùng → cái thứ
 * hai thấy cờ đã set → dừng. Nếu gửi lỗi sau đó, CHẤP NHẬN mất lời chào (thà mất
 * còn hơn spam) — đây là chủ đích, không phải sót.
 */
export async function chaoNhomKhiThem(deps: ChaoNhomDeps): Promise<boolean> {
  const { orgId, accountId, groupId, groupName, botUid, api, tenShop } = deps;

  // 1. Tìm/tạo Conversation cho nhóm (unique theo account+externalThreadId).
  const conv = await prisma.conversation.upsert({
    where: { zaloAccountId_externalThreadId: { zaloAccountId: accountId, externalThreadId: groupId } },
    create: {
      orgId, zaloAccountId: accountId, threadType: 'group',
      externalThreadId: groupId, groupName: groupName ?? undefined,
    },
    update: {},
    select: { id: true, groupGreetedAt: true, botGroupBlocked: true },
  });

  // 2. Đã chào rồi → dừng.
  if (conv.groupGreetedAt) {
    logger.info({ groupId }, '[chao-nhom] nhóm đã chào trước đó — bỏ qua');
    return true;
  }
  // 3. Nhóm bị chặn → dừng.
  if (conv.botGroupBlocked) {
    logger.info({ groupId }, '[chao-nhom] nhóm trong blocklist — bỏ qua');
    return true;
  }

  // 4. Đặt cờ NGAY (trước LLM/gửi) để chống 2 event trùng. updateMany có điều kiện
  //    groupGreetedAt=null để race thật sự chỉ 1 bên thắng.
  const chiem = await prisma.conversation.updateMany({
    where: { id: conv.id, groupGreetedAt: null },
    data: { groupGreetedAt: new Date() },
  });
  if (chiem.count === 0) {
    logger.info({ groupId }, '[chao-nhom] event join trùng — bên khác đã chiếm, bỏ qua');
    return true;
  }

  // 5. Đọc bối cảnh + sinh câu ngữ cảnh (mọi lỗi → chào khuôn thuần).
  let cauNguCanh = '';
  try {
    const history = await api.getGroupChatHistory(groupId, SO_TIN_DOC);
    const boiCanh = gomBoiCanh(history, botUid);
    if (boiCanh) {
      const gen = await dungGenerate(orgId);
      if (gen) {
        const kq = await gen({
          system:
            'Bạn giúp một trợ lý bán hàng viết MỘT câu ngắn (tối đa 20 từ) nêu chủ đề ' +
            'nhóm đang quan tâm, để chào cho tự nhiên. CHỈ trả đúng 1 câu, hoặc trả "không rõ" ' +
            'nếu không đoán được. TUYỆT ĐỐI không nhắc số tiền, đơn hàng, giá, khiếu nại, ' +
            'hứa hẹn, số điện thoại. Không chào, không giới thiệu — chỉ nêu chủ đề.',
          messages: [{ role: 'user', content: `Đoạn chat gần đây trong nhóm:\n${boiCanh}` }],
          tools: [],
        });
        cauNguCanh = locCauNguCanh(kq?.text);
      }
    }
  } catch (err) {
    logger.warn({ groupId, err: (err as Error).message }, '[chao-nhom] đọc bối cảnh lỗi — chào khuôn thuần');
  }

  // 6. Ghép + gửi.
  const loiChao = cauNguCanh ? `${khuonChao(tenShop)}\n${cauNguCanh}` : khuonChao(tenShop);
  const dich: DichGui = {
    accountId, threadId: groupId, threadType: 1, zaloUid: null, tenKhach: null, sdtKhach: null,
  };
  try {
    await guiTin(dich, loiChao, true);
    logger.info({ groupId, coNguCanh: Boolean(cauNguCanh) }, '[chao-nhom] đã chào nhóm');
  } catch (err) {
    logger.warn({ groupId, err: (err as Error).message }, '[chao-nhom] gửi lời chào lỗi (cờ đã set, không thử lại)');
  }
  return true;
}
