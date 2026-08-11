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
import { layDichBao, LOAI_VIEC, type LoaiViec } from './dich-bao.js';
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
  /**
   * Org của hội thoại — để tra đích báo trong DB (đa tổ chức, phải lọc).
   * THIẾU → rơi về env AI_AGENT_THREAD_BAO_SALE như trước, không ném.
   */
  orgId?: string;
  /** Loại việc để chọn đích. Mặc định "khách cần hỗ trợ". */
  loaiViec?: LoaiViec;
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

  // Đích lấy từ bảng agent_notify_targets (giao diện Cài đặt → "Người nhận
  // thông báo"); bảng rỗng thì rơi về env cũ. Xem thứ tự ưu tiên ở dich-bao.ts.
  const dsDich = await layDichBao(goi.orgId ?? '', goi.loaiViec ?? LOAI_VIEC.KHACH_CAN_HO_TRO);
  if (dsDich.length === 0) {
    logger.warn(
      { conversationId: goi.conversationId, lyDo: goi.lyDo, orgId: goi.orgId },
      '[agent/khach] bot bí nhưng CHƯA cấu hình nơi nhận thông báo — nhân viên chỉ còn log này',
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

  // Gửi TUẦN TỰ và bọc try riêng từng đích: một nhóm bị Zalo chặn không được
  // nuốt tin của những đích còn lại (trước đây chỉ một đích nên không cần).
  for (const noi of dsDich) {
    try {
      // Không giả nhịp người — nhân viên biết đây là bot, chờ 9s là vô ích.
      await guiTin(
        { accountId: dich.accountId, threadId: noi.threadId, threadType: noi.threadType, zaloUid: null, tenKhach: null, sdtKhach: null },
        noiDung,
        false,
      );
      logger.info({ conversationId: goi.conversationId, dich: noi.tenGoi }, '[agent/khach] ĐÃ báo nhân viên');
    } catch (err) {
      logger.error(
        { err, conversationId: goi.conversationId, dich: noi.tenGoi },
        '[agent/khach] báo nhân viên LỖI — khách vẫn được giữ chân',
      );
    }
  }
  return true;
}
