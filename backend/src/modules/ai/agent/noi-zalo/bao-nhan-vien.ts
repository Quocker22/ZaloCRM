// SPDX-License-Identifier: AGPL-3.0-or-later
// BÁO NHÂN VIÊN — khi bot bí, khách KHÔNG được rơi vào im lặng.
//
// Bug gốc (05/08/2026, bản đánh giá): mọi nhánh `chua_hoan_tat` và lỗi-sau-tool
// đều kết thúc bằng im lặng hoàn toàn — khách chờ vô vọng nếu nhân viên không
// tình cờ mở CRM. Chuẩn handoff: (1) khách luôn có một câu giữ chân, (2) nhân
// viên nhận GÓI NGỮ CẢNH — khách là ai, hỏi gì, bot kẹt ở đâu — để vào tiếp
// chuyện ngay, không phải hỏi lại khách từ đầu.
//
// Hợp đồng: `baoNhanVien` KHÔNG BAO GIỜ ném — báo lỗi không được làm vỡ luồng
// trả khách. Trả `true` = lần bí ĐẦU TIÊN trong cửa sổ throttle (caller gửi câu
// giữ chân); `false` = đã báo gần đây, đừng lặp lại câu giữ chân y hệt (lộ bot).
//
// Câu giữ chân KHÔNG phụ thuộc cấu hình thread báo: thiếu env thì nhân viên
// chỉ còn log để dò, nhưng khách vẫn phải nhận được một câu — im lặng là điều
// duy nhất bị cấm ở đây.
import { logger } from '../../../../shared/utils/logger.js';
import { threadBaoSale } from './cong-tac.js';
import { guiTin, type DichGui } from './gui-zalo.js';

/** Câu giữ chân khách — hứa NGƯỜI sẽ trả lời, không hứa nội dung (không đụng
 *  hàng rào `khoeDaLenDon`: đây không phải lời khoe đã làm gì). */
export const CAU_GIU_CHAN = 'Dạ anh/chị chờ em chút nhé, em kiểm tra rồi báo lại ngay ạ.';

/** Mỗi hội thoại chỉ báo một lần trong khoảng này — bot bí 5 lần liên tiếp
 *  không được thành 5 tin dội nhóm sale + 5 câu giữ chân y hệt dội khách. */
export const KHOANG_LANG_BAO_MS = 10 * 60_000;

const lanBaoCuoi = new Map<string, number>();

/** Cho test: xoá trạng thái throttle giữa các case. */
export function xoaLichSuBao(): void {
  lanBaoCuoi.clear();
}

/** Gói ngữ cảnh nhân viên cần để tiếp chuyện ngay, khỏi hỏi lại khách. */
export interface GoiNguCanh {
  conversationId: string;
  /** Bot kẹt vì sao — lấy từ `lyDo` của agent hoặc thông điệp lỗi. */
  lyDo: string;
  /** Tin khách vừa nhắn — thứ đang chờ được trả lời. */
  tinKhach: string;
  soToolDaChay?: number;
}

/**
 * Báo nhân viên một hội thoại đang kẹt, throttle theo conversation.
 *
 * Gửi từ CHÍNH tài khoản Zalo đang tiếp khách (`dich.accountId`) — không cần
 * thêm tài khoản nào, và nhân viên thấy ngay nick nào đang kẹt.
 */
export async function baoNhanVien(dich: DichGui, goi: GoiNguCanh): Promise<boolean> {
  const truoc = lanBaoCuoi.get(goi.conversationId);
  if (truoc !== undefined && Date.now() - truoc < KHOANG_LANG_BAO_MS) {
    logger.info({ conversationId: goi.conversationId }, '[agent/khach] đã báo trong cửa sổ throttle — không lặp lại');
    return false;
  }
  lanBaoCuoi.set(goi.conversationId, Date.now());

  const noi = threadBaoSale();
  if (!noi) {
    logger.warn(
      { conversationId: goi.conversationId, lyDo: goi.lyDo },
      '[agent/khach] bot bí nhưng CHƯA cấu hình AI_AGENT_THREAD_BAO_SALE — nhân viên chỉ còn log này',
    );
    return true; // vẫn là lần bí đầu tiên — khách vẫn phải nhận câu giữ chân
  }

  const khach = [dich.tenKhach, dich.sdtKhach].filter(Boolean).join(' · ') || 'chưa rõ tên';
  const noiDung = [
    '[BOT CẦN NGƯỜI] Vào trả lời giúp khách nhé.',
    `Khách: ${khach}`,
    `Khách nhắn: "${goi.tinKhach.slice(0, 200)}"`,
    `Bot kẹt: ${goi.lyDo.slice(0, 300)}`,
    ...(goi.soToolDaChay ? [`Bot đã tra Odoo ${goi.soToolDaChay} lần — xem tool_call_logs nếu cần.`] : []),
    `Hội thoại CRM: ${goi.conversationId}`,
  ].join('\n');

  try {
    // Không giả nhịp người — nhân viên biết đây là bot, chờ 9s là vô ích.
    await guiTin(
      { accountId: dich.accountId, threadId: noi.threadId, threadType: noi.threadType, zaloUid: null, tenKhach: null, sdtKhach: null },
      noiDung,
      false,
    );
    logger.info({ conversationId: goi.conversationId }, '[agent/khach] ĐÃ báo nhân viên');
  } catch (err) {
    logger.error({ err, conversationId: goi.conversationId }, '[agent/khach] báo nhân viên LỖI — khách vẫn được giữ chân');
  }
  return true;
}
