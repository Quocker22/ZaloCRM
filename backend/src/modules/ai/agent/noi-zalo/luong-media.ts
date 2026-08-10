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
import { chiCoEmoji } from './chi-co-emoji.js';
import { layCauHinhLlm } from './llm.js';
import { nhinAnhOpenaiCompat } from '../../providers/openai-compat.js';
import { bocUrlAnh, bocChuThich, docAnh, laLoaiDocDuoc, loiDanDocAnh } from './doc-anh.js';
import { xuLyTinNhanVien } from './luong-nhan-vien.js';
import { xuLyTinKhach } from './luong-khach.js';
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
 * Xử lý một tin media từ KHÁCH (1-1). Trả `true` = đã xử lý xong phần mình.
 *
 * KHÔNG chạy trong nhóm: giữ chân giữa nhóm đông người vừa vô nghĩa vừa ồn.
 * KHÔNG cần Odoo/LLM — chỉ cần công tắc luồng khách bật.
 */
export async function xuLyTinMedia(
  ctx: Pick<NgữCanhTin, 'orgId' | 'conversationId' | 'messageId' | 'laNhom'> & {
    /** Nội dung thô của tin — ẢNH giấu URL trong đây (JSON của zca-js). */
    content?: string;
    senderUid?: string | null;
    isSelf?: boolean;
    daTagBot?: boolean;
  },
  contentType: string,
): Promise<boolean> {
  if (!batLuongKhach()) return false;

  if (LOAI_BO_QUA.has(contentType)) {
    logger.info({ conversationId: ctx.conversationId, contentType }, '[agent/khach] sticker/gif — bỏ qua có chủ đích');
    return true;
  }

  // ẢNH — ĐỌC được (10/08). Anh Quốc: "làm bot đọc được ảnh… chỉ đọc ảnh rồi
  // lấy thông tin xử lý thôi". Chuyển ảnh thành CHỮ rồi ném vào đúng luồng
  // thường, nên toàn bộ nghiệp vụ sẵn có (gom đơn, tra khách, tool Odoo) dùng
  // được với ảnh mà không phải viết lại đường nào.
  //
  // Anh chốt: MỌI ảnh trong nhóm đều đọc, không cần tag.
  if (laLoaiDocDuoc(contentType)) {
    const daXu = await docVaChuyenTiep(ctx, contentType);
    if (daXu) return true;
    // Đọc không được → rơi xuống đường báo nhân viên bên dưới, KHÔNG im lặng.
  }

  // Từ đây là loại CHƯA đọc được (voice/video/file) hoặc ảnh đọc hỏng.
  // Nhóm thì không giữ chân — giữa nhóm đông người vừa vô nghĩa vừa ồn.
  if (ctx.laNhom) return false;

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

/**
 * Đọc ảnh → chữ → ném vào ĐÚNG luồng như một tin chữ bình thường.
 *
 * Trả `true` nếu đã xử xong (đọc được và đã chuyển tiếp); `false` để caller đi
 * tiếp đường báo nhân viên — đọc hỏng thì tuyệt đối không được im lặng.
 *
 * Vì sao chuyển tiếp thay vì tự trả lời: mọi nghiệp vụ (máy gom đơn, tra
 * khách, 3 tool Odoo, luật giá NV báo) đã nằm ở luồng chữ. Chuyển ảnh thành
 * chữ rồi đi đường cũ nghĩa là ảnh dùng được TẤT CẢ những thứ đó ngay, không
 * phải nhân bản logic sang một đường thứ hai rồi lệch nhau.
 */
async function docVaChuyenTiep(
  ctx: Pick<NgữCanhTin, 'orgId' | 'conversationId' | 'messageId' | 'laNhom'> & {
    content?: string; senderUid?: string | null; isSelf?: boolean; daTagBot?: boolean;
  },
  contentType: string,
): Promise<boolean> {
  const url = bocUrlAnh(ctx.content ?? '');
  if (!url) {
    logger.info({ conversationId: ctx.conversationId }, '[doc-anh] không tìm được URL ảnh');
    return false;
  }

  const chuThich = bocChuThich(ctx.content ?? '');
  const t0 = Date.now();
  const moTa = await docAnh({ goiModel: (a) => goiModelNhinAnh(ctx.orgId, a) }, { url, chuThich });
  if (!moTa) return false;

  logger.info(
    { conversationId: ctx.conversationId, ms: Date.now() - t0, moTa: moTa.slice(0, 80) },
    '[doc-anh] đã đọc ảnh',
  );

  // Câu đưa cho luồng thường: nói rõ đây là nội dung TỪ ẢNH để model không
  // tưởng khách gõ ra, và giữ lời nhắn kèm ảnh (thường mới là ý định thật:
  // "cái này bao nhiêu?", "lên đơn cái này").
  const cau = chuThich
    ? `${chuThich}\n[Khách gửi ảnh, nội dung trong ảnh: ${moTa}]`
    : `[Khách gửi ảnh, nội dung trong ảnh: ${moTa}]`;

  const ctxChu: NgữCanhTin = {
    orgId: ctx.orgId,
    bizName: '',
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    content: cau,
    senderUid: ctx.senderUid ?? null,
    isSelf: ctx.isSelf ?? false,
    laNhom: ctx.laNhom,
    daTagBot: ctx.daTagBot,
  };

  // Nhân viên trước (họ có quyền ghi), khách sau — đúng thứ tự message-handler.
  try {
    if (await xuLyTinNhanVien(ctxChu)) return true;
  } catch (err) {
    logger.warn({ err }, '[doc-anh] luồng nhân viên lỗi khi xử ảnh');
  }
  try {
    if (await xuLyTinKhach(ctxChu)) return true;
  } catch (err) {
    logger.warn({ err }, '[doc-anh] luồng khách lỗi khi xử ảnh');
  }

  // Đọc được ảnh nhưng không luồng nào nhận (vd nhóm không tag, câu không phải
  // việc của bot) → coi như đã xử, đừng báo nhân viên vì chẳng có gì cần người.
  return true;
}

/** Gọi provider nhìn ảnh — lấy key/URL từ cùng nguồn với luồng chat. */
async function goiModelNhinAnh(orgId: string, args: {
  model: string; anhBase64: string; kieuAnh: string; chuThich: string;
}): Promise<string> {
  const cfg = await layCauHinhLlm(orgId);
  if (!cfg) throw new Error('chưa cấu hình LLM');
  return nhinAnhOpenaiCompat({
    url: cfg.url,
    apiKey: cfg.apiKey,
    model: args.model,
    loiDan: loiDanDocAnh(args.chuThich),
    anhBase64: args.anhBase64,
    kieuAnh: args.kieuAnh,
  });
}
