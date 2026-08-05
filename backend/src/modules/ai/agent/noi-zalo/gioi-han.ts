// SPDX-License-Identifier: AGPL-3.0-or-later
// GIỚI HẠN TIN / KHÁCH — chặn cost-DoS TRƯỚC cổng LLM.
//
// Rủi ro (bản đánh giá 05/08/2026): không có giới hạn nào — một người spam
// 1.000 tin là đốt ~200k đ tiền LLM, và bot trả lời máy móc 1.000 lần cũng
// đủ để Zalo gắn cờ nick. Giới hạn phải đứng TRƯỚC mọi lần gọi LLM: tin bị
// chặn không được tốn một token nào.
//
// Cửa sổ trượt trong RAM là đủ: một tiến trình duy nhất, restart thì đếm lại
// từ 0 — kẻ spam được "tha" vài phút sau mỗi lần deploy, chấp nhận được so
// với việc kéo thêm Redis vào chỉ cho một cái đếm.
import { logger } from '../../../../shared/utils/logger.js';

/** Trần tin mỗi KHÁCH mỗi giờ — vượt là im, đủ cho khách thật mặc cả sôi nổi. */
export function maxTinGio(): number {
  return Number(process.env.AI_AGENT_MAX_TIN_GIO ?? 15);
}

/** Trần tin mỗi KHÁCH mỗi ngày. */
export function maxTinNgay(): number {
  return Number(process.env.AI_AGENT_MAX_TIN_NGAY ?? 60);
}

const GIO_MS = 60 * 60_000;
const NGAY_MS = 24 * GIO_MS;

/** Mốc thời gian các tin đã tính, theo khoá khách. Tự cắt tỉa khi chạm. */
const lichSuTin = new Map<string, number[]>();

/** Cho test: xoá sạch bộ đếm. */
export function xoaBoDem(): void {
  lichSuTin.clear();
}

export type KetQuaGioiHan =
  | { cho: true }
  /** `lanDau` = true đúng MỘT lần (tin đầu tiên vượt trần) — dùng để xin phép
   *  khách một câu / báo nhân viên một lần, rồi im hẳn: bot không được thành
   *  cái máy lặp "em xin phép trả lời sau". */
  | { cho: false; lyDo: 'qua_tran_gio' | 'qua_tran_ngay'; lanDau: boolean };

/**
 * Đếm một tin đến của `khoa` (zaloUid hoặc conversationId) và phán cho/chặn.
 *
 * Gọi ĐÚNG MỘT lần cho mỗi tin, TRƯỚC khi đụng LLM. Tin bị chặn vẫn được đếm —
 * spam tiếp trong lúc bị chặn không giúp cửa sổ trôi nhanh hơn.
 */
export function demVaKiemTra(khoa: string, bayGio = Date.now()): KetQuaGioiHan {
  const cu = lichSuTin.get(khoa) ?? [];
  const trongNgay = cu.filter((t) => bayGio - t < NGAY_MS);
  const trongGio = trongNgay.filter((t) => bayGio - t < GIO_MS);

  const ketQua: KetQuaGioiHan =
    trongNgay.length >= maxTinNgay()
      ? { cho: false, lyDo: 'qua_tran_ngay', lanDau: trongNgay.length === maxTinNgay() }
      : trongGio.length >= maxTinGio()
        ? { cho: false, lyDo: 'qua_tran_gio', lanDau: trongGio.length === maxTinGio() }
        : { cho: true };

  trongNgay.push(bayGio);
  lichSuTin.set(khoa, trongNgay);

  if (!ketQua.cho) {
    logger.warn(
      { khoa, lyDo: ketQua.lyDo, tinTrongGio: trongGio.length, tinTrongNgay: trongNgay.length - 1 },
      '[agent/khach] chặn tin vượt giới hạn — KHÔNG gọi LLM',
    );
  }
  return ketQua;
}

/** Câu duy nhất bot nói khi khách vừa chạm trần giờ. */
export const CAU_XIN_PHEP =
  'Dạ em xin phép trả lời anh/chị sau một chút nhé, em đang xử lý ạ.';
