// SPDX-License-Identifier: AGPL-3.0-or-later
// Helper DỪNG-CÓ-LOG — chống "cổng im lặng" tái phát.
//
// BÀI HỌC TRẢ GIÁ (2026-08-05): bot không trả lời tin khách. Bốn cổng đầu vào
// của handler đều viết tay kiểu `if (...) return false;`, và HAI cổng đầu quên
// ghi log. Kết quả: không một manh mối nào trong log, phải gọi lại từng hàm
// bằng tay suốt cả tiếng mới tìm ra chỗ dừng.
//
// Cấu trúc hoá bài học đó: mọi lối thoát sớm PHẢI đi qua `dung(lyDo, chiTiet)`.
// Hàm ký kiểu trả về `false` nên dùng được thẳng trong `return dung(...)` —
// viết một cổng mới mà thiếu lý do là code không gõ nổi, không phải là chuyện
// "nhớ thì log".
import { logger } from '../../../../shared/utils/logger.js';

export type TenLuong = 'nv' | 'khach';

/**
 * Tạo hàm `dung` cho một luồng. Mỗi lần gọi ghi MỘT dòng warn có prefix thống
 * nhất `[agent/<luồng>] dừng: <lý do>` — grep một mẫu là ra mọi lần bot im.
 *
 * Dùng `warn` chứ không phải `debug`: logger.ts tắt debug khi
 * NODE_ENV=production, tức đúng lúc cần chẩn đoán nhất thì không thấy gì.
 */
export function taoDung(luong: TenLuong): (lyDo: string, chiTiet?: Record<string, unknown>) => false {
  return (lyDo, chiTiet) => {
    logger.warn(chiTiet ?? {}, `[agent/${luong}] dừng: ${lyDo}`);
    return false;
  };
}

/**
 * Hạn giờ CẢ LƯỢT — hàng rào cuối chống treo im lặng.
 *
 * BÀI HỌC TRẢ GIÁ (2026-08-05, lần hai): `taoDung` diệt được cổng im lặng ở
 * các nhánh `return`, nhưng KHÔNG phủ trường hợp code TREO giữa chừng. Thủ
 * phạm: một `fetch` không timeout trong embedding. Triệu chứng y hệt lần
 * trước — log dừng ở "BẮT ĐẦU xử lý", không lỗi, không XONG, khách chờ mãi.
 *
 * Từ nay mọi lượt agent phải chạy trong hàn giờ này. Quá hạn → ném, và
 * caller xử như mọi lỗi khác (báo nhân viên, giữ chân khách). Thà trả lời
 * muộn có lý do còn hơn im lặng vô tận.
 *
 * 90s: lượt bình thường 3-15s, trần LLM leo thang tối đa 40s × vài vòng tool.
 * Quá 90s nghĩa là hỏng chứ không phải chậm.
 */
export function hanGioLuot(): number {
  return Number(process.env.AI_AGENT_HAN_GIO_MS) || 90_000;
}

/**
 * Chạy `viec` với hạn giờ. Quá hạn → ném `Error` có chữ "quá hạn" để log đọc
 * ra ngay, thay vì treo vô tận.
 *
 * KHÔNG huỷ được việc đang chạy (Promise không huỷ được) — nhưng nó thành
 * việc mồ côi chạy nền, không còn chặn câu trả lời cho khách.
 */
export async function chayCoHanGio<T>(luong: TenLuong, viec: Promise<T>, ms = hanGioLuot()): Promise<T> {
  let hen: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      viec,
      new Promise<never>((_, tuChoi) => {
        hen = setTimeout(() => {
          logger.error({ ms }, `[agent/${luong}] QUÁ HẠN ${ms}ms — cắt lượt, không để treo im lặng`);
          tuChoi(new Error(`lượt agent quá hạn ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (hen) clearTimeout(hen);
  }
}

/** Log mốc bắt đầu/kết thúc với cùng prefix — đọc log thấy trọn vòng đời một lượt. */
export function taoMoc(luong: TenLuong): {
  batDau: (chiTiet: Record<string, unknown>) => number;
  xong: (t0: number, chiTiet: Record<string, unknown>) => void;
} {
  return {
    batDau: (chiTiet) => {
      logger.info(chiTiet, `[agent/${luong}] BẮT ĐẦU xử lý`);
      return Date.now();
    },
    xong: (t0, chiTiet) => {
      logger.info({ ms: Date.now() - t0, ...chiTiet }, `[agent/${luong}] XONG`);
    },
  };
}
