// SPDX-License-Identifier: AGPL-3.0-or-later
// TIN KHÔNG PHẢI CHỮ — sticker, icon, ảnh, voice, video, file.
//
// Lỗ hổng gốc (06/08/2026): cả hai luồng agent chỉ nhận `contentType='text'`,
// mọi thứ khác rơi vào im lặng TUYỆT ĐỐI. Mà với shop bán hàng, ảnh khách gửi
// thường là ảnh CHUYỂN KHOẢN hoặc ảnh sản phẩm cần báo giá — im lặng ở đó là
// mất tiền thật, không phải mất lịch sự.
//
// Cách xử theo loại:
//   sticker/gif      → BỎ QUA có chủ đích. Người thật cũng không đáp sticker;
//                      trả lời "em đã nhận sticker" nghe máy móc hơn cả im lặng.
//   image/voice/     → KHÔNG đọc được nội dung → câu giữ chân + báo nhân viên
//   video/file         (tái dùng bao-nhan-vien, có sẵn throttle 10 phút).
//   text chỉ emoji   → như sticker: bỏ qua, KHÔNG gọi LLM ("👍" mà đi hết một
//                      lượt agent là đốt ~3k token cho một cái like).
import { logger } from '../../../../shared/utils/logger.js';
import { batLuongKhach } from './cong-tac.js';
import { timDich, guiTin } from './gui-zalo.js';
import { baoNhanVien } from './bao-nhan-vien.js';
import type { NgữCanhTin } from './types.js';

/** Loại tin media bot KHÔNG đọc được nhưng người gửi đang chờ phản hồi. */
const LOAI_CAN_NGUOI: Record<string, string> = {
  image: 'ảnh',
  photo: 'ảnh',
  voice: 'tin nhắn thoại',
  video: 'video',
  file: 'tệp',
};

/** Loại tin bỏ qua có chủ đích — đáp lại còn máy móc hơn im lặng. */
const LOAI_BO_QUA = new Set(['sticker', 'gif', 'link']);

/**
 * Text CHỈ còn emoji/ký tự trang trí sau khi bỏ khoảng trắng + dấu câu?
 *
 * "👍", "👌👌", "😀 !!" → true (bỏ qua, không gọi LLM).
 * "ok 👍", "10 cái"     → false (có chữ/số thật, xử lý bình thường).
 */
export function chiCoEmoji(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return true;
  // Bỏ mọi thứ KHÔNG phải chữ hoặc số (mọi bảng chữ cái Unicode) — còn lại gì
  // thì đó là nội dung thật.
  return !/[\p{L}\p{N}]/u.test(t);
}

/**
 * Xử lý một tin media từ KHÁCH (1-1). Trả `true` = đã xử lý xong phần mình.
 *
 * KHÔNG chạy trong nhóm: giữ chân giữa nhóm đông người vừa vô nghĩa vừa ồn.
 * KHÔNG cần Odoo/LLM — chỉ cần công tắc luồng khách bật.
 */
export async function xuLyTinMedia(
  ctx: Pick<NgữCanhTin, 'orgId' | 'conversationId' | 'messageId' | 'laNhom'>,
  contentType: string,
): Promise<boolean> {
  if (!batLuongKhach()) return false;
  if (ctx.laNhom) return false;

  if (LOAI_BO_QUA.has(contentType)) {
    logger.info({ conversationId: ctx.conversationId, contentType }, '[agent/khach] sticker/gif — bỏ qua có chủ đích');
    return true;
  }

  const loai = LOAI_CAN_NGUOI[contentType];
  if (!loai) return false; // loại lạ — để pipeline cũ tự xử

  const dich = await timDich(ctx.conversationId);
  if (!dich) return false;

  // baoNhanVien tự throttle theo hội thoại (10 phút): khách gửi album 5 tấm
  // ảnh thì chỉ MỘT câu giữ chân + MỘT tin báo, không phải 5.
  const lanDau = await baoNhanVien(dich, {
    conversationId: ctx.conversationId,
    lyDo: `khách gửi ${loai} — bot không đọc được, cần người xem`,
    tinKhach: `[${loai}]`,
  });
  if (lanDau) {
    try {
      await guiTin(dich, `Dạ em đã nhận được ${loai} của anh/chị, em xem rồi phản hồi ngay ạ.`, true);
    } catch (err) {
      logger.warn({ err, conversationId: ctx.conversationId }, '[agent/khach] gửi câu nhận media lỗi');
    }
  }
  logger.info({ conversationId: ctx.conversationId, contentType, lanDau }, '[agent/khach] media — đã báo nhân viên');
  return true;
}
